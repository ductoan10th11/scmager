import { isValidObjectId } from 'mongoose';
import { auditLogRepository } from '../repositories/audit-log.repository';
import { IncomingDocumentModel, TaskModel, WorkDeclarationModel } from '../models';
import { AuthUser } from '../types/auth';
import { badRequest, forbidden } from '../utils/http-error';

const idOf = (value: any) => String(value?._id ?? value ?? '');
const isAdmin = (actor: AuthUser) => actor.role.code === 'ADMIN';
const isDeptLeader = (actor: AuthUser) => actor.role.code === 'DEPARTMENT_LEADER';
const isSpecialist = (actor: AuthUser) => actor.role.code === 'SPECIALIST';
const SUPPORTED_ENTITY_MODELS = ['IncomingDocument', 'Task', 'WorkDeclaration'] as const;

const parsePagination = (query: Record<string, unknown>) => {
  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
  const sort = typeof query.sort === 'string' ? query.sort : '-createdAt';
  return { page, limit, skip: (page - 1) * limit, sort };
};

const assertObjectId = (value: unknown, field: string) => {
  if (!value || typeof value !== 'string' || !isValidObjectId(value)) {
    throw badRequest(`${field} must be a valid ObjectId.`);
  }
  return value;
};

const applyDateFilter = (filter: Record<string, unknown>, query: Record<string, unknown>) => {
  const createdAt: Record<string, Date> = {};
  if (query.dateFrom) {
    const date = new Date(String(query.dateFrom));
    if (Number.isNaN(date.getTime())) throw badRequest('dateFrom must be a valid date.');
    createdAt.$gte = date;
  }
  if (query.dateTo) {
    const date = new Date(String(query.dateTo));
    if (Number.isNaN(date.getTime())) throw badRequest('dateTo must be a valid date.');
    createdAt.$lte = date;
  }
  if (Object.keys(createdAt).length) filter.createdAt = createdAt;
};

const ensureEntityAccess = async (actor: AuthUser, entityModel: string, entityId: string) => {
  if (entityModel === 'IncomingDocument') {
    const doc = await IncomingDocumentModel.findById(entityId).select('organization currentDepartment currentAssignee currentAssignees');
    if (!doc) throw forbidden('Access denied.');
    if (!isAdmin(actor) && actor.organization && idOf((doc as any).organization) !== actor.organization) throw forbidden('Access denied.');
    if (isDeptLeader(actor) && idOf((doc as any).currentDepartment) !== actor.department) throw forbidden('Access denied.');
    if (isSpecialist(actor)) {
      const assignees = [idOf((doc as any).currentAssignee), ...((doc as any).currentAssignees ?? []).map(idOf)];
      const relatedTask = assignees.includes(actor.id)
        ? true
        : Boolean(await TaskModel.exists({ sourceDocument: entityId, assignedTo: actor.id }));
      if (!relatedTask) throw forbidden('Access denied.');
    }
    return;
  }

  if (entityModel === 'Task') {
    const task = await TaskModel.findById(entityId).select('organization department assignedDepartment assignedTo');
    if (!task) throw forbidden('Access denied.');
    if (!isAdmin(actor) && actor.organization && idOf((task as any).organization) !== actor.organization) throw forbidden('Access denied.');
    if (isDeptLeader(actor)) {
      const departments = [idOf((task as any).department), idOf((task as any).assignedDepartment)];
      if (!actor.department || !departments.includes(actor.department)) throw forbidden('Access denied.');
    }
    if (isSpecialist(actor) && idOf((task as any).assignedTo) !== actor.id) throw forbidden('Access denied.');
    return;
  }

  if (entityModel === 'WorkDeclaration') {
    const declaration = await WorkDeclarationModel.findById(entityId)
      .select('organization department createdBy approval.currentApprover');
    if (!declaration) throw forbidden('Access denied.');
    if (!isAdmin(actor) && (!actor.organization || idOf((declaration as any).organization) !== actor.organization)) {
      throw forbidden('Access denied.');
    }
    if (idOf((declaration as any).createdBy) === actor.id || idOf((declaration as any).approval?.currentApprover) === actor.id) return;
    if (isDeptLeader(actor) && idOf((declaration as any).department) === actor.department) return;
    if (!isAdmin(actor) && actor.role.level > 2) throw forbidden('Access denied.');
    return;
  }

  if (!isAdmin(actor) && actor.role.level > 2) throw forbidden('Access denied.');
};

const scopedBaseFilter = async (actor: AuthUser) => {
  const filter: Record<string, unknown> = {};
  if (!isAdmin(actor)) {
    if (!actor.organization) throw forbidden('User has no organization assigned.');
    filter.organization = actor.organization;
  }

  if (isDeptLeader(actor)) {
    if (!actor.department) throw forbidden('Department leader has no department assigned.');
    const [documents, tasks, declarations] = await Promise.all([
      IncomingDocumentModel.find({ currentDepartment: actor.department }).select('_id').lean(),
      TaskModel.find({
        $or: [{ department: actor.department }, { assignedDepartment: actor.department }],
      }).select('_id').lean(),
      WorkDeclarationModel.find({
        $or: [{ department: actor.department }, { createdBy: actor.id }, { 'approval.currentApprover': actor.id }],
      }).select('_id').lean(),
    ]);
    filter.$or = [
      { department: actor.department },
      { entityModel: 'IncomingDocument', entityId: { $in: documents.map((item) => item._id) } },
      { entityModel: 'Task', entityId: { $in: tasks.map((item) => item._id) } },
      { entityModel: 'WorkDeclaration', entityId: { $in: declarations.map((item) => item._id) } },
    ];
  }

  if (isSpecialist(actor)) {
    const [tasks, declarations] = await Promise.all([
      TaskModel.find({ assignedTo: actor.id }).select('_id sourceDocument').lean(),
      WorkDeclarationModel.find({ createdBy: actor.id }).select('_id').lean(),
    ]);
    const taskIds = tasks.map((item) => item._id);
    const sourceDocumentIds = tasks.map((item: any) => item.sourceDocument).filter(Boolean);
    const documents = await IncomingDocumentModel.find({
      $or: [
        { currentAssignee: actor.id },
        { currentAssignees: actor.id },
        { _id: { $in: sourceDocumentIds } },
      ],
    }).select('_id').lean();
    filter.$or = [
      { entityModel: 'Task', entityId: { $in: taskIds } },
      { entityModel: 'IncomingDocument', entityId: { $in: documents.map((item) => item._id) } },
      { entityModel: 'WorkDeclaration', entityId: { $in: declarations.map((item) => item._id) } },
    ];
  }

  return filter;
};

export const listAuditLogsService = async (actor: AuthUser, query: Record<string, unknown>) => {
  const { page, limit, skip, sort } = parsePagination(query);
  const filter = await scopedBaseFilter(actor);

  if (query.entityModel) {
    const model = String(query.entityModel);
    if (!SUPPORTED_ENTITY_MODELS.includes(model as (typeof SUPPORTED_ENTITY_MODELS)[number])) {
      throw badRequest('entityModel must be IncomingDocument, Task, or WorkDeclaration.');
    }
    filter.entityModel = model;
  }
  if (query.entityId) filter.entityId = assertObjectId(query.entityId, 'entityId');
  if (query.actorId) filter.actor = assertObjectId(query.actorId, 'actorId');
  if (query.departmentId) filter.department = assertObjectId(query.departmentId, 'departmentId');
  if (query.action) filter.action = String(query.action);
  applyDateFilter(filter, query);

  const [items, total] = await Promise.all([
    auditLogRepository.findMany(filter, skip, limit, sort),
    auditLogRepository.count(filter),
  ]);

  return { data: items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
};

export const listAuditLogsForEntityService = async (
  actor: AuthUser,
  entityModel: unknown,
  entityId: unknown,
  query: Record<string, unknown>,
) => {
  const model = String(entityModel ?? '');
  if (!SUPPORTED_ENTITY_MODELS.includes(model as (typeof SUPPORTED_ENTITY_MODELS)[number])) {
    throw badRequest('entityModel must be IncomingDocument, Task, or WorkDeclaration.');
  }
  const id = assertObjectId(entityId, 'entityId');
  await ensureEntityAccess(actor, model, id);

  const { page, limit, skip, sort } = parsePagination(query);
  const filter: Record<string, unknown> = { entityModel: model, entityId: id };
  if (!isAdmin(actor) && actor.organization) filter.organization = actor.organization;
  if (query.actorId) filter.actor = assertObjectId(query.actorId, 'actorId');
  if (query.departmentId) filter.department = assertObjectId(query.departmentId, 'departmentId');
  if (query.action) filter.action = String(query.action);
  applyDateFilter(filter, query);

  const [items, total] = await Promise.all([
    auditLogRepository.findMany(filter, skip, limit, sort),
    auditLogRepository.count(filter),
  ]);
  return { data: items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
};
