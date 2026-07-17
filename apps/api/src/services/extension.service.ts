import { DocumentModel, WorkDeclarationModel } from '../models';
import { AuthUser } from '../types/auth';
import { forbidden } from '../utils/http-error';
import { documentWorkflowFiltersFor } from './document-workflow.service';

const idOf = (value: any) => String(value?._id ?? value ?? '');
const isAdmin = (actor: AuthUser) => actor.role.code === 'ADMIN';
const isDepartmentLeader = (actor: AuthUser) => actor.role.code === 'DEPARTMENT_LEADER';
const isSpecialist = (actor: AuthUser) => actor.role.code === 'SPECIALIST';

const parseLimit = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 5;
  return Math.min(Math.max(parsed, 0), 20);
};

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

const toSafeUser = (actor: AuthUser) => ({
  id: actor.id,
  username: actor.username,
  fullName: actor.fullName,
  position: actor.position ?? null,
  email: actor.email,
  role: actor.role,
  organization: actor.organization,
  department: actor.department,
  status: actor.status,
});

const toWorkItem = (work: any) => ({
  id: idOf(work),
  title: work.title,
  type: 'WORK_DECLARATION',
  status: work.status,
  priority: null,
  dueAt: work.workEndAt,
  assignedAt: work.createdAt,
  point: work.declaredPoint,
  currentApprover: work.approval?.currentApprover
    ? {
      id: idOf(work.approval.currentApprover),
      username: work.approval.currentApprover.username,
      fullName: work.approval.currentApprover.fullName,
      position: work.approval.currentApprover.position ?? null,
      email: work.approval.currentApprover.email,
    }
    : null,
  assignedTo: work.createdBy
    ? {
      id: idOf(work.createdBy),
      username: work.createdBy.username,
      fullName: work.createdBy.fullName,
      position: work.createdBy.position ?? null,
      email: work.createdBy.email,
    }
    : null,
  assignedDepartment: work.department
    ? { id: idOf(work.department), name: work.department.name, code: work.department.code }
    : null,
});

const toIngestDocumentItem = (doc: any) => ({
  id: idOf(doc),
  documentId: doc.documentId,
  soDen: doc.soDen,
  soKyHieu: doc.soKyHieu,
  trichYeu: doc.trichYeu,
  donViBanHanh: doc.donViBanHanh,
  ngayDen: doc.ngayDen,
  deadline: doc.deadline ?? null,
  point: doc.point ?? null,
  pointSource: doc.pointSource?.comment ?? null,
  doKhan: doc.doKhan,
  doMat: doc.doMat,
  completed: Boolean(doc.ingest?.completed),
  deadLetter: Boolean(doc.ingest?.deadLetter),
  lastError: doc.ingest?.lastError || '',
  detailFetchedAt: doc.ingest?.detailFetchedAt ?? null,
  processingStatus: doc.processing?.status ?? 'UNASSIGNED',
  currentAssignee: doc.processing?.currentAssignee ?? null,
  updatedAt: doc.updatedAt,
});

export const extensionOverviewService = async (actor: AuthUser, query: Record<string, unknown>) => {
  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);
  const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const limit = parseLimit(query.limit);
  const workScope = scopedWorkFilter(actor);
  const activeWorkScope = { ...workScope, status: { $ne: 'CANCELLED' } };
  const pendingIngestFilter = { 'ingest.completed': { $ne: true }, 'ingest.deadLetter': { $ne: true } };
  const documentScope = await documentWorkflowFiltersFor(actor);
  const taskDocumentScope = { ...documentScope.participant, deadline: { $ne: null } };
  const currentTaskDocumentScope = { ...documentScope.current, deadline: { $ne: null } };

  const [
    total,
    draft,
    pendingApproval,
    returned,
    approved,
    overdue,
    dueSoon,
    today,
    workItemsRaw,
    ingestTotal,
    ingestCompleted,
    ingestPending,
    ingestDeadLetter,
    ingestFailed,
    ingestUpdatedLast24h,
    ingestOverdue,
    ingestPointStats,
    ingestItemsRaw,
  ] = await Promise.all([
    WorkDeclarationModel.countDocuments(activeWorkScope),
    WorkDeclarationModel.countDocuments({ ...workScope, status: 'DRAFT' }),
    WorkDeclarationModel.countDocuments({ ...workScope, status: 'PENDING_APPROVAL' }),
    WorkDeclarationModel.countDocuments({ ...workScope, status: 'RETURNED' }),
    WorkDeclarationModel.countDocuments({ ...workScope, status: 'APPROVED' }),
    WorkDeclarationModel.countDocuments({ ...workScope, workEndAt: { $lt: now }, status: { $nin: ['APPROVED', 'CANCELLED'] } }),
    WorkDeclarationModel.countDocuments({ ...workScope, workEndAt: { $gte: now, $lte: in24h }, status: { $nin: ['APPROVED', 'CANCELLED'] } }),
    WorkDeclarationModel.countDocuments({ ...workScope, workEndAt: { $gte: todayStart, $lt: todayEnd }, status: { $nin: ['APPROVED', 'CANCELLED'] } }),
    limit > 0
      ? WorkDeclarationModel.find(activeWorkScope)
        .sort({ workEndAt: 1, updatedAt: -1 })
        .limit(limit)
        .populate('createdBy', '_id username fullName position email')
        .populate('department', '_id name code')
        .populate('approval.currentApprover', '_id username fullName position email')
      : Promise.resolve([]),
    DocumentModel.countDocuments(taskDocumentScope),
    DocumentModel.countDocuments({ ...taskDocumentScope, 'ingest.completed': true }),
    DocumentModel.countDocuments({ ...taskDocumentScope, ...pendingIngestFilter }),
    DocumentModel.countDocuments({ ...taskDocumentScope, 'ingest.deadLetter': true }),
    DocumentModel.countDocuments({ ...taskDocumentScope, 'ingest.lastError': { $nin: ['', null] } }),
    DocumentModel.countDocuments({ ...taskDocumentScope, updatedAt: { $gte: last24h } }),
    DocumentModel.countDocuments({ ...currentTaskDocumentScope, ...pendingIngestFilter, deadline: { $lt: now } }),
    DocumentModel.aggregate([
      { $match: taskDocumentScope },
      {
        $group: {
          _id: null,
          totalPoint: { $sum: { $ifNull: ['$point', 0] } },
          completedPoint: {
            $sum: {
              $cond: [
                {
                  $or: [
                    { $eq: ['$ingest.completed', true] },
                    { $in: ['$processing.status', ['COMPLETED', 'MANUALLY_PROCESSED']] },
                  ],
                },
                { $ifNull: ['$point', 0] },
                0,
              ],
            },
          },
          pendingPoint: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ne: ['$ingest.completed', true] },
                    { $not: [{ $in: ['$processing.status', ['COMPLETED', 'MANUALLY_PROCESSED']] }] },
                  ],
                },
                { $ifNull: ['$point', 0] },
                0,
              ],
            },
          },
          overduePoint: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $lt: ['$deadline', now] },
                    { $ne: ['$ingest.completed', true] },
                    { $not: [{ $in: ['$processing.status', ['COMPLETED', 'MANUALLY_PROCESSED']] }] },
                  ],
                },
                { $ifNull: ['$point', 0] },
                0,
              ],
            },
          },
          dueSoonPoint: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $gte: ['$deadline', now] },
                    { $lte: ['$deadline', in24h] },
                    { $ne: ['$ingest.completed', true] },
                    { $not: [{ $in: ['$processing.status', ['COMPLETED', 'MANUALLY_PROCESSED']] }] },
                  ],
                },
                { $ifNull: ['$point', 0] },
                0,
              ],
            },
          },
        },
      },
    ]),
    limit > 0
      ? DocumentModel.find(taskDocumentScope)
        .sort({ deadline: 1, updatedAt: -1 })
        .limit(limit)
        .select('documentId soDen soKyHieu trichYeu donViBanHanh ngayDen deadline point pointSource doKhan doMat ingest processing updatedAt')
      : Promise.resolve([]),
  ]);
  const pointStats = Array.isArray(ingestPointStats) && ingestPointStats[0]
    ? ingestPointStats[0]
    : { totalPoint: 0, completedPoint: 0, pendingPoint: 0, overduePoint: 0, dueSoonPoint: 0 };

  return {
    data: {
      serverTime: now.toISOString(),
      user: toSafeUser(actor),
      // Keep the `tasks` key for extension compatibility; its items are work declarations.
      tasks: {
        summary: {
          total,
          todo: draft,
          inProgress: 0,
          pendingReview: pendingApproval,
          revisionRequested: returned,
          done: approved,
          overdue,
          dueSoon,
          today,
        },
        items: (Array.isArray(workItemsRaw) ? workItemsRaw : []).map(toWorkItem),
      },
      ingestDocuments: {
        summary: {
          total: ingestTotal,
          completed: ingestCompleted,
          pending: ingestPending,
          deadLetter: ingestDeadLetter,
          failed: ingestFailed,
          updatedLast24h: ingestUpdatedLast24h,
          overdue: ingestOverdue,
        },
        performance: {
          totalPoint: pointStats.totalPoint,
          completedPoint: pointStats.completedPoint,
          pendingPoint: pointStats.pendingPoint,
          overduePoint: pointStats.overduePoint,
          dueSoonPoint: pointStats.dueSoonPoint,
          completionRate: ingestTotal ? Math.round((ingestCompleted / ingestTotal) * 100) : 0,
          overdueRate: ingestTotal ? Math.round((ingestOverdue / ingestTotal) * 100) : 0,
        },
        items: (Array.isArray(ingestItemsRaw) ? ingestItemsRaw : []).map(toIngestDocumentItem),
      },
    },
  };
};
