import mongoose, { isValidObjectId } from 'mongoose';
import { DepartmentModel, OfficeDocumentContextModel, WorkDeclarationModel } from '../models';
import { workDeclarationRepository } from '../repositories/work-declaration.repository';
import { userRepository } from '../repositories/user.repository';
import { AuthUser } from '../types/auth';
import { badRequest, conflict, forbidden, notFound } from '../utils/http-error';
import {
  enqueueWorkDeclarationNotification,
  markAllWorkDeclarationPointAdjustmentNotificationsRead,
  markAllWorkDeclarationNotificationsRead,
  markWorkDeclarationPointAdjustmentNotificationsRead,
  markWorkDeclarationNotificationsRead,
} from './notification.service';
import { AuditLogModel } from '../models/audit-log.model';
import { emitWorkDeclarationChanged } from '../realtime/ingest.socket';
import { ensureDailyCapacity, getEffectiveWorkPolicy, type EffectiveWorkPolicy } from './work-policy.service';
import {
  applyOfficeDocumentBusinessCompletion,
  clearOfficeDocumentBusinessCompletion,
} from './office-document-completion.service';

const idOf = (value: any) => String(value?._id ?? value ?? '');
const isAdmin = (actor: AuthUser) => actor.role.code === 'ADMIN';
const isSpecialist = (actor: AuthUser) => actor.role.code === 'SPECIALIST';
const isDepartmentLeader = (actor: AuthUser) => actor.role.code === 'DEPARTMENT_LEADER';
const isSelfApprover = (actor: AuthUser) => ['OFFICE_CHIEF', 'COMMUNE_LEADER'].includes(actor.role.code);
const scheduleLocks = new Map<string, Promise<void>>();
type WorkMutationSession = mongoose.ClientSession | null;

const isTransactionUnsupported = (error: unknown) => /transaction numbers are only allowed on a replica set member or mongos|transaction support is not available/i
  .test(error instanceof Error ? error.message : String(error));

/**
 * Uses a transaction when MongoDB supports it. Local/legacy deployments may
 * be a standalone mongod; in that case mutations still run safely in order
 * with the existing process schedule lock and optimistic revision checks.
 */
export const runWorkDeclarationMutation = async <T>(operation: (session: WorkMutationSession) => Promise<T>): Promise<T> => {
  const session = await mongoose.startSession();
  try {
    let result: T | undefined;
    await session.withTransaction(async () => { result = await operation(session); });
    if (result === undefined) throw conflict('Workflow transaction did not complete.');
    return result;
  } catch (error) {
    if (!isTransactionUnsupported(error)) throw error;
    return operation(null);
  } finally {
    await session.endSession();
  }
};

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
  organizationId: string,
  userId: string,
  workStartAt: Date,
  workEndAt: Date,
  excludeId?: string,
  session?: WorkMutationSession,
) => {
  const filter: Record<string, unknown> = {
    organization: organizationId,
    createdBy: userId,
    status: { $ne: 'CANCELLED' },
    workStartAt: { $lt: workEndAt },
    workEndAt: { $gt: workStartAt },
  };
  if (excludeId) filter._id = { $ne: excludeId };
  const overlapping = await WorkDeclarationModel.findOne(filter).session(session ?? null).select('_id title workStartAt workEndAt').lean();
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
  const normalized = value.trim().slice(0, field === 'description' ? 10_000 : 1_000);
  if (required && !normalized) throw badRequest(`${field} is required.`);
  return normalized;
};

const expectedRevision = (body: Record<string, unknown>): number => {
  const revision = Number(body.revision);
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw badRequest('revision must be a positive integer.');
  }
  return revision;
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

const parsePoint = (value: unknown, field: string) => {
  const point = Number(value);
  if (!Number.isFinite(point) || point < 0 || point > 1_000_000) {
    throw badRequest(`${field} must be a non-negative number.`);
  }
  return point;
};

const parseWorkSource = (value: unknown, assignedByLeader: boolean) => {
  if (assignedByLeader) return 'MANAGER_ASSIGNED';
  if (value === undefined || value === null || value === '') return 'SELF_REPORTED';
  if (value !== 'SELF_REPORTED') throw badRequest('workSource is managed by the server.');
  return 'SELF_REPORTED';
};

export const assertSourceDocumentCanBeLinked = (
  source: any,
  ownerId: string,
) => {
  if (idOf(source?.management?.assignment?.userId) !== ownerId) {
    throw forbidden('Nhiệm vụ nguồn không được giao cho người thực hiện đã chọn.');
  }
  if (source?.management?.businessCompletion?.completed === true) {
    throw conflict('Nhiệm vụ nguồn đã được xác nhận hoàn thành.');
  }
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
      assignedByLeader: false,
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

const resolveSubmissionApprover = async (
  actor: AuthUser,
  approverId: unknown,
) => {
  if (isSelfApprover(actor)) return { approverId: actor.id, selfApproved: true, openToHigher: false };

  if (isSpecialist(actor)) {
    // The business rule is deliberately not tied to a single department
    // leader: any higher-level user in the same organization may approve.
    return { approverId: null, selfApproved: false, openToHigher: true };
  }

  if (isDepartmentLeader(actor)) {
    let targetId = approverId ? assertObjectId(approverId, 'approverId') : '';
    if (!targetId) {
      const candidates = await userRepository.findAssignmentParticipants({
        organization: actor.organization,
        status: 'ACTIVE',
      });
      const defaultApprover = candidates.find((candidate: any) =>
        ['OFFICE_CHIEF', 'COMMUNE_LEADER'].includes(candidate.role?.code),
      );
      targetId = idOf(defaultApprover);
      if (!targetId) throw badRequest('Không có Chánh văn phòng hoặc Lãnh đạo xã để duyệt công việc.');
    }
    const target = await findEligibleUser(actor, targetId);
    if (!['OFFICE_CHIEF', 'COMMUNE_LEADER'].includes((target as any).role?.code)) {
      throw badRequest('Department leaders must submit to an OFFICE_CHIEF or COMMUNE_LEADER.');
    }
    return { approverId: targetId, selfApproved: false, openToHigher: false };
  }

  if (actor.role.code === 'OFFICE_CHIEF') {
    const targetId = assertObjectId(approverId, 'approverId');
    const target = await findEligibleUser(actor, targetId);
    if ((target as any).role?.code !== 'COMMUNE_LEADER') {
      throw badRequest('Office chiefs must submit to a COMMUNE_LEADER when self approval is disabled.');
    }
    return { approverId: targetId, selfApproved: false, openToHigher: false };
  }

  throw forbidden('Your role cannot submit work declarations.');
};

const findHigherLevelApprovers = async (actor: AuthUser) => {
  if (!actor.organization) return [] as any[];
  const users = await userRepository.findAssignmentParticipants({
    organization: actor.organization,
    status: 'ACTIVE',
  });
  return users.filter((user: any) => {
    if (String(user._id) === actor.id) return false;
    if (['OFFICE_CHIEF', 'COMMUNE_LEADER'].includes(user.role?.code)) return true;
    return user.role?.code === 'DEPARTMENT_LEADER'
      && actor.department
      && idOf(user.department) === actor.department;
  });
};

const canApproveOpenRequest = async (actor: AuthUser, declaration: any) => {
  if (!(declaration.approval?.openToHigher)) return false;
  if (isAdmin(actor)) return false;
  if (!actor.organization || actor.organization !== idOf(declaration.organization)) return false;
  const owner = await userRepository.findPublicById(idOf(declaration.createdBy));
  if (!owner || Number(actor.role.level) >= Number((owner as any).role?.level)) return false;
  if (['OFFICE_CHIEF', 'COMMUNE_LEADER'].includes(actor.role.code)) return true;
  return actor.role.code === 'DEPARTMENT_LEADER'
    && Boolean(actor.department)
    && idOf((owner as any).department) === actor.department;
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

const createAudit = (
  actor: AuthUser,
  action: string,
  declaration: any,
  metadata: Record<string, unknown> = {},
  session?: WorkMutationSession,
) => {
  const entry = {
    actor: actor.id,
    action,
    entityModel: 'WorkDeclaration',
    entityId: declaration._id,
    organization: declaration.organization,
    department: declaration.department,
    metadata,
  };
  return session
    ? AuditLogModel.create([entry], { session }).then(([created]) => created)
    : AuditLogModel.create(entry);
};

const loadCurrentForMutation = async (
  actor: AuthUser,
  declarationId: string,
  revision: number,
  session: WorkMutationSession,
) => {
  const declaration = await WorkDeclarationModel.findById(declarationId).session(session);
  if (!declaration) throw notFound('Work declaration not found.');
  ensureDeclarationAccess(actor, declaration);
  if (Number((declaration as any).revision) !== revision) {
    throw conflict('Khai báo đã thay đổi. Hãy tải lại dữ liệu mới nhất.', {
      revision: Number((declaration as any).revision),
    });
  }
  return declaration;
};

const saveRevisioned = async (declaration: any, session: WorkMutationSession) => {
  declaration.revision = Number(declaration.revision ?? 1) + 1;
  await declaration.save({ session: session ?? undefined });
};

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
        // Specialist declarations deliberately have no single approver. A
        // department leader remains eligible even when the specialist is in
        // another department of the same organization.
        ...(query.pendingForMe === 'true'
          ? [{ 'approval.openToHigher': true, department: actor.department }]
          : []),
      ],
    });
  }

  if (query.status) filter.status = String(query.status);
  if (query.mine === 'true') filter.createdBy = actor.id;
  if (query.pendingForMe === 'true') {
    const canReviewOpenRequests = isAdmin(actor) || Number(actor.role.level) < 4;
    conditions.push(canReviewOpenRequests
      ? { $or: [{ 'approval.currentApprover': actor.id }, { 'approval.openToHigher': true }] }
      : { 'approval.currentApprover': actor.id });
  }
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
  const rawAssigneeIds = Array.isArray(body.assigneeIds)
    ? body.assigneeIds
    : [body.assigneeId];
  if (!rawAssigneeIds.length || rawAssigneeIds.length > 50) {
    throw badRequest('assigneeIds must contain from 1 to 50 users.');
  }
  const owners = await Promise.all(rawAssigneeIds.map((assigneeId) => resolveDeclarationOwner(actor, assigneeId)));
  const uniqueOwners = owners.filter((owner, index) => owners.findIndex((item) => item.id === owner.id) === index);
  let sourceDocument: string | null = null;
  if (body.sourceDocument !== undefined && body.sourceDocument !== null && body.sourceDocument !== '') {
    if (uniqueOwners.length !== 1) {
      throw badRequest('Một nhiệm vụ nguồn chỉ được liên kết với một người thực hiện.');
    }
    sourceDocument = assertObjectId(body.sourceDocument, 'sourceDocument');
    const source: any = await OfficeDocumentContextModel.findOne({
      _id: sourceDocument,
      organizationId: uniqueOwners[0].organization,
      pageType: 'incoming',
    }).select('_id management.assignment management.businessCompletion');
    if (!source) throw notFound('Source document not found.');
    assertSourceDocumentCanBeLinked(source, uniqueOwners[0].id);
  }
  const now = new Date();
  const lockOwners = [...uniqueOwners].sort((left, right) => left.id.localeCompare(right.id));
  const createAll = async (index: number): Promise<any[]> => {
    if (index >= lockOwners.length) {
      return runWorkDeclarationMutation(async (session) => {
        const created = [] as any[];
        for (const owner of uniqueOwners) {
          if (sourceDocument) {
            const duplicate = await WorkDeclarationModel.findOne({
              sourceDocument,
              status: { $ne: 'CANCELLED' },
            })
              .session(session ?? null)
              .select('_id status')
              .lean();
            if (duplicate) {
              throw conflict('Nhiệm vụ nguồn đã được liên kết với một công việc khác.', {
                workDeclarationId: idOf(duplicate),
                status: (duplicate as any).status,
              });
            }
          }
          const policy = await getEffectiveWorkPolicy(owner.organization);
          await ensureNoScheduleOverlap(owner.organization, owner.id, payload.workStartAt, payload.workEndAt, undefined, session);
          await ensureDailyCapacity(owner.organization, owner.id, payload.workStartAt, payload.workEndAt, policy, undefined, session);
          const workSource = parseWorkSource(body.workSource, owner.assignedByLeader);
          const [item] = await WorkDeclarationModel.create([{
            ...payload, organization: owner.organization, department: owner.department, createdBy: owner.id,
            assignedBy: owner.assignedByLeader ? actor.id : null, workSource,
            sourceDocument, revision: 1, status: owner.assignedByLeader ? 'APPROVED' : 'DRAFT',
            approval: owner.assignedByLeader ? {
              currentApprover: actor.id, openToHigher: false, submittedAt: now, approvedAt: now,
              history: [{ action: 'APPROVED', actor: actor.id, fromApprover: actor.id, toApprover: owner.id, note: 'Công việc được giao trực tiếp.', actedAt: now }],
            } : undefined,
          }], { session: session ?? undefined });
          await createAudit(actor, owner.assignedByLeader ? 'WORK_DECLARATION_ASSIGNED' : 'WORK_DECLARATION_CREATED', item, {
            declaredPoint: payload.declaredPoint, sourceDocument, assigneeId: owner.id, revision: 1,
          }, session);
          if (owner.assignedByLeader) {
            await enqueueWorkDeclarationNotification({ session, recipient: owner.id, actor: actor.id, type: 'WORK_DECLARATION_APPROVED', title: 'Công việc được giao', message: item.title, entityId: String(item._id), organizationId: owner.organization, revision: 1 });
          }
          created.push(item);
        }
        return created;
      });
    }
    return withScheduleLock(lockOwners[index].id, () => createAll(index + 1));
  };
  const declarations = await createAll(0);
  declarations.forEach(emitDeclarationChanged);
  const data = await Promise.all(declarations.map((item) => reload(String(item._id))));
  return { data: data[0], meta: { created: data.length, ids: data.map((item: any) => String(item._id)) } };
};

export const updateWorkDeclarationService = async (actor: AuthUser, id: unknown, body: Record<string, unknown>) => {
  const declarationId = assertObjectId(id, 'id');
  const revision = expectedRevision(body);
  const payload = parseDeclarationPayload(body);
  const declaration = await runWorkDeclarationMutation(async (session) => {
    const current = await loadCurrentForMutation(actor, declarationId, revision, session);
    if (idOf((current as any).createdBy) !== actor.id) throw forbidden('Only the creator can update this declaration.');
    if (!['DRAFT', 'RETURNED'].includes((current as any).status)) throw conflict('Only draft or returned declarations can be updated.');
    const ownerId = idOf((current as any).createdBy);
    const organization = idOf((current as any).organization);
    const policy = await getEffectiveWorkPolicy(organization);
    await ensureNoScheduleOverlap(organization, ownerId, payload.workStartAt, payload.workEndAt, declarationId, session);
    await ensureDailyCapacity(organization, ownerId, payload.workStartAt, payload.workEndAt, policy, declarationId, session);
    Object.assign(current, payload);
    await saveRevisioned(current, session);
    await createAudit(actor, 'WORK_DECLARATION_UPDATED', current, { declaredPoint: payload.declaredPoint, revision: current.revision }, session);
    return current;
  });
  emitDeclarationChanged(declaration);
  return { data: await reload(declarationId) };
};

export const rescheduleWorkDeclarationService = async (
  actor: AuthUser,
  id: unknown,
  body: Record<string, unknown>,
) => {
  const declarationId = assertObjectId(id, 'id');
  const revision = expectedRevision(body);
  const workStartAt = parseWorkDateTime(body.workStartAt);
  const workEndAt = parseWorkDateTime(body.workEndAt);
  if (Number.isNaN(workStartAt.getTime())) throw badRequest('workStartAt must be a valid date.');
  if (Number.isNaN(workEndAt.getTime())) throw badRequest('workEndAt must be a valid date.');
  if (workEndAt <= workStartAt) throw badRequest('workEndAt must be after workStartAt.');

  const declaration = await runWorkDeclarationMutation(async (session) => {
    const current = await loadCurrentForMutation(actor, declarationId, revision, session);
    if (!['DRAFT', 'RETURNED', 'APPROVED'].includes((current as any).status)) {
      throw conflict('Only draft, returned or approved work can be rescheduled.');
    }
    const ownerId = idOf((current as any).createdBy);
    const organization = idOf((current as any).organization);
    const policy = await getEffectiveWorkPolicy(organization);
    await ensureNoScheduleOverlap(organization, ownerId, workStartAt, workEndAt, declarationId, session);
    await ensureDailyCapacity(organization, ownerId, workStartAt, workEndAt, policy, declarationId, session);
    Object.assign(current, { workStartAt, workEndAt, durationMinutes: Math.max(1, Math.round((workEndAt.getTime() - workStartAt.getTime()) / 60_000)) });
    await saveRevisioned(current, session);
    await createAudit(actor, 'WORK_DECLARATION_RESCHEDULED', current, { workStartAt, workEndAt, revision: current.revision }, session);
    return current;
  });
  emitDeclarationChanged(declaration);
  return { data: await reload(declarationId) };
};

export const submitWorkDeclarationService = async (actor: AuthUser, id: unknown, body: Record<string, unknown>) => {
  const declarationId = assertObjectId(id, 'id');
  const revision = expectedRevision(body);
  const declaration = await runWorkDeclarationMutation(async (session) => {
    const current = await loadCurrentForMutation(actor, declarationId, revision, session);
    if (idOf((current as any).createdBy) !== actor.id) throw forbidden('Only the creator can submit this declaration.');
    if (!['DRAFT', 'RETURNED'].includes((current as any).status)) throw conflict('Only draft or returned declarations can be submitted.');
    const { approverId, selfApproved, openToHigher } = await resolveSubmissionApprover(actor, body.approverId);
    const now = new Date();
    const note = normalizeText(body.note, 'note') ?? null;
    const history = [...((current as any).approval?.history ?? [])];
    history.push({ action: 'SUBMITTED', actor: actor.id, fromApprover: null, toApprover: approverId, note, actedAt: now });
    if (selfApproved) {
      history.push({ action: 'SELF_APPROVED', actor: actor.id, fromApprover: actor.id, toApprover: actor.id, note, actedAt: now });
      Object.assign(current, { status: 'APPROVED', approval: { currentApprover: actor.id, openToHigher: false, submittedAt: now, approvedAt: now, returnedAt: null, history } });
      await saveRevisioned(current, session);
      await createAudit(actor, 'WORK_DECLARATION_SELF_APPROVED', current, { note, revision: current.revision }, session);
    } else {
      Object.assign(current, { status: 'PENDING_APPROVAL', approval: { currentApprover: approverId, openToHigher, submittedAt: now, approvedAt: null, returnedAt: null, history } });
      await saveRevisioned(current, session);
      await createAudit(actor, 'WORK_DECLARATION_SUBMITTED', current, { approverId, openToHigher, note, revision: current.revision }, session);
      const recipients = approverId ? [{ _id: approverId }] : await findHigherLevelApprovers(actor);
      await Promise.all(recipients.map((recipient: any) => enqueueWorkDeclarationNotification({ session, recipient: idOf(recipient), actor: actor.id, type: 'WORK_DECLARATION_SUBMITTED', title: 'Có công việc chờ duyệt', message: current.title, entityId: declarationId, organizationId: idOf(current.organization), revision: current.revision })));
    }
    return current;
  });
  emitDeclarationChanged(declaration);
  return { data: await reload(declarationId) };
};

export const approveWorkDeclarationService = async (actor: AuthUser, id: unknown, body: Record<string, unknown>) => {
  const declarationId = assertObjectId(id, 'id');
  const revision = expectedRevision(body);
  const note = normalizeText(body.note, 'note') ?? null;
  const editableFields = ['title', 'description', 'workStartAt', 'workEndAt', 'declaredPoint'] as const;
  const hasEdits = editableFields.some((field) => Object.prototype.hasOwnProperty.call(body, field));
  const declaration = await runWorkDeclarationMutation(async (session) => {
    const current = await loadCurrentForMutation(actor, declarationId, revision, session);
    if ((current as any).status !== 'PENDING_APPROVAL') throw conflict('Work declaration is not pending approval.');
    if (idOf((current as any).approval?.currentApprover) !== actor.id && !(await canApproveOpenRequest(actor, current))) throw forbidden('You are not an eligible approver.');
    const editedPayload = hasEdits ? parseDeclarationPayload({
      title: body.title ?? (current as any).title, description: body.description ?? (current as any).description,
      workStartAt: body.workStartAt ?? (current as any).workStartAt, workEndAt: body.workEndAt ?? (current as any).workEndAt,
      declaredPoint: body.declaredPoint ?? (current as any).declaredPoint,
    }) : null;
    const ownerId = idOf((current as any).createdBy);
    const organization = idOf((current as any).organization);
    const now = new Date();
    if (editedPayload) {
      const policy = await getEffectiveWorkPolicy(organization);
      await ensureNoScheduleOverlap(organization, ownerId, editedPayload.workStartAt, editedPayload.workEndAt, declarationId, session);
      await ensureDailyCapacity(organization, ownerId, editedPayload.workStartAt, editedPayload.workEndAt, policy, declarationId, session);
      Object.assign(current, editedPayload);
    }
    current.status = 'APPROVED'; current.approval.currentApprover = actor.id; current.approval.openToHigher = false; current.approval.approvedAt = now;
    current.approval.history.push({ action: 'APPROVED', actor: actor.id, fromApprover: actor.id, toApprover: null, note, actedAt: now });
    await saveRevisioned(current, session);
    await createAudit(actor, 'WORK_DECLARATION_APPROVED', current, { note, editedFields: hasEdits ? editableFields.filter((field) => Object.prototype.hasOwnProperty.call(body, field)) : [], revision: current.revision }, session);
    await enqueueWorkDeclarationNotification({ session, recipient: ownerId, actor: actor.id, type: 'WORK_DECLARATION_APPROVED', title: 'Công việc đã được duyệt', message: current.title, entityId: declarationId, organizationId: organization, revision: current.revision });
    return current;
  });
  await markAllWorkDeclarationNotificationsRead(declarationId);
  emitDeclarationChanged(declaration);
  return { data: await reload(declarationId) };
};

export const returnWorkDeclarationService = async (actor: AuthUser, id: unknown, body: Record<string, unknown>) => {
  const declarationId = assertObjectId(id, 'id');
  const revision = expectedRevision(body);
  const note = normalizeText(body.note, 'note', true) as string;
  const declaration = await runWorkDeclarationMutation(async (session) => {
    const current = await loadCurrentForMutation(actor, declarationId, revision, session);
    if (current.status !== 'PENDING_APPROVAL') throw conflict('Work declaration is not pending approval.');
    if (idOf(current.approval?.currentApprover) !== actor.id && !(await canApproveOpenRequest(actor, current))) throw forbidden('You are not an eligible approver.');
    const now = new Date(); const ownerId = idOf(current.createdBy); const organization = idOf(current.organization);
    current.status = 'RETURNED'; current.approval.currentApprover = null; current.approval.openToHigher = false; current.approval.returnedAt = now;
    current.approval.history.push({ action: 'RETURNED', actor: actor.id, fromApprover: actor.id, toApprover: ownerId, note, actedAt: now });
    await saveRevisioned(current, session);
    await createAudit(actor, 'WORK_DECLARATION_RETURNED', current, { note, revision: current.revision }, session);
    await enqueueWorkDeclarationNotification({ session, recipient: ownerId, actor: actor.id, type: 'WORK_DECLARATION_RETURNED', title: 'Công việc cần bổ sung', message: current.title, entityId: declarationId, organizationId: organization, revision: current.revision, metadata: { note } });
    return current;
  });
  await markAllWorkDeclarationNotificationsRead(declarationId);
  emitDeclarationChanged(declaration);
  return { data: await reload(declarationId) };
};

export const forwardWorkDeclarationService = async (actor: AuthUser, id: unknown, body: Record<string, unknown>) => {
  const declarationId = assertObjectId(id, 'id');
  const revision = expectedRevision(body);
  const targetId = assertObjectId(body.approverId, 'approverId');
  const note = normalizeText(body.note, 'note', true) as string;
  const declaration = await runWorkDeclarationMutation(async (session) => {
    const current = await loadCurrentForMutation(actor, declarationId, revision, session);
    if (!['PENDING_APPROVAL', 'PENDING_COMPLETION'].includes(current.status)) throw conflict('Work declaration is not pending approval.');
    if (idOf(current.approval?.currentApprover) !== actor.id) throw forbidden('You are not the current approver.');
    await ensureForwardTarget(actor, targetId);
    const now = new Date();
    current.approval.currentApprover = targetId;
    current.approval.history.push({ action: 'FORWARDED', actor: actor.id, fromApprover: actor.id, toApprover: targetId, note, actedAt: now });
    await saveRevisioned(current, session);
    await createAudit(actor, 'WORK_DECLARATION_FORWARDED', current, { targetId, note, revision: current.revision }, session);
    await enqueueWorkDeclarationNotification({ session, recipient: targetId, actor: actor.id, type: 'WORK_DECLARATION_FORWARDED', title: 'Công việc được chuyển duyệt', message: current.title, entityId: declarationId, organizationId: idOf(current.organization), revision: current.revision, metadata: { note } });
    return current;
  });
  await markWorkDeclarationNotificationsRead(actor.id, declarationId);
  emitDeclarationChanged(declaration);
  return { data: await reload(declarationId) };
};

export const requestWorkDeclarationPointAdjustmentService = async (
  actor: AuthUser,
  id: unknown,
  body: Record<string, unknown>,
) => {
  const declarationId = assertObjectId(id, 'id');
  const revision = expectedRevision(body);
  const requestedPoint = parsePoint(body.requestedPoint, 'requestedPoint');
  const reason = normalizeText(body.reason, 'reason', true) as string;
  const declaration = await runWorkDeclarationMutation(async (session) => {
    const current = await loadCurrentForMutation(actor, declarationId, revision, session);
    if (idOf(current.createdBy) !== actor.id) throw forbidden('Only the assignee can request a point adjustment.');
    if (current.workSource !== 'MANAGER_ASSIGNED' || !current.assignedBy) {
      throw conflict('Only directly assigned work can request a point adjustment.');
    }
    if (current.status !== 'APPROVED') throw conflict('Only active approved work can request a point adjustment.');
    if (current.pointAdjustment?.status === 'PENDING') throw conflict('A point adjustment is already pending.');

    const now = new Date();
    const approverId = idOf(current.assignedBy);
    const history = [...(current.pointAdjustment?.history ?? [])];
    history.push({
      action: 'REQUESTED', actor: actor.id, fromApprover: null, toApprover: approverId,
      requestedPoint, approvedPoint: null, note: reason, actedAt: now,
    });
    current.pointAdjustment = {
      status: 'PENDING', requestedPoint, approvedPoint: null, reason,
      requestedBy: actor.id, requestedAt: now, currentApprover: approverId,
      decidedBy: null, decidedAt: null, decisionNote: '', history,
    };
    await saveRevisioned(current, session);
    await createAudit(actor, 'WORK_DECLARATION_POINT_ADJUSTMENT_REQUESTED', current, {
      originalPoint: current.declaredPoint, requestedPoint, reason, approverId, revision: current.revision,
    }, session);
    await enqueueWorkDeclarationNotification({
      session, recipient: approverId, actor: actor.id,
      type: 'WORK_DECLARATION_POINT_ADJUSTMENT_REQUESTED', title: 'Có kiến nghị điều chỉnh điểm',
      message: `${current.title}: ${current.declaredPoint} điểm -> đề xuất ${requestedPoint} điểm`,
      entityId: declarationId, organizationId: idOf(current.organization), revision: current.revision,
      metadata: { requestedPoint, reason },
    });
    return current;
  });
  emitDeclarationChanged(declaration);
  return { data: await reload(declarationId) };
};

export const approveWorkDeclarationPointAdjustmentService = async (
  actor: AuthUser,
  id: unknown,
  body: Record<string, unknown>,
) => {
  const declarationId = assertObjectId(id, 'id');
  const revision = expectedRevision(body);
  const declaration = await runWorkDeclarationMutation(async (session) => {
    const current = await loadCurrentForMutation(actor, declarationId, revision, session);
    const adjustment = current.pointAdjustment;
    if (adjustment?.status !== 'PENDING') throw conflict('Point adjustment is not pending approval.');
    if (idOf(adjustment.currentApprover) !== actor.id) throw forbidden('You are not the current point adjustment approver.');
    const approvedPoint = body.approvedPoint === undefined
      ? parsePoint(adjustment.requestedPoint, 'requestedPoint')
      : parsePoint(body.approvedPoint, 'approvedPoint');
    const decisionNote = normalizeText(body.note, 'note') ?? '';
    const now = new Date();
    adjustment.status = 'APPROVED'; adjustment.approvedPoint = approvedPoint;
    adjustment.currentApprover = actor.id; adjustment.decidedBy = actor.id;
    adjustment.decidedAt = now; adjustment.decisionNote = decisionNote;
    adjustment.history.push({
      action: 'APPROVED', actor: actor.id, fromApprover: actor.id, toApprover: null,
      requestedPoint: adjustment.requestedPoint, approvedPoint, note: decisionNote || null, actedAt: now,
    });
    await saveRevisioned(current, session);
    await createAudit(actor, 'WORK_DECLARATION_POINT_ADJUSTMENT_APPROVED', current, {
      originalPoint: current.declaredPoint, requestedPoint: adjustment.requestedPoint,
      approvedPoint, note: decisionNote, revision: current.revision,
    }, session);
    await enqueueWorkDeclarationNotification({
      session, recipient: idOf(current.createdBy), actor: actor.id,
      type: 'WORK_DECLARATION_POINT_ADJUSTMENT_APPROVED', title: 'Kiến nghị điểm đã được duyệt',
      message: `${current.title}: điểm hiệu lực ${approvedPoint}`, entityId: declarationId,
      organizationId: idOf(current.organization), revision: current.revision,
      metadata: { approvedPoint, originalPoint: current.declaredPoint },
    });
    return current;
  });
  await markAllWorkDeclarationPointAdjustmentNotificationsRead(declarationId);
  emitDeclarationChanged(declaration);
  return { data: await reload(declarationId) };
};

export const rejectWorkDeclarationPointAdjustmentService = async (
  actor: AuthUser,
  id: unknown,
  body: Record<string, unknown>,
) => {
  const declarationId = assertObjectId(id, 'id');
  const revision = expectedRevision(body);
  const note = normalizeText(body.note, 'note', true) as string;
  const declaration = await runWorkDeclarationMutation(async (session) => {
    const current = await loadCurrentForMutation(actor, declarationId, revision, session);
    const adjustment = current.pointAdjustment;
    if (adjustment?.status !== 'PENDING') throw conflict('Point adjustment is not pending approval.');
    if (idOf(adjustment.currentApprover) !== actor.id) throw forbidden('You are not the current point adjustment approver.');
    const now = new Date();
    adjustment.status = 'REJECTED'; adjustment.currentApprover = actor.id;
    adjustment.decidedBy = actor.id; adjustment.decidedAt = now; adjustment.decisionNote = note;
    adjustment.history.push({
      action: 'REJECTED', actor: actor.id, fromApprover: actor.id, toApprover: null,
      requestedPoint: adjustment.requestedPoint, approvedPoint: null, note, actedAt: now,
    });
    await saveRevisioned(current, session);
    await createAudit(actor, 'WORK_DECLARATION_POINT_ADJUSTMENT_REJECTED', current, {
      originalPoint: current.declaredPoint, requestedPoint: adjustment.requestedPoint, note, revision: current.revision,
    }, session);
    await enqueueWorkDeclarationNotification({
      session, recipient: idOf(current.createdBy), actor: actor.id,
      type: 'WORK_DECLARATION_POINT_ADJUSTMENT_REJECTED', title: 'Kiến nghị điểm chưa được duyệt',
      message: current.title, entityId: declarationId, organizationId: idOf(current.organization), revision: current.revision,
      metadata: { note },
    });
    return current;
  });
  await markAllWorkDeclarationPointAdjustmentNotificationsRead(declarationId);
  emitDeclarationChanged(declaration);
  return { data: await reload(declarationId) };
};

export const forwardWorkDeclarationPointAdjustmentService = async (
  actor: AuthUser,
  id: unknown,
  body: Record<string, unknown>,
) => {
  const declarationId = assertObjectId(id, 'id');
  const revision = expectedRevision(body);
  const targetId = assertObjectId(body.approverId, 'approverId');
  const note = normalizeText(body.note, 'note', true) as string;
  const declaration = await runWorkDeclarationMutation(async (session) => {
    const current = await loadCurrentForMutation(actor, declarationId, revision, session);
    const adjustment = current.pointAdjustment;
    if (adjustment?.status !== 'PENDING') throw conflict('Point adjustment is not pending approval.');
    if (idOf(adjustment.currentApprover) !== actor.id) throw forbidden('You are not the current point adjustment approver.');
    await ensureForwardTarget(actor, targetId);
    const now = new Date();
    adjustment.currentApprover = targetId;
    adjustment.history.push({
      action: 'FORWARDED', actor: actor.id, fromApprover: actor.id, toApprover: targetId,
      requestedPoint: adjustment.requestedPoint, approvedPoint: null, note, actedAt: now,
    });
    await saveRevisioned(current, session);
    await createAudit(actor, 'WORK_DECLARATION_POINT_ADJUSTMENT_FORWARDED', current, {
      targetId, requestedPoint: adjustment.requestedPoint, note, revision: current.revision,
    }, session);
    await enqueueWorkDeclarationNotification({
      session, recipient: targetId, actor: actor.id,
      type: 'WORK_DECLARATION_POINT_ADJUSTMENT_FORWARDED', title: 'Kiến nghị điểm được chuyển duyệt',
      message: current.title, entityId: declarationId, organizationId: idOf(current.organization), revision: current.revision,
      metadata: { note, requestedPoint: adjustment.requestedPoint },
    });
    return current;
  });
  await markWorkDeclarationPointAdjustmentNotificationsRead(actor.id, declarationId);
  emitDeclarationChanged(declaration);
  return { data: await reload(declarationId) };
};

export const cancelWorkDeclarationPointAdjustmentService = async (
  actor: AuthUser,
  id: unknown,
  body: Record<string, unknown>,
) => {
  const declarationId = assertObjectId(id, 'id');
  const revision = expectedRevision(body);
  const declaration = await runWorkDeclarationMutation(async (session) => {
    const current = await loadCurrentForMutation(actor, declarationId, revision, session);
    const adjustment = current.pointAdjustment;
    if (adjustment?.status !== 'PENDING') throw conflict('Point adjustment is not pending approval.');
    if (idOf(current.createdBy) !== actor.id || idOf(adjustment.requestedBy) !== actor.id) {
      throw forbidden('Only the requester can cancel a point adjustment.');
    }
    const now = new Date();
    adjustment.status = 'CANCELLED'; adjustment.decidedBy = actor.id; adjustment.decidedAt = now;
    adjustment.history.push({
      action: 'CANCELLED', actor: actor.id, fromApprover: null, toApprover: null,
      requestedPoint: adjustment.requestedPoint, approvedPoint: null, note: null, actedAt: now,
    });
    await saveRevisioned(current, session);
    await createAudit(actor, 'WORK_DECLARATION_POINT_ADJUSTMENT_CANCELLED', current, {
      requestedPoint: adjustment.requestedPoint, revision: current.revision,
    }, session);
    return current;
  });
  await markAllWorkDeclarationPointAdjustmentNotificationsRead(declarationId);
  emitDeclarationChanged(declaration);
  return { data: await reload(declarationId) };
};

export const submitWorkDeclarationCompletionService = async (actor: AuthUser, id: unknown, body: Record<string, unknown>) => {
  const declarationId = assertObjectId(id, 'id');
  const revision = expectedRevision(body);
  const result = normalizeText(body.result, 'result', true) as string;
  const declaration = await runWorkDeclarationMutation(async (session) => {
    const current = await loadCurrentForMutation(actor, declarationId, revision, session);
    if (idOf(current.createdBy) !== actor.id) throw forbidden('Only the assignee can submit a work result.');
    if (current.status !== 'APPROVED') throw conflict('Only approved work can submit a result.');
    const approverId = idOf(current.approval?.currentApprover);
    if (!approverId) throw conflict('Work has no approver for completion confirmation.');
    const now = new Date();
    current.status = 'PENDING_COMPLETION';
    current.completion = { ...((current as any).completion?.toObject?.() ?? (current as any).completion), submittedAt: now, submittedResult: result, returnedAt: null };
    current.approval.history.push({ action: 'COMPLETION_SUBMITTED', actor: actor.id, fromApprover: null, toApprover: approverId, note: result, actedAt: now });
    await saveRevisioned(current, session);
    await createAudit(actor, 'WORK_DECLARATION_COMPLETION_SUBMITTED', current, { revision: current.revision }, session);
    await enqueueWorkDeclarationNotification({ session, recipient: approverId, actor: actor.id, type: 'WORK_DECLARATION_SUBMITTED', title: 'Có kết quả công việc chờ xác nhận', message: current.title, entityId: declarationId, organizationId: idOf(current.organization), revision: current.revision });
    return current;
  });
  emitDeclarationChanged(declaration);
  return { data: await reload(declarationId) };
};

export const confirmWorkDeclarationCompletionService = async (actor: AuthUser, id: unknown, body: Record<string, unknown>) => {
  const declarationId = assertObjectId(id, 'id');
  const revision = expectedRevision(body);
  const note = normalizeText(body.note, 'note') ?? null;
  const declaration = await runWorkDeclarationMutation(async (session) => {
    const current = await loadCurrentForMutation(actor, declarationId, revision, session);
    if (current.status !== 'PENDING_COMPLETION') throw conflict('Work result is not pending confirmation.');
    if (idOf(current.approval?.currentApprover) !== actor.id) throw forbidden('You are not the current approver.');
    const now = new Date();
    current.status = 'COMPLETED';
    current.completion = { ...((current as any).completion?.toObject?.() ?? (current as any).completion), confirmedAt: now, confirmationNote: note };
    current.approval.history.push({ action: 'COMPLETED', actor: actor.id, fromApprover: actor.id, toApprover: null, note, actedAt: now });
    const sourceDocumentId = idOf(current.sourceDocument);
    let sourceCompletionApplied = false;
    if (sourceDocumentId) {
      const effectivePoint = current.pointAdjustment?.status === 'APPROVED'
        ? Number(current.pointAdjustment.approvedPoint ?? current.declaredPoint)
        : Number(current.declaredPoint);
      const reworkCount = (current.approval?.history ?? [])
        .filter((entry: any) => entry.action === 'RETURNED')
        .length;
      const source = await applyOfficeDocumentBusinessCompletion({
        incomingDocumentId: sourceDocumentId,
        organizationId: idOf(current.organization),
        evidenceType: 'WORK_DECLARATION',
        evidenceId: declarationId,
        submittedBy: idOf(current.createdBy),
        submittedAt: new Date(current.completion?.submittedAt ?? now),
        approvedBy: actor.id,
        approvedAt: now,
        point: Number.isFinite(effectivePoint) ? Math.max(0, effectivePoint) : 0,
        reworkCount,
      }, session);
      if (!source) {
        throw conflict('Nhiệm vụ nguồn đã được hoàn thành bằng một kết quả khác.');
      }
      sourceCompletionApplied = true;
    }
    try {
      await saveRevisioned(current, session);
    } catch (error) {
      if (sourceDocumentId && sourceCompletionApplied && !session) {
        await clearOfficeDocumentBusinessCompletion({
          incomingDocumentId: sourceDocumentId,
          organizationId: idOf(current.organization),
          evidenceType: 'WORK_DECLARATION',
          evidenceId: declarationId,
        });
      }
      throw error;
    }
    await Promise.allSettled([
      createAudit(actor, 'WORK_DECLARATION_COMPLETED', current, { revision: current.revision }, session),
      enqueueWorkDeclarationNotification({ session, recipient: idOf(current.createdBy), actor: actor.id, type: 'WORK_DECLARATION_APPROVED', title: 'Kết quả công việc đã được xác nhận', message: current.title, entityId: declarationId, organizationId: idOf(current.organization), revision: current.revision }),
    ]);
    return current;
  });
  await Promise.allSettled([
    markAllWorkDeclarationNotificationsRead(declarationId),
  ]);
  emitDeclarationChanged(declaration);
  return { data: await reload(declarationId) };
};

export const returnWorkDeclarationCompletionService = async (actor: AuthUser, id: unknown, body: Record<string, unknown>) => {
  const declarationId = assertObjectId(id, 'id');
  const revision = expectedRevision(body);
  const note = normalizeText(body.note, 'note', true) as string;
  const declaration = await runWorkDeclarationMutation(async (session) => {
    const current = await loadCurrentForMutation(actor, declarationId, revision, session);
    if (current.status !== 'PENDING_COMPLETION') throw conflict('Work result is not pending confirmation.');
    if (idOf(current.approval?.currentApprover) !== actor.id) throw forbidden('You are not the current approver.');
    const now = new Date();
    current.status = 'APPROVED';
    current.completion = { ...((current as any).completion?.toObject?.() ?? (current as any).completion), returnedAt: now, confirmationNote: note };
    current.approval.history.push({ action: 'RETURNED', actor: actor.id, fromApprover: actor.id, toApprover: idOf(current.createdBy), note, actedAt: now });
    await saveRevisioned(current, session);
    await createAudit(actor, 'WORK_DECLARATION_COMPLETION_RETURNED', current, { note, revision: current.revision }, session);
    await enqueueWorkDeclarationNotification({ session, recipient: idOf(current.createdBy), actor: actor.id, type: 'WORK_DECLARATION_RETURNED', title: 'Kết quả công việc cần làm lại', message: current.title, entityId: declarationId, organizationId: idOf(current.organization), revision: current.revision, metadata: { note } });
    return current;
  });
  await markAllWorkDeclarationNotificationsRead(declarationId);
  emitDeclarationChanged(declaration);
  return { data: await reload(declarationId) };
};

export const cancelWorkDeclarationService = async (actor: AuthUser, id: unknown, body: Record<string, unknown>) => {
  const declarationId = assertObjectId(id, 'id');
  const revision = expectedRevision(body);
  const declaration = await runWorkDeclarationMutation(async (session) => {
    const current = await loadCurrentForMutation(actor, declarationId, revision, session);
    if (idOf(current.createdBy) !== actor.id) throw forbidden('Only the creator can cancel this declaration.');
    if (!['DRAFT', 'RETURNED', 'PENDING_APPROVAL'].includes(current.status)) throw conflict('Approved declarations cannot be cancelled.');
    current.status = 'CANCELLED'; current.approval.currentApprover = null;
    await saveRevisioned(current, session);
    await createAudit(actor, 'WORK_DECLARATION_CANCELLED', current, { revision: current.revision }, session);
    return current;
  });
  const pendingApproverId = idOf((declaration as any).approval?.currentApprover);
  if (pendingApproverId) await markAllWorkDeclarationNotificationsRead(declarationId);
  emitDeclarationChanged(declaration);
  return { data: await reload(declarationId) };
};
