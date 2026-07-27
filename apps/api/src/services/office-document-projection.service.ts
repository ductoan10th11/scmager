import { getLatestTrackLog } from './langson-dwr.service';

export const idOf = (value: any) => String(value?._id ?? value ?? '');

export const parseOfficeDate = (value: unknown, endOfDay = false): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const raw = String(value).trim();
  const match = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/);
  if (match) {
    const [, day, month, year, hour, minute] = match;
    return new Date(`${year}-${month}-${day}T${hour ?? (endOfDay ? '23' : '00')}:${minute ?? (endOfDay ? '59' : '00')}:${endOfDay && !hour ? '59' : '00'}+07:00`);
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const officeDocumentProjection = (context: any) => {
  const observation = context.observation ?? {};
  const overrides = context.management?.overrides ?? {};
  const sync = context.statusSync ?? {};
  const completed = sync.completed === true;
  const latestTrackLog: any = getLatestTrackLog(sync.trackLogs ?? []);
  const completedAt = completed
    ? parseOfficeDate(latestTrackLog?.completedAt ?? latestTrackLog?.processingAt ?? latestTrackLog?.updatedAt ?? sync.completedAt)
    : null;
  const deadline = parseOfficeDate(overrides.dueDate ?? observation.dueDate, true);
  const assignment = context.management?.assignment ?? {};
  const workflowAssignee = sync.processing?.currentAssignee ?? null;
  const owner = assignment.userId || assignment.fullName
    ? {
        id: idOf(assignment.userId) || null,
        fullName: assignment.fullName ?? '',
        departmentId: idOf(assignment.departmentId) || null,
        departmentName: assignment.departmentName ?? '',
      }
    : {
        id: idOf(workflowAssignee?.userId) || null,
        fullName: workflowAssignee?.fullName ?? workflowAssignee?.externalFullName ?? '',
        departmentId: idOf(workflowAssignee?.departmentId) || null,
        departmentName: '',
      };
  const point = Number(context.management?.manualScore ?? overrides.point ?? observation.point ?? 0);
  const status = completed
    ? 'COMPLETED'
    : deadline && deadline.getTime() < Date.now()
      ? 'OVERDUE'
      : 'IN_PROGRESS';

  return {
    id: idOf(context),
    documentId: context.externalDocumentId,
    pageType: context.pageType,
    soKyHieu: overrides.soKyHieu ?? observation.soKyHieu ?? '',
    trichYeu: overrides.subject ?? observation.subject ?? '',
    ngayDen: overrides.receivedDate ?? observation.receivedDate ?? '',
    ngayBanHanh: overrides.createdDate ?? observation.createdDate ?? '',
    deadline,
    point: Number.isFinite(point) ? point : 0,
    reworkCount: Number(observation.reworkCount ?? 0),
    completed,
    completedAt,
    status,
    owner,
    trackLogs: sync.trackLogs ?? [],
    processing: sync.processing ?? null,
    observedAt: context.observedAt ?? context.createdAt ?? null,
    updatedAt: context.updatedAt ?? context.observedAt ?? null,
  };
};

export const officeDocumentScope = (actor: { id: string; organization?: string | null; department?: string | null; role: { code: string } }) => {
  const filter: Record<string, unknown> = { pageType: 'incoming' };
  if (actor.organization) filter.organizationId = actor.organization;
  else if (actor.role.code !== 'ADMIN') filter._id = null;
  if (actor.role.code === 'SPECIALIST') {
    filter['management.assignment.userId'] = actor.id;
  } else if (actor.role.code === 'DEPARTMENT_LEADER') {
    filter.$or = [
      { 'management.assignment.departmentId': actor.department },
      { 'management.assignment.userId': actor.id },
    ];
  }
  return filter;
};
