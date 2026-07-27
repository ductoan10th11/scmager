import OfficeDocumentContextModel from '../models/office-document-context.model';
import {
  getCsrfToken,
  getLatestTrackLog,
  getLatestTrackLogPoint,
  getTrackLog,
  isCompletedDocumentTrackLog,
  LANGSON_COMPLETED_RULE,
  type TrackLogItem,
} from './langson-dwr.service';
import { resolveDocumentWorkflow } from './document-workflow.service';
import { langson } from './langson-client.service';

export type ExtensionStatusSyncSummary = {
  selected: number;
  synced: number;
  completed: number;
  failed: number;
  sessionHealed: number;
  errors: string[];
};

export type ExtensionStatusSyncLogInfo = {
  contextId: string;
  documentId: string;
  soKyHieu: string;
  status: 'PENDING_RESPONSE' | 'RESPONSE_CREATED' | 'IN_PROGRESS' | 'COMPLETED';
  completed: boolean;
};

export type ExtensionStatusSyncHooks = {
  onDocumentSynced?: (info: ExtensionStatusSyncLogInfo) => void;
};

type StatusOnlyDependencies = {
  getCsrfToken: typeof getCsrfToken;
  getTrackLog: typeof getTrackLog;
  resolveDocumentWorkflow: typeof resolveDocumentWorkflow;
  disposeSession: typeof langson.dispose;
};

const defaultDependencies: StatusOnlyDependencies = {
  getCsrfToken,
  getTrackLog,
  resolveDocumentWorkflow,
  disposeSession: langson.dispose,
};

const numberFromEnv = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
};

const config = () => ({
  limit: Math.min(100, Math.max(1, Math.floor(numberFromEnv('EXTENSION_STATUS_INGEST_BATCH_SIZE', 25)))),
  orgPrefix: process.env.LANGSON_ORG_PREFIX ?? 'QLVB_LSN_XATHIENTAN.',
  retryBaseMs: Math.max(1_000, numberFromEnv('EXTENSION_STATUS_INGEST_RETRY_BASE_MS', 60_000)),
  retryMaxMs: Math.max(60_000, numberFromEnv('EXTENSION_STATUS_INGEST_RETRY_MAX_MS', 60 * 60_000)),
  sessionHealDelayMs: Math.max(0, numberFromEnv('LANGSON_INGEST_SESSION_HEAL_DELAY_MS', 2_000)),
});

const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);
const isSessionError = (error: unknown) => /(401|403|unauthorized|forbidden|login|session|authentication|probe failed)/i.test(messageOf(error));
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const retryAt = (attempts: number, now: Date, c: ReturnType<typeof config>) => {
  const delay = Math.min(c.retryBaseMs * (2 ** Math.max(0, attempts - 1)), c.retryMaxMs);
  return new Date(now.getTime() + delay);
};

const responseCreated = (log: TrackLogItem | null) => String(log?.action ?? '')
  .normalize('NFC')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase() === 'đã tạo phúc đáp';

const withoutCoProcessors = (value: unknown) => String(value ?? '')
  .replace(/(?:^|\s)đồng\s*xử\s*lý\s*:\s*.*?(?=\s*(?:thao\s*tác|chuyển\s*tới|trả\s*lại)\s*:|$)/giu, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const peopleLabel = (people: Array<{ fullName?: string; username?: string }>) => people
  .map((person) => [person.fullName, person.username ? `(${person.username})` : ''].filter(Boolean).join(' '))
  .filter(Boolean)
  .join(', ');

const trackLogsForObservation = (trackLogs: TrackLogItem[]) => trackLogs.map((trackLog) => ({
  'Mã nhật ký': trackLog.id ?? '',
  TT: trackLog.sequence ? String(trackLog.sequence) : '',
  'Người gửi': [trackLog.sender.fullName, trackLog.sender.username ? `(${trackLog.sender.username})` : ''].filter(Boolean).join(' '),
  'Người nhận': peopleLabel(trackLog.recipients?.length ? trackLog.recipients : [trackLog.receiver]),
  'Chưa xử lý': trackLog.receivedAt ?? '',
  'Đang xử lý': trackLog.processingAt ?? '',
  'Đã xử lý': trackLog.completedAt ?? '',
  'Thời gian': trackLog.completedAt ?? trackLog.processingAt ?? trackLog.receivedAt ?? '',
  'Thao tác': trackLog.action ?? '',
  'Nội dung': withoutCoProcessors(trackLog.comment) || withoutCoProcessors(trackLog.content) || trackLog.action || '',
  'File văn bản': '',
}));

const statusFrom = (trackLogs: TrackLogItem[], completed: boolean, workflow: { status?: string }) => {
  if (completed) return 'COMPLETED' as const;
  if (responseCreated(getLatestTrackLog(trackLogs))) return 'RESPONSE_CREATED' as const;
  if (workflow.status === 'IN_PROGRESS') return 'IN_PROGRESS' as const;
  return 'PENDING_RESPONSE' as const;
};

const appendError = (summary: ExtensionStatusSyncSummary, documentId: string, error: unknown) => {
  if (summary.errors.length < 20) summary.errors.push(`${documentId}: ${messageOf(error)}`.slice(0, 500));
};

/**
 * Reads eOffice track logs for extension-origin incoming contexts only.
 * It deliberately never calls list/discovery APIs and never writes DocumentModel
 * or outgoing-document records.
 */
export async function runExtensionStatusOnlyIngest(
  hooks: ExtensionStatusSyncHooks = {},
  dependencies: StatusOnlyDependencies = defaultDependencies,
): Promise<ExtensionStatusSyncSummary> {
  const c = config();
  const now = new Date();
  const contexts = await OfficeDocumentContextModel.find({
    pageType: 'incoming',
    origin: { $ne: 'MANUAL' },
    'statusSync.completed': { $ne: true },
    $or: [
      { 'statusSync.nextRetryAt': null },
      { 'statusSync.nextRetryAt': { $lte: now } },
    ],
  })
    .sort({ 'statusSync.lastAttemptAt': 1, observedAt: 1 })
    .limit(c.limit)
    .lean();

  const summary: ExtensionStatusSyncSummary = {
    selected: contexts.length, synced: 0, completed: 0, failed: 0, sessionHealed: 0, errors: [],
  };
  if (!contexts.length) return summary;

  let csrf: string;
  try {
    csrf = await dependencies.getCsrfToken();
  } catch (error) {
    await Promise.all(contexts.map(async (context: any) => {
      const attempts = Number(context.statusSync?.attempts ?? 0) + 1;
      await OfficeDocumentContextModel.updateOne(
        { _id: context._id, 'statusSync.completed': { $ne: true } },
        { $set: {
          'statusSync.lastAttemptAt': now,
          'statusSync.nextRetryAt': retryAt(attempts, now, c),
          'statusSync.attempts': attempts,
          'statusSync.lastError': messageOf(error).slice(0, 1000),
        } },
      );
      summary.failed += 1;
      appendError(summary, context.externalDocumentId, error);
    }));
    return summary;
  }

  for (const context of contexts as any[]) {
    try {
      let trackLogs: TrackLogItem[];
      try {
        trackLogs = await dependencies.getTrackLog(context.externalDocumentId, c.orgPrefix, csrf);
      } catch (error) {
        if (!isSessionError(error)) throw error;
        summary.sessionHealed += 1;
        await dependencies.disposeSession();
        await wait(c.sessionHealDelayMs);
        csrf = await dependencies.getCsrfToken();
        trackLogs = await dependencies.getTrackLog(context.externalDocumentId, c.orgPrefix, csrf);
      }

      // The authoritative terminal event is the latest eOffice track log:
      // the office clerk has created the response.
      const completed = isCompletedDocumentTrackLog(trackLogs);
      const latestPoint = getLatestTrackLogPoint(trackLogs);
      const processing = await dependencies.resolveDocumentWorkflow(trackLogs, completed);
      const status = statusFrom(trackLogs, completed, processing);
      const updated = await OfficeDocumentContextModel.updateOne(
        { _id: context._id, 'statusSync.completed': { $ne: true } },
        { $set: {
          'statusSync.status': status,
          'statusSync.completed': completed,
          'statusSync.completedRule': completed ? LANGSON_COMPLETED_RULE : '',
          'statusSync.completedAt': completed ? now : null,
          'statusSync.trackLogs': trackLogs,
          'observation.point': latestPoint?.point ?? context.observation?.point ?? null,
          // Keep the detail timeline current with the full eOffice track log,
          // excluding only co-processor routing information.
          'observation.timeline': trackLogsForObservation(trackLogs),
          'statusSync.processing': processing,
          'statusSync.lastSyncedAt': now,
          'statusSync.lastAttemptAt': now,
          'statusSync.nextRetryAt': null,
          'statusSync.attempts': 0,
          'statusSync.lastError': '',
        } },
      );
      if (!updated.modifiedCount) continue;

      summary.synced += 1;
      if (completed) summary.completed += 1;
      hooks.onDocumentSynced?.({
        contextId: String(context._id),
        documentId: context.externalDocumentId,
        soKyHieu: String(context.observation?.soKyHieu ?? ''),
        status,
        completed,
      });
    } catch (error) {
      const attempts = Number(context.statusSync?.attempts ?? 0) + 1;
      await OfficeDocumentContextModel.updateOne(
        { _id: context._id, 'statusSync.completed': { $ne: true } },
        { $set: {
          'statusSync.lastAttemptAt': now,
          'statusSync.nextRetryAt': retryAt(attempts, now, c),
          'statusSync.attempts': attempts,
          'statusSync.lastError': messageOf(error).slice(0, 1000),
        } },
      );
      summary.failed += 1;
      appendError(summary, context.externalDocumentId, error);
    }
  }
  return summary;
}
