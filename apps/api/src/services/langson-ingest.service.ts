import mongoose from 'mongoose';
import { connectDB } from '../configs/mongo';
import { documentRepository } from '../repositories/document.repository';
import { outgoingDocumentRepository } from '../repositories/outgoing-document.repository';
import {
  getCsrfToken,
  getDocCount,
  getDocList,
  getLatestTrackLogPoint,
  getRelatedDocuments,
  getTrackLog,
  isCompletedDocumentTrackLog,
  LANGSON_COMPLETED_RULE,
  deadlineDescendingFilter,
} from './langson-dwr.service';
import { resolveDocumentWorkflow } from './document-workflow.service';
import { langson } from './langson-client.service';

export interface IngestConfig {
  pageSize: number;
  delayMinMs: number;
  delayMaxMs: number;
  rateLimitMax: number;
  rateLimitDurationMs: number;
  orgPrefix: string;
  retryBaseDelayMs: number;
  retryMaxDelayMs: number;
  retryJitterRatio: number;
  maxAttempts: number;
  sessionHealDelayMs: number;
  dateTimeZone: string;
}

export interface DiscoverySummary {
  totalRecords: number;
  totalPages: number;
  scannedPages: number;
  scannedItems: number;
  skippedOutsideDocumentMonth: number;
  skippedWithoutDeadline: number;
  inserted: number;
  updated: number;
  failedPages: number;
  failedItems: number;
  errors: string[];
}

export interface EnrichSummary {
  selected: number;
  enriched: number;
  completed: number;
  failed: number;
  deadLettered: number;
  sessionHealed: number;
  errors: string[];
}

export interface SprintSummary {
  discovery: DiscoverySummary;
  enrichment: EnrichSummary;
  errors: string[];
}

export interface RelatedDocumentBackfillSummary extends EnrichSummary {
  withOutgoing: number;
}

export interface DocumentIngestLogInfo {
  documentId: string;
  soKyHieu: string;
  ngayDen: string;
  completed: boolean;
}

export interface IngestHooks {
  onDocumentEnriched?: (info: DocumentIngestLogInfo) => void;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;

  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function config(overrides: Partial<IngestConfig> = {}): IngestConfig {
  // One incoming record normally has only one or two related records. Keep the
  // complete eOffice graph responsive while the outer worker remains sequential.
  const delayMinMs = envInt('LANGSON_INGEST_DELAY_MIN_MS', 50);
  const delayMaxMs = envInt('LANGSON_INGEST_DELAY_MAX_MS', 150);
  const dateTimeZone = process.env.LANGSON_INGEST_DATE_TIME_ZONE ?? 'Asia/Ho_Chi_Minh';

  return {
    pageSize: envInt('LANGSON_DWR_DOC_PAGE_LIMIT', 50),
    delayMinMs,
    delayMaxMs: Math.max(delayMinMs, delayMaxMs),
    rateLimitMax: Math.max(1, envInt('LANGSON_INGEST_RATE_LIMIT_MAX', 8)),
    rateLimitDurationMs: Math.max(1, envInt('LANGSON_INGEST_RATE_LIMIT_DURATION_MS', 1_000)),
    orgPrefix: process.env.LANGSON_ORG_PREFIX ?? 'QLVB_LSN_XATHIENTAN.',
    retryBaseDelayMs: envInt('LANGSON_INGEST_RETRY_BASE_DELAY_MS', 5_000),
    retryMaxDelayMs: envInt('LANGSON_INGEST_RETRY_MAX_DELAY_MS', 15 * 60_000),
    retryJitterRatio: Math.min(0.5, envInt('LANGSON_INGEST_RETRY_JITTER_PERCENT', 20) / 100),
    maxAttempts: Math.max(1, envInt('LANGSON_INGEST_MAX_ATTEMPTS', 3)),
    sessionHealDelayMs: envInt('LANGSON_INGEST_SESSION_HEAL_DELAY_MS', 2_000),
    dateTimeZone,
    ...overrides,
  };
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function jitterDelayMs(c: IngestConfig): number {
  if (c.delayMaxMs <= c.delayMinMs) return c.delayMinMs;
  return c.delayMinMs + Math.floor(Math.random() * (c.delayMaxMs - c.delayMinMs + 1));
}

async function politeDelay(c: IngestConfig): Promise<void> {
  await sleep(jitterDelayMs(c));
}

function nextRetryAt(attempts: number, c: IngestConfig, now = new Date()): Date {
  const baseDelay = Math.min(
    c.retryBaseDelayMs * 3 ** Math.max(0, attempts - 1),
    c.retryMaxDelayMs,
  );
  const jitter = 1 + ((Math.random() * 2 - 1) * c.retryJitterRatio);
  const delay = Math.max(0, Math.round(baseDelay * jitter));
  return new Date(now.getTime() + delay);
}

function appendError(errors: string[], scope: string, error: unknown): void {
  // A remote outage can affect many records. Keep diagnostics useful without
  // retaining an unbounded number of duplicate messages in memory/socket payloads.
  if (errors.length >= 20) return;
  errors.push(`${scope}: ${errorMessage(error)}`.slice(0, 500));
}

function emptyDiscoverySummary(): DiscoverySummary {
  return {
    totalRecords: 0,
    totalPages: 0,
    scannedPages: 0,
    scannedItems: 0,
    skippedOutsideDocumentMonth: 0,
    skippedWithoutDeadline: 0,
    inserted: 0,
    updated: 0,
    failedPages: 0,
    failedItems: 0,
    errors: [],
  };
}

function emptyEnrichSummary(): EnrichSummary {
  return {
    selected: 0,
    enriched: 0,
    completed: 0,
    failed: 0,
    deadLettered: 0,
    sessionHealed: 0,
    errors: [],
  };
}

type DocumentMonthRange = {
  year: string;
  month: string;
  startDate: string;
  endDate: string;
};

function currentDocumentMonthRange(timeZone: string, now = new Date()): DocumentMonthRange {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  if (!year || !month) throw new Error('Unable to resolve current document month.');

  const lastDay = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  return {
    year,
    month,
    startDate: `01/${month}/${year}`,
    endDate: `${String(lastDay).padStart(2, '0')}/${month}/${year}`,
  };
}

function isWithinDocumentMonth(value: string, range: DocumentMonthRange): boolean {
  const match = value.trim().match(/^\d{2}\/(\d{2})\/(\d{4})$/);
  return match?.[1] === range.month && match?.[2] === range.year;
}

export class IngestRateLimiter {
  private readonly timestamps: number[] = [];

  constructor(private readonly max: number, private readonly durationMs: number) {}

  async wait(): Promise<void> {
    const now = Date.now();
    while (this.timestamps.length && now - this.timestamps[0] >= this.durationMs) {
      this.timestamps.shift();
    }

    if (this.timestamps.length >= this.max) {
      const waitMs = this.durationMs - (now - this.timestamps[0]);
      await sleep(waitMs);
      return this.wait();
    }

    this.timestamps.push(Date.now());
  }
}

export interface IngestJob {
  documentId: string;
  attempts: number;
}

export interface ProcessJobResult {
  documentId: string;
  completed: boolean;
  sessionHealed: boolean;
  csrfToken: string;
  logInfo: DocumentIngestLogInfo;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isSessionError(error: unknown): boolean {
  return /(401|403|unauthorized|forbidden|login|session|authentication|probe failed)/i.test(errorMessage(error));
}

async function healSession(c: IngestConfig): Promise<string> {
  await langson.dispose();
  await sleep(c.sessionHealDelayMs);
  return getCsrfToken();
}

async function fetchWithSafety<T>(
  c: IngestConfig,
  limiter: IngestRateLimiter,
  fn: () => Promise<T>,
): Promise<T> {
  await politeDelay(c);
  await limiter.wait();
  return fn();
}

function formatDocumentIngestLog(info: DocumentIngestLogInfo): string {
  return [
    `[langson-ingest] doc ok`,
    `soKyHieu=${info.soKyHieu || '-'}`,
    `ngayDen=${info.ngayDen || '-'}`,
    `vanThuPhucDap=${info.completed ? 'true' : 'false'}`,
  ].join(' ');
}

function emitDocumentIngestLog(info: DocumentIngestLogInfo, hooks: IngestHooks): void {
  console.info(formatDocumentIngestLog(info));
  try {
    hooks.onDocumentEnriched?.(info);
  } catch (error) {
    // The record is already persisted. A socket/log consumer must never turn a
    // successful ingest into a retryable failure.
    console.warn('[langson-ingest] onDocumentEnriched hook failed:', errorMessage(error));
  }
}

export async function processIngestJob(
  job: IngestJob,
  csrfToken: string,
  limiter: IngestRateLimiter,
  overrides: Partial<IngestConfig> = {},
  hooks: IngestHooks = {},
): Promise<ProcessJobResult> {
  const c = config(overrides);
  let csrf = csrfToken;
  let sessionHealed = false;

  const run = async () => {
    const [trackLogs, relatedDocuments] = await Promise.all([
      fetchWithSafety(c, limiter, () => getTrackLog(job.documentId, c.orgPrefix, csrf)),
      fetchWithSafety(c, limiter, () => getRelatedDocuments(job.documentId, c.orgPrefix, csrf)),
    ]);
    const completed = isCompletedDocumentTrackLog(trackLogs);
    const point = getLatestTrackLogPoint(trackLogs);
    const processing = await resolveDocumentWorkflow(trackLogs, completed);

    const sourceDocument = await documentRepository.markEnriched(job.documentId, {
      trackLogs,
      completed,
      completedRule: completed ? LANGSON_COMPLETED_RULE : '',
      point: point?.point ?? 0,
      processing,
    });
    if (!sourceDocument) throw new Error(`Incoming document ${job.documentId} no longer exists.`);
    await outgoingDocumentRepository.syncForIncoming(sourceDocument, relatedDocuments);

    const logInfo = {
      documentId: job.documentId,
      soKyHieu: String((sourceDocument as any).soKyHieu ?? ''),
      ngayDen: String((sourceDocument as any).ngayDen ?? ''),
      completed,
    };
    emitDocumentIngestLog(logInfo, hooks);

    return { completed, logInfo };
  };

  try {
    const result = await run();
    return {
      documentId: job.documentId,
      completed: result.completed,
      sessionHealed,
      csrfToken: csrf,
      logInfo: result.logInfo,
    };
  } catch (error) {
    if (!isSessionError(error)) throw error;

    sessionHealed = true;
    csrf = await healSession(c);
    const result = await run();
    return {
      documentId: job.documentId,
      completed: result.completed,
      sessionHealed,
      csrfToken: csrf,
      logInfo: result.logInfo,
    };
  }
}

export async function runDiscovery(overrides: Partial<IngestConfig> = {}): Promise<DiscoverySummary> {
  const c = config(overrides);
  const limiter = new IngestRateLimiter(c.rateLimitMax, c.rateLimitDurationMs);
  const csrf = await fetchWithSafety(c, limiter, () => getCsrfToken());
  const monthRange = currentDocumentMonthRange(c.dateTimeZone);
  const filter = deadlineDescendingFilter({
    txt_start_date_ngayden: monthRange.startDate,
    txt_end_date_ngayden: monthRange.endDate,
  });
  const count = await fetchWithSafety(c, limiter, () => getDocCount(filter, csrf, c.pageSize));
  const summary: DiscoverySummary = {
    totalRecords: count.totalRecords,
    totalPages: count.totalPages,
    scannedPages: 0,
    scannedItems: 0,
    skippedOutsideDocumentMonth: 0,
    skippedWithoutDeadline: 0,
    inserted: 0,
    updated: 0,
    failedPages: 0,
    failedItems: 0,
    errors: [],
  };

  let consecutivePageFailures = 0;

  for (let page = 1; page <= count.totalPages; page++) {
    let docs;
    try {
      docs = await fetchWithSafety(c, limiter, () => getDocList(page, c.pageSize, filter, csrf));
      consecutivePageFailures = 0;
    } catch (error) {
      summary.failedPages += 1;
      appendError(summary.errors, `list page ${page}`, error);
      console.warn(`[langson-ingest] list page ${page} failed:`, errorMessage(error));

      // One transient page error is allowed. Stop after two consecutive errors
      // so an upstream outage does not keep a sprint alive indefinitely.
      consecutivePageFailures += 1;
      if (consecutivePageFailures >= 2) break;
      continue;
    }

    summary.scannedPages += 1;
    let stopAfterPage = false;

    for (const item of docs) {
      summary.scannedItems += 1;
      if (!isWithinDocumentMonth(item.ngayDen, monthRange)) {
        summary.skippedOutsideDocumentMonth += 1;
        continue;
      }
      if (!item.deadline) {
        summary.skippedWithoutDeadline += 1;
        // DWR is sorted by deadline descending. Blank deadline records are
        // therefore the tail of this result set and cannot yield more work.
        stopAfterPage = true;
        break;
      }

      try {
        const result = await documentRepository.upsertListItem(item);
        if (result.inserted) summary.inserted += 1;
        else summary.updated += 1;
      } catch (error) {
        summary.failedItems += 1;
        appendError(summary.errors, `store ${item.documentId}`, error);
        console.warn(`[langson-ingest] could not store ${item.documentId}:`, errorMessage(error));
      }
    }

    if (stopAfterPage) break;
  }

  return summary;
}

export async function loadPendingIngestJobs(
  overrides: Partial<IngestConfig> = {},
): Promise<IngestJob[]> {
  const c = config(overrides);
  const monthRange = currentDocumentMonthRange(c.dateTimeZone);
  const pending = await documentRepository.findPendingForEnrichment(monthRange.year, monthRange.month);
  return pending.map((doc) => ({
    documentId: String((doc as any).documentId),
    attempts: Number((doc as any).ingest?.attempts ?? 0) + 1,
  }));
}

export async function runEnrichPending(
  overrides: Partial<IngestConfig> = {},
  hooks: IngestHooks = {},
): Promise<EnrichSummary> {
  const c = config(overrides);
  const summary = emptyEnrichSummary();
  let jobs: IngestJob[];
  try {
    jobs = await loadPendingIngestJobs(overrides);
  } catch (error) {
    appendError(summary.errors, 'load pending jobs', error);
    console.error('[langson-ingest] could not load pending jobs:', errorMessage(error));
    return summary;
  }

  summary.selected = jobs.length;
  if (!jobs.length) return summary;

  let csrf: string;
  try {
    csrf = await getCsrfToken();
  } catch (error) {
    appendError(summary.errors, 'get csrf token', error);
    console.error('[langson-ingest] could not start enrichment:', errorMessage(error));
    return summary;
  }

  const limiter = new IngestRateLimiter(c.rateLimitMax, c.rateLimitDurationMs);

  for (const job of jobs) {
    try {
      const result = await processIngestJob(job, csrf, limiter, overrides, hooks);
      csrf = result.csrfToken;
      summary.enriched += 1;
      if (result.completed) summary.completed += 1;
      if (result.sessionHealed) summary.sessionHealed += 1;
    } catch (error) {
      const deadLetter = job.attempts >= c.maxAttempts;
      appendError(summary.errors, `enrich ${job.documentId}`, error);
      console.warn(`[langson-ingest] enrich ${job.documentId} failed:`, errorMessage(error));
      try {
        await documentRepository.markEnrichFailed(
          job.documentId,
          error,
          nextRetryAt(job.attempts, c),
          new Date(),
          deadLetter,
        );
      } catch (persistError) {
        appendError(summary.errors, `persist failure ${job.documentId}`, persistError);
        console.error('[langson-ingest] could not persist job failure:', errorMessage(persistError));
        // Mongo is unavailable or unhealthy. Continuing would only pile up
        // connection work and make the process less responsive.
        break;
      }
      summary.failed += 1;
      if (deadLetter) summary.deadLettered += 1;
    }
  }

  return summary;
}

/**
 * One-off backfill for documents that were ingested before related documents
 * existed in the schema, or whose eOffice workflow has not created an outgoing
 * response yet. This deliberately ignores the normal current-month window.
 */
export async function runRelatedDocumentBackfill(
  overrides: Partial<IngestConfig> = {},
  hooks: IngestHooks = {},
): Promise<RelatedDocumentBackfillSummary> {
  const c = config(overrides);
  let csrf = await getCsrfToken();
  const pending = await documentRepository.findWithoutOutgoingRelations();
  const jobs = pending.map((doc) => ({
    documentId: String((doc as any).documentId),
    attempts: Number((doc as any).ingest?.attempts ?? 0) + 1,
  }));
  const limiter = new IngestRateLimiter(c.rateLimitMax, c.rateLimitDurationMs);
  const summary: RelatedDocumentBackfillSummary = {
    selected: jobs.length,
    enriched: 0,
    completed: 0,
    failed: 0,
    deadLettered: 0,
    sessionHealed: 0,
    errors: [],
    withOutgoing: 0,
  };

  for (const job of jobs) {
    try {
      const result = await processIngestJob(job, csrf, limiter, overrides, hooks);
      csrf = result.csrfToken;
      summary.enriched += 1;
      if (result.completed) summary.completed += 1;
      if (result.sessionHealed) summary.sessionHealed += 1;

      const document = await documentRepository.findByDocumentId(job.documentId);
      if (Number((document as any)?.ingest?.outgoingDocumentCount ?? 0) > 0) {
        summary.withOutgoing += 1;
      }
    } catch (error) {
      const deadLetter = job.attempts >= c.maxAttempts;
      appendError(summary.errors, `related backfill ${job.documentId}`, error);
      console.warn(`[langson-ingest] related backfill ${job.documentId} failed:`, errorMessage(error));
      try {
        await documentRepository.markEnrichFailed(
          job.documentId,
          error,
          nextRetryAt(job.attempts, c),
          new Date(),
          deadLetter,
        );
      } catch (persistError) {
        appendError(summary.errors, `persist failure ${job.documentId}`, persistError);
        console.error('[langson-ingest] could not persist related-document failure:', errorMessage(persistError));
        break;
      }
      summary.failed += 1;
      if (deadLetter) summary.deadLettered += 1;
    }
  }

  return summary;
}

export async function runSprint(
  overrides: Partial<IngestConfig> = {},
  hooks: IngestHooks = {},
): Promise<SprintSummary> {
  let discovery = emptyDiscoverySummary();
  let enrichment = emptyEnrichSummary();

  try {
    discovery = await runDiscovery(overrides);
  } catch (error) {
    discovery.failedPages = 1;
    appendError(discovery.errors, 'discovery', error);
    console.error('[langson-ingest] discovery failed:', errorMessage(error));
  }

  // Discovery failure must not block re-checking documents already stored and
  // still awaiting a final workflow state or an outgoing relation.
  try {
    enrichment = await runEnrichPending(overrides, hooks);
  } catch (error) {
    appendError(enrichment.errors, 'enrichment', error);
    console.error('[langson-ingest] enrichment failed:', errorMessage(error));
  }

  return { discovery, enrichment, errors: [...discovery.errors, ...enrichment.errors].slice(0, 20) };
}

function configureCliMongoUri(): void {
  if (process.env.LANGSON_INGEST_MONGO_URI) {
    process.env.MONGO_URI = process.env.LANGSON_INGEST_MONGO_URI;
    console.log('Using LANGSON_INGEST_MONGO_URI for ingest CLI.');
    return;
  }

  const uri = process.env.MONGO_URI;
  if (!uri) return;

  const hostFallback = process.env.LANGSON_INGEST_MONGO_HOST ?? '127.0.0.1';
  const rewritten = uri.replace(/([/@])mongodb(?=[:/,])/g, `$1${hostFallback}`);
  if (rewritten !== uri) {
    process.env.MONGO_URI = rewritten;
    console.log(`Using ingest CLI Mongo host fallback: mongodb -> ${hostFallback}.`);
  }
}

// Manual CLI only. This file is intentionally not imported by server startup.
// Example: pnpm exec tsx src/services/langson-ingest.service.ts
if (require.main === module) {
  (async () => {
    try {
      configureCliMongoUri();
      await connectDB();
      const summary = process.argv.includes('--related-backfill')
        ? await runRelatedDocumentBackfill()
        : await runSprint();
      console.log(JSON.stringify(summary, null, 2));
    } catch (error) {
      console.error('Langson ingest failed:', error);
      process.exitCode = 1;
    } finally {
      await langson.dispose();
      await mongoose.disconnect().catch(() => {});
    }
  })();
}
