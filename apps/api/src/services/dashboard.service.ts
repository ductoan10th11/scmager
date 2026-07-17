import { Types } from 'mongoose';
import { DocumentModel, RoleModel, UserModel, WorkDeclarationModel } from '../models';
import { AuthUser } from '../types/auth';
import { forbidden } from '../utils/http-error';
import { documentWorkflowFiltersFor } from './document-workflow.service';

const idOf = (value: any) => String(value?._id ?? value ?? '');
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

const pendingIngestFilter = () => ({
  'ingest.completed': { $ne: true },
  'ingest.deadLetter': { $ne: true },
});

const toDashboardWork = (work: any) => ({
  ...work.toObject?.() ?? work,
  dueAt: work.workEndAt,
  assignedTo: work.createdBy,
  assignedDepartment: work.department,
});

export const dashboardSummaryService = async (actor: AuthUser) => {
  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);
  const workScope = scopedWorkFilter(actor);
  const activeWorkScope = { ...workScope, status: { $ne: 'CANCELLED' } };
  const pendingDocuments = pendingIngestFilter();
  const documentScope = await documentWorkflowFiltersFor(actor);

  const [total, draft, pendingApproval, returned, approved, overdue, dueSoon, today, documentTotal, documentPending, documentCompleted, documentOverdue, documentCurrent, documentProcessed] = await Promise.all([
    WorkDeclarationModel.countDocuments(activeWorkScope),
    WorkDeclarationModel.countDocuments({ ...workScope, status: 'DRAFT' }),
    WorkDeclarationModel.countDocuments({ ...workScope, status: 'PENDING_APPROVAL' }),
    WorkDeclarationModel.countDocuments({ ...workScope, status: 'RETURNED' }),
    WorkDeclarationModel.countDocuments({ ...workScope, status: 'APPROVED' }),
    WorkDeclarationModel.countDocuments({ ...workScope, workEndAt: { $lt: now }, status: { $nin: ['APPROVED', 'CANCELLED'] } }),
    WorkDeclarationModel.countDocuments({ ...workScope, workEndAt: { $gte: now, $lte: in24h }, status: { $nin: ['APPROVED', 'CANCELLED'] } }),
    WorkDeclarationModel.countDocuments({ ...workScope, workEndAt: { $gte: todayStart, $lt: todayEnd }, status: { $nin: ['APPROVED', 'CANCELLED'] } }),
    DocumentModel.countDocuments(documentScope.participant),
    DocumentModel.countDocuments({ ...documentScope.participant, ...pendingDocuments }),
    DocumentModel.countDocuments({ ...documentScope.participant, 'ingest.completed': true }),
    DocumentModel.countDocuments({ ...documentScope.current, ...pendingDocuments, deadline: { $lt: now } }),
    DocumentModel.countDocuments({ ...documentScope.current, ...pendingDocuments }),
    DocumentModel.countDocuments(documentScope.processed),
  ]);

  return {
    data: {
      role: actor.role.code,
      tasks: { total, todo: draft, inProgress: 0, pendingReview: pendingApproval, done: approved, overdue, dueSoon, today, revisionRequested: returned },
      documents: {
        total: documentTotal,
        pending: documentPending,
        completed: documentCompleted,
        overdue: documentOverdue,
        currentForScope: documentCurrent,
        processedByScope: documentProcessed,
        // Compatibility aliases until the dashboard clients are fully refreshed.
        unassigned: documentPending,
        unassignedDepartment: documentPending,
        unassignedSpecialist: 0,
        slaUnassigned: 0,
        readyToComplete: documentCompleted,
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
  const documentScope = await documentWorkflowFiltersFor(actor);
  const populateWork = (query: any) => query
    .populate('createdBy', '_id username fullName email')
    .populate('department', '_id name code')
    .populate('approval.currentApprover', '_id username fullName email');

  const [overdueTasks, todayTasks, pendingReviewTasks, dueSoonTasks, overdueDocuments, currentDocuments] = await Promise.all([
    populateWork(WorkDeclarationModel.find({ ...workScope, workEndAt: { $lt: now }, status: { $nin: ['APPROVED', 'CANCELLED'] } }).sort({ workEndAt: 1 }).limit(10)),
    populateWork(WorkDeclarationModel.find({ ...workScope, workEndAt: { $gte: todayStart, $lt: todayEnd }, status: { $nin: ['APPROVED', 'CANCELLED'] } }).sort({ workEndAt: 1 }).limit(10)),
    populateWork(WorkDeclarationModel.find({ ...workScope, status: 'PENDING_APPROVAL' }).sort({ 'approval.submittedAt': 1 }).limit(10)),
    populateWork(WorkDeclarationModel.find({ ...workScope, workEndAt: { $gte: now, $lte: in24h }, status: { $nin: ['APPROVED', 'CANCELLED'] } }).sort({ workEndAt: 1 }).limit(10)),
    DocumentModel.find({ ...documentScope.current, ...pendingIngestFilter(), deadline: { $lt: now } }).sort({ deadline: 1 }).limit(10),
    DocumentModel.find({ ...documentScope.current, ...pendingIngestFilter() }).sort({ deadline: 1, updatedAt: -1 }).limit(10),
  ]);

  return {
    data: {
      overdueTasks: overdueTasks.map(toDashboardWork),
      dueSoonTasks: dueSoonTasks.map(toDashboardWork),
      todayTasks: todayTasks.map(toDashboardWork),
      pendingReviewTasks: pendingReviewTasks.map(toDashboardWork),
      overdueDocuments,
      currentDocuments,
      slaUnassignedDocuments: [],
    },
  };
};

export const dashboardWorkloadService = async (actor: AuthUser) => {
  if (!actor.organization && !isAdmin(actor)) return { data: [] };
  const userFilter: Record<string, unknown> = { status: 'ACTIVE' };
  if (!isAdmin(actor) && actor.organization) userFilter.organization = actor.organization;
  if (isDepartmentLeader(actor)) {
    if (!actor.department) throw forbidden('Department leader has no department assigned.');
    userFilter.department = actor.department;
  }
  if (isSpecialist(actor)) userFilter._id = actor.id;
  const specialistRole = await RoleModel.findOne({ code: 'SPECIALIST' }).select('_id');
  if (!isSpecialist(actor) && specialistRole) userFilter.role = specialistRole._id;

  const users = await UserModel.find(userFilter).select('_id username fullName email department').populate('department', '_id name code').limit(200);
  const match: Record<string, unknown> = { createdBy: { $in: users.map((user: any) => user._id) } };
  if (!isAdmin(actor) && actor.organization) match.organization = new Types.ObjectId(actor.organization);
  const grouped = await WorkDeclarationModel.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$createdBy',
        total: { $sum: { $cond: [{ $ne: ['$status', 'CANCELLED'] }, 1, 0] } },
        todo: { $sum: { $cond: [{ $eq: ['$status', 'DRAFT'] }, 1, 0] } },
        inProgress: { $sum: { $cond: [{ $eq: ['$status', 'RETURNED'] }, 1, 0] } },
        pendingReview: { $sum: { $cond: [{ $eq: ['$status', 'PENDING_APPROVAL'] }, 1, 0] } },
        done: { $sum: { $cond: [{ $eq: ['$status', 'APPROVED'] }, 1, 0] } },
        overdue: { $sum: { $cond: [{ $and: [{ $lt: ['$workEndAt', new Date()] }, { $not: [{ $in: ['$status', ['APPROVED', 'CANCELLED']] }] }] }, 1, 0] } },
      },
    },
  ]);
  const countsByUser = new Map(grouped.map((item: any) => [idOf(item._id), item]));
  const userIds = users.map((user: any) => user._id);
  const documentMatch = {
    deadline: { $ne: null },
    'processing.assignees.userId': { $in: userIds },
  };
  const [documentGrouped, currentDocuments] = await Promise.all([
    DocumentModel.aggregate([
      { $match: documentMatch },
      { $unwind: '$processing.assignees' },
      { $match: { 'processing.assignees.userId': { $in: userIds } } },
      {
        $group: {
          _id: '$processing.assignees.userId',
          documentTotal: { $sum: 1 },
          documentsCurrent: { $sum: { $cond: [{ $eq: ['$processing.assignees.status', 'PENDING'] }, 1, 0] } },
          documentsProcessed: { $sum: { $cond: [{ $eq: ['$processing.assignees.status', 'PROCESSED'] }, 1, 0] } },
          documentsOverdue: {
            $sum: {
              $cond: [
                { $and: [{ $eq: ['$processing.assignees.status', 'PENDING'] }, { $lt: ['$deadline', new Date()] }] },
                1,
                0,
              ],
            },
          },
        },
      },
    ]),
    DocumentModel.find({
      deadline: { $ne: null },
      'processing.currentAssignee.userId': { $in: userIds },
    })
      .select('soDen soKyHieu trichYeu deadline processing.currentAssignee')
      .sort({ deadline: 1, updatedAt: -1 })
      .limit(100)
      .lean(),
  ]);
  const documentCountsByUser = new Map(documentGrouped.map((item: any) => [idOf(item._id), item]));
  const activeDocumentsByUser = new Map<string, any[]>();
  for (const document of currentDocuments as any[]) {
    const userId = idOf(document.processing?.currentAssignee?.userId);
    if (!userId) continue;
    const bucket = activeDocumentsByUser.get(userId) ?? [];
    if (bucket.length < 3) {
      bucket.push({
        id: idOf(document),
        soDen: document.soDen,
        soKyHieu: document.soKyHieu,
        trichYeu: document.trichYeu,
        deadline: document.deadline,
      });
    }
    activeDocumentsByUser.set(userId, bucket);
  }

  return {
    data: users.map((user: any) => {
      const counts: any = countsByUser.get(idOf(user)) ?? {};
      const documentCounts: any = documentCountsByUser.get(idOf(user)) ?? {};
      return {
        user: { _id: idOf(user), username: user.username, fullName: user.fullName, email: user.email, department: user.department },
        total: counts.total ?? 0,
        todo: counts.todo ?? 0,
        inProgress: counts.inProgress ?? 0,
        pendingReview: counts.pendingReview ?? 0,
        done: counts.done ?? 0,
        overdue: counts.overdue ?? 0,
        documentTotal: documentCounts.documentTotal ?? 0,
        documentsCurrent: documentCounts.documentsCurrent ?? 0,
        documentsProcessed: documentCounts.documentsProcessed ?? 0,
        documentsOverdue: documentCounts.documentsOverdue ?? 0,
        currentDocuments: activeDocumentsByUser.get(idOf(user)) ?? [],
      };
    }),
  };
};
