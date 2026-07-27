import { OfficeDocumentContextModel, UserModel, WorkDeclarationModel } from '../models';
import type { AuthUser } from '../types/auth';
import { forbidden } from '../utils/http-error';
import { idOf, officeDocumentProjection, officeDocumentScope } from './office-document-projection.service';
import { vietnamDateKey, vietnamDayBounds, vietnamPeriodKey } from './work-policy.service';

const isAdmin = (actor: AuthUser) => actor.role.code === 'ADMIN';
const isDepartmentLeader = (actor: AuthUser) => actor.role.code === 'DEPARTMENT_LEADER';
const isSpecialist = (actor: AuthUser) => actor.role.code === 'SPECIALIST';

const scopedWorkFilter = (actor: AuthUser) => {
  if (!actor.organization && !isAdmin(actor)) throw forbidden('User has no organization assigned.');
  const filter: Record<string, unknown> = {};
  if (!isAdmin(actor)) filter.organization = actor.organization;
  if (isSpecialist(actor)) filter.createdBy = actor.id;
  if (isDepartmentLeader(actor)) {
    if (!actor.department) throw forbidden('Department leader has no department assigned.');
    filter.$or = [
      { department: actor.department },
      { createdBy: actor.id },
      { 'approval.currentApprover': actor.id },
    ];
  }
  return filter;
};

const toDashboardWork = (work: any) => ({
  ...work.toObject?.() ?? work,
  dueAt: work.workEndAt,
  assignedTo: work.createdBy,
  assignedDepartment: work.department,
});

const documentsFor = async (actor: AuthUser) => {
  const contexts = await OfficeDocumentContextModel.find(officeDocumentScope(actor))
    .select('externalDocumentId observation statusSync management observedAt updatedAt')
    .sort({ updatedAt: -1 })
    .limit(2_000)
    .lean();
  return contexts.map(officeDocumentProjection);
};

const documentItem = (document: any) => ({
  _id: document.id,
  documentId: document.documentId,
  soKyHieu: document.soKyHieu,
  trichYeu: document.trichYeu,
  deadline: document.deadline,
  point: document.point,
  completed: document.completed,
  status: document.status,
  processing: document.processing,
  currentAssignee: document.owner,
  updatedAt: document.updatedAt,
});

export const dashboardSummaryService = async (actor: AuthUser) => {
  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const { start: todayStart, end: todayEnd } = vietnamDayBounds(vietnamDateKey(now));
  const workScope = scopedWorkFilter(actor);
  const activeWorkScope = { ...workScope, status: { $ne: 'CANCELLED' } };
  const [documents, total, draft, pendingApproval, returned, approved, overdue, dueSoon, today] = await Promise.all([
    documentsFor(actor),
    WorkDeclarationModel.countDocuments(activeWorkScope),
    WorkDeclarationModel.countDocuments({ ...workScope, status: 'DRAFT' }),
    WorkDeclarationModel.countDocuments({ ...workScope, status: 'PENDING_APPROVAL' }),
    WorkDeclarationModel.countDocuments({ ...workScope, status: 'RETURNED' }),
    WorkDeclarationModel.countDocuments({ ...workScope, status: 'APPROVED' }),
    WorkDeclarationModel.countDocuments({ ...workScope, workEndAt: { $lt: now }, status: { $nin: ['APPROVED', 'CANCELLED'] } }),
    WorkDeclarationModel.countDocuments({ ...workScope, workEndAt: { $gte: now, $lte: in24h }, status: { $nin: ['APPROVED', 'CANCELLED'] } }),
    WorkDeclarationModel.countDocuments({ ...workScope, workStartAt: { $lt: todayEnd }, workEndAt: { $gt: todayStart }, status: { $ne: 'CANCELLED' } }),
  ]);
  const completed = documents.filter((document) => document.completed).length;
  const pending = documents.length - completed;
  const overdueDocuments = documents.filter((document) => document.status === 'OVERDUE').length;
  const currentDocuments = documents.filter((document) => !document.completed).length;
  const monthlyDocuments = documents.filter((document) => {
    const ingestedAt = document.observedAt ? new Date(document.observedAt) : null;
    return ingestedAt && !Number.isNaN(ingestedAt.getTime()) && vietnamPeriodKey(ingestedAt) === vietnamPeriodKey(now);
  }).length;

  return {
    data: {
      role: actor.role.code,
      tasks: { total, todo: draft, inProgress: 0, pendingReview: pendingApproval, done: approved, overdue, dueSoon, today, revisionRequested: returned },
      documents: {
        total: documents.length,
        monthly: monthlyDocuments,
        pending,
        completed,
        overdue: overdueDocuments,
        currentForScope: currentDocuments,
        processedByScope: completed,
        unassigned: documents.filter((document) => !document.owner.id).length,
        unassignedDepartment: 0,
        unassignedSpecialist: 0,
        slaUnassigned: 0,
        readyToComplete: completed,
      },
    },
  };
};

export const dashboardDeadlinesService = async (actor: AuthUser) => {
  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);
  const workScope = scopedWorkFilter(actor);
  const populateWork = (query: any) => query
    .populate('createdBy', '_id username fullName email')
    .populate('department', '_id name code')
    .populate('approval.currentApprover', '_id username fullName email');
  const [documents, overdueTasks, todayTasks, pendingReviewTasks, dueSoonTasks] = await Promise.all([
    documentsFor(actor),
    populateWork(WorkDeclarationModel.find({ ...workScope, workEndAt: { $lt: now }, status: { $nin: ['APPROVED', 'CANCELLED'] } }).sort({ workEndAt: 1 }).limit(10)),
    populateWork(WorkDeclarationModel.find({ ...workScope, workEndAt: { $gte: todayStart, $lt: todayEnd }, status: { $nin: ['APPROVED', 'CANCELLED'] } }).sort({ workEndAt: 1 }).limit(10)),
    populateWork(WorkDeclarationModel.find({ ...workScope, status: 'PENDING_APPROVAL' }).sort({ 'approval.submittedAt': 1 }).limit(10)),
    populateWork(WorkDeclarationModel.find({ ...workScope, workEndAt: { $gte: now, $lte: in24h }, status: { $nin: ['APPROVED', 'CANCELLED'] } }).sort({ workEndAt: 1 }).limit(10)),
  ]);
  const active = documents.filter((document) => !document.completed && document.deadline);
  const byDeadline = (left: any, right: any) => left.deadline.getTime() - right.deadline.getTime();
  return {
    data: {
      overdueTasks: overdueTasks.map(toDashboardWork),
      dueSoonTasks: dueSoonTasks.map(toDashboardWork),
      todayTasks: todayTasks.map(toDashboardWork),
      pendingReviewTasks: pendingReviewTasks.map(toDashboardWork),
      overdueDocuments: active.filter((document) => document.status === 'OVERDUE').sort(byDeadline).slice(0, 10).map(documentItem),
      dueSoonDocuments: active
        .filter((document) => document.status !== 'OVERDUE' && document.deadline && document.deadline >= now && document.deadline <= in24h)
        .sort(byDeadline)
        .slice(0, 10)
        .map(documentItem),
      currentDocuments: active.sort(byDeadline).slice(0, 10).map(documentItem),
      slaUnassignedDocuments: [],
    },
  };
};

export const dashboardWorkloadService = async (actor: AuthUser) => {
  if (!actor.organization && !isAdmin(actor)) return { data: [] };
  const userFilter: Record<string, unknown> = { status: 'ACTIVE' };
  if (actor.organization) userFilter.organization = actor.organization;
  if (isDepartmentLeader(actor)) userFilter.department = actor.department;
  if (isSpecialist(actor)) userFilter._id = actor.id;
  const users = await UserModel.find(userFilter)
    .select('_id username fullName email department')
    .populate('department', '_id name code')
    .limit(200)
    .lean();
  const visibleUsers = new Set(users.map((user: any) => idOf(user)));
  const [documents, work] = await Promise.all([
    documentsFor({ ...actor, role: isSpecialist(actor) || isDepartmentLeader(actor) ? actor.role : { ...actor.role, code: 'OFFICE_CHIEF' } } as AuthUser),
    WorkDeclarationModel.find(scopedWorkFilter(actor)).select('createdBy status workEndAt').lean(),
  ]);
  const workByUser = new Map<string, any>();
  for (const item of work as any[]) {
    const key = idOf(item.createdBy);
    if (!visibleUsers.has(key)) continue;
    const row = workByUser.get(key) ?? { total: 0, todo: 0, inProgress: 0, pendingReview: 0, done: 0, overdue: 0 };
    if (item.status !== 'CANCELLED') row.total += 1;
    if (item.status === 'DRAFT') row.todo += 1;
    if (item.status === 'RETURNED') row.inProgress += 1;
    if (item.status === 'PENDING_APPROVAL') row.pendingReview += 1;
    if (item.status === 'APPROVED') row.done += 1;
    if (item.workEndAt < new Date() && !['APPROVED', 'CANCELLED'].includes(item.status)) row.overdue += 1;
    workByUser.set(key, row);
  }
  const documentByUser = new Map<string, any>();
  for (const document of documents) {
    const key = document.owner.id;
    if (!key || !visibleUsers.has(key)) continue;
    const row = documentByUser.get(key) ?? { documentTotal: 0, documentsCurrent: 0, documentsProcessed: 0, documentsOverdue: 0, currentDocuments: [] };
    row.documentTotal += 1;
    if (document.completed) row.documentsProcessed += 1;
    else row.documentsCurrent += 1;
    if (document.status === 'OVERDUE') row.documentsOverdue += 1;
    if (!document.completed && row.currentDocuments.length < 3) row.currentDocuments.push(documentItem(document));
    documentByUser.set(key, row);
  }
  return {
    data: users.map((user: any) => ({
      user: { _id: idOf(user), username: user.username, fullName: user.fullName, email: user.email, department: user.department },
      ...(workByUser.get(idOf(user)) ?? { total: 0, todo: 0, inProgress: 0, pendingReview: 0, done: 0, overdue: 0 }),
      ...(documentByUser.get(idOf(user)) ?? { documentTotal: 0, documentsCurrent: 0, documentsProcessed: 0, documentsOverdue: 0, currentDocuments: [] }),
    })),
  };
};
