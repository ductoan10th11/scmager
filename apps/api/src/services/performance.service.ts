import { Types } from 'mongoose';
import { DocumentModel, UserModel } from '../models';
import { AuthUser } from '../types/auth';
import { forbidden } from '../utils/http-error';
import { documentWorkflowFiltersFor } from './document-workflow.service';

const idOf = (value: any) => String(value?._id ?? value ?? '');
const objectIdOf = (value: any) => new Types.ObjectId(idOf(value));
const isAdmin = (actor: AuthUser) => actor.role.code === 'ADMIN';
const isOrgLeader = (actor: AuthUser) => ['OFFICE_CHIEF', 'COMMUNE_LEADER'].includes(actor.role.code);
const isDepartmentLeader = (actor: AuthUser) => actor.role.code === 'DEPARTMENT_LEADER';
const isSpecialist = (actor: AuthUser) => actor.role.code === 'SPECIALIST';

const completedExpr = {
  $or: [
    { $eq: ['$ingest.completed', true] },
    { $in: ['$processing.status', ['COMPLETED', 'MANUALLY_PROCESSED']] },
  ],
};

const pendingExpr = {
  $and: [
    { $ne: ['$ingest.completed', true] },
    { $not: [{ $in: ['$processing.status', ['COMPLETED', 'MANUALLY_PROCESSED']] }] },
  ],
};

const baseDocumentFilterFor = async (actor: AuthUser) => {
  const filter: Record<string, unknown> = { deadline: { $ne: null } };
  if (isSpecialist(actor)) {
    const scope = await documentWorkflowFiltersFor(actor, { includeDepartment: false });
    Object.assign(filter, scope.participant);
  } else if (isDepartmentLeader(actor)) {
    const scope = await documentWorkflowFiltersFor(actor);
    Object.assign(filter, scope.participant);
  }
  return filter;
};

const castWorkflowFilter = (filter: Record<string, unknown>) => {
  const next = { ...filter };
  for (const key of ['processing.assignees.userId', 'processing.currentAssignee.userId']) {
    const value: any = next[key];
    if (value?.$in) next[key] = { $in: value.$in.map(objectIdOf) };
    else if (value) next[key] = objectIdOf(value);
  }
  return next;
};

const userFilterFor = (actor: AuthUser) => {
  const filter: Record<string, unknown> = { status: 'ACTIVE' };
  if (isSpecialist(actor)) filter._id = actor.id;
  if (!isAdmin(actor)) {
    if (!actor.organization) throw forbidden('User has no organization assigned.');
    filter.organization = actor.organization;
  }
  if (isDepartmentLeader(actor)) {
    if (!actor.department) throw forbidden('Department leader has no department assigned.');
    filter.department = actor.department;
  }
  return filter;
};

const toNumber = (value: unknown) => Number(value ?? 0) || 0;

const toDocumentItem = (doc: any) => ({
  id: idOf(doc),
  soKyHieu: doc.soKyHieu,
  trichYeu: doc.trichYeu,
  deadline: doc.deadline,
  point: doc.point ?? 0,
  doKhan: doc.doKhan,
  completed: Boolean(doc.ingest?.completed) || ['COMPLETED', 'MANUALLY_PROCESSED'].includes(doc.processing?.status),
  processingStatus: doc.processing?.status ?? 'UNASSIGNED',
  currentAssignee: doc.processing?.currentAssignee ?? null,
});

export const performanceOverviewService = async (actor: AuthUser) => {
  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const in3d = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
  const documentFilter = castWorkflowFilter(await baseDocumentFilterFor(actor));
  const userFilter = userFilterFor(actor);

  const users = await UserModel.find(userFilter)
    .select('_id username fullName position email department role')
    .populate('department', '_id name code')
    .populate('role', '_id code name level')
    .limit(isAdmin(actor) || isOrgLeader(actor) ? 500 : 200)
    .lean();
  const userIds = users.map((user: any) => user._id).filter(Boolean);

  const [
    summaryRaw,
    urgencyRaw,
    assigneeRaw,
    overdueDocuments,
    dueSoonDocuments,
    highPointDocuments,
  ] = await Promise.all([
    DocumentModel.aggregate([
      { $match: documentFilter },
      {
        $group: {
          _id: null,
          totalDocuments: { $sum: 1 },
          completedDocuments: { $sum: { $cond: [completedExpr, 1, 0] } },
          pendingDocuments: { $sum: { $cond: [pendingExpr, 1, 0] } },
          overdueDocuments: {
            $sum: { $cond: [{ $and: [pendingExpr, { $lt: ['$deadline', now] }] }, 1, 0] },
          },
          dueSoonDocuments: {
            $sum: { $cond: [{ $and: [pendingExpr, { $gte: ['$deadline', now] }, { $lte: ['$deadline', in24h] }] }, 1, 0] },
          },
          totalPoint: { $sum: { $ifNull: ['$point', 0] } },
          completedPoint: { $sum: { $cond: [completedExpr, { $ifNull: ['$point', 0] }, 0] } },
          pendingPoint: { $sum: { $cond: [pendingExpr, { $ifNull: ['$point', 0] }, 0] } },
          overduePoint: {
            $sum: { $cond: [{ $and: [pendingExpr, { $lt: ['$deadline', now] }] }, { $ifNull: ['$point', 0] }, 0] },
          },
          dueSoonPoint: {
            $sum: { $cond: [{ $and: [pendingExpr, { $gte: ['$deadline', now] }, { $lte: ['$deadline', in24h] }] }, { $ifNull: ['$point', 0] }, 0] },
          },
        },
      },
    ]),
    DocumentModel.aggregate([
      { $match: documentFilter },
      {
        $group: {
          _id: { $ifNull: ['$doKhan', 'Không rõ'] },
          total: { $sum: 1 },
          point: { $sum: { $ifNull: ['$point', 0] } },
          overdue: { $sum: { $cond: [{ $and: [pendingExpr, { $lt: ['$deadline', now] }] }, 1, 0] } },
          completed: { $sum: { $cond: [completedExpr, 1, 0] } },
        },
      },
      { $sort: { point: -1, total: -1 } },
    ]),
    userIds.length
      ? DocumentModel.aggregate([
        { $match: { deadline: { $ne: null }, 'processing.assignees.userId': { $in: userIds } } },
        { $unwind: '$processing.assignees' },
        { $match: { 'processing.assignees.userId': { $in: userIds } } },
        {
          $group: {
            _id: '$processing.assignees.userId',
            totalDocuments: { $sum: 1 },
            completedDocuments: { $sum: { $cond: [{ $eq: ['$processing.assignees.status', 'PROCESSED'] }, 1, 0] } },
            pendingDocuments: { $sum: { $cond: [{ $eq: ['$processing.assignees.status', 'PENDING'] }, 1, 0] } },
            overdueDocuments: {
              $sum: {
                $cond: [
                  { $and: [{ $eq: ['$processing.assignees.status', 'PENDING'] }, { $lt: ['$deadline', now] }] },
                  1,
                  0,
                ],
              },
            },
            totalPoint: { $sum: { $ifNull: ['$point', 0] } },
            completedPoint: { $sum: { $cond: [{ $eq: ['$processing.assignees.status', 'PROCESSED'] }, { $ifNull: ['$point', 0] }, 0] } },
            pendingPoint: { $sum: { $cond: [{ $eq: ['$processing.assignees.status', 'PENDING'] }, { $ifNull: ['$point', 0] }, 0] } },
            overduePoint: {
              $sum: {
                $cond: [
                  { $and: [{ $eq: ['$processing.assignees.status', 'PENDING'] }, { $lt: ['$deadline', now] }] },
                  { $ifNull: ['$point', 0] },
                  0,
                ],
              },
            },
          },
        },
      ])
      : Promise.resolve([]),
    DocumentModel.find({ ...documentFilter, deadline: { $ne: null, $lt: now }, 'ingest.completed': { $ne: true }, 'processing.status': { $nin: ['COMPLETED', 'MANUALLY_PROCESSED'] } })
      .select('soKyHieu trichYeu deadline point doKhan ingest processing')
      .sort({ deadline: 1, point: -1 })
      .limit(12)
      .lean(),
    DocumentModel.find({ ...documentFilter, deadline: { $gte: now, $lte: in3d }, 'ingest.completed': { $ne: true }, 'processing.status': { $nin: ['COMPLETED', 'MANUALLY_PROCESSED'] } })
      .select('soKyHieu trichYeu deadline point doKhan ingest processing')
      .sort({ deadline: 1, point: -1 })
      .limit(12)
      .lean(),
    DocumentModel.find(documentFilter)
      .select('soKyHieu trichYeu deadline point doKhan ingest processing')
      .sort({ point: -1, deadline: 1 })
      .limit(12)
      .lean(),
  ]);

  const summary = summaryRaw[0] ?? {};
  const byUser = new Map(assigneeRaw.map((item: any) => [idOf(item._id), item]));
  const assignees = users.map((user: any) => {
    const row: any = byUser.get(idOf(user)) ?? {};
    const totalPoint = toNumber(row.totalPoint);
    const completedPoint = toNumber(row.completedPoint);
    return {
      user: {
        id: idOf(user),
        username: user.username,
        fullName: user.fullName,
        position: user.position ?? null,
        email: user.email,
        role: user.role ? { code: user.role.code, name: user.role.name, level: user.role.level } : null,
        department: user.department ? { id: idOf(user.department), name: user.department.name, code: user.department.code } : null,
      },
      totalDocuments: toNumber(row.totalDocuments),
      completedDocuments: toNumber(row.completedDocuments),
      pendingDocuments: toNumber(row.pendingDocuments),
      overdueDocuments: toNumber(row.overdueDocuments),
      totalPoint,
      completedPoint,
      pendingPoint: toNumber(row.pendingPoint),
      overduePoint: toNumber(row.overduePoint),
      completionRate: totalPoint ? Math.round((completedPoint / totalPoint) * 100) : 0,
    };
  }).sort((left, right) => (
    right.overduePoint - left.overduePoint
    || right.pendingPoint - left.pendingPoint
    || right.totalPoint - left.totalPoint
  ));

  const totalPoint = toNumber(summary.totalPoint);
  const completedPoint = toNumber(summary.completedPoint);
  return {
    data: {
      generatedAt: now.toISOString(),
      scope: {
        role: actor.role.code,
        userId: actor.id,
        organizationId: actor.organization ?? null,
        departmentId: actor.department ?? null,
      },
      summary: {
        totalDocuments: toNumber(summary.totalDocuments),
        completedDocuments: toNumber(summary.completedDocuments),
        pendingDocuments: toNumber(summary.pendingDocuments),
        overdueDocuments: toNumber(summary.overdueDocuments),
        dueSoonDocuments: toNumber(summary.dueSoonDocuments),
        totalPoint,
        completedPoint,
        pendingPoint: toNumber(summary.pendingPoint),
        overduePoint: toNumber(summary.overduePoint),
        dueSoonPoint: toNumber(summary.dueSoonPoint),
        completionRate: totalPoint ? Math.round((completedPoint / totalPoint) * 100) : 0,
      },
      urgency: urgencyRaw.map((item: any) => ({
        label: item._id || 'Không rõ',
        total: toNumber(item.total),
        point: toNumber(item.point),
        overdue: toNumber(item.overdue),
        completed: toNumber(item.completed),
      })),
      assignees,
      documents: {
        overdue: overdueDocuments.map(toDocumentItem),
        dueSoon: dueSoonDocuments.map(toDocumentItem),
        highPoint: highPointDocuments.map(toDocumentItem),
      },
    },
  };
};
