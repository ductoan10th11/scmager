import UserModel from '../models/user.model';
import type { AuthUser } from '../types/auth';
import type { TrackLogItem } from './langson-dwr.service';

type TrackLogActor = {
  externalUsername: string | null;
  fullName: string;
};

type RawParticipant = TrackLogActor & {
  key: string;
  assignedAt: string | null;
  assignedTrackLogId: string | null;
  processedAt: string | null;
  processedTrackLogId: string | null;
  // Position in the routing chain of the first hand-off to this participant.
  receivedOrder: number | null;
};

const idOf = (value: any) => String(value?._id ?? value ?? '');

const trackLogTime = (log: TrackLogItem): number => {
  const raw = log.completedAt ?? log.processingAt ?? log.receivedAt;
  const match = raw?.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})$/);
  if (!match) return Number.NaN;
  const [, day, month, year, hour, minute] = match;
  return new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute)).getTime();
};

const chronologicalTrackLogs = (trackLogs: TrackLogItem[]) => [...trackLogs].sort((a, b) => {
  const aTime = trackLogTime(a);
  const bTime = trackLogTime(b);
  if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) return aTime - bTime;
  const aId = Number(a.id);
  const bId = Number(b.id);
  if (Number.isFinite(aId) && Number.isFinite(bId) && aId !== bId) return aId - bId;
  return trackLogs.indexOf(a) - trackLogs.indexOf(b);
});

const actorFrom = (actor: TrackLogItem['sender']): TrackLogActor | null => {
  const fullName = String(actor?.fullName ?? '').trim();
  const parsedUsername = String(actor?.username ?? '').trim().toLowerCase();
  const match = fullName.match(/\(([^()]+)\)\s*\.?\s*$/);
  const externalUsername = parsedUsername || match?.[1]?.trim().toLowerCase() || null;
  if (!fullName && !externalUsername) return null;

  return {
    fullName,
    externalUsername,
  };
};

const actorKey = (actor: TrackLogActor) => actor.externalUsername || actor.fullName.toLowerCase();
const eventTime = (log: TrackLogItem) => log.completedAt ?? log.processingAt ?? log.receivedAt ?? null;
const isResponseCreated = (log: TrackLogItem | null) => String(log?.action ?? '')
  .normalize('NFC')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase() === 'đã tạo phúc đáp';

const usernameCandidates = (externalUsername: string | null) => {
  if (!externalUsername) return [];
  const exact = externalUsername.toLowerCase();
  const withoutLangsonSuffix = exact.replace(/\.lsn$/, '');
  return [...new Set([exact, withoutLangsonSuffix].filter(Boolean))];
};

const rawWorkflow = (trackLogs: TrackLogItem[], completed: boolean) => {
  const ordered = chronologicalTrackLogs(trackLogs);
  const participants = new Map<string, RawParticipant>();
  const getParticipant = (actor: TrackLogActor) => {
    const key = actorKey(actor);
    const existing = participants.get(key);
    if (existing) return existing;
    const created: RawParticipant = {
      ...actor,
      key,
      assignedAt: null,
      assignedTrackLogId: null,
      processedAt: null,
      processedTrackLogId: null,
      receivedOrder: null,
    };
    participants.set(key, created);
    return created;
  };

  let handoffIndex = 0;
  for (const log of ordered) {
    const sender = actorFrom(log.sender);
    if (sender) {
      const participant = getParticipant(sender);
      participant.processedAt = eventTime(log);
      participant.processedTrackLogId = String(log.id ?? '') || null;
    }
    const receivers = log.recipients?.length
      ? log.recipients.map((person) => actorFrom(person)).filter(Boolean)
      : [actorFrom(log.receiver)].filter(Boolean);
    for (const receiver of receivers as TrackLogActor[]) {
      const participant = getParticipant(receiver);
      participant.assignedAt = eventTime(log);
      participant.assignedTrackLogId = String(log.id ?? '') || null;
      if (participant.receivedOrder === null) {
        handoffIndex += 1;
        participant.receivedOrder = handoffIndex;
      }
    }
  }

  const latest = ordered.at(-1) ?? null;
  // A specialist creating a response has not completed the incoming document.
  // eOffice does not always return a receiver for this event, so keep that
  // specialist as the current actor until the commune clerk creates the response.
  const current = completed || !latest
    ? null
    : actorFrom(latest.receiver) ?? (isResponseCreated(latest) ? actorFrom(latest.sender) : null);
  const currentKey = current ? actorKey(current) : null;
  return {
    status: completed ? 'COMPLETED' : current ? 'IN_PROGRESS' : 'UNASSIGNED',
    currentKey,
    participants: [...participants.values()],
  };
};

export const resolveDocumentWorkflow = async (trackLogs: TrackLogItem[], completed: boolean) => {
  const raw = rawWorkflow(trackLogs, completed);
  const candidateUsernames = [...new Set(raw.participants.flatMap((participant) => usernameCandidates(participant.externalUsername)))];
  const users = candidateUsernames.length
    ? await UserModel.find({ username: { $in: candidateUsernames }, status: 'ACTIVE' })
      .select('_id username fullName position department role')
      .populate('role', 'code')
      .lean()
    : [];
  const userByUsername = new Map(users.map((user: any) => [String(user.username).toLowerCase(), user]));
  const toSnapshot = (participant: RawParticipant) => {
    const user = usernameCandidates(participant.externalUsername)
      .map((candidate) => userByUsername.get(candidate))
      .find(Boolean) as any;
    return {
      userId: user?._id ?? null,
      username: user?.username ?? null,
      externalUsername: participant.externalUsername,
      fullName: user?.fullName ?? participant.fullName,
      externalFullName: participant.fullName,
      position: user?.position ?? null,
      departmentId: user?.department ?? null,
      roleCode: (user?.role as any)?.code ?? null,
      receivedOrder: participant.receivedOrder,
      status: ['COMPLETED', 'MANUALLY_PROCESSED'].includes(raw.status) || participant.key !== raw.currentKey ? 'PROCESSED' : 'PENDING',
      assignedAt: participant.assignedAt,
      assignedTrackLogId: participant.assignedTrackLogId,
      processedAt: participant.processedAt,
      processedTrackLogId: participant.processedTrackLogId,
    };
  };
  const assignees = raw.participants.map(toSnapshot);
  const currentAssignee = raw.currentKey
    ? assignees.find((participant) => (participant.externalUsername || participant.externalFullName.toLowerCase()) === raw.currentKey) ?? null
    : null;

  /**
   * The specialist who received the document first is the one credited with the
   * work. A chain such as office chief → department leader → specialist routes
   * through managers whose job is dispatching, not doing; and anyone the first
   * specialist forwards to afterwards is assisting, not owning it.
   */
  const primaryAssignee: (typeof assignees)[number] | null = assignees
    .filter((participant) => participant.roleCode === 'SPECIALIST' && participant.userId && participant.receivedOrder)
    .sort((left, right) => Number(left.receivedOrder) - Number(right.receivedOrder))[0] ?? null;

  return { status: raw.status, currentAssignee, primaryAssignee, assignees };
};

export const documentWorkflowFiltersFor = async (actor: AuthUser, options: { includeDepartment?: boolean } = {}) => {
  if (['ADMIN', 'OFFICE_CHIEF', 'COMMUNE_LEADER'].includes(actor.role.code)) {
    return { participant: {}, current: {}, processed: {} };
  }

  let userIds = [actor.id];
  if (options.includeDepartment !== false && actor.role.code === 'DEPARTMENT_LEADER' && actor.department) {
    const departmentUsers = await UserModel.find({ department: actor.department, status: 'ACTIVE' }).select('_id').lean();
    userIds = [...new Set([...departmentUsers.map((user: any) => idOf(user)), actor.id])];
  }

  return {
    participant: { 'processing.assignees.userId': { $in: userIds } },
    current: { 'processing.currentAssignee.userId': { $in: userIds } },
    processed: { 'processing.assignees': { $elemMatch: { userId: { $in: userIds }, status: 'PROCESSED' } } },
  };
};
