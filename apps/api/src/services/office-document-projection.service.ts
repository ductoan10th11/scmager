import {
  effectiveOfficeDocumentCompletion,
  effectiveOfficeDocumentPoint,
  effectiveOfficeDocumentReworkCount,
} from './office-document-completion.service';

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
  const completion = effectiveOfficeDocumentCompletion(context);
  const completed = completion.completed;
  const completedAt = completion.completedAt;
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
  const point = effectiveOfficeDocumentPoint(context);
  const status = completed
    ? 'COMPLETED'
    : deadline && deadline.getTime() < Date.now()
      ? 'OVERDUE'
      : 'IN_PROGRESS';

  const bottleneck = (() => {
    if (context.pageType !== 'incoming') {
      return {
        stage: 'OUTGOING_HOLDING',
        role: null,
        roleLabel: 'Văn bản đi',
        name: owner.fullName || 'Chưa xác định',
        departmentId: owner.departmentId || null,
        departmentName: owner.departmentName || null,
        isLate: false,
        label: owner.fullName ? `Đang giữ: ${owner.fullName}` : 'Văn bản đi',
      };
    }
    if (completed) {
      return {
        stage: 'COMPLETED',
        role: null,
        roleLabel: 'Đã hoàn thành',
        name: owner.fullName || 'Đã hoàn thành',
        departmentId: owner.departmentId || null,
        departmentName: owner.departmentName || null,
        isLate: false,
        label: 'Đã hoàn thành',
      };
    }
    // 1. Chuyên viên đang thụ lý:
    // Văn bản đã đến tay chuyên viên (kể cả do Trưởng phòng giao hoặc Chánh văn phòng bypass chuyển thẳng)
    if (
      workflowAssignee?.roleCode === 'SPECIALIST' ||
      sync.processing?.primaryAssignee?.roleCode === 'SPECIALIST'
    ) {
      const name = workflowAssignee?.fullName || sync.processing?.primaryAssignee?.fullName || owner.fullName || 'Chuyên viên';
      return {
        stage: 'SPECIALIST_PROCESSING',
        role: 'SPECIALIST',
        roleLabel: 'Chuyên viên thụ lý',
        name,
        departmentId: owner.departmentId || null,
        departmentName: owner.departmentName || null,
        isLate: status === 'OVERDUE',
        label: `Chuyên viên đang xử lý: ${name}`,
      };
    }
    // 2. Chờ Chánh văn phòng phân phòng:
    if (workflowAssignee?.roleCode === 'OFFICE_CHIEF') {
      const name = workflowAssignee?.fullName || 'Chánh văn phòng';
      return {
        stage: 'OFFICE_CHIEF_PENDING',
        role: 'OFFICE_CHIEF',
        roleLabel: 'Chánh văn phòng',
        name,
        departmentId: null,
        departmentName: null,
        isLate: status === 'OVERDUE',
        label: `Chờ Chánh VP phân phòng: ${name}`,
      };
    }
    // 3. Chờ Trưởng phòng giao việc:
    // Chưa đến tay chuyên viên, nhưng đã về phòng ban (bám theo role chuyên viên)
    if (
      workflowAssignee?.roleCode === 'DEPARTMENT_LEADER' ||
      owner.departmentId ||
      workflowAssignee?.departmentId
    ) {
      const deptName = owner.departmentName || 'Phòng ban';
      const name = workflowAssignee?.fullName || owner.fullName || `Trưởng phòng (${deptName})`;
      return {
        stage: 'DEPARTMENT_LEADER_PENDING',
        role: 'DEPARTMENT_LEADER',
        roleLabel: 'Trưởng phòng',
        name,
        departmentId: owner.departmentId || workflowAssignee?.departmentId || null,
        departmentName: deptName,
        isLate: status === 'OVERDUE',
        label: `Chờ Trưởng phòng giao việc: ${name}`,
      };
    }
    return {
      stage: 'OFFICE_CHIEF_PENDING',
      role: 'OFFICE_CHIEF',
      roleLabel: 'Chánh văn phòng',
      name: 'Chánh văn phòng',
      departmentId: null,
      departmentName: null,
      isLate: status === 'OVERDUE',
      label: 'Chờ Chánh VP phân phòng',
    };
  })();

  return {
    id: idOf(context),
    documentId: context.externalDocumentId,
    pageType: context.pageType,
    soKyHieu: overrides.soKyHieu ?? observation.soKyHieu ?? '',
    trichYeu: overrides.subject ?? observation.subject ?? '',
    ngayDen: overrides.receivedDate ?? observation.receivedDate ?? '',
    ngayBanHanh: overrides.createdDate ?? observation.createdDate ?? '',
    deadline,
    point,
    reworkCount: effectiveOfficeDocumentReworkCount(context),
    completed,
    completedAt,
    completionSource: completion.source,
    status,
    owner,
    bottleneck,
    trackLogs: sync.trackLogs ?? [],
    processing: sync.processing ?? null,
    observedAt: context.observedAt ?? context.createdAt ?? null,
    updatedAt: context.updatedAt ?? context.observedAt ?? null,
  };
};

export const officeDocumentScope = (actor: { id: string; username?: string; organization?: string | null; department?: string | null; role: { code: string } }) => {
  const filter: Record<string, unknown> = { pageType: 'incoming' };
  if (actor.organization) filter.organizationId = actor.organization;
  else if (actor.role.code !== 'ADMIN') filter._id = null;
  if (actor.role.code === 'SPECIALIST') {
    filter.$or = [
      { 'management.assignment.userId': actor.id },
      { 'statusSync.processing.currentAssignee.userId': actor.id },
      { 'statusSync.processing.currentAssignee.externalUsername': actor.username },
      { 'statusSync.processing.currentAssignee.username': actor.username },
      { 'statusSync.processing.assignees': { $elemMatch: { userId: actor.id } } },
      { 'statusSync.processing.assignees': { $elemMatch: { externalUsername: actor.username } } },
      { 'observation.recipients': { $elemMatch: { role: 'main', userId: actor.username } } },
    ];
  } else if (actor.role.code === 'DEPARTMENT_LEADER') {
    filter.$or = [
      { 'management.assignment.departmentId': actor.department },
      { 'management.assignment.userId': actor.id },
    ];
  }
  return filter;
};
