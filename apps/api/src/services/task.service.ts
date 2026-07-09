import { isValidObjectId } from 'mongoose';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { taskRepository } from '../repositories/task.repository';
import { userRepository } from '../repositories/user.repository';
import {
  allocateSequentialSchedule,
  assertBusinessSlot,
  findNearestCommonSlot,
  insertMeetingAndReschedule,
  scheduleEnvelope,
} from './task-scheduler.service';
import { AuditLogModel, FileAttachmentModel } from '../models';
import { AuthUser } from '../types/auth';
import { badRequest, conflict, forbidden, notFound } from '../utils/http-error';

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
const isLeaderOrAbove = (a: AuthUser) => a.role.level <= 3;
const isDeptLeader = (a: AuthUser) => a.role.code === 'DEPARTMENT_LEADER';
const isSpecialist = (a: AuthUser) => a.role.code === 'SPECIALIST';
const canCreateTask = (a: AuthUser) => a.role.level <= 3; // ADMIN..DEPT_LEADER
const idOf = (value: any) => String(value?._id ?? value ?? '');

const ensureSameOrganization = (actor: AuthUser, target: any) => {
  if (actor.role.code === 'ADMIN') return;
  if (!actor.organization || idOf(target.organization) !== actor.organization) {
    throw forbidden('Target user is outside your organization.');
  }
};

const ensureTaskInDepartment = (task: any, departmentId: string | null) => {
  const assignedDepartment = idOf(task.assignedDepartment);
  const owningDepartment = idOf(task.department);
  if (!departmentId || (assignedDepartment !== departmentId && owningDepartment !== departmentId)) {
    throw forbidden('Task is not in your department.');
  }
};

const resolveAssignableUser = async (
  actor: AuthUser,
  userId: string,
  departmentId?: string | null,
) => {
  const user = await userRepository.findPublicById(userId);
  if (!user) throw badRequest('userId does not exist.');
  if ((user as any).status !== 'ACTIVE') throw conflict('Target user is inactive.');
  ensureSameOrganization(actor, user);

  const userDepartment = idOf((user as any).department);
  if (departmentId && userDepartment !== departmentId) {
    throw forbidden('Target user must belong to the assigned department.');
  }
  if (isDeptLeader(actor) && userDepartment !== actor.department) {
    throw forbidden('Department leaders can only assign users in their department.');
  }
  if ((user as any).role?.code && (user as any).role.code !== 'SPECIALIST') {
    throw forbidden('Tasks can only be assigned to a SPECIALIST.');
  }

  return { user, departmentId: userDepartment || departmentId || null };
};

// ─── List ─────────────────────────────────────────────────────────────────────

export const listTasksService = async (actor: AuthUser, query: Record<string, unknown>) => {
  const { page, limit, skip, sort } = parsePagination(query);
  const filter: Record<string, unknown> = {};

  // Scope by role
  if (isDeptLeader(actor)) {
    if (!actor.department) throw forbidden('Department leader has no department assigned.');
    filter.$or = [{ assignedDepartment: actor.department }, { department: actor.department }];
  } else if (isSpecialist(actor)) {
    filter.assignedTo = actor.id;
  }

  if (query.type) filter.type = query.type;
  if (query.priority) filter.priority = query.priority;
  if (query.departmentId && isValidObjectId(String(query.departmentId))) {
    const departmentId = String(query.departmentId);
    if (isDeptLeader(actor) && departmentId !== actor.department) {
      throw forbidden('You can only filter tasks from your department.');
    }
    if (!isSpecialist(actor)) filter.assignedDepartment = departmentId;
  }
  if (query.assignedToMe === 'true') filter.assignedTo = actor.id;
  if (query.search && typeof query.search === 'string') {
    filter.title = new RegExp(escapeRegex(query.search), 'i');
  }

  // Summary follows the current scope/search/type filters, but remains independent
  // from status and overdue filters so every progress card stays meaningful.
  const summaryFilter = { ...filter, status: { $ne: 'CANCELLED' } };

  if (query.status) {
    filter.status = query.status;
  } else if (query.overdue === 'true') {
    filter.dueAt = { $lt: new Date() };
    filter.status = { $nin: ['DONE', 'CANCELLED'] };
  } else {
    filter.status = { $ne: 'CANCELLED' };
  }

  const now = new Date();
  const [
    items,
    total,
    summaryTotal,
    summaryTodo,
    summaryInProgress,
    summaryPendingReview,
    summaryDone,
    summaryOverdue,
  ] = await Promise.all([
    taskRepository.findMany(filter, skip, limit, sort),
    taskRepository.count(filter),
    taskRepository.count(summaryFilter),
    taskRepository.count({ ...summaryFilter, status: 'TODO' }),
    taskRepository.count({ ...summaryFilter, status: 'IN_PROGRESS' }),
    taskRepository.count({ ...summaryFilter, status: 'PENDING_REVIEW' }),
    taskRepository.count({ ...summaryFilter, status: 'DONE' }),
    taskRepository.count({
      ...summaryFilter,
      dueAt: { $lt: now },
      status: { $nin: ['DONE', 'CANCELLED'] },
    }),
  ]);

  return {
    data: items,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    summary: {
      total: summaryTotal,
      todo: summaryTodo,
      inProgress: summaryInProgress,
      pendingReview: summaryPendingReview,
      done: summaryDone,
      overdue: summaryOverdue,
    },
  };
};

// ─── Get by ID ────────────────────────────────────────────────────────────────

export const getTaskByIdService = async (actor: AuthUser, id: unknown) => {
  const taskId = assertObjectId(id, 'id');
  const task = await taskRepository.findById(taskId);
  if (!task) throw notFound('Task not found.');

  if (isDeptLeader(actor)) {
    ensureTaskInDepartment(task, actor.department);
  }
  if (isSpecialist(actor) && String((task as any).assignedTo?._id ?? (task as any).assignedTo) !== actor.id) {
    throw forbidden('Access denied.');
  }

  return { data: task };
};

export const getTaskAttachmentDownloadService = async (
  actor: AuthUser,
  id: unknown,
  attachmentId: unknown,
) => {
  const taskId = assertObjectId(id, 'id');
  const attachmentObjectId = assertObjectId(attachmentId, 'attachmentId');
  const task = await taskRepository.findRawById(taskId);
  if (!task) throw notFound('Task not found.');

  if (isDeptLeader(actor)) ensureTaskInDepartment(task, actor.department);
  if (isSpecialist(actor) && String((task as any).assignedTo) !== actor.id) {
    throw forbidden('This task is not assigned to you.');
  }

  const belongsToTask = ((task as any).attachments ?? [])
    .some((value: any) => idOf(value) === attachmentObjectId);
  if (!belongsToTask) throw forbidden('Attachment does not belong to this task.');

  const attachment = await FileAttachmentModel.findById(attachmentObjectId);
  if (!attachment) throw notFound('Attachment not found.');

  const filePath = path.resolve(process.cwd(), String((attachment as any).objectKey));
  if (!fs.existsSync(filePath)) throw notFound('Attachment file not found.');

  return {
    filePath,
    fileName: String((attachment as any).fileName),
    contentType: String((attachment as any).contentType ?? 'application/octet-stream'),
  };
};

export const getTaskSourceAttachmentDownloadService = async (
  actor: AuthUser,
  id: unknown,
  attachmentId: unknown,
) => {
  const taskId = assertObjectId(id, 'id');
  const attachmentObjectId = assertObjectId(attachmentId, 'attachmentId');
  const task = await taskRepository.findRawById(taskId);
  if (!task) throw notFound('Task not found.');

  if (isDeptLeader(actor)) ensureTaskInDepartment(task, actor.department);
  if (isSpecialist(actor) && String((task as any).assignedTo) !== actor.id) {
    throw forbidden('This task is not assigned to you.');
  }

  const sourceDocumentId = idOf((task as any).sourceDocument);
  if (!sourceDocumentId) throw notFound('Task has no source document.');

  const attachment = await FileAttachmentModel.findById(attachmentObjectId);
  if (!attachment) throw notFound('Attachment not found.');
  if (
    (attachment as any).linkedModel !== 'IncomingDocument'
    || String((attachment as any).linkedId) !== sourceDocumentId
  ) {
    throw forbidden('Attachment does not belong to this task source document.');
  }

  const filePath = path.resolve(process.cwd(), String((attachment as any).objectKey));
  if (!fs.existsSync(filePath)) throw notFound('Attachment file not found.');

  return {
    filePath,
    fileName: String((attachment as any).fileName),
    contentType: String((attachment as any).contentType ?? 'application/octet-stream'),
  };
};

export const createDepartmentMeetingService = async (
  actor: AuthUser,
  body: Record<string, unknown>,
) => {
  if (!isDeptLeader(actor)) throw forbidden('Only department leaders can create department meetings.');
  if (!actor.organization || !actor.department) {
    throw forbidden('Department leader has no organization or department assigned.');
  }

  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title) throw badRequest('title is required.');
  if (!Array.isArray(body.attendeeUserIds) || body.attendeeUserIds.length === 0) {
    throw badRequest('attendeeUserIds must contain at least one specialist.');
  }
  const attendeeUserIds = [...new Set(
    body.attendeeUserIds.map((value, index) => assertObjectId(value, `attendeeUserIds[${index}]`)),
  )];
  await Promise.all(
    attendeeUserIds.map((userId) => resolveAssignableUser(actor, userId, actor.department)),
  );

  const durationMinutes = Number(body.durationMinutes);
  if (
    !Number.isInteger(durationMinutes)
    || durationMinutes < 15
    || durationMinutes > 8 * 60
  ) {
    throw badRequest('durationMinutes must be an integer between 15 and 480.');
  }

  const strategy = body.strategy === 'INSERT_AND_SPLIT' ? 'INSERT_AND_SPLIT' : 'NEAREST_FREE';
  let meetingSlot;
  if (strategy === 'INSERT_AND_SPLIT') {
    const startAt = new Date(String(body.startAt ?? ''));
    if (Number.isNaN(startAt.getTime())) throw badRequest('startAt is required for INSERT_AND_SPLIT.');
    meetingSlot = {
      startAt,
      endAt: new Date(startAt.getTime() + durationMinutes * 60000),
    };
    assertBusinessSlot(meetingSlot.startAt, meetingSlot.endAt);
    await insertMeetingAndReschedule({
      userIds: attendeeUserIds,
      meetingStartAt: meetingSlot.startAt,
      meetingEndAt: meetingSlot.endAt,
    });
  } else {
    const requestedEarliest = body.earliestAt ? new Date(String(body.earliestAt)) : new Date();
    if (Number.isNaN(requestedEarliest.getTime())) throw badRequest('earliestAt must be a valid date.');
    meetingSlot = await findNearestCommonSlot({
      userIds: attendeeUserIds,
      durationMinutes,
      earliestAt: requestedEarliest,
    });
  }

  const meetingId = randomUUID();
  const tasks = await Promise.all(attendeeUserIds.map((userId) => taskRepository.create({
    organization: actor.organization,
    department: actor.department,
    assignedDepartment: actor.department,
    type: 'INVITATION',
    title,
    description: body.description ? String(body.description).trim() : undefined,
    priority: 'MEDIUM',
    status: 'TODO',
    assignedBy: actor.id,
    assignedTo: userId,
    assignedAt: new Date(),
    scheduleSegments: [meetingSlot],
    scheduledStartAt: meetingSlot.startAt,
    scheduledEndAt: meetingSlot.endAt,
    dueAt: meetingSlot.endAt,
    estimatedMinutes: durationMinutes,
    location: body.location ? String(body.location).trim() : undefined,
    metadata: { meetingId, strategy },
    assignmentHistory: [{
      assignedBy: actor.id,
      assignedTo: userId,
      assignedDepartment: actor.department,
      note: 'Department meeting',
      assignedAt: new Date(),
    }],
  })));

  await AuditLogModel.create({
    actor: actor.id,
    action: 'DEPARTMENT_MEETING_CREATED',
    entityModel: 'Task',
    entityId: (tasks[0] as any)._id,
    organization: actor.organization,
    department: actor.department,
    metadata: {
      meetingId,
      attendeeUserIds,
      strategy,
      startAt: meetingSlot.startAt,
      endAt: meetingSlot.endAt,
      taskIds: tasks.map((task: any) => String(task._id)),
    },
  });

  return {
    data: {
      meetingId,
      startAt: meetingSlot.startAt,
      endAt: meetingSlot.endAt,
      tasks: await Promise.all(tasks.map((task: any) => (
        taskRepository.findById(String(task._id))
      ))),
    },
  };
};

// ─── Create ───────────────────────────────────────────────────────────────────

export const createTaskService = async (actor: AuthUser, body: Record<string, unknown>) => {
  if (!canCreateTask(actor)) throw forbidden('Specialists cannot create tasks.');
  if (!actor.organization) throw forbidden('User has no organization assigned.');

  const {
    title,
    description,
    type,
    priority,
    departmentId,
    assignedToUserId,
    sourceDocumentId,
    scheduledStartAt,
    scheduledEndAt,
    dueAt,
    estimatedMinutes,
  } = body;
  if (!title || typeof title !== 'string') throw badRequest('title is required.');
  if (!type) throw badRequest('type is required.');

  const parsedStartAt = scheduledStartAt ? new Date(String(scheduledStartAt)) : undefined;
  const parsedEndAt = scheduledEndAt ? new Date(String(scheduledEndAt)) : undefined;
  if (parsedStartAt && Number.isNaN(parsedStartAt.getTime())) {
    throw badRequest('scheduledStartAt must be a valid date.');
  }
  if (parsedEndAt && Number.isNaN(parsedEndAt.getTime())) {
    throw badRequest('scheduledEndAt must be a valid date.');
  }
  if ((parsedStartAt && !parsedEndAt) || (!parsedStartAt && parsedEndAt)) {
    throw badRequest('scheduledStartAt and scheduledEndAt must be provided together.');
  }
  if (parsedStartAt && parsedEndAt && parsedEndAt.getTime() <= parsedStartAt.getTime()) {
    throw badRequest('scheduledEndAt must be after scheduledStartAt.');
  }

  const parsedEstimatedMinutes = estimatedMinutes === undefined
    ? (parsedStartAt && parsedEndAt
        ? Math.round((parsedEndAt.getTime() - parsedStartAt.getTime()) / 60000)
        : 0)
    : Number(estimatedMinutes);
  if (!Number.isInteger(parsedEstimatedMinutes) || parsedEstimatedMinutes < 0) {
    throw badRequest('estimatedMinutes must be a non-negative integer.');
  }
  const parsedDueAt = dueAt ? new Date(String(dueAt)) : undefined;
  if (parsedDueAt && Number.isNaN(parsedDueAt.getTime())) {
    throw badRequest('dueAt must be a valid date.');
  }

  const assignedToId = assignedToUserId
    ? assertObjectId(assignedToUserId, 'assignedToUserId')
    : null;
  let assignedDepartmentId = departmentId && isValidObjectId(String(departmentId))
    ? String(departmentId)
    : undefined;

  if (isDeptLeader(actor)) {
    if (!actor.department) throw forbidden('Department leader has no department assigned.');
    if (assignedDepartmentId && assignedDepartmentId !== actor.department) {
      throw forbidden('Department leaders can only create tasks in their department.');
    }
    assignedDepartmentId = actor.department;
  }

  if (assignedToId) {
    const target = await resolveAssignableUser(actor, assignedToId, assignedDepartmentId);
    assignedDepartmentId = target.departmentId ?? assignedDepartmentId;
  }

  const status = assignedToId ? 'TODO' : 'DRAFT';
  let scheduleSegments = parsedStartAt && parsedEndAt
    ? [{ startAt: parsedStartAt, endAt: parsedEndAt }]
    : [];
  if (assignedToId && scheduleSegments.length === 0 && parsedEstimatedMinutes >= 15) {
    scheduleSegments = await allocateSequentialSchedule({
      userId: assignedToId,
      estimatedMinutes: parsedEstimatedMinutes,
      dueAt: parsedDueAt,
    });
  }
  const schedule = scheduleEnvelope(scheduleSegments);

  const task = await taskRepository.create({
    organization: actor.organization,
    department: assignedDepartmentId,
    sourceDocument: sourceDocumentId && isValidObjectId(String(sourceDocumentId)) ? sourceDocumentId : undefined,
    type,
    title: String(title).trim(),
    description: description ? String(description).trim() : undefined,
    priority: priority ?? 'MEDIUM',
    status,
    assignedBy: actor.id,
    assignedTo: assignedToId ?? undefined,
    assignedDepartment: assignedDepartmentId,
    assignedAt: new Date(),
    scheduleSegments,
    scheduledStartAt: schedule.scheduledStartAt,
    scheduledEndAt: schedule.scheduledEndAt,
    dueAt: parsedDueAt,
    estimatedMinutes: parsedEstimatedMinutes,
    assignmentHistory: assignedToId
      ? [{ assignedBy: actor.id, assignedTo: assignedToId, assignedDepartment: assignedDepartmentId, assignedAt: new Date() }]
      : [],
  });

  await AuditLogModel.create({
    actor: actor.id,
    action: 'TASK_CREATED',
    entityModel: 'Task',
    entityId: (task as any)._id,
    organization: actor.organization,
    metadata: { title: (task as any).title, status },
  });

  const created = await taskRepository.findById(String((task as any)._id));
  return { data: created };
};

// ─── Assign ───────────────────────────────────────────────────────────────────

export const assignTaskService = async (actor: AuthUser, id: unknown, body: Record<string, unknown>) => {
  if (!isLeaderOrAbove(actor)) throw forbidden('Only leaders can assign tasks.');
  const taskId = assertObjectId(id, 'id');
  const userId = assertObjectId(body.userId, 'userId');

  const task = await taskRepository.findRawById(taskId);
  if (!task) throw notFound('Task not found.');
  if (['DONE', 'CANCELLED'].includes((task as any).status)) {
    throw badRequest(`Cannot assign a task with status '${(task as any).status}'.`);
  }

  if (isDeptLeader(actor)) {
    ensureTaskInDepartment(task, actor.department);
  }

  let targetDepartmentId = body.departmentId && isValidObjectId(String(body.departmentId))
    ? String(body.departmentId)
    : idOf((task as any).assignedDepartment) || idOf((task as any).department) || undefined;
  if (isDeptLeader(actor)) {
    if (body.departmentId && String(body.departmentId) !== actor.department) {
      throw forbidden('Department leaders can only assign tasks within their department.');
    }
    targetDepartmentId = actor.department ?? targetDepartmentId;
  }
  const target = await resolveAssignableUser(actor, userId, targetDepartmentId);
  targetDepartmentId = target.departmentId ?? targetDepartmentId;

  (task as any).assignedTo = userId;
  if (targetDepartmentId) (task as any).assignedDepartment = targetDepartmentId;
  (task as any).assignedAt = new Date();
  if ((task as any).status === 'DRAFT') (task as any).status = 'TODO';
  (task as any).assignmentHistory.push({
    assignedBy: actor.id,
    assignedTo: userId,
    assignedDepartment: targetDepartmentId,
    note: body.note ? String(body.note).trim() : undefined,
    assignedAt: new Date(),
  });

  await taskRepository.save(task);

  await AuditLogModel.create({
    actor: actor.id,
    action: 'TASK_ASSIGNED',
    entityModel: 'Task',
    entityId: (task as any)._id,
    organization: (task as any).organization,
    metadata: { targetUserId: userId, newStatus: (task as any).status },
  });

  return { data: await taskRepository.findById(taskId) };
};

// ─── Start ────────────────────────────────────────────────────────────────────

export const startTaskService = async (actor: AuthUser, id: unknown) => {
  if (!isSpecialist(actor)) throw forbidden('Only specialists can start tasks.');
  const taskId = assertObjectId(id, 'id');
  const task = await taskRepository.findRawById(taskId);
  if (!task) throw notFound('Task not found.');
  if (String((task as any).assignedTo) !== actor.id) throw forbidden('This task is not assigned to you.');
  if (!['TODO', 'REVISION_REQUESTED'].includes((task as any).status)) {
    throw badRequest(`Cannot start task with status '${(task as any).status}'.`);
  }

  (task as any).status = 'IN_PROGRESS';
  if (!(task as any).startAt) (task as any).startAt = new Date();
  await taskRepository.save(task);

  await AuditLogModel.create({
    actor: actor.id, action: 'TASK_STARTED', entityModel: 'Task',
    entityId: (task as any)._id, organization: (task as any).organization,
    metadata: {},
  });

  return { data: await taskRepository.findById(taskId) };
};

// ─── Submit review ────────────────────────────────────────────────────────────

export const submitReviewService = async (actor: AuthUser, id: unknown, body: Record<string, unknown>) => {
  if (!isSpecialist(actor)) throw forbidden('Only specialists can submit for review.');
  const taskId = assertObjectId(id, 'id');
  const task = await taskRepository.findRawById(taskId);
  if (!task) throw notFound('Task not found.');
  if (String((task as any).assignedTo) !== actor.id) throw forbidden('This task is not assigned to you.');
  if ((task as any).status !== 'IN_PROGRESS') throw badRequest(`Task must be IN_PROGRESS to submit for review.`);

  (task as any).status = 'PENDING_REVIEW';
  (task as any).review = {
    ...(task as any).review,
    submittedAt: new Date(),
    result: 'PENDING',
    note: body.note ? String(body.note).trim() : undefined,
  };
  await taskRepository.save(task);

  await AuditLogModel.create({
    actor: actor.id, action: 'TASK_REVIEW_SUBMITTED', entityModel: 'Task',
    entityId: (task as any)._id, organization: (task as any).organization, metadata: {},
  });

  return { data: await taskRepository.findById(taskId) };
};

// ─── Review (approve/return) ──────────────────────────────────────────────────

export const reviewTaskService = async (actor: AuthUser, id: unknown, body: Record<string, unknown>) => {
  if (!isLeaderOrAbove(actor)) throw forbidden('Only leaders can review tasks.');
  const taskId = assertObjectId(id, 'id');
  const { result, note, score } = body;
  if (!result || !['APPROVED', 'RETURNED'].includes(String(result))) {
    throw badRequest('result must be APPROVED or RETURNED.');
  }

  const task = await taskRepository.findRawById(taskId);
  if (!task) throw notFound('Task not found.');
  if ((task as any).status !== 'PENDING_REVIEW') throw badRequest('Task must be PENDING_REVIEW to review.');

  if (isDeptLeader(actor)) {
    ensureTaskInDepartment(task, actor.department);
  }

  (task as any).status = result === 'APPROVED' ? 'DONE' : 'REVISION_REQUESTED';
  if (result === 'APPROVED') (task as any).completedAt = new Date();

  (task as any).review = {
    ...(task as any).review,
    reviewedBy: actor.id,
    reviewedAt: new Date(),
    result,
    note: note ? String(note).trim() : undefined,
    score: score !== undefined ? Number(score) : undefined,
  };
  await taskRepository.save(task);

  await AuditLogModel.create({
    actor: actor.id, action: 'TASK_REVIEWED', entityModel: 'Task',
    entityId: (task as any)._id, organization: (task as any).organization,
    metadata: { result, score },
  });

  return { data: await taskRepository.findById(taskId) };
};

// ─── Cancel ───────────────────────────────────────────────────────────────────

export const cancelTaskService = async (actor: AuthUser, id: unknown) => {
  if (!isLeaderOrAbove(actor)) throw forbidden('Only leaders can cancel tasks.');
  const taskId = assertObjectId(id, 'id');
  const task = await taskRepository.findRawById(taskId);
  if (!task) throw notFound('Task not found.');
  if (['DONE', 'CANCELLED'].includes((task as any).status)) {
    throw badRequest(`Task is already ${(task as any).status}.`);
  }
  if (isDeptLeader(actor)) {
    ensureTaskInDepartment(task, actor.department);
    if (String((task as any).assignedBy) !== actor.id) {
      throw forbidden('Department leaders can only cancel tasks they created.');
    }
  }

  (task as any).status = 'CANCELLED';
  await taskRepository.save(task);

  await AuditLogModel.create({
    actor: actor.id, action: 'TASK_CANCELLED', entityModel: 'Task',
    entityId: (task as any)._id, organization: (task as any).organization, metadata: {},
  });

  return { data: await taskRepository.findById(taskId) };
};

// ─── Update meta ──────────────────────────────────────────────────────────────

export const updateTaskService = async (actor: AuthUser, id: unknown, body: Record<string, unknown>) => {
  const taskId = assertObjectId(id, 'id');
  const task = await taskRepository.findRawById(taskId);
  if (!task) throw notFound('Task not found.');

  if (isSpecialist(actor)) {
    if (String((task as any).assignedTo) !== actor.id) throw forbidden('This task is not assigned to you.');
    if (['DONE', 'CANCELLED'].includes((task as any).status)) {
      throw conflict('Cannot update time for a completed or cancelled task.');
    }

    const invalidFields = Object.keys(body).filter((key) => key !== 'dueAt');
    if (invalidFields.length > 0) throw forbidden('Specialists can only update task dueAt.');
    if (body.dueAt === undefined) throw badRequest('dueAt is required.');

    const dueAt = new Date(String(body.dueAt));
    if (Number.isNaN(dueAt.getTime())) throw badRequest('dueAt must be a valid date.');
    if ((task as any).dueAt && dueAt.getTime() > new Date((task as any).dueAt).getTime()) {
      throw badRequest('New dueAt must be before the current deadline.');
    }
    (task as any).dueAt = dueAt;
    await taskRepository.save(task);
    return { data: await taskRepository.findById(taskId) };
  }

  if (!isLeaderOrAbove(actor)) throw forbidden('Only leaders can update tasks.');
  if (isDeptLeader(actor)) {
    ensureTaskInDepartment(task, actor.department);
    const creatorOnlyFields = ['title', 'description', 'priority'];
    const updatesCreatorOnlyField = creatorOnlyFields.some((field) => body[field] !== undefined);
    if (updatesCreatorOnlyField && String((task as any).assignedBy) !== actor.id) {
      throw forbidden('Department leaders can only edit task content they created.');
    }
  }

  const allowed = [
    'title',
    'description',
    'priority',
    'dueAt',
    'estimatedMinutes',
    'scheduleSegments',
    'scheduledStartAt',
    'scheduledEndAt',
  ];
  for (const key of allowed) {
    if (body[key] !== undefined) {
      if (key === 'scheduleSegments') continue;
      const isScheduledDate = ['scheduledStartAt', 'scheduledEndAt'].includes(key);
      (task as any)[key] = isScheduledDate && body[key] === null
        ? null
        : ['dueAt', 'scheduledStartAt', 'scheduledEndAt'].includes(key)
          ? new Date(String(body[key]))
          : body[key];
    }
  }

  if (body.scheduleSegments !== undefined) {
    if (!Array.isArray(body.scheduleSegments)) {
      throw badRequest('scheduleSegments must be an array.');
    }
    const segments = body.scheduleSegments.map((raw, index) => {
      if (!raw || typeof raw !== 'object') {
        throw badRequest(`scheduleSegments[${index}] must be an object.`);
      }
      const startAt = new Date(String((raw as any).startAt));
      const endAt = new Date(String((raw as any).endAt));
      if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || endAt <= startAt) {
        throw badRequest(`scheduleSegments[${index}] is invalid.`);
      }
      return { startAt, endAt };
    }).sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
    for (let index = 1; index < segments.length; index += 1) {
      if (segments[index].startAt < segments[index - 1].endAt) {
        throw badRequest('scheduleSegments cannot overlap.');
      }
    }
    (task as any).scheduleSegments = segments;
    const envelope = scheduleEnvelope(segments);
    (task as any).scheduledStartAt = envelope.scheduledStartAt ?? null;
    (task as any).scheduledEndAt = envelope.scheduledEndAt ?? null;
  } else if (body.scheduledStartAt !== undefined || body.scheduledEndAt !== undefined) {
    const nextStartAt = (task as any).scheduledStartAt
      ? new Date((task as any).scheduledStartAt)
      : null;
    const nextEndAt = (task as any).scheduledEndAt
      ? new Date((task as any).scheduledEndAt)
      : null;
    if ((nextStartAt && !nextEndAt) || (!nextStartAt && nextEndAt)) {
      throw badRequest('scheduledStartAt and scheduledEndAt must be provided together.');
    }
    if (nextStartAt && Number.isNaN(nextStartAt.getTime())) {
      throw badRequest('scheduledStartAt must be a valid date.');
    }
    if (nextEndAt && Number.isNaN(nextEndAt.getTime())) {
      throw badRequest('scheduledEndAt must be a valid date.');
    }
    if (nextStartAt && nextEndAt && nextEndAt.getTime() <= nextStartAt.getTime()) {
      throw badRequest('scheduledEndAt must be after scheduledStartAt.');
    }
    (task as any).scheduleSegments = nextStartAt && nextEndAt
      ? [{ startAt: nextStartAt, endAt: nextEndAt }]
      : [];
  }
  if (
    body.estimatedMinutes !== undefined
    && (!Number.isInteger(Number(body.estimatedMinutes)) || Number(body.estimatedMinutes) < 15)
  ) {
    throw badRequest('estimatedMinutes must be an integer >= 15.');
  }

  await taskRepository.save(task);
  return { data: await taskRepository.findById(taskId) };
};
