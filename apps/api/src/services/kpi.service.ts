import { getLatestTrackLog, getLatestTrackLogPoint } from './langson-dwr.service';
import { workingDaysLate } from './work-policy.service';

const parseLangsonDate = (value: unknown): Date | null => {
  const match = String(value ?? '').match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?$/);
  if (!match) return null;
  const [, day, month, year, hour = '00', minute = '00'] = match;
  return new Date(`${year}-${month}-${day}T${hour}:${minute}:00+07:00`);
};

const normalizeUsername = (value: unknown) => String(value ?? '')
  .trim()
  .toLowerCase()
  .replace(/\.lsn$/, '');

const logTimeValue = (log: any) => (
  log?.completedAt ?? log?.processingAt ?? log?.receivedAt ?? log?.updatedAt ?? null
);

const isResponseCreated = (log: any) => {
  const text = `${log?.action ?? ''} ${log?.content ?? ''}`
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return text.includes('đã tạo phúc đáp');
};

const participantMatches = (participant: any, username: unknown) => {
  const expected = normalizeUsername(username);
  if (!expected) return false;
  return [participant?.username, participant?.externalUsername]
    .map(normalizeUsername)
    .includes(expected);
};

export const calculateCreditedPoint = (basePoint: number, reworkCount: number, lateWorkingDays: number) => {
  const point = Math.max(0, Number(basePoint) || 0);
  const deductions = (Math.max(0, Number(reworkCount) || 0) * 0.25 * point)
    + (Math.max(0, Number(lateWorkingDays) || 0) * 0.25 * point);
  return Math.max(0, point - deductions);
};

/** Finds the actual recipient of the latest point declaration in a document. */
export const getDocumentPointAssignment = (document: any) => {
  const point = getLatestTrackLogPoint(document?.trackLogs ?? []);
  if (!point || Number(point.point) <= 0) return null;

  const pointLog: any = point.trackLog;
  const assignees = Array.isArray(document?.processing?.assignees)
    ? document.processing.assignees
    : [];
  const pointTime = logTimeValue(pointLog);
  const recipientUsername = pointLog?.receiver?.username;
  const assignee = assignees.find((item: any) => participantMatches(item, recipientUsername))
    ?? (point.trackLogId
      ? assignees.find((item: any) => String(item?.assignedTrackLogId ?? '') === String(point.trackLogId))
      : undefined)
    ?? assignees.find((item: any) => item?.assignedAt && item.assignedAt === pointTime);
  if (!assignee?.userId) return null;

  const responseTime = [...(document?.trackLogs ?? [])]
    .filter((log: any) => isResponseCreated(log) && participantMatches({
      username: log?.sender?.username,
      externalUsername: log?.sender?.username,
    }, assignee.externalUsername ?? assignee.username))
    .map((log: any) => parseLangsonDate(logTimeValue(log)))
    .filter((value: Date | null): value is Date => Boolean(value))
    .sort((left: Date, right: Date) => left.getTime() - right.getTime())
    .find((value: Date) => {
      const assignedAt = parseLangsonDate(assignee.assignedAt);
      return !assignedAt || value.getTime() >= assignedAt.getTime();
    }) ?? parseLangsonDate(assignee.processedAt);

  return {
    recipient: assignee.userId,
    submittedAt: responseTime,
    point: Number(point.point),
    trackLogId: point.trackLogId,
  };
};

/** Derives the live KPI state directly from one incoming document. */
export const getDocumentPerformanceProjection = (document: any) => {
  const assignment = getDocumentPointAssignment(document);
  const completed = document?.ingest?.completed === true
    || ['COMPLETED', 'MANUALLY_PROCESSED'].includes(document?.processing?.status);
  const completionLog = getLatestTrackLog(document?.trackLogs ?? []);
  const completedAt = parseLangsonDate(logTimeValue(completionLog));
  const deadline = document?.deadline ? new Date(document.deadline) : null;
  const lateWorkingDays = completed && deadline && assignment?.submittedAt
    ? workingDaysLate(deadline, assignment.submittedAt)
    : 0;
  const basePoint = Number(assignment?.point ?? 0);

  return {
    completed,
    recipient: assignment?.recipient ?? document?.processing?.currentAssignee?.userId ?? null,
    point: basePoint,
    submittedAt: assignment?.submittedAt ?? null,
    completedAt,
    lateWorkingDays,
    creditedPoint: completed
      ? calculateCreditedPoint(basePoint, Number(document?.reworkCount ?? document?.observation?.reworkCount ?? 0), lateWorkingDays)
      : 0,
  };
};
