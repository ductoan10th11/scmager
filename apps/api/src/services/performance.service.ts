import {
  DocumentResultLinkModel,
  OfficeDocumentContextModel,
  UserModel,
  WorkDeclarationModel,
} from '../models';
import type { AuthUser } from '../types/auth';
import { badRequest, forbidden } from '../utils/http-error';
import { calculateCreditedPoint } from './kpi.service';
import { vietnamPeriodKey, workingDaysLate } from './work-policy.service';
import {
  effectiveOfficeDocumentCompletion,
  effectiveOfficeDocumentPoint,
  effectiveOfficeDocumentReworkCount,
} from './office-document-completion.service';

const idOf = (value: any) => String(value?._id ?? value ?? '');
const isSpecialist = (actor: AuthUser) => actor.role.code === 'SPECIALIST';
const isDepartmentLeader = (actor: AuthUser) => actor.role.code === 'DEPARTMENT_LEADER';
const isOrganizationViewer = (actor: AuthUser) => ['ADMIN', 'OFFICE_CHIEF', 'COMMUNE_LEADER'].includes(actor.role.code);

const parsePeriod = (value: unknown) => {
  if (value === undefined || value === null || value === '') return vietnamPeriodKey(new Date());
  const period = String(value);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw badRequest('period must use YYYY-MM.');
  return period;
};

const parseVietnamDate = (value: unknown, endOfDay = false): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const raw = String(value).trim();
  const match = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/);
  if (match) {
    const [, day, month, year, hour, minute] = match;
    return new Date(`${year}-${month}-${day}T${hour ?? (endOfDay ? '23' : '00')}:${minute ?? (endOfDay ? '59' : '00')}:${endOfDay && !hour ? '59' : '00'}+07:00`);
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const userFilterFor = (actor: AuthUser) => {
  const filter: Record<string, unknown> = { status: 'ACTIVE' };
  if (actor.organization) filter.organization = actor.organization;
  if (isSpecialist(actor)) filter._id = actor.id;
  if (isDepartmentLeader(actor)) {
    if (!actor.department) throw forbidden('Department leader has no department assigned.');
    filter.department = actor.department;
  }
  if (!actor.organization && !isOrganizationViewer(actor)) throw forbidden('User has no organization assigned.');
  return filter;
};

const contextCompletedAt = (context: any) => {
  return effectiveOfficeDocumentCompletion(context).completedAt;
};

const documentStatus = (completed: boolean, deadline: Date | null) => {
  if (completed) return 'COMPLETED';
  if (deadline && deadline.getTime() < Date.now()) return 'OVERDUE';
  return 'IN_PROGRESS';
};

export const performanceDocumentOwnerId = (
  context: any,
  completion = effectiveOfficeDocumentCompletion(context),
) => {
  const resultPerformerId =
    completion.source === 'DOCUMENT_RESULT'
      ? idOf(context.management?.businessCompletion?.submittedBy)
      : '';
  return resultPerformerId || idOf(context.management?.assignment?.userId);
};

/**
 * KPI is derived from the same extension-origin incoming documents shown to
 * users. Management.assignment is the persisted eOffice-to-internal-user map;
 * no legacy ingest rows are included here.
 */
export const performanceOverviewService = async (
  actor: AuthUser,
  query: Record<string, unknown> = {},
  options: { documentLimit?: number; sourceLimit?: number | null; deadlineRange?: { start: Date; end: Date } } = {},
) => {
  const period = parsePeriod(query.period);
  const users = await UserModel.find(userFilterFor(actor))
    .select('_id username fullName position email department role')
    .populate('department', '_id name code')
    .populate('role', '_id code name level')
    .limit(isOrganizationViewer(actor) ? 500 : 200)
    .lean();
  const userIds = new Set(users.map((user: any) => idOf(user._id)));
  const contextFilter: Record<string, unknown> = { pageType: 'incoming' };
  if (actor.organization) contextFilter.organizationId = actor.organization;
  else if (actor.role.code !== 'ADMIN') contextFilter._id = null;

  const sourceContextQuery = OfficeDocumentContextModel.find(contextFilter)
    .select('externalDocumentId observation statusSync management')
    .sort({ observedAt: -1 });
  if (options.sourceLimit !== null && options.sourceLimit !== undefined) {
    sourceContextQuery.limit(options.sourceLimit);
  }
  const workDeclarationQuery = WorkDeclarationModel.find({
      ...(actor.organization ? { organization: actor.organization } : isOrganizationViewer(actor) ? {} : { _id: null }),
      createdBy: { $in: [...userIds] },
      sourceDocument: null,
      status: { $in: ['APPROVED', 'PENDING_COMPLETION', 'COMPLETED'] },
    })
      .select('createdBy title description workEndAt declaredPoint pointAdjustment completion approval status workSource kpiImport')
      .sort({ workEndAt: -1 });
  const productContextQuery = OfficeDocumentContextModel.find({
    ...(actor.organization
      ? { organizationId: actor.organization }
      : isOrganizationViewer(actor)
        ? {}
        : { _id: null }),
    pageType: { $in: ['outgoing', 'outgoing_c2'] },
    'management.assignment.userId': { $in: [...userIds] },
  })
    .select('externalDocumentId observation management observedAt pageType')
    .sort({ observedAt: -1 });
  const linkedProductQuery = DocumentResultLinkModel.find({
    ...(actor.organization
      ? { organization: actor.organization }
      : isOrganizationViewer(actor)
        ? {}
        : { _id: null }),
    incomingDocument: { $ne: null },
  })
    .select('outgoingDocument')
    .lean();
  if (options.sourceLimit !== null && options.sourceLimit !== undefined) {
    workDeclarationQuery.limit(options.sourceLimit);
    productContextQuery.limit(options.sourceLimit);
  }
  const [
    sourceContexts,
    workDeclarations,
    productContexts,
    linkedProductRows,
  ] = await Promise.all([
    sourceContextQuery.lean(),
    workDeclarationQuery.lean(),
    productContextQuery.lean(),
    linkedProductQuery,
  ]);

  const incomingDocuments = sourceContexts
    .map((context: any) => {
      const imported = context.management?.kpiImport ?? null;
      const deadline = parseVietnamDate(
        context.management?.overrides?.dueDate ?? context.observation?.dueDate,
        true,
      );
      const effectiveCompletion = effectiveOfficeDocumentCompletion(context);
      const completed = imported?.importKey
        ? Number(imported.completedQuantity ?? 0) >= Number(imported.assignedQuantity ?? 1)
        : effectiveCompletion.completed;
      const completedAt = imported?.importKey && imported.completedAt
        ? new Date(imported.completedAt)
        : contextCompletedAt(context);
      const appearsInPeriod = options.deadlineRange
        ? Boolean(deadline && deadline >= options.deadlineRange.start && deadline <= options.deadlineRange.end)
        : completed
          ? Boolean(completedAt && vietnamPeriodKey(completedAt) === period)
          : Boolean(deadline && vietnamPeriodKey(deadline) === period);
      const assignment = context.management?.assignment ?? {};
      const ownerId = performanceDocumentOwnerId(
        context,
        effectiveCompletion,
      );
      const scopeAllows = isSpecialist(actor)
        ? ownerId === actor.id
        : isDepartmentLeader(actor)
          ? userIds.has(ownerId)
          : true;
      if (!appearsInPeriod || !scopeAllows) return null;

      const point = imported?.importKey
        ? Number(imported.point ?? 0)
        : effectiveOfficeDocumentPoint(context);
      const reworkCount = imported?.importKey
        ? Math.max(0, Number(imported.reworkCount ?? 0) || 0)
        : effectiveOfficeDocumentReworkCount(context);
      const lateWorkingDays = completed && deadline && completedAt
        ? workingDaysLate(deadline, completedAt)
        : 0;
      const status = documentStatus(completed, deadline);
      const owner = users.find((user: any) => idOf(user._id) === ownerId);
      return {
        id: idOf(context._id),
        source: 'OFFICE_CONTEXT',
        documentId: context.externalDocumentId,
        soDen: '',
        soKyHieu: context.management?.overrides?.soKyHieu ?? context.observation?.soKyHieu ?? '',
        trichYeu: context.management?.overrides?.subject ?? context.observation?.subject ?? '',
        ngayDen: context.management?.overrides?.receivedDate ?? context.observation?.receivedDate ?? '',
        doKhan: context.management?.overrides?.priority ?? context.observation?.priority ?? '',
        deadline,
        point: Number.isFinite(point) ? point : 0,
        reworkCount,
        creditedPoint: completed
          ? calculateCreditedPoint(Number.isFinite(point) ? point : 0, reworkCount, lateWorkingDays)
          : 0,
        lateWorkingDays,
        submittedAt: completedAt,
        completedAt,
        completed,
        status,
        processing: context.statusSync?.processing ?? null,
        trackLogs: context.statusSync?.trackLogs ?? [],
        owner: owner
          ? {
              id: idOf(owner._id),
              username: owner.username,
              fullName: owner.fullName,
              position: owner.position ?? null,
              department: owner.department ? { id: idOf(owner.department), name: owner.department.name, code: owner.department.code } : null,
            }
          : {
              id: ownerId || null,
              username: null,
              fullName: assignment.fullName || 'Chưa map được người xử lý',
              position: null,
              department: assignment.departmentId
                ? { id: idOf(assignment.departmentId), name: assignment.departmentName ?? '', code: '' }
                : null,
            },
      };
    })
    .filter(Boolean) as any[];

  const externalWork = workDeclarations
    .map((work: any) => {
      const deadline = work.workEndAt ? new Date(work.workEndAt) : null;
      const completed = work.status === 'COMPLETED';
      const completedAt = completed && work.completion?.confirmedAt
        ? new Date(work.completion.confirmedAt)
        : null;
      const appearsInPeriod = options.deadlineRange
        ? Boolean(deadline && deadline >= options.deadlineRange.start && deadline <= options.deadlineRange.end)
        : completed
          ? Boolean(completedAt && vietnamPeriodKey(completedAt) === period)
          : Boolean(deadline && vietnamPeriodKey(deadline) === period);
      if (!appearsInPeriod) return null;
      const ownerId = idOf(work.createdBy);
      const owner = users.find((user: any) => idOf(user._id) === ownerId);
      if (!owner) return null;
      const point = Number(work.pointAdjustment?.status === 'APPROVED'
        ? work.pointAdjustment.approvedPoint
        : work.declaredPoint ?? 0);
      const reworkCount = work.workSource === 'KPI_IMPORT'
        ? Math.max(0, Number(work.kpiImport?.reworkCount ?? 0))
        : (work.approval?.history ?? []).filter((item: any) => item.action === 'RETURNED').length;
      const submittedAt = work.completion?.submittedAt ? new Date(work.completion.submittedAt) : null;
      const lateWorkingDays = completed && deadline && submittedAt
        ? workingDaysLate(deadline, submittedAt)
        : 0;
      return {
        id: idOf(work._id), source: 'WORK_DECLARATION', documentId: idOf(work._id), soDen: '',
        soKyHieu: 'Công việc ngoài hệ thống', trichYeu: work.title ?? '', ngayDen: '', doKhan: '',
        product: 'Công việc ngoài hệ thống', deadline,
        point: Number.isFinite(point) ? point : 0, reworkCount,
        creditedPoint: completed
          ? calculateCreditedPoint(Number.isFinite(point) ? point : 0, reworkCount, lateWorkingDays)
          : 0,
        lateWorkingDays, submittedAt, completedAt, completed,
        status: documentStatus(completed, deadline), processing: null, trackLogs: [],
        owner: {
          id: ownerId, username: owner.username, fullName: owner.fullName,
          position: owner.position ?? null,
          department: owner.department ? { id: idOf(owner.department), name: owner.department.name, code: owner.department.code } : null,
        },
      };
    })
    .filter(Boolean) as any[];
  const linkedProductIds = new Set(
    linkedProductRows.map((link: any) => idOf(link.outgoingDocument)),
  );
  const standaloneProducts = productContexts
    .map((product: any) => {
      if (linkedProductIds.has(idOf(product))) return null;
      const observation = {
        ...(product.observation ?? {}),
        ...(product.management?.overrides ?? {}),
      };
      const completedAt =
        parseVietnamDate(observation.createdDate)
        ?? parseVietnamDate(product.observedAt);
      const appearsInPeriod = options.deadlineRange
        ? Boolean(
          completedAt
          && completedAt >= options.deadlineRange.start
          && completedAt <= options.deadlineRange.end,
        )
        : Boolean(completedAt && vietnamPeriodKey(completedAt) === period);
      if (!appearsInPeriod) return null;
      const ownerId = idOf(product.management?.assignment?.userId);
      const owner = users.find((user: any) => idOf(user._id) === ownerId);
      if (!owner) return null;
      const point = effectiveOfficeDocumentPoint(product);
      const reworkCount = effectiveOfficeDocumentReworkCount(product);
      return {
        id: idOf(product._id),
        source: 'OFFICE_PRODUCT',
        documentId: product.externalDocumentId,
        soDen: '',
        soKyHieu: observation.soKyHieu ?? '',
        trichYeu: observation.subject ?? '',
        ngayDen: observation.createdDate ?? '',
        doKhan: observation.priority ?? '',
        product: product.pageType === 'outgoing_c2'
          ? 'Sản phẩm C2'
          : 'Sản phẩm',
        deadline: completedAt,
        point,
        reworkCount,
        creditedPoint: calculateCreditedPoint(point, reworkCount, 0),
        lateWorkingDays: 0,
        submittedAt: completedAt,
        completedAt,
        completed: true,
        status: 'COMPLETED',
        processing: null,
        trackLogs: [],
        owner: {
          id: ownerId,
          username: owner.username,
          fullName: owner.fullName,
          position: owner.position ?? null,
          department: owner.department
            ? {
                id: idOf(owner.department),
                name: owner.department.name,
                code: owner.department.code,
              }
            : null,
        },
      };
    })
    .filter(Boolean) as any[];
  const documents = [
    ...incomingDocuments,
    ...externalWork,
    ...standaloneProducts,
  ];

  const perUser = new Map(users.map((user: any) => [idOf(user._id), {
    user,
    totalPoint: 0,
    monthlyKpi: 0,
    pendingPoint: 0,
    documentCount: 0,
    completedDocumentCount: 0,
    inProgressDocumentCount: 0,
    overdueDocumentCount: 0,
    lateWorkingDays: 0,
  }]));
  const summary = {
    totalDocuments: documents.length,
    completedDocuments: 0,
    inProgressDocuments: 0,
    overdueDocuments: 0,
    totalPoint: 0,
    pendingPoint: 0,
    lateWorkingDays: 0,
    unmappedDocuments: 0,
  };

  for (const document of documents) {
    if (document.completed) summary.completedDocuments += 1;
    else summary.inProgressDocuments += 1;
    if (document.status === 'OVERDUE') summary.overdueDocuments += 1;
    if (document.completed) {
      summary.totalPoint += Number(document.creditedPoint ?? 0);
      summary.lateWorkingDays += Number(document.lateWorkingDays ?? 0);
    } else {
      summary.pendingPoint += Number(document.point ?? 0);
    }

    const row = document.owner.id ? perUser.get(document.owner.id) : null;
    if (!row) {
      summary.unmappedDocuments += 1;
      continue;
    }
    row.documentCount += 1;
    if (document.completed) {
      row.completedDocumentCount += 1;
      row.totalPoint += Number(document.creditedPoint ?? 0);
      row.monthlyKpi += Number(document.creditedPoint ?? 0);
      row.lateWorkingDays += Number(document.lateWorkingDays ?? 0);
    } else {
      row.inProgressDocumentCount += 1;
      if (document.status === 'OVERDUE') row.overdueDocumentCount += 1;
      row.pendingPoint += Number(document.point ?? 0);
    }
  }

  const assignees = [...perUser.values()]
    .map((row: any) => ({
      user: {
        id: idOf(row.user._id),
        username: row.user.username,
        fullName: row.user.fullName,
        position: row.user.position ?? null,
        email: row.user.email,
        department: row.user.department ? { id: idOf(row.user.department), name: row.user.department.name, code: row.user.department.code } : null,
        role: row.user.role ? { code: row.user.role.code, name: row.user.role.name, level: row.user.role.level } : null,
      },
      totalPoint: row.totalPoint,
      monthlyKpi: row.monthlyKpi,
      pendingPoint: row.pendingPoint,
      projectedPoint: row.totalPoint + row.pendingPoint,
      documentCount: row.documentCount,
      completedDocumentCount: row.completedDocumentCount,
      inProgressDocumentCount: row.inProgressDocumentCount,
      overdueDocumentCount: row.overdueDocumentCount,
      lateWorkingDays: row.lateWorkingDays,
    }))
    .sort((left, right) => {
      const priority = (row: any) => row.user.role?.code === 'SPECIALIST' && row.documentCount > 0 ? 0 : row.documentCount > 0 ? 1 : 2;
      return priority(left) - priority(right)
        || right.projectedPoint - left.projectedPoint
        || right.inProgressDocumentCount - left.inProgressDocumentCount
        || left.user.fullName.localeCompare(right.user.fullName, 'vi');
    });

  documents.sort((left, right) => {
    const statusRank = { OVERDUE: 0, IN_PROGRESS: 1, COMPLETED: 2 } as Record<string, number>;
    return statusRank[left.status] - statusRank[right.status]
      || (right.deadline?.getTime?.() ?? 0) - (left.deadline?.getTime?.() ?? 0);
  });

  return {
    data: {
      period,
      scope: { role: actor.role.code, userId: actor.id, organizationId: actor.organization, departmentId: actor.department },
      summary: { ...summary, projectedPoint: summary.totalPoint + summary.pendingPoint },
      assignees,
      documents: documents.slice(0, options.documentLimit ?? 250),
    },
  };
};
