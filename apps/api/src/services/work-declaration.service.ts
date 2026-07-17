import { isValidObjectId } from 'mongoose';
import { DepartmentModel, DocumentModel, WorkDeclarationModel } from '../models';
import { workDeclarationRepository } from '../repositories/work-declaration.repository';
import { userRepository } from '../repositories/user.repository';
import { AuthUser } from '../types/auth';
import { badRequest, conflict, forbidden, notFound } from '../utils/http-error';
import { markAllWorkDeclarationNotificationsRead, markWorkDeclarationNotificationsRead, notifyUser } from './notification.service';
import { AuditLogModel } from '../models/audit-log.model';
import { documentWorkflowFiltersFor } from './document-workflow.service';
import { emitWorkDeclarationChanged } from '../realtime/ingest.socket';

const idOf = (value: any) => String(value?._id ?? value ?? '');
const isAdmin = (actor: AuthUser) => actor.role.code === 'ADMIN';
const isSpecialist = (actor: AuthUser) => actor.role.code === 'SPECIALIST';
const isDepartmentLeader = (actor: AuthUser) => actor.role.code === 'DEPARTMENT_LEADER';
const isSelfApprover = (actor: AuthUser) => ['OFFICE_CHIEF', 'COMMUNE_LEADER'].includes(actor.role.code);
const scheduleLocks = new Map<string, Promise<void>>();

const withScheduleLock = async <T>(userId: string, operation: () => Promise<T>) => {
  const previous = scheduleLocks.get(userId) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  const settled = current.then(() => undefined, () => undefined);
  scheduleLocks.set(userId, settled);
  try {
    return await current;
  } finally {
    if (scheduleLocks.get(userId) === settled) scheduleLocks.delete(userId);
  }
};

const ensureNoScheduleOverlap = async (
  userId: string,
  workStartAt: Date,
  workEndAt: Date,
  excludeId?: string,
) => {
  const filter: Record<string, unknown> = {
    createdBy: userId,
    status: { $ne: 'CANCELLED' },
    workStartAt: { $lt: workEndAt },
    workEndAt: { $gt: workStartAt },
  };
  if (excludeId) filter._id = { $ne: excludeId };
  const overlapping = await WorkDeclarationModel.findOne(filter).select('_id title workStartAt workEndAt').lean();
  if (overlapping) {
    throw conflict('Khoảng thời gian này đang trùng với một công việc khác.', {
      workDeclarationId: idOf(overlapping),
      title: (overlapping as any).title,
      workStartAt: (overlapping as any).workStartAt,
      workEndAt: (overlapping as any).workEndAt,
    });
  }
};

const parsePagination = (query: Record<string, unknown>) => {
  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
  return { page, limit, skip: (page - 1) * limit };
};

const assertObjectId = (value: unknown, field: string) => {
  if (!value || typeof value !== 'string' || !isValidObjectId(value)) {
    throw badRequest(`${field} must be a valid ObjectId.`);
  }
  return value;
};

const normalizeText = (value: unknown, field: string, required = false) => {
  if (value === undefined || value === null) {
    if (required) throw badRequest(`${field} is required.`);
    return undefined;
  }
  if (typeof value !== 'string') throw badRequest(`${field} must be a string.`);
  const normalized = value.trim();
  if (required && !normalized) throw badRequest(`${field} is required.`);
  return normalized;
};

const parseWorkDateTime = (value: unknown) => {
  const raw = String(value ?? '').trim();
  const vietnamTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw)
    ? `${raw}:00+07:00`
    : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(raw)
      ? `${raw}+07:00`
      : raw;
  return new Date(vietnamTime);
};

const parseDeclarationPayload = (body: Record<string, unknown>) => {
  const title = normalizeText(body.title, 'title', true) as string;
  const description = normalizeText(body.description, 'description') ?? '';
  const workStartAt = parseWorkDateTime(body.workStartAt);
  const workEndAt = parseWorkDateTime(body.workEndAt);
  const declaredPoint = Number(body.declaredPoint);

  if (Number.isNaN(workStartAt.getTime())) throw badRequest('workStartAt must be a valid date.');
  if (Number.isNaN(workEndAt.getTime())) throw badRequest('workEndAt must be a valid date.');
  if (workEndAt <= workStartAt) throw badRequest('workEndAt must be after workStartAt.');
  if (!Number.isFinite(declaredPoint) || declaredPoint < 0) {
    throw badRequest('declaredPoint must be a non-negative number.');
  }

  return {
    title,
    description,
    workStartAt,
    workEndAt,
    durationMinutes: Math.max(1, Math.round((workEndAt.getTime() - workStartAt.getTime()) / 60_000)),
    declaredPoint,
  };
};

const ensureSameOrganization = (actor: AuthUser, entity: any) => {
  if (isAdmin(actor)) return;
  if (!actor.organization || idOf(entity.organization) !== actor.organization) {
    throw forbidden('Access denied.');
  }
};

const resolveDeclarationOwner = async (actor: AuthUser, assigneeId: unknown) => {
  if (assigneeId === undefined || assigneeId === null || assigneeId === '' || String(assigneeId) === actor.id) {
    if (!actor.organization) throw forbidden('User has no organization assigned.');
    return {
      id: actor.id,
      organization: actor.organization,
      department: actor.department,
      assignedByLeader: actor.role.level <= 3,
    };
  }

  if (actor.role.level > 3) throw forbidden('Only leaders can assign work to another user.');
  const targetId = assertObjectId(assigneeId, 'assigneeId');
  const target = await userRepository.findPublicById(targetId);
  if (!target || (target as any).status !== 'ACTIVE') throw badRequest('assigneeId must reference an active user.');
  const targetRoleLevel = Number((target as any).role?.level);
  if (!Number.isFinite(targetRoleLevel) || targetRoleLevel <= actor.role.level) {
    throw forbidden('Work can only be assigned to a user with a lower role level.');
  }
  ensureSameOrganization(actor, target);

  const targetOrganization = idOf((target as any).organization);
  const targetDepartment = idOf((target as any).department) || null;
  if (!targetOrganization) throw badRequest('The selected user has no organization assigned.');
  if (isDepartmentLeader(actor) && (!actor.department || targetDepartment !== actor.department)) {
    throw forbidden('Department leaders can only assign work within their department.');
  }

  return {
    id: targetId,
    organization: targetOrganization,
    department: targetDepartment,
    assignedByLeader: true,
  };
};

const findEligibleUser = async (actor: AuthUser, userId: string) => {
  const user = await userRepository.findPublicById(userId);
  if (!user || (user as any).status !== 'ACTIVE') throw badRequest('approver must be an active user.');
  ensureSameOrganization(actor, user);
  return user;
};

const resolveSubmissionApprover = async (actor: AuthUser, approverId: unknown) => {
  if (isSelfApprover(actor)) return { approverId: actor.id, selfApproved: true };

  if (isSpecialist(actor)) {
    if (!actor.department) throw badRequest('Specialist must belong to a department before submitting.');
    const department = await DepartmentModel.findById(actor.department).select('leader organization');
    if (!department || idOf((department as any).organization) !== actor.organization) {
      throw badRequest('Department does not exist in your organization.');
    }
    const leaderId = idOf((department as any).leader);
    if (!leaderId) throw badRequest('Your department has no leader assigned.');
    const leader = await findEligibleUser(actor, leaderId);
    if ((leader as any).role?.code !== 'DEPARTMENT_LEADER') {
      throw badRequest('Your department leader must have the DEPARTMENT_LEADER role.');
    }
    return { approverId: leaderId, selfApproved: false };
  }

  if (isDepartmentLeader(actor)) {
    const targetId = assertObjectId(approverId, 'approverId');
    const target = await findEligibleUser(actor, targetId);
    if (!['OFFICE_CHIEF', 'COMMUNE_LEADER'].includes((target as any).role?.code)) {
      throw badRequest('Department leaders must submit to an OFFICE_CHIEF or COMMUNE_LEADER.');
    }
    return { approverId: targetId, selfApproved: false };
  }

  throw forbidden('Your role cannot submit work declarations.');
};

const ensureForwardTarget = async (actor: AuthUser, targetId: string) => {
  const target = await findEligibleUser(actor, targetId);
  if (targetId === actor.id) throw badRequest('Cannot forward to yourself.');
  const targetRole = (target as any).role?.code;

  if (isDepartmentLeader(actor) && ['OFFICE_CHIEF', 'COMMUNE_LEADER'].includes(targetRole)) return target;
  if (actor.role.code === 'OFFICE_CHIEF' && targetRole === 'COMMUNE_LEADER') return target;
  throw forbidden('The selected approver is not a valid higher-level approver.');
};

const ensureDeclarationAccess = (actor: AuthUser, declaration: any) => {
  ensureSameOrganization(actor, declaration);
  if (isAdmin(actor)) return;
  if (idOf(declaration.createdBy) === actor.id || idOf(declaration.approval?.currentApprover) === actor.id) return;
  if (isDepartmentLeader(actor) && actor.department && idOf(declaration.department) === actor.department) return;
  if (['OFFICE_CHIEF', 'COMMUNE_LEADER'].includes(actor.role.code)) return;
  throw forbidden('Access denied.');
};

const reload = async (id: string) => {
  const declaration = await workDeclarationRepository.findById(id);
  if (!declaration) throw notFound('Work declaration not found.');
  return declaration;
};

const createAudit = (actor: AuthUser, action: string, declaration: any, metadata: Record<string, unknown> = {}) => (
  AuditLogModel.create({
    actor: actor.id,
    action,
    entityModel: 'WorkDeclaration',
    entityId: declaration._id,
    organization: declaration.organization,
    department: declaration.department,
    metadata,
  })
);

const emitDeclarationChanged = (declaration: any) => {
  const organizationId = idOf(declaration.organization);
  if (!organizationId) return;
  emitWorkDeclarationChanged(organizationId, {
    id: idOf(declaration._id),
    status: declaration.status,
    updatedAt: new Date().toISOString(),
  });
};

export const listWorkDeclarationsService = async (actor: AuthUser, query: Record<string, unknown>) => {
  const { page, limit, skip } = parsePagination(query);
  const filter: Record<string, unknown> = {};
  const conditions: Record<string, unknown>[] = [];

  if (!isAdmin(actor)) {
    if (!actor.organization) throw forbidden('User has no organization assigned.');
    filter.organization = actor.organization;
  }

  if (isSpecialist(actor)) {
    filter.createdBy = actor.id;
  } else if (isDepartmentLeader(actor)) {
    if (!actor.department) throw forbidden('Department leader has no department assigned.');
    conditions.push({
      $or: [
        { department: actor.department },
        { createdBy: actor.id },
        { 'approval.currentApprover': actor.id },
      ],
    });
  }

  if (query.status) filter.status = String(query.status);
  if (query.mine === 'true') filter.createdBy = actor.id;
  if (query.pendingForMe === 'true') filter['approval.currentApprover'] = actor.id;
  if (query.approvalActionByMe) {
    const action = String(query.approvalActionByMe);
    if (!['APPROVED', 'RETURNED'].includes(action)) throw badRequest('approvalActionByMe is invalid.');
    conditions.push({
      'approval.history': {
        $elemMatch: { actor: actor.id, action },
      },
    });
  }

  const search = normalizeText(query.search, 'search');
  if (search) {
    const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    conditions.push({ $or: [{ title: regex }, { description: regex }] });
  }
  if (conditions.length) filter.$and = conditions;

  const [data, total, draft, pendingApproval, returned, approved] = await Promise.all([
    workDeclarationRepository.findMany(filter, skip, limit),
    workDeclarationRepository.count(filter),
    workDeclarationRepository.count({ ...filter, status: 'DRAFT' }),
    workDeclarationRepository.count({ ...filter, status: 'PENDING_APPROVAL' }),
    workDeclarationRepository.count({ ...filter, status: 'RETURNED' }),
    workDeclarationRepository.count({ ...filter, status: 'APPROVED' }),
  ]);

  return {
    data,
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    summary: { total, draft, pendingApproval, returned, approved },
  };
};

export const listAssignmentParticipantsService = async (actor: AuthUser, query: Record<string, unknown>) => {
  const requestedDepartment = query.departmentId
    ? assertObjectId(query.departmentId, 'departmentId')
    : null;
  const filter: Record<string, unknown> = { status: 'ACTIVE' };

  if (isAdmin(actor)) {
    if (requestedDepartment) filter.department = requestedDepartment;
  } else {
    if (!actor.organization) throw forbidden('User has no organization assigned.');
    filter.organization = actor.organization;

    if (isSpecialist(actor)) {
      filter._id = actor.id;
    } else if (isDepartmentLeader(actor)) {
      if (!actor.department) throw forbidden('Department leader has no department assigned.');
      if (requestedDepartment && requestedDepartment !== actor.department) throw forbidden('Access denied.');
      filter.department = actor.department;
    } else if (requestedDepartment) {
      const department = await DepartmentModel.findById(requestedDepartment).select('organization');
      if (!department || idOf((department as any).organization) !== actor.organization) {
        throw badRequest('departmentId must belong to your organization.');
      }
      filter.department = requestedDepartment;
    }
  }

  const users = await userRepository.findAssignmentParticipants(filter);
  return {
    data: users.map((user: any) => ({
      _id: String(user._id),
      fullName: user.fullName,
      position: user.position ?? null,
      avatarUrl: user.avatarUrl ?? null,
      role: user.role
        ? {
            _id: String(user.role._id),
            code: user.role.code,
            name: user.role.name,
            level: user.role.level,
          }
        : null,
      department: user.department
        ? {
            _id: String(user.department._id),
            name: user.department.name,
            code: user.department.code,
          }
        : null,
    })),
  };
};

export const getWorkDeclarationService = async (actor: AuthUser, id: unknown) => {
  const declarationId = assertObjectId(id, 'id');
  const declaration = await reload(declarationId);
  ensureDeclarationAccess(actor, declaration);
  return { data: declaration };
};

export const createWorkDeclarationService = async (actor: AuthUser, body: Record<string, unknown>) => {
  const payload = parseDeclarationPayload(body);
  const owner = await resolveDeclarationOwner(actor, body.assigneeId);
  let sourceDocument: string | null = null;
  if (body.sourceDocument !== undefined && body.sourceDocument !== null && body.sourceDocument !== '') {
    sourceDocument = assertObjectId(body.sourceDocument, 'sourceDocument');
    const source = await DocumentModel.findById(sourceDocument).select('_id');
    if (!source) throw notFound('Source document not found.');
    if (!['ADMIN', 'OFFICE_CHIEF', 'COMMUNE_LEADER'].includes(actor.role.code)) {
      const scope = await documentWorkflowFiltersFor(actor);
      const canUseSource = await DocumentModel.exists({ _id: sourceDocument, ...scope.participant });
      if (!canUseSource) throw forbidden('You do not have access to the source document.');
    }
  }
  const now = new Date();
  const declaration = await withScheduleLock(owner.id, async () => {
    await ensureNoScheduleOverlap(owner.id, payload.workStartAt, payload.workEndAt);
    return workDeclarationRepository.create({
      ...payload,
      organization: owner.organization,
      department: owner.department,
      createdBy: owner.id,
      sourceDocument,
      status: owner.assignedByLeader ? 'APPROVED' : 'DRAFT',
      approval: owner.assignedByLeader
        ? {
            currentApprover: null,
            submittedAt: now,
            approvedAt: now,
            history: [{
              action: 'APPROVED',
              actor: actor.id,
              fromApprover: actor.id,
              toApprover: owner.id,
              note: 'Công việc được giao trực tiếp.',
              actedAt: now,
            }],
          }
        : undefined,
    });
  });
  await createAudit(
    actor,
    owner.assignedByLeader ? 'WORK_DECLARATION_ASSIGNED' : 'WORK_DECLARATION_CREATED',
    declaration,
    { declaredPoint: payload.declaredPoint, sourceDocument, assigneeId: owner.id },
  );
  emitDeclarationChanged(declaration);
  return { data: await reload(String((declaration as any)._id)) };
};

export const updateWorkDeclarationService = async (actor: AuthUser, id: unknown, body: Record<string, unknown>) => {
  const declarationId = assertObjectId(id, 'id');
  const declaration = await workDeclarationRepository.findRawById(declarationId);
  if (!declaration) throw notFound('Work declaration not found.');
  ensureDeclarationAccess(actor, declaration);
  if (idOf((declaration as any).createdBy) !== actor.id) throw forbidden('Only the creator can update this declaration.');
  if (!['DRAFT', 'RETURNED'].includes((declaration as any).status)) {
    throw badRequest('Only draft or returned declarations can be updated.');
  }

  const payload = parseDeclarationPayload(body);
  await withScheduleLock(idOf((declaration as any).createdBy), async () => {
    await ensureNoScheduleOverlap(
      idOf((declaration as any).createdBy),
      payload.workStartAt,
      payload.workEndAt,
      declarationId,
    );
    Object.assign(declaration, payload);
    await workDeclarationRepository.save(declaration);
  });
  await createAudit(actor, 'WORK_DECLARATION_UPDATED', declaration, { declaredPoint: payload.declaredPoint });
  emitDeclarationChanged(declaration);
  return { data: await reload(declarationId) };
};

export const rescheduleWorkDeclarationService = async (
  actor: AuthUser,
  id: unknown,
  body: Record<string, unknown>,
) => {
  const declarationId = assertObjectId(id, 'id');
  const declaration = await workDeclarationRepository.findRawById(declarationId);
  if (!declaration) throw notFound('Work declaration not found.');
  ensureDeclarationAccess(actor, declaration);
  if ((declaration as any).status === 'CANCELLED') throw badRequest('Cancelled declarations cannot be rescheduled.');

  const workStartAt = parseWorkDateTime(body.workStartAt);
  const workEndAt = parseWorkDateTime(body.workEndAt);
  if (Number.isNaN(workStartAt.getTime())) throw badRequest('workStartAt must be a valid date.');
  if (Number.isNaN(workEndAt.getTime())) throw badRequest('workEndAt must be a valid date.');
  if (workEndAt <= workStartAt) throw badRequest('workEndAt must be after workStartAt.');

  const ownerId = idOf((declaration as any).createdBy);
  await withScheduleLock(ownerId, async () => {
    await ensureNoScheduleOverlap(ownerId, workStartAt, workEndAt, declarationId);
    (declaration as any).workStartAt = workStartAt;
    (declaration as any).workEndAt = workEndAt;
    (declaration as any).durationMinutes = Math.max(1, Math.round((workEndAt.getTime() - workStartAt.getTime()) / 60_000));
    await workDeclarationRepository.save(declaration);
  });
  await createAudit(actor, 'WORK_DECLARATION_RESCHEDULED', declaration, { workStartAt, workEndAt });
  emitDeclarationChanged(declaration);
  return { data: await reload(declarationId) };
};

export const submitWorkDeclarationService = async (actor: AuthUser, id: unknown, body: Record<string, unknown>) => {
  const declarationId = assertObjectId(id, 'id');
  const declaration = await workDeclarationRepository.findRawById(declarationId);
  if (!declaration) throw notFound('Work declaration not found.');
  ensureDeclarationAccess(actor, declaration);
  if (idOf((declaration as any).createdBy) !== actor.id) throw forbidden('Only the creator can submit this declaration.');
  if (!['DRAFT', 'RETURNED'].includes((declaration as any).status)) {
    throw badRequest('Only draft or returned declarations can be submitted.');
  }

  const { approverId, selfApproved } = await resolveSubmissionApprover(actor, body.approverId);
  const now = new Date();
  const note = normalizeText(body.note, 'note') ?? null;
  const history = (declaration as any).approval?.history ?? [];
  history.push({ action: 'SUBMITTED', actor: actor.id, fromApprover: null, toApprover: approverId, note, actedAt: now });

  if (selfApproved) {
    history.push({ action: 'SELF_APPROVED', actor: actor.id, fromApprover: actor.id, toApprover: actor.id, note, actedAt: now });
    (declaration as any).status = 'APPROVED';
    (declaration as any).approval = { currentApprover: null, submittedAt: now, approvedAt: now, returnedAt: null, history };
    await workDeclarationRepository.save(declaration);
    await createAudit(actor, 'WORK_DECLARATION_SELF_APPROVED', declaration, { note });
    emitDeclarationChanged(declaration);
  } else {
    (declaration as any).status = 'PENDING_APPROVAL';
    (declaration as any).approval = { currentApprover: approverId, submittedAt: now, approvedAt: null, returnedAt: null, history };
    await workDeclarationRepository.save(declaration);
    await createAudit(actor, 'WORK_DECLARATION_SUBMITTED', declaration, { approverId, note });
    await notifyUser(approverId, {
      actor: actor.id,
      type: 'WORK_DECLARATION_SUBMITTED',
      title: 'Có công việc chờ duyệt',
      message: (declaration as any).title,
      entityModel: 'WorkDeclaration',
      entityId: declarationId,
    });
    emitDeclarationChanged(declaration);
  }

  return { data: await reload(declarationId) };
};

export const approveWorkDeclarationService = async (actor: AuthUser, id: unknown, body: Record<string, unknown>) => {
  const declarationId = assertObjectId(id, 'id');
  const declaration = await workDeclarationRepository.findRawById(declarationId);
  if (!declaration) throw notFound('Work declaration not found.');
  ensureDeclarationAccess(actor, declaration);
  if ((declaration as any).status !== 'PENDING_APPROVAL') throw badRequest('Work declaration is not pending approval.');
  if (idOf((declaration as any).approval?.currentApprover) !== actor.id) throw forbidden('You are not the current approver.');

  const note = normalizeText(body.note, 'note') ?? null;
  const editableFields = ['title', 'description', 'workStartAt', 'workEndAt', 'declaredPoint'] as const;
  const hasEdits = editableFields.some((field) => Object.prototype.hasOwnProperty.call(body, field));
  const editedPayload = hasEdits
    ? parseDeclarationPayload({
        title: body.title ?? (declaration as any).title,
        description: body.description ?? (declaration as any).description,
        workStartAt: body.workStartAt ?? (declaration as any).workStartAt,
        workEndAt: body.workEndAt ?? (declaration as any).workEndAt,
        declaredPoint: body.declaredPoint ?? (declaration as any).declaredPoint,
      })
    : null;
  const ownerId = idOf((declaration as any).createdBy);
  const now = new Date();

  await withScheduleLock(ownerId, async () => {
    if (editedPayload) {
      await ensureNoScheduleOverlap(
        ownerId,
        editedPayload.workStartAt,
        editedPayload.workEndAt,
        declarationId,
      );
      Object.assign(declaration, editedPayload);
    }
    (declaration as any).status = 'APPROVED';
    (declaration as any).approval.currentApprover = null;
    (declaration as any).approval.approvedAt = now;
    (declaration as any).approval.history.push({ action: 'APPROVED', actor: actor.id, fromApprover: actor.id, toApprover: null, note, actedAt: now });
    await workDeclarationRepository.save(declaration);
  });
  await createAudit(actor, 'WORK_DECLARATION_APPROVED', declaration, {
    note,
    editedFields: hasEdits ? editableFields.filter((field) => Object.prototype.hasOwnProperty.call(body, field)) : [],
  });
  await markAllWorkDeclarationNotificationsRead(declarationId);
  await notifyUser(idOf((declaration as any).createdBy), {
    actor: actor.id,
    type: 'WORK_DECLARATION_APPROVED',
    title: 'Công việc đã được duyệt',
    message: (declaration as any).title,
    entityModel: 'WorkDeclaration',
    entityId: declarationId,
  });
  emitDeclarationChanged(declaration);
  return { data: await reload(declarationId) };
};

export const returnWorkDeclarationService = async (actor: AuthUser, id: unknown, body: Record<string, unknown>) => {
  const declarationId = assertObjectId(id, 'id');
  const declaration = await workDeclarationRepository.findRawById(declarationId);
  if (!declaration) throw notFound('Work declaration not found.');
  ensureDeclarationAccess(actor, declaration);
  if ((declaration as any).status !== 'PENDING_APPROVAL') throw badRequest('Work declaration is not pending approval.');
  if (idOf((declaration as any).approval?.currentApprover) !== actor.id) throw forbidden('You are not the current approver.');
  const note = normalizeText(body.note, 'note', true) as string;
  const now = new Date();
  (declaration as any).status = 'RETURNED';
  (declaration as any).approval.currentApprover = null;
  (declaration as any).approval.returnedAt = now;
  (declaration as any).approval.history.push({ action: 'RETURNED', actor: actor.id, fromApprover: actor.id, toApprover: idOf((declaration as any).createdBy), note, actedAt: now });
  await workDeclarationRepository.save(declaration);
  await createAudit(actor, 'WORK_DECLARATION_RETURNED', declaration, { note });
  await markAllWorkDeclarationNotificationsRead(declarationId);
  await notifyUser(idOf((declaration as any).createdBy), {
    actor: actor.id,
    type: 'WORK_DECLARATION_RETURNED',
    title: 'Công việc cần bổ sung',
    message: (declaration as any).title,
    entityModel: 'WorkDeclaration',
    entityId: declarationId,
    metadata: { note },
  });
  emitDeclarationChanged(declaration);
  return { data: await reload(declarationId) };
};

export const forwardWorkDeclarationService = async (actor: AuthUser, id: unknown, body: Record<string, unknown>) => {
  const declarationId = assertObjectId(id, 'id');
  const declaration = await workDeclarationRepository.findRawById(declarationId);
  if (!declaration) throw notFound('Work declaration not found.');
  ensureDeclarationAccess(actor, declaration);
  if ((declaration as any).status !== 'PENDING_APPROVAL') throw badRequest('Work declaration is not pending approval.');
  if (idOf((declaration as any).approval?.currentApprover) !== actor.id) throw forbidden('You are not the current approver.');

  const targetId = assertObjectId(body.approverId, 'approverId');
  await ensureForwardTarget(actor, targetId);
  const note = normalizeText(body.note, 'note', true) as string;
  const now = new Date();
  (declaration as any).approval.currentApprover = targetId;
  (declaration as any).approval.history.push({ action: 'FORWARDED', actor: actor.id, fromApprover: actor.id, toApprover: targetId, note, actedAt: now });
  await workDeclarationRepository.save(declaration);
  await createAudit(actor, 'WORK_DECLARATION_FORWARDED', declaration, { targetId, note });
  await markWorkDeclarationNotificationsRead(actor.id, declarationId);
  await notifyUser(targetId, {
    actor: actor.id,
    type: 'WORK_DECLARATION_FORWARDED',
    title: 'Công việc được chuyển duyệt',
    message: (declaration as any).title,
    entityModel: 'WorkDeclaration',
    entityId: declarationId,
    metadata: { note },
  });
  emitDeclarationChanged(declaration);
  return { data: await reload(declarationId) };
};

export const cancelWorkDeclarationService = async (actor: AuthUser, id: unknown) => {
  const declarationId = assertObjectId(id, 'id');
  const declaration = await workDeclarationRepository.findRawById(declarationId);
  if (!declaration) throw notFound('Work declaration not found.');
  ensureDeclarationAccess(actor, declaration);
  if (idOf((declaration as any).createdBy) !== actor.id) throw forbidden('Only the creator can cancel this declaration.');
  if (!['DRAFT', 'RETURNED', 'PENDING_APPROVAL'].includes((declaration as any).status)) {
    throw badRequest('Approved declarations cannot be cancelled.');
  }
  const pendingApproverId = idOf((declaration as any).approval?.currentApprover);
  (declaration as any).status = 'CANCELLED';
  (declaration as any).approval.currentApprover = null;
  await workDeclarationRepository.save(declaration);
  await createAudit(actor, 'WORK_DECLARATION_CANCELLED', declaration);
  if (pendingApproverId) await markAllWorkDeclarationNotificationsRead(declarationId);
  emitDeclarationChanged(declaration);
  return { data: await reload(declarationId) };
};
