import type { AuthUser } from "../types/auth";
import { badRequest, forbidden } from "../utils/http-error";
import { listOfficeDocumentContexts } from "./office-document-context.service";

const REPORT_FETCH_LIMIT = 5000;
const DEFAULT_DEADLINE_STATUS = "PENDING_OVERDUE,DONE_LATE";

export type OverdueOfficeDocumentRow = {
  id: string;
  soKyHieu: string;
  subject: string;
  departmentId: string;
  departmentName: string;
  assigneeUserId: string;
  assigneeName: string;
  dueAt: string | null;
  deadlineStatus: string;
  statusLabel: string;
  overdueDays: number;
  daysRemaining: number;
};

const resolveScopedDepartmentId = (actor: AuthUser, query: Record<string, unknown>) => {
  const requested = query.departmentId !== undefined && query.departmentId !== null && query.departmentId !== ""
    ? String(query.departmentId)
    : "";
  if (actor.role.code === "DEPARTMENT_LEADER") {
    if (!actor.department) throw forbidden("Department leader has no department assigned.");
    if (requested && requested !== actor.department) throw forbidden("Access denied.");
    return actor.department;
  }
  return requested;
};

export const fetchOverdueOfficeDocumentRows = async (
  actor: AuthUser,
  query: Record<string, unknown>,
): Promise<OverdueOfficeDocumentRow[]> => {
  if (actor.role.code === "SPECIALIST") throw forbidden("Specialists cannot access this report.");

  const departmentId = resolveScopedDepartmentId(actor, query);
  const userId = query.userId !== undefined && query.userId !== null && query.userId !== "" ? String(query.userId) : "";
  const dateFrom = query.dateFrom !== undefined && query.dateFrom !== null ? String(query.dateFrom) : "";
  const dateTo = query.dateTo !== undefined && query.dateTo !== null ? String(query.dateTo) : "";
  const dateField = query.dateField !== undefined && query.dateField !== null && query.dateField !== "" ? String(query.dateField) : "due";
  const deadlineStatus = query.deadlineStatus !== undefined && query.deadlineStatus !== null && query.deadlineStatus !== ""
    ? String(query.deadlineStatus)
    : DEFAULT_DEADLINE_STATUS;
  const pageTypeRaw = query.pageType !== undefined && query.pageType !== null && query.pageType !== "" ? String(query.pageType) : "incoming";
  if (!["incoming", "outgoing", "outgoing_c2", "outgoing,outgoing_c2"].includes(pageTypeRaw)) {
    throw badRequest("pageType must be incoming, outgoing, or outgoing_c2.");
  }

  const forwardedQuery: Record<string, unknown> = {
    page: 1,
    limit: REPORT_FETCH_LIMIT,
    pageType: pageTypeRaw,
    deadlineStatus,
    dateField,
  };
  if (departmentId) forwardedQuery.departmentId = departmentId;
  if (userId) forwardedQuery.userId = userId;
  if (dateFrom) forwardedQuery.dateFrom = dateFrom;
  if (dateTo) forwardedQuery.dateTo = dateTo;

  const result = await listOfficeDocumentContexts(actor, forwardedQuery);
  const now = new Date();
  return (result.data ?? []).map((item: any) => {
    const observed = (field: string) => item.management?.overrides?.[field] ?? item.observation?.[field] ?? "";
    const tracking = item.tracking ?? {};
    const dueAt = tracking.dueAt ? new Date(tracking.dueAt) : null;
    const compareAt = tracking.completedAt ? new Date(tracking.completedAt) : now;
    const overdueDays = dueAt ? Math.max(0, Math.ceil((compareAt.getTime() - dueAt.getTime()) / 86_400_000)) : 0;
    // Days still left before the deadline; 0 for anything already due or done.
    const daysRemaining = dueAt && tracking.deadlineStatus === "PENDING_IN_TIME"
      ? Math.max(0, Math.ceil((dueAt.getTime() - now.getTime()) / 86_400_000))
      : 0;
    return {
      id: String(item._id),
      soKyHieu: String(observed("soKyHieu") ?? ""),
      subject: String(observed("subject") ?? ""),
      departmentId: tracking.assignee?.departmentId ?? "",
      departmentName: tracking.assignee?.departmentName || "Chưa phân phòng ban",
      assigneeUserId: tracking.assignee?.userId ?? "",
      assigneeName: tracking.assignee?.fullName || "Chưa xác định",
      dueAt: dueAt ? dueAt.toISOString() : null,
      deadlineStatus: tracking.deadlineStatus,
      statusLabel: tracking.statusLabel,
      overdueDays,
      daysRemaining,
    };
  });
};

type SummaryRow = { total: number; pendingOverdue: number; doneLate: number; dueSoon: number };

const bumpSummary = (row: SummaryRow, deadlineStatus: string) => {
  row.total += 1;
  if (deadlineStatus === "PENDING_OVERDUE") row.pendingOverdue += 1;
  if (deadlineStatus === "DONE_LATE") row.doneLate += 1;
  if (deadlineStatus === "PENDING_IN_TIME") row.dueSoon += 1;
};

export const overdueOfficeDocumentReportService = async (actor: AuthUser, query: Record<string, unknown>) => {
  const items = await fetchOverdueOfficeDocumentRows(actor, query);
  items.sort((left, right) => (
    right.overdueDays - left.overdueDays
    || (left.daysRemaining || Number.MAX_SAFE_INTEGER) - (right.daysRemaining || Number.MAX_SAFE_INTEGER)
  ));

  const departmentMap = new Map<string, { departmentId: string; departmentName: string } & SummaryRow>();
  const userMap = new Map<string, { userId: string; fullName: string; departmentName: string } & SummaryRow>();

  for (const item of items) {
    const departmentKey = item.departmentId || "unknown";
    if (!departmentMap.has(departmentKey)) {
      departmentMap.set(departmentKey, {
        departmentId: item.departmentId, departmentName: item.departmentName,
        total: 0, pendingOverdue: 0, doneLate: 0, dueSoon: 0,
      });
    }
    bumpSummary(departmentMap.get(departmentKey)!, item.deadlineStatus);

    const userKey = item.assigneeUserId || "unknown";
    if (!userMap.has(userKey)) {
      userMap.set(userKey, {
        userId: item.assigneeUserId, fullName: item.assigneeName, departmentName: item.departmentName,
        total: 0, pendingOverdue: 0, doneLate: 0, dueSoon: 0,
      });
    }
    bumpSummary(userMap.get(userKey)!, item.deadlineStatus);
  }

  return {
    data: {
      items,
      departmentSummary: Array.from(departmentMap.values()).sort((a, b) => b.total - a.total),
      userSummary: Array.from(userMap.values()).sort((a, b) => b.total - a.total),
    },
    meta: {
      total: items.length,
      generatedAt: new Date().toISOString(),
      truncated: items.length >= REPORT_FETCH_LIMIT,
    },
  };
};
