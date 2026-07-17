import mongoose from 'mongoose';
import { connectDB } from '../configs/mongo';
import { documentRepository } from '../repositories/document.repository';
import {
  getCsrfToken,
  getDocCount,
  getDocDetail,
  getDocList,
  getLatestTrackLogPoint,
  getTrackLog,
  isCompletedDocumentTrackLog,
  LANGSON_COMPLETED_RULE,
  newestNgayDenFilter,
  type DocDetailResult,
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
  maxAttempts: number;
  sessionHealDelayMs: number;
  dateWindowDays: number;
  dateTimeZone: string;
}

export interface DiscoverySummary {
  totalRecords: number;
  totalPages: number;
  scannedPages: number;
  scannedItems: number;
  skippedOutOfWindow: number;
  skippedWithoutDeadline: number;
  inserted: number;
  updated: number;
}

export interface EnrichSummary {
  selected: number;
  enriched: number;
  completed: number;
  failed: number;
  deadLettered: number;
  sessionHealed: number;
}

export interface SprintSummary {
  discovery: DiscoverySummary;
  enrichment: EnrichSummary;
}

export interface DocumentIngestLogInfo {
  documentId: string;
  soDen: string;
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
  const delayMinMs = envInt('LANGSON_INGEST_DELAY_MIN_MS', 1_000);
  const delayMaxMs = envInt('LANGSON_INGEST_DELAY_MAX_MS', 3_000);

  return {
    pageSize: envInt('LANGSON_DWR_DOC_PAGE_LIMIT', 50),
    delayMinMs,
    delayMaxMs: Math.max(delayMinMs, delayMaxMs),
    rateLimitMax: Math.max(1, envInt('LANGSON_INGEST_RATE_LIMIT_MAX', 2)),
    rateLimitDurationMs: Math.max(1, envInt('LANGSON_INGEST_RATE_LIMIT_DURATION_MS', 1_000)),
    orgPrefix: process.env.LANGSON_ORG_PREFIX ?? 'QLVB_LSN_XATHIENTAN.',
    retryBaseDelayMs: envInt('LANGSON_INGEST_RETRY_BASE_DELAY_MS', 5_000),
    retryMaxDelayMs: envInt('LANGSON_INGEST_RETRY_MAX_DELAY_MS', 15 * 60_000),
    maxAttempts: Math.max(1, envInt('LANGSON_INGEST_MAX_ATTEMPTS', 3)),
    sessionHealDelayMs: envInt('LANGSON_INGEST_SESSION_HEAL_DELAY_MS', 2_000),
    dateWindowDays: Math.max(1, envInt('LANGSON_INGEST_DATE_WINDOW_DAYS', 2)),
    dateTimeZone: process.env.LANGSON_INGEST_DATE_TIME_ZONE ?? 'Asia/Ho_Chi_Minh',
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
  const delay = Math.min(c.retryBaseDelayMs * 3 ** Math.max(0, attempts - 1), c.retryMaxDelayMs);
  return new Date(now.getTime() + delay);
}

function formatDateInTimeZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

function langsonDateKey(value: string): number | null {
  const match = value.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;

  const [, day, month, year] = match;
  return Number(year) * 10_000 + Number(month) * 100 + Number(day);
}

export function ingestDateWindow(c: IngestConfig, now = new Date()): string[] {
  const oneDayMs = 24 * 60 * 60 * 1000;
  return Array.from({ length: c.dateWindowDays }, (_, index) => (
    formatDateInTimeZone(new Date(now.getTime() - index * oneDayMs), c.dateTimeZone)
  ));
}

function classifyLangsonNgayDen(value: string, allowedDates: string[]): 'within' | 'older' | 'newer' | 'unknown' {
  const key = langsonDateKey(value);
  const allowedKeys = allowedDates
    .map(langsonDateKey)
    .filter((item): item is number => item !== null);

  if (key === null || allowedKeys.length === 0) return 'unknown';
  if (allowedKeys.includes(key)) return 'within';

  const min = Math.min(...allowedKeys);
  const max = Math.max(...allowedKeys);
  if (key < min) return 'older';
  if (key > max) return 'newer';
  return 'unknown';
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

function assertValidDetail(documentId: string, detail: DocDetailResult): void {
  const hasCoreData = [
    detail.soDen,
    detail.soKyHieu,
    detail.trichYeu,
    detail.donViBanHanh,
    detail.ngayDen,
  ].some((value) => String(value ?? '').trim());

  if (!hasCoreData) {
    throw new Error(`Langson session/detail response is empty for document ${documentId}`);
  }
}

function formatDocumentIngestLog(info: DocumentIngestLogInfo): string {
  return [
    `[langson-ingest] doc ok`,
    `soDen=${info.soDen || '-'}`,
    `soKyHieu=${info.soKyHieu || '-'}`,
    `ngayDen=${info.ngayDen || '-'}`,
    `vanThuPhucDap=${info.completed ? 'true' : 'false'}`,
  ].join(' ');
}

function emitDocumentIngestLog(info: DocumentIngestLogInfo, hooks: IngestHooks): void {
  console.info(formatDocumentIngestLog(info));
  hooks.onDocumentEnriched?.(info);
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
    const detail = await fetchWithSafety(c, limiter, () => getDocDetail(job.documentId, csrf));
    assertValidDetail(job.documentId, detail);

    const trackLogs = await fetchWithSafety(c, limiter, () => getTrackLog(job.documentId, c.orgPrefix, csrf));
    const completed = isCompletedDocumentTrackLog(trackLogs);
    const point = getLatestTrackLogPoint(trackLogs);
    const processing = await resolveDocumentWorkflow(trackLogs, completed);

    await documentRepository.markEnriched(job.documentId, {
      detail,
      trackLogs,
      completed,
      completedRule: completed ? LANGSON_COMPLETED_RULE : '',
      point: point?.point ?? 0,
      pointSource: point ? { trackLogId: point.trackLogId, comment: point.comment } : null,
      processing,
    });

    const logInfo = {
      documentId: job.documentId,
      soDen: detail.soDen,
      soKyHieu: detail.soKyHieu,
      ngayDen: detail.ngayDen,
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
  const csrf = await getCsrfToken();
  const filter = newestNgayDenFilter();
  const count = await getDocCount(filter, csrf, c.pageSize);
  const allowedDates = ingestDateWindow(c);
  const summary: DiscoverySummary = {
    totalRecords: count.totalRecords,
    totalPages: count.totalPages,
    scannedPages: 0,
    scannedItems: 0,
    skippedOutOfWindow: 0,
    skippedWithoutDeadline: 0,
    inserted: 0,
    updated: 0,
  };

  for (let page = 1; page <= count.totalPages; page++) {
    if (page > 1) await politeDelay(c);

    const docs = await getDocList(page, c.pageSize, filter, csrf);
    summary.scannedPages += 1;
    let stopAfterPage = false;

    for (const item of docs) {
      summary.scannedItems += 1;
      const dateStatus = classifyLangsonNgayDen(item.ngayDen, allowedDates);
      if (dateStatus !== 'within') {
        summary.skippedOutOfWindow += 1;
        if (dateStatus === 'older') stopAfterPage = true;
        continue;
      }
      if (!item.deadline) {
        summary.skippedWithoutDeadline += 1;
        continue;
      }

      const result = await documentRepository.upsertListItem(item);
      if (result.inserted) summary.inserted += 1;
      else summary.updated += 1;
    }

    if (stopAfterPage) break;
  }

  return summary;
}

export async function loadPendingIngestJobs(
  overrides: Partial<IngestConfig> = {},
): Promise<IngestJob[]> {
  const c = config(overrides);
  const pending = await documentRepository.findPendingForEnrichment(ingestDateWindow(c));
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
  let csrf = await getCsrfToken();
  const jobs = await loadPendingIngestJobs(overrides);
  const limiter = new IngestRateLimiter(c.rateLimitMax, c.rateLimitDurationMs);
  const summary: EnrichSummary = {
    selected: jobs.length,
    enriched: 0,
    completed: 0,
    failed: 0,
    deadLettered: 0,
    sessionHealed: 0,
  };

  for (const job of jobs) {
    try {
      const result = await processIngestJob(job, csrf, limiter, overrides, hooks);
      csrf = result.csrfToken;
      summary.enriched += 1;
      if (result.completed) summary.completed += 1;
      if (result.sessionHealed) summary.sessionHealed += 1;
    } catch (error) {
      const deadLetter = job.attempts >= c.maxAttempts;
      await documentRepository.markEnrichFailed(job.documentId, error, nextRetryAt(job.attempts, c), new Date(), deadLetter);
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
  const discovery = await runDiscovery(overrides);
  const enrichment = await runEnrichPending(overrides, hooks);
  return { discovery, enrichment };
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
      const summary = await runSprint();
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
