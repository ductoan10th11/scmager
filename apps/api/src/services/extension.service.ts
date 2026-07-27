import { OfficeDocumentContextModel, WorkDeclarationModel } from '../models';
import type { AuthUser } from '../types/auth';
import { forbidden } from '../utils/http-error';
import { officeDocumentProjection, officeDocumentScope } from './office-document-projection.service';

const isAdmin = (actor: AuthUser) => actor.role.code === 'ADMIN';
const isSpecialist = (actor: AuthUser) => actor.role.code === 'SPECIALIST';
const isDepartmentLeader = (actor: AuthUser) => actor.role.code === 'DEPARTMENT_LEADER';

const parseLimit = (value: unknown) => Math.min(Math.max(Number(value) || 5, 0), 50);

const scopedWorkFilter = (actor: AuthUser) => {
  if (!actor.organization && !isAdmin(actor)) throw forbidden('User has no organization assigned.');
  const filter: Record<string, unknown> = {};
  if (!isAdmin(actor)) filter.organization = actor.organization;
  if (isSpecialist(actor)) filter.createdBy = actor.id;
  if (isDepartmentLeader(actor)) {
    filter.$or = [{ department: actor.department }, { createdBy: actor.id }, { 'approval.currentApprover': actor.id }];
  }
  return filter;
};

const toSafeUser = (actor: AuthUser) => ({
  id: actor.id, username: actor.username, fullName: actor.fullName, position: actor.position ?? null,
  email: actor.email, role: actor.role, organization: actor.organization, department: actor.department, status: actor.status,
});

const toWorkItem = (work: any) => ({
  id: String(work._id), title: work.title, type: 'WORK_DECLARATION', status: work.status,
  priority: null, dueAt: work.workEndAt, assignedAt: work.createdAt, point: work.declaredPoint,
  currentApprover: work.approval?.currentApprover ? {
    id: String(work.approval.currentApprover._id), username: work.approval.currentApprover.username,
    fullName: work.approval.currentApprover.fullName, position: work.approval.currentApprover.position ?? null, email: work.approval.currentApprover.email,
  } : null,
  assignedTo: work.createdBy ? {
    id: String(work.createdBy._id), username: work.createdBy.username, fullName: work.createdBy.fullName,
    position: work.createdBy.position ?? null, email: work.createdBy.email,
  } : null,
  assignedDepartment: work.department ? { id: String(work.department._id), name: work.department.name, code: work.department.code } : null,
});

const toOfficeDocumentItem = (document: any) => ({
  id: document.id,
  documentId: document.documentId,
  soKyHieu: document.soKyHieu,
  trichYeu: document.trichYeu,
  ngayDen: document.ngayDen,
  deadline: document.deadline,
  point: document.point,
  doKhan: '',
  nguoiXuLy: document.owner.fullName,
  completed: document.completed,
  deadLetter: false,
  lastError: '',
  processingStatus: document.status,
  currentAssignee: document.owner,
  latestTrackLog: document.trackLogs.at(-1) ?? null,
  updatedAt: document.updatedAt,
});

export const extensionOverviewService = async (actor: AuthUser, query: Record<string, unknown>) => {
  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);
  const limit = parseLimit(query.limit);
  const workScope = scopedWorkFilter(actor);
  const activeWorkScope = { ...workScope, status: { $ne: 'CANCELLED' } };
  const [contexts, total, draft, pendingApproval, returned, approved, overdue, dueSoon, today, workItemsRaw] = await Promise.all([
    OfficeDocumentContextModel.find(officeDocumentScope(actor))
      .select('externalDocumentId observation statusSync management observedAt updatedAt')
      .sort({ updatedAt: -1 }).limit(2_000).lean(),
    WorkDeclarationModel.countDocuments(activeWorkScope),
    WorkDeclarationModel.countDocuments({ ...workScope, status: 'DRAFT' }),
    WorkDeclarationModel.countDocuments({ ...workScope, status: 'PENDING_APPROVAL' }),
    WorkDeclarationModel.countDocuments({ ...workScope, status: 'RETURNED' }),
    WorkDeclarationModel.countDocuments({ ...workScope, status: 'APPROVED' }),
    WorkDeclarationModel.countDocuments({ ...workScope, workEndAt: { $lt: now }, status: { $nin: ['APPROVED', 'CANCELLED'] } }),
    WorkDeclarationModel.countDocuments({ ...workScope, workEndAt: { $gte: now, $lte: in24h }, status: { $nin: ['APPROVED', 'CANCELLED'] } }),
    WorkDeclarationModel.countDocuments({ ...workScope, workEndAt: { $gte: todayStart, $lt: todayEnd }, status: { $nin: ['APPROVED', 'CANCELLED'] } }),
    limit ? WorkDeclarationModel.find(activeWorkScope).sort({ workEndAt: 1, updatedAt: -1 }).limit(limit)
      .populate('createdBy', '_id username fullName position email')
      .populate('department', '_id name code')
      .populate('approval.currentApprover', '_id username fullName position email') : Promise.resolve([]),
  ]);
  const documents = contexts.map(officeDocumentProjection);
  const completedDocuments = documents.filter((document) => document.completed);
  const pendingDocuments = documents.filter((document) => !document.completed);
  const overdueDocuments = pendingDocuments.filter((document) => document.status === 'OVERDUE');
  const totalPoint = documents.reduce((sum, document) => sum + document.point, 0);
  const completedPoint = completedDocuments.reduce((sum, document) => sum + document.point, 0);
  const pendingPoint = pendingDocuments.reduce((sum, document) => sum + document.point, 0);
  const overduePoint = overdueDocuments.reduce((sum, document) => sum + document.point, 0);
  const dueSoonPoint = pendingDocuments.filter((document) => document.deadline && document.deadline >= now && document.deadline <= in24h)
    .reduce((sum, document) => sum + document.point, 0);
  return { data: {
    serverTime: now.toISOString(), user: toSafeUser(actor),
    tasks: { summary: { total, todo: draft, inProgress: 0, pendingReview: pendingApproval, revisionRequested: returned, done: approved, overdue, dueSoon, today }, items: (workItemsRaw as any[]).map(toWorkItem) },
    ingestDocuments: {
      summary: { total: documents.length, completed: completedDocuments.length, pending: pendingDocuments.length, deadLetter: 0, failed: 0, updatedLast24h: documents.filter((document) => document.updatedAt && new Date(document.updatedAt).getTime() >= now.getTime() - 86_400_000).length, overdue: overdueDocuments.length },
      performance: { totalPoint, completedPoint, pendingPoint, overduePoint, dueSoonPoint, completionRate: documents.length ? Math.round((completedDocuments.length / documents.length) * 100) : 0, overdueRate: documents.length ? Math.round((overdueDocuments.length / documents.length) * 100) : 0 },
      items: documents.sort((left, right) => (right.deadline?.getTime?.() ?? 0) - (left.deadline?.getTime?.() ?? 0)).slice(0, limit).map(toOfficeDocumentItem),
    },
  } };
};
