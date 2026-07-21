import type { AuthUser } from '../types/auth';
import { forbidden } from '../utils/http-error';
import {
  emitIngestCronEvent,
  setIngestSocketConnectionHandler,
} from '../realtime/ingest.socket';
import {
  runSprint,
  type DocumentIngestLogInfo,
  type SprintSummary,
} from './langson-ingest.service';

export type IngestCronLogLevel = 'INFO' | 'WARN' | 'ERROR';
export type IngestCronLogEvent =
  | 'CRON_STARTED'
  | 'CRON_STOPPED'
  | 'TICK_STARTED'
  | 'TICK_SKIPPED'
  | 'TICK_SCHEDULED'
  | 'TICK_SUCCEEDED'
  | 'TICK_FAILED'
  | 'DOC_ENRICHED'
  | 'RUN_REQUESTED';

export interface IngestCronLog {
  id: string;
  at: string;
  level: IngestCronLogLevel;
  event: IngestCronLogEvent;
  message: string;
  summary?: SprintSummary;
  error?: string;
  actor?: {
    id: string;
    username: string;
    fullName: string;
  };
}

export interface IngestCronStatus {
  enabled: boolean;
  running: boolean;
  intervalMs: number;
  jitterPercent: number;
  nextRunAt: string | null;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastSummary: SprintSummary | null;
  lastError: string;
  logSize: number;
}

const numberFromEnv = (name: string, fallback: number): number => {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const intervalMs = () => Math.max(
  60_000,
  numberFromEnv('LANGSON_INGEST_CRON_INTERVAL_MS', 15 * 60_000),
);
const jitterPercent = () => Math.min(
  50,
  Math.max(0, numberFromEnv('LANGSON_INGEST_CRON_JITTER_PERCENT', 15)),
);
const maxLogs = () => Math.min(
  10,
  Math.max(1, Math.floor(numberFromEnv('LANGSON_INGEST_CRON_LOG_LIMIT', 10))),
);

let timer: NodeJS.Timeout | null = null;
let enabled = false;
let running = false;
let nextRunAt: Date | null = null;
let lastStartedAt: Date | null = null;
let lastFinishedAt: Date | null = null;
let lastSummary: SprintSummary | null = null;
let lastError = '';
const logs: IngestCronLog[] = [];

const actorMeta = (actor?: AuthUser) => actor ? {
  id: actor.id,
  username: actor.username,
  fullName: actor.fullName,
} : undefined;

const ensureAdmin = (actor: AuthUser) => {
  if (actor.role.code !== 'ADMIN') {
    throw forbidden('Only ADMIN can manage ingest cron.');
  }
};

const status = (): IngestCronStatus => ({
  enabled,
  running,
  intervalMs: intervalMs(),
  jitterPercent: jitterPercent(),
  nextRunAt: nextRunAt?.toISOString() ?? null,
  lastStartedAt: lastStartedAt?.toISOString() ?? null,
  lastFinishedAt: lastFinishedAt?.toISOString() ?? null,
  lastSummary,
  lastError,
  logSize: logs.length,
});

const emitStatus = () => {
  try {
    emitIngestCronEvent('ingest:cron:status', status());
  } catch (error) {
    // Realtime is observational. Cron state must not depend on a socket emit.
    console.warn('[ingest-cron] could not emit status:', error instanceof Error ? error.message : String(error));
  }
};

const pushLog = (
  level: IngestCronLogLevel,
  event: IngestCronLogEvent,
  message: string,
  extra: Partial<Pick<IngestCronLog, 'summary' | 'error' | 'actor'>> = {},
) => {
  const log: IngestCronLog = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    at: new Date().toISOString(),
    level,
    event,
    message,
    ...extra,
  };

  logs.unshift(log);
  logs.splice(maxLogs());
  try {
    emitIngestCronEvent('ingest:cron:log', log);
  } catch (error) {
    console.warn('[ingest-cron] could not emit log:', error instanceof Error ? error.message : String(error));
  }
  emitStatus();
  return log;
};

const clearTimer = () => {
  if (!timer) return;
  clearTimeout(timer);
  timer = null;
};

const nextDelayMs = (): number => {
  const base = intervalMs();
  const spread = jitterPercent() / 100;
  if (!spread) return base;

  // Keep scheduled traffic from repeating at the same second while preserving
  // a bounded cadence around the configured interval.
  return Math.max(60_000, Math.round(base * (1 + ((Math.random() * 2 - 1) * spread))));
};

const reportUnexpectedTickError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  lastError = message;
  console.error('[ingest-cron] unexpected tick error:', message);
  try {
    pushLog('ERROR', 'TICK_FAILED', 'Ingest tick stopped unexpectedly.', { error: message });
  } catch {
    // Do not let a logging failure turn into an unhandled timer rejection.
  }
};

const runDetached = (scheduleAfter: boolean) => {
  void executeSprint(scheduleAfter).catch(reportUnexpectedTickError);
};

const scheduleNext = () => {
  clearTimer();
  if (!enabled) {
    nextRunAt = null;
    return;
  }

  const delay = nextDelayMs();
  nextRunAt = new Date(Date.now() + delay);
  timer = setTimeout(() => {
    void tick().catch(reportUnexpectedTickError);
  }, delay);
  timer.unref?.();
  pushLog(
    'INFO',
    'TICK_SCHEDULED',
    `Next ingest sprint scheduled at ${nextRunAt.toISOString()} (delay ${Math.round(delay / 1000)}s).`,
  );
};

const documentLogMessage = (info: DocumentIngestLogInfo) => {
  return [
    info.soKyHieu || '-',
    `Ngày đến ${info.ngayDen || '-'}`,
    `Tình trạng: ${info.completed ? 'Xong' : 'Đang xử lý'}`,
  ].join(' | ');
};

async function executeSprint(scheduleAfter: boolean): Promise<void> {
  if (running) {
    pushLog('WARN', 'TICK_SKIPPED', 'Skipped ingest sprint because a previous sprint is still running.');
    if (scheduleAfter) scheduleNext();
    return;
  }

  running = true;
  try {
    lastStartedAt = new Date();
    lastError = '';
    pushLog('INFO', 'TICK_STARTED', 'Ingest sprint started.');

    const summary = await runSprint({}, {
      onDocumentEnriched: (info) => {
        pushLog('INFO', 'DOC_ENRICHED', documentLogMessage(info));
      },
    });
    lastSummary = summary;
    lastFinishedAt = new Date();
    if (summary.errors.length) {
      lastError = summary.errors[0];
      pushLog('WARN', 'TICK_SUCCEEDED', 'Ingest sprint completed with recoverable errors.', { summary });
    } else {
      pushLog('INFO', 'TICK_SUCCEEDED', 'Ingest sprint completed.', { summary });
    }
  } catch (error) {
    lastFinishedAt = new Date();
    lastError = error instanceof Error ? error.message : String(error);
    pushLog('ERROR', 'TICK_FAILED', 'Ingest sprint failed.', { error: lastError });
  } finally {
    running = false;
    if (enabled && scheduleAfter) scheduleNext();
    else emitStatus();
  }
}

export async function tick(): Promise<void> {
  if (!enabled) return;
  await executeSprint(true);
}

export const ingestCronService = {
  getStatus(actor: AuthUser) {
    ensureAdmin(actor);
    return { data: status() };
  },

  getLogs(actor: AuthUser, limit = 100) {
    ensureAdmin(actor);
    return { data: logs.slice(0, Math.min(Math.max(limit, 1), maxLogs())) };
  },

  clearLogs(actor: AuthUser) {
    ensureAdmin(actor);
    logs.splice(0);
    try {
      emitIngestCronEvent('ingest:cron:logs-cleared', { at: new Date().toISOString() });
    } catch (error) {
      console.warn('[ingest-cron] could not emit logs-cleared:', error instanceof Error ? error.message : String(error));
    }
    emitStatus();
    return { data: logs };
  },

  start(actor: AuthUser) {
    ensureAdmin(actor);
    if (!enabled) {
      enabled = true;
      pushLog('INFO', 'CRON_STARTED', 'Ingest cron enabled.', { actor: actorMeta(actor) });
      runDetached(true);
    } else if (!running && !timer) {
      scheduleNext();
    }
    return { data: status() };
  },

  stop(actor: AuthUser) {
    ensureAdmin(actor);
    if (enabled) {
      enabled = false;
      clearTimer();
      nextRunAt = null;
      pushLog('INFO', 'CRON_STOPPED', 'Ingest cron disabled.', { actor: actorMeta(actor) });
    }
    emitStatus();
    return { data: status() };
  },

  async runNow(actor: AuthUser) {
    ensureAdmin(actor);
    pushLog('INFO', 'RUN_REQUESTED', 'Manual ingest sprint requested.', { actor: actorMeta(actor) });
    clearTimer();
    nextRunAt = null;
    emitStatus();
    runDetached(enabled);
    return { data: status() };
  },
};

setIngestSocketConnectionHandler((socket) => {
  socket.emit('ingest:cron:status', status());
});
