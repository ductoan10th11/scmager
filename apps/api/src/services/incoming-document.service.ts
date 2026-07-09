import { isValidObjectId } from 'mongoose';
import { incomingDocumentRepository } from '../repositories/incoming-document.repository';
import { taskRepository } from '../repositories/task.repository';
import { userRepository } from '../repositories/user.repository';
import { AuditLogModel, FileAttachmentModel, TaskModel } from '../models';
import { AuthUser } from '../types/auth';
import { badRequest, conflict, forbidden, notFound } from '../utils/http-error';
import {
  allocateSequentialSchedule,
  scheduleEnvelope,
} from './task-scheduler.service';

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// RBAC helpers
const isAdminOrChief = (actor: AuthUser) => actor.role.level <= 1;          // ADMIN | OFFICE_CHIEF
const isDeptLeader = (actor: AuthUser) => actor.role.code === 'DEPARTMENT_LEADER';
const isSpecialist = (actor: AuthUser) => actor.role.code === 'SPECIALIST';
const idOf = (value: any) => String(value?._id ?? value ?? '');
const ATTACHMENT_CATEGORIES = ['DECISION', 'WORK'] as const;

const isDocumentAssignedToSpecialist = (doc: any, actor: AuthUser) => {
  if (!isSpecialist(actor)) return false;
  const assigneeIds = [
    doc.currentAssignee,
    ...((doc.currentAssignees ?? []) as any[]),
  ].filter(Boolean).map(idOf);
  return assigneeIds.includes(actor.id);
};

const toAttachmentResponse = (attachment: any) => {
  const raw = typeof attachment.toObject === 'function' ? attachment.toObject() : attachment;
  const category = raw.metadata?.category ?? raw.category ?? 'DECISION';
  return {
    ...raw,
    _id: String(raw._id),
    category,
    metadata: { ...(raw.metadata ?? {}), category },
  };
};

const ensureSameOrganization = (actor: AuthUser, target: any) => {
  if (actor.role.code === 'ADMIN') return;
  if (!actor.organization || idOf(target.organization) !== actor.organization) {
    throw forbidden('Target user is outside your organization.');
  }
};

const resolveAssignableUser = async (
  actor: AuthUser,
  userId: string,
  departmentId: string,
) => {
  const user = await userRepository.findPublicById(userId);
  if (!user) throw badRequest('userId does not exist.');
  if ((user as any).status !== 'ACTIVE') throw conflict('Target user is inactive.');
  ensureSameOrganization(actor, user);

  if (idOf((user as any).department) !== departmentId) {
    throw forbidden('Target user must belong to the assigned department.');
  }
  if ((user as any).role?.code && (user as any).role.code !== 'SPECIALIST') {
    throw forbidden('Documents can only be assigned to a SPECIALIST.');
  }

  return user;
};

const normalizeAssigneeIds = (body: Record<string, unknown>) => {
  const raw = Array.isArray(body.userIds) ? body.userIds : [body.userId];
  const ids = raw
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => assertObjectId(value, 'userIds'));
  return [...new Set(ids)];
};

const normalizeAttachmentIdList = (value: unknown, field: string) => {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => assertObjectId(item, field)))];
};

const normalizeUserAssignments = (body: Record<string, unknown>) => {
  if (Array.isArray(body.attachmentIds) && body.attachmentIds.length > 0) {
    throw badRequest('attachmentIds must be provided per specialist assignment.');
  }

  if (!Array.isArray(body.assignments)) {
    return normalizeAssigneeIds(body).map((userId) => ({ userId, attachmentIds: [] }));
  }

  const assignments = body.assignments.map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw badRequest(`assignments[${index}] must be an object.`);
    }
    const raw = item as Record<string, unknown>;
    return {
      userId: assertObjectId(raw.userId, `assignments[${index}].userId`),
      attachmentIds: normalizeAttachmentIdList(raw.attachmentIds, `assignments[${index}].attachmentIds`),
    };
  });

  if (assignments.length === 0) throw badRequest('assignments must contain at least one specialist.');

  const userIds = assignments.map((assignment) => assignment.userId);
  if (new Set(userIds).size !== userIds.length) {
    throw badRequest('Each specialist can appear only once in assignments.');
  }

  const allAttachmentIds = assignments.flatMap((assignment) => assignment.attachmentIds);
  if (new Set(allAttachmentIds).size !== allAttachmentIds.length) {
    throw badRequest('Each WORK attachment can be assigned to only one specialist.');
  }

  return assignments;
};

const normalizeEstimatedMinutes = (value: unknown) => {
  const minutes = Number(value ?? 60);
  if (!Number.isInteger(minutes) || minutes < 15) {
    throw badRequest('estimatedMinutes must be an integer >= 15.');
  }
  return minutes;
};

const normalizeTaskDueAt = (value: unknown, documentDueAt?: Date | null) => {
  const dueAt = value ? new Date(String(value)) : documentDueAt ?? undefined;
  if (!dueAt) return undefined;
  if (Number.isNaN(dueAt.getTime())) throw badRequest('dueAt must be a valid date.');
  if (documentDueAt && dueAt.getTime() > new Date(documentDueAt).getTime()) {
    throw badRequest('Task dueAt cannot be after document dueAt.');
  }
  return dueAt;
};

const resolveWorkAttachments = async (docId: string, attachmentIds: string[]) => {
  if (attachmentIds.length === 0) return new Map<string, any>();

  const attachments = await FileAttachmentModel.find({ _id: { $in: attachmentIds } });
  if (attachments.length !== attachmentIds.length) throw badRequest('Some attachmentIds do not exist.');

  for (const attachment of attachments) {
    const category = (attachment as any).metadata?.category ?? (attachment as any).category ?? 'DECISION';
    if ((attachment as any).linkedModel !== 'IncomingDocument' || String((attachment as any).linkedId) !== docId) {
      throw forbidden('All attachments must belong to this document.');
    }
    if (category !== 'WORK') {
      throw forbidden('Only WORK attachments can be assigned to specialists.');
    }
  }

  return new Map(attachments.map((attachment: any) => [String(attachment._id), attachment._id]));
};

// ─── List ─────────────────────────────────────────────────────────────────────

export const listDocumentsService = async (
  actor: AuthUser,
  query: Record<string, unknown>,
) => {
  const { page, limit, skip, sort } = parsePagination(query);
  const filter: Record<string, unknown> = {};

  // Scope by role
  if (isDeptLeader(actor)) {
    // chỉ thấy document của phòng mình
    if (!actor.department) throw forbidden('Department leader has no department assigned.');
    filter.currentDepartment = actor.department;
  } else if (isSpecialist(actor)) {
    // chỉ thấy document được giao cho mình
    filter.$or = [{ currentAssignee: actor.id }, { currentAssignees: actor.id }];
  }

  if (query.status) filter.status = query.status;
  if (query.priority) filter.priority = query.priority;
  if (query.departmentId && isValidObjectId(String(query.departmentId))) {
    const departmentId = String(query.departmentId);
    if (isDeptLeader(actor) && departmentId !== actor.department) {
      throw forbidden('You can only filter documents from your department.');
    }
    if (!isSpecialist(actor)) filter.currentDepartment = departmentId;
  }
  if (query.search && typeof query.search === 'string') {
    filter.title = new RegExp(escapeRegex(query.search), 'i');
  }

  const [items, total] = await Promise.all([
    incomingDocumentRepository.findMany(filter, skip, limit, sort),
    incomingDocumentRepository.count(filter),
  ]);

  return {
    data: items,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
};

// ─── Get by ID ────────────────────────────────────────────────────────────────

export const getDocumentByIdService = async (actor: AuthUser, id: unknown) => {
  const docId = assertObjectId(id, 'id');
  const doc = await incomingDocumentRepository.findById(docId);
  if (!doc) throw notFound('Document not found.');

  // DEPARTMENT_LEADER chỉ xem phòng mình
  if (isDeptLeader(actor) && String((doc as any).currentDepartment?._id ?? (doc as any).currentDepartment) !== actor.department) {
    throw forbidden('Access denied.');
  }
  // SPECIALIST chỉ xem document được giao cho mình
  if (isSpecialist(actor) && !isDocumentAssignedToSpecialist(doc, actor)) {
    throw forbidden('Access denied.');
  }

  return { data: doc };
};

// ─── Create ───────────────────────────────────────────────────────────────────

export const createDocumentService = async (
  actor: AuthUser,
  body: Record<string, unknown>,
) => {
  if (!isAdminOrChief(actor)) throw forbidden('Only OFFICE_CHIEF can create documents.');
  if (!actor.organization) throw forbidden('User has no organization assigned.');

  const { documentNumber, title, summary, sender, category, priority, source, dueAt, issuedAt } = body;
  if (!documentNumber || typeof documentNumber !== 'string') throw badRequest('documentNumber is required.');
  if (!title || typeof title !== 'string') throw badRequest('title is required.');

  const doc = await incomingDocumentRepository.create({
    organization: actor.organization,
    documentNumber: String(documentNumber).trim(),
    title: String(title).trim(),
    summary: summary ? String(summary).trim() : undefined,
    sender: sender ? String(sender).trim() : undefined,
    category: category ? String(category).trim() : undefined,
    priority: priority ?? 'MEDIUM',
    source: source ?? 'MANUAL',
    dueAt: dueAt ? new Date(String(dueAt)) : undefined,
    issuedAt: issuedAt ? new Date(String(issuedAt)) : undefined,
    receivedBy: actor.id,
    status: 'DRAFT',
  });

  await AuditLogModel.create({
    actor: actor.id,
    action: 'DOCUMENT_CREATED',
    entityModel: 'IncomingDocument',
    entityId: (doc as any)._id,
    organization: actor.organization,
    metadata: { documentNumber: doc.documentNumber, title: doc.title },
  });

  const created = await incomingDocumentRepository.findById(String((doc as any)._id));
  return { data: created };
};

// ─── Update meta ──────────────────────────────────────────────────────────────

export const updateDocumentService = async (
  actor: AuthUser,
  id: unknown,
  body: Record<string, unknown>,
) => {
  if (!isAdminOrChief(actor)) throw forbidden('Only OFFICE_CHIEF can update documents.');
  const docId = assertObjectId(id, 'id');
  const doc = await incomingDocumentRepository.findRawById(docId);
  if (!doc) throw notFound('Document not found.');

  const allowed = ['title', 'summary', 'sender', 'category', 'priority', 'dueAt', 'issuedAt'];
  for (const key of allowed) {
    if (body[key] !== undefined) {
      (doc as any)[key] = key.endsWith('At') ? new Date(String(body[key])) : body[key];
    }
  }

  await incomingDocumentRepository.save(doc);
  const updated = await incomingDocumentRepository.findById(docId);
  return { data: updated };
};

// ─── Assign department ────────────────────────────────────────────────────────

export const assignDepartmentService = async (
  actor: AuthUser,
  id: unknown,
  body: Record<string, unknown>,
) => {
  if (!isAdminOrChief(actor)) throw forbidden('Only OFFICE_CHIEF can assign departments.');
  const docId = assertObjectId(id, 'id');
  const departmentId = assertObjectId(body.departmentId, 'departmentId');

  const doc = await incomingDocumentRepository.findRawById(docId);
  if (!doc) throw notFound('Document not found.');
  if (!['DRAFT', 'RECEIVED', 'ASSIGNED_TO_DEPARTMENT'].includes((doc as any).status)) {
    throw badRequest(`Cannot assign department when status is '${(doc as any).status}'.`);
  }

  const prevStatus = (doc as any).status;
  const prevDept = (doc as any).currentDepartment;

  (doc as any).status = 'ASSIGNED_TO_DEPARTMENT';
  (doc as any).currentDepartment = departmentId;
  (doc as any).currentAssignee = null;
  (doc as any).currentAssignees = [];
  (doc as any).relatedTasks = [];
  (doc as any).assignedBy = actor.id;
  (doc as any).assignedAt = new Date();
  (doc as any).routingHistory.push({
    fromDepartment: prevDept ?? null,
    toDepartment: departmentId,
    action: 'ASSIGN_DEPARTMENT',
    note: body.note ? String(body.note).trim() : undefined,
    actedAt: new Date(),
  });

  await incomingDocumentRepository.save(doc);

  await AuditLogModel.create({
    actor: actor.id,
    action: 'DOCUMENT_ASSIGNED_TO_DEPARTMENT',
    entityModel: 'IncomingDocument',
    entityId: (doc as any)._id,
    organization: (doc as any).organization,
    department: departmentId,
    metadata: { oldStatus: prevStatus, newStatus: 'ASSIGNED_TO_DEPARTMENT', targetDepartmentId: departmentId },
  });

  const updated = await incomingDocumentRepository.findById(docId);
  return { data: updated };
};

// ─── Assign user ──────────────────────────────────────────────────────────────

export const assignUserService = async (
  actor: AuthUser,
  id: unknown,
  body: Record<string, unknown>,
) => {
  if (!isDeptLeader(actor)) {
    throw forbidden('Only DEPARTMENT_LEADER can assign users.');
  }
  const docId = assertObjectId(id, 'id');
  const assignments = normalizeUserAssignments(body);
  const userIds = assignments.map((assignment) => assignment.userId);
  const estimatedMinutes = normalizeEstimatedMinutes(body.estimatedMinutes);

  const doc = await incomingDocumentRepository.findRawById(docId);
  if (!doc) throw notFound('Document not found.');
  if (!['ASSIGNED_TO_DEPARTMENT', 'ASSIGNED_TO_USER'].includes((doc as any).status)) {
    throw badRequest(`Cannot assign user when status is '${(doc as any).status}'.`);
  }

  const docDepartmentId = String((doc as any).currentDepartment);
  if (isDeptLeader(actor)) {
    if (docDepartmentId !== actor.department) throw forbidden('Document is not assigned to your department.');
  }
  await Promise.all(userIds.map((userId) => resolveAssignableUser(actor, userId, docDepartmentId)));

  const taskDueAt = normalizeTaskDueAt(body.dueAt, (doc as any).dueAt);
  const allAttachmentIds = assignments.flatMap((assignment) => assignment.attachmentIds);
  const attachmentById = await resolveWorkAttachments(docId, allAttachmentIds);

  await TaskModel.updateMany(
    {
      sourceDocument: (doc as any)._id,
      status: { $nin: ['DONE', 'CANCELLED'] },
    },
    { $set: { status: 'CANCELLED' } },
  );

  const prevAssignee = (doc as any).currentAssignee;
  (doc as any).status = 'ASSIGNED_TO_USER';
  (doc as any).currentAssignee = userIds[0];
  (doc as any).currentAssignees = userIds;

  const createdTasks = await Promise.all(assignments.map(async (assignment) => {
    const scheduleSegments = await allocateSequentialSchedule({
      userId: assignment.userId,
      estimatedMinutes,
      dueAt: taskDueAt,
    });
    const schedule = scheduleEnvelope(scheduleSegments);
    return taskRepository.create({
      organization: (doc as any).organization,
      department: docDepartmentId,
      assignedDepartment: docDepartmentId,
      sourceDocument: (doc as any)._id,
      type: 'DEADLINE',
      title: (doc as any).title,
      description: body.note ? String(body.note).trim() : (doc as any).summary,
      priority: (doc as any).priority ?? 'MEDIUM',
      status: 'TODO',
      assignedBy: actor.id,
      assignedTo: assignment.userId,
      assignedAt: new Date(),
      scheduleSegments,
      scheduledStartAt: schedule.scheduledStartAt,
      scheduledEndAt: schedule.scheduledEndAt,
      dueAt: taskDueAt,
      estimatedMinutes,
      attachments: assignment.attachmentIds.map((attachmentId) => attachmentById.get(attachmentId)),
      assignmentHistory: [{
        assignedBy: actor.id,
        assignedTo: assignment.userId,
        assignedDepartment: docDepartmentId,
        note: body.note ? String(body.note).trim() : undefined,
        assignedAt: new Date(),
      }],
    });
  }));

  (doc as any).relatedTasks = createdTasks.map((task: any) => task._id);
  for (const userId of userIds) {
    (doc as any).routingHistory.push({
      fromUser: prevAssignee ?? null,
      toUser: userId,
      action: 'ASSIGN_USER',
      note: body.note ? String(body.note).trim() : undefined,
      actedAt: new Date(),
    });
  }

  await incomingDocumentRepository.save(doc);

  await AuditLogModel.create({
    actor: actor.id,
    action: 'DOCUMENT_ASSIGNED_TO_USER',
    entityModel: 'IncomingDocument',
    entityId: (doc as any)._id,
    organization: (doc as any).organization,
    department: (doc as any).currentDepartment,
    metadata: {
      oldStatus: 'ASSIGNED_TO_DEPARTMENT',
      newStatus: 'ASSIGNED_TO_USER',
      targetUserIds: userIds,
      taskIds: createdTasks.map((task: any) => String(task._id)),
      assignments: assignments.map((assignment) => ({
        userId: assignment.userId,
        attachmentIds: assignment.attachmentIds,
      })),
      estimatedMinutes,
      dueAt: taskDueAt,
    },
  });

  const updated = await incomingDocumentRepository.findById(docId);
  return { data: updated };
};

// ─── Complete ─────────────────────────────────────────────────────────────────

export const completeDocumentService = async (actor: AuthUser, id: unknown) => {
  if (!isAdminOrChief(actor) && !isDeptLeader(actor)) {
    throw forbidden('Access denied.');
  }
  const docId = assertObjectId(id, 'id');
  const doc = await incomingDocumentRepository.findRawById(docId);
  if (!doc) throw notFound('Document not found.');

  if (!['IN_PROGRESS', 'ASSIGNED_TO_USER'].includes((doc as any).status)) {
    throw badRequest(`Cannot complete document with status '${(doc as any).status}'.`);
  }
  if (isDeptLeader(actor) && String((doc as any).currentDepartment) !== actor.department) {
    throw forbidden('You can only complete documents from your department.');
  }
  if (isDeptLeader(actor)) {
    const relatedTaskIds = ((doc as any).relatedTasks ?? []).map((taskId: any) => String(taskId));
    if (relatedTaskIds.length === 0) throw badRequest('Document has no assigned specialist tasks.');

    const tasks = await TaskModel.find({ _id: { $in: relatedTaskIds } }).select('_id status');
    if (tasks.length !== relatedTaskIds.length) throw conflict('Some related tasks are missing.');
    const pendingTasks = tasks.filter((task: any) => task.status !== 'DONE');
    if (pendingTasks.length > 0) {
      throw conflict('All specialist tasks must be approved DONE before completing the document.');
    }
  }

  (doc as any).status = 'COMPLETED';
  (doc as any).completedAt = new Date();
  (doc as any).routingHistory.push({ action: 'COMPLETE', actedAt: new Date() });

  await incomingDocumentRepository.save(doc);

  await AuditLogModel.create({
    actor: actor.id,
    action: 'DOCUMENT_COMPLETED',
    entityModel: 'IncomingDocument',
    entityId: (doc as any)._id,
    organization: (doc as any).organization,
    department: (doc as any).currentDepartment,
    metadata: { completedAt: (doc as any).completedAt },
  });

  const updated = await incomingDocumentRepository.findById(docId);
  return { data: updated };
};

// ─── Upload attachments ───────────────────────────────────────────────────────

export const uploadAttachmentsService = async (
  actor: AuthUser,
  id: unknown,
  files: Express.Multer.File[],
  category = 'DECISION',
) => {
  if (!isAdminOrChief(actor) && !isSpecialist(actor)) {
    throw forbidden('Access denied.');
  }
  if (!files || files.length === 0) throw badRequest('No files uploaded.');
  const normalizedCategory = String(category).toUpperCase();
  if (!ATTACHMENT_CATEGORIES.includes(normalizedCategory as (typeof ATTACHMENT_CATEGORIES)[number])) {
    throw badRequest('category must be DECISION or WORK.');
  }

  const docId = assertObjectId(id, 'id');
  const doc = await incomingDocumentRepository.findRawById(docId);
  if (!doc) throw notFound('Document not found.');

  // DEPARTMENT_LEADER / SPECIALIST: chỉ thao tác trên document phòng/người mình
  if (isDeptLeader(actor) && String((doc as any).currentDepartment) !== actor.department) {
    throw forbidden('Access denied.');
  }
  if (isSpecialist(actor) && !isDocumentAssignedToSpecialist(doc, actor)) {
    throw forbidden('Access denied.');
  }

  const attachmentDocs = await FileAttachmentModel.insertMany(
    files.map((f) => ({
      bucket: 'local',
      objectKey: f.path,
      fileName: f.originalname,
      contentType: f.mimetype,
      sizeBytes: f.size,
      category: normalizedCategory,
      uploadedBy: actor.id,
      linkedModel: 'IncomingDocument',
      linkedId: (doc as any)._id,
      metadata: { category: normalizedCategory },
    })),
  );

  const ids = attachmentDocs.map((a: any) => a._id);
  (doc as any).attachments.push(...ids);
  await incomingDocumentRepository.save(doc);

  await AuditLogModel.create({
    actor: actor.id,
    action: 'DOCUMENT_ATTACHMENT_ADDED',
    entityModel: 'IncomingDocument',
    entityId: (doc as any)._id,
    organization: (doc as any).organization,
    metadata: { count: files.length, category: normalizedCategory },
  });

  return { data: { attachments: attachmentDocs.map(toAttachmentResponse) } };
};

// ─── Delete attachment ────────────────────────────────────────────────────────

export const deleteAttachmentService = async (
  actor: AuthUser,
  id: unknown,
  attachmentId: unknown,
) => {
  if (!isAdminOrChief(actor) && !isDeptLeader(actor) && !isSpecialist(actor)) {
    throw forbidden('Access denied.');
  }
  const docId = assertObjectId(id, 'id');
  const attId = assertObjectId(attachmentId, 'attachmentId');

  const doc = await incomingDocumentRepository.findRawById(docId);
  if (!doc) throw notFound('Document not found.');

  if (isDeptLeader(actor)) throw forbidden('Department leaders cannot delete document attachments.');
  if (isSpecialist(actor) && !isDocumentAssignedToSpecialist(doc, actor))
    throw forbidden('Access denied.');

  const att = await FileAttachmentModel.findById(attId);
  if (!att) throw notFound('Attachment not found.');
  if ((att as any).linkedModel !== 'IncomingDocument' || String((att as any).linkedId) !== docId) {
    throw forbidden('Attachment does not belong to this document.');
  }

  await att.deleteOne();
  (doc as any).attachments = (doc as any).attachments.filter(
    (a: any) => String(a._id ?? a) !== attId,
  );
  await incomingDocumentRepository.save(doc);

  await AuditLogModel.create({
    actor: actor.id,
    action: 'DOCUMENT_ATTACHMENT_REMOVED',
    entityModel: 'IncomingDocument',
    entityId: (doc as any)._id,
    organization: (doc as any).organization,
    metadata: { attachmentId: attId },
  });

  return { data: { success: true } };
};
