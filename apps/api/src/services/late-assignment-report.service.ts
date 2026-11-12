import type { AuthUser } from "../types/auth";
import { badRequest, forbidden } from "../utils/http-error";
import OfficeDocumentContextModel from "../models/office-document-context.model";
import DepartmentModel from "../models/department.model";
import UserModel from "../models/user.model";
import RoleModel from "../models/role.model";
import { effectiveOfficeDocumentCompletion } from "./office-document-completion.service";
import { parseOfficeDate } from "./office-document-projection.service";
import { isOfficeDocumentNotRequired } from "./office-document-not-required-state.service";

export type LateAssignmentRow = {
  id: string;
  externalDocumentId: string;
  soKyHieu: string;
  subject: string;
  departmentId: string;
  departmentName: string;
  leaderUserId: string;
  leaderName: string;
  // When the document reached the department leader now holding it.
  receivedAt: string | null;
  // When eOffice routing was last read for it; the row is only as fresh as this.
  syncedAt: string | null;
  holdingHours: number;
  holdingDays: number;
  dueAt: string | null;
  deadlineStatus: string;
  isOverdue: boolean;
  priority: string;
  documentForm: string;
};

const resolveScopedDepartmentId = (actor: AuthUser, query: Record<string, unknown>) => {
  const raw = query.departmentId !== undefined && query.departmentId !== null ? String(query.departmentId).trim() : "";
  const requested = raw === "__all__" ? "" : raw;
  if (actor.role.code === "DEPARTMENT_LEADER") {
    if (!actor.department) throw forbidden("Trưởng phòng chưa được phân công phòng ban.");
    if (requested && requested !== actor.department) throw forbidden("Không có quyền truy cập phòng ban khác.");
    return actor.department;
  }
  return requested;
};

const isClerk = (participant: any) => {
  const username = String(participant?.username || participant?.externalUsername || "").toLowerCase();
  const name = String(participant?.fullName || participant?.externalFullName || "").toLowerCase();
  return username.includes("vanthu") || name.includes("văn thư");
};

/**
 * A leader who acted after the document reached them (in practice: created the
 * response themselves) is working it, not sitting on it. Track logs sharing a
 * minute are ordered by id, as the workflow resolver orders them.
 */
const hasActedSinceReceived = (participant: any) => {
  const processed = parseOfficeDate(participant?.processedAt);
  if (!processed) return false;
  const assigned = parseOfficeDate(participant?.assignedAt);
  if (!assigned) return true;
  if (processed.getTime() !== assigned.getTime()) return processed.getTime() > assigned.getTime();
  return Number(participant?.processedTrackLogId) > Number(participant?.assignedTrackLogId);
};

const sortByArrival = (rows: LateAssignmentRow[], order: "asc" | "desc") => {
  const time = (row: LateAssignmentRow) => (row.receivedAt ? new Date(row.receivedAt).getTime() : 0);
  return rows.sort((a, b) => (order === "asc" ? time(a) - time(b) : time(b) - time(a)));
};

type LateAssignmentCollection = {
  rows: LateAssignmentRow[];
  // Pending documents whose eOffice routing was never read: nobody can say who holds them.
  unsyncedCount: number;
  lastSyncedAt: string | null;
};

export const fetchLateAssignmentRows = async (
  actor: AuthUser,
  query: Record<string, unknown>,
): Promise<LateAssignmentRow[]> => (await collectLateAssignments(actor, query)).rows;

const collectLateAssignments = async (
  actor: AuthUser,
  query: Record<string, unknown>,
): Promise<LateAssignmentCollection> => {
  if (actor.role.code === "SPECIALIST") {
    throw forbidden("Chuyên viên không có quyền truy cập báo cáo này.");
  }

  const departmentId = resolveScopedDepartmentId(actor, query);
  const search = String(query.search ?? "").trim().toLowerCase();
  const slaHours = Math.max(0, Number(query.slaHours ?? 24));
  const filterType = String(query.filterType ?? "ALL_LATE"); // "ALL_LATE", "SLA_24", "SLA_48", "OVERDUE", "ALL_PENDING"
  const sortOrder = String(query.sortOrder ?? "").toLowerCase() === "asc" ? "asc" : "desc";

  // Base Mongo query for incoming documents
  const filter: Record<string, unknown> = {
    pageType: "incoming",
  };
  if (actor.organization) {
    filter.organizationId = actor.organization;
  } else if (actor.role.code !== "ADMIN") {
    filter._id = null;
  }

  // Fetch departments map to resolve names and leaders
  const deptQuery: Record<string, unknown> = { isActive: true };
  if (actor.organization && actor.role.code !== "ADMIN") {
    deptQuery.organization = actor.organization;
  }
  const departments = await DepartmentModel.find(deptQuery)
    .populate("leader", "_id fullName username")
    .lean();
  const deptMap = new Map(departments.map((d: any) => [String(d._id), d]));

  // Department leaders by department ID
  const leaderByDeptId = new Map<string, { id: string; fullName: string }>();
  for (const dept of departments) {
    if (dept.leader) {
      leaderByDeptId.set(String(dept._id), {
        id: String((dept.leader as any)._id),
        fullName: (dept.leader as any).fullName || (dept.leader as any).username || "",
      });
    }
  }

  // Query all active users with roles to check specialist vs department leader assignments
  const userQuery: Record<string, unknown> = {
    status: "ACTIVE",
    ...(actor.organization && actor.role.code !== "ADMIN" ? { organization: actor.organization } : {}),
  };
  const activeUsers = await UserModel.find(userQuery)
    .populate("role", "code")
    .lean();
  const userMap = new Map<string, any>(activeUsers.map((u: any) => [String(u._id), u]));
  const userByUsername = new Map<string, any>(activeUsers.map((u: any) => [String(u.username || "").toLowerCase(), u]));
  const userByNormalizedName = new Map<string, any>(
    activeUsers.map((u: any) => [
      String(u.fullName || "")
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .replace(/\.lsn$/iu, "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase(),
      u,
    ]),
  );

  const resolveRole = (participant: any): string | null => {
    if (!participant) return null;
    // The live role first: the snapshot is from the last sync and roles change.
    if (participant.userId && userMap.has(String(participant.userId))) {
      return (userMap.get(String(participant.userId)).role as any)?.code ?? null;
    }
    if (participant.roleCode) return participant.roleCode;
    const username = String(participant.username || participant.externalUsername || "")
      .toLowerCase()
      .replace(/\.lsn$/, "");
    if (username && userByUsername.has(username)) {
      return (userByUsername.get(username).role as any)?.code ?? null;
    }
    const name = String(participant.fullName || participant.externalFullName || "")
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .replace(/\.lsn$/iu, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    if (name && userByNormalizedName.has(name)) {
      return (userByNormalizedName.get(name).role as any)?.code ?? null;
    }
    return null;
  };

  for (const u of activeUsers) {
    if ((u.role as any)?.code === "DEPARTMENT_LEADER" && u.department) {
      const dId = String(u.department);
      if (!leaderByDeptId.has(dId)) {
        leaderByDeptId.set(dId, {
          id: String(u._id),
          fullName: u.fullName || u.username || "",
        });
      }
    }
  }

  const contexts = await OfficeDocumentContextModel.find(filter)
    .select("-observation.recipients")
    .sort({ updatedAt: -1 })
    .lean();

  const now = new Date();
  const rows: LateAssignmentRow[] = [];
  let unsyncedCount = 0;
  let lastSyncedAt: Date | null = null;

  for (const context of contexts) {
    const syncedAt = context.statusSync?.lastSyncedAt ? new Date(context.statusSync.lastSyncedAt) : null;
    if (syncedAt && (!lastSyncedAt || syncedAt > lastSyncedAt)) lastSyncedAt = syncedAt;

    // 1. Must not be completed
    const completion = effectiveOfficeDocumentCompletion(context);
    if (completion.completed) continue;
    // A task confirmed as not required is nobody's late assignment.
    if (isOfficeDocumentNotRequired(context)) continue;

    const assignment = context.management?.assignment ?? {};
    const sync = context.statusSync ?? {};
    const processing = sync.processing ?? {};
    const currentAssignee = processing.currentAssignee ?? null;
    const primaryAssignee = processing.primaryAssignee ?? null;
    const assignees = Array.isArray(processing.assignees) ? processing.assignees : [];
    const observation = context.observation ?? {};
    const overrides = context.management?.overrides ?? {};

    // 2. Check if already reached a specialist:
    // (Bao gồm cả trường hợp Trưởng phòng phân công cho Chuyên viên,
    // HOẶC Chánh văn phòng bypass quy trình chuyển thẳng tới Chuyên viên).
    // Nếu văn bản đã đến tay chuyên viên thì coi như là ok rồi -> KHÔNG tính chậm giao tại Trưởng phòng!
    const currentAssigneeRole = resolveRole(currentAssignee);
    const primaryAssigneeRole = resolveRole(primaryAssignee);
    const assignedUserRole = assignment.userId ? (userMap.get(String(assignment.userId))?.role as any)?.code : null;
    const hasSpecialistInAssignees = assignees.some((p: any) => resolveRole(p) === "SPECIALIST");

    const hasReachedSpecialist =
      currentAssigneeRole === "SPECIALIST" ||
      primaryAssigneeRole === "SPECIALIST" ||
      assignedUserRole === "SPECIALIST" ||
      hasSpecialistInAssignees;

    if (hasReachedSpecialist) {
      // Đã đến tay chuyên viên -> Coi như ok, không phải văn bản Trưởng phòng chậm giao
      continue;
    }

    // 3. Chỉ tính khi luồng eOffice cho thấy văn bản ĐANG nằm ở một Trưởng phòng.
    // Không có luồng (chưa đồng bộ được) thì không biết ai đang giữ: assignment chỉ là
    // phòng/người nhận dự kiến, nên không được suy ra "Trưởng phòng chậm giao" từ đó.
    const hasWorkflow = Array.isArray(sync.trackLogs) && sync.trackLogs.length > 0;
    if (!hasWorkflow) {
      const expectedDeptId = String(assignment.departmentId || "");
      if (!departmentId || expectedDeptId === departmentId) unsyncedCount += 1;
      continue;
    }
    // Đang ở Lãnh đạo UBND, Chánh VP, Văn thư, đơn vị ngoài..., hoặc Trưởng phòng đã
    // chuyển tiếp/trả lại (không còn người giữ hiện tại) -> không phải Trưởng phòng chậm giao.
    if (!currentAssignee || currentAssigneeRole !== "DEPARTMENT_LEADER" || isClerk(currentAssignee)) continue;
    // Trưởng phòng đã tự xử lý (tạo phúc đáp) sau khi nhận.
    if (hasActedSinceReceived(currentAssignee)) continue;

    // 4. Phòng ban là phòng của Trưởng phòng đang giữ, không phải phòng được gán dự kiến.
    const holder = currentAssignee.userId ? userMap.get(String(currentAssignee.userId)) : null;
    const targetDeptId = String(holder?.department || currentAssignee.departmentId || assignment.departmentId || "");

    if (departmentId && targetDeptId !== departmentId) continue;

    // 5. Calculate timing and overdue
    const deptInfo = targetDeptId ? deptMap.get(targetDeptId) : null;
    const assignmentDepartmentName = String(assignment.departmentId || "") === targetDeptId ? assignment.departmentName : "";
    const departmentName = deptInfo?.name || assignmentDepartmentName || "Phòng ban";
    const leaderInfo = targetDeptId ? leaderByDeptId.get(targetDeptId) : null;

    const leaderName = currentAssignee.fullName || currentAssignee.externalFullName
      || leaderInfo?.fullName || `Trưởng phòng (${departmentName})`;
    const leaderUserId = currentAssignee.userId ? String(currentAssignee.userId) : (leaderInfo?.id || "");

    // Thời gian đến = lúc văn bản được chuyển tới Trưởng phòng đang giữ.
    const assignedTime = parseOfficeDate(currentAssignee.assignedAt)
      || parseOfficeDate(overrides.receivedDate ?? observation.receivedDate)
      || (context.observedAt ? new Date(context.observedAt) : null)
      || now;

    const diffMs = Math.max(0, now.getTime() - assignedTime.getTime());
    const holdingHours = Math.floor(diffMs / 3600000);
    const holdingDays = Math.floor(diffMs / 86400000);

    const dueAt = parseOfficeDate(overrides.dueDate ?? observation.dueDate, true);
    const isOverdue = dueAt ? dueAt.getTime() <= now.getTime() : false;
    const isDueSoon = dueAt ? (!isOverdue && dueAt.getTime() - now.getTime() <= 24 * 3600000) : false;

    // Filter according to SLA threshold / filterType
    let isLate = holdingHours >= slaHours || isOverdue;
    if (filterType === "SLA_24" && holdingHours < 24) continue;
    if (filterType === "SLA_48" && holdingHours < 48) continue;
    if (filterType === "OVERDUE" && !isOverdue) continue;
    if (filterType === "ALL_LATE" && !isLate) continue;
    // "ALL_PENDING" keeps all without specialist

    const soKyHieu = String(overrides.soKyHieu ?? observation.soKyHieu ?? "");
    const subject = String(overrides.subject ?? observation.subject ?? "");

    // Search filter
    if (search) {
      const match = soKyHieu.toLowerCase().includes(search)
        || subject.toLowerCase().includes(search)
        || departmentName.toLowerCase().includes(search)
        || leaderName.toLowerCase().includes(search);
      if (!match) continue;
    }

    const deadlineStatus = !dueAt
      ? "NO_DEADLINE"
      : isOverdue
        ? "PENDING_OVERDUE"
        : isDueSoon
          ? "DUE_SOON"
          : "PENDING_IN_TIME";

    rows.push({
      id: String(context._id),
      externalDocumentId: context.externalDocumentId,
      soKyHieu,
      subject,
      departmentId: targetDeptId,
      departmentName,
      leaderUserId,
      leaderName,
      receivedAt: assignedTime.toISOString(),
      syncedAt: syncedAt ? syncedAt.toISOString() : null,
      holdingHours,
      holdingDays,
      dueAt: dueAt ? dueAt.toISOString() : null,
      deadlineStatus,
      isOverdue,
      priority: String(overrides.priority ?? observation.priority ?? "Bình thường"),
      documentForm: String(overrides.documentForm ?? observation.documentForm ?? "Công văn"),
    });
  }

  // Theo thời gian đến; mặc định văn bản mới đến lên trước (sortOrder=asc để đảo lại).
  sortByArrival(rows, sortOrder);
  return {
    rows,
    unsyncedCount,
    lastSyncedAt: lastSyncedAt ? lastSyncedAt.toISOString() : null,
  };
};

export const lateAssignmentReportService = async (
  actor: AuthUser,
  query: Record<string, unknown>,
) => {
  const { rows: items, unsyncedCount, lastSyncedAt } = await collectLateAssignments(actor, query);

  // Group by Department
  const deptSummaryMap = new Map<string, {
    departmentId: string;
    departmentName: string;
    leaderName: string;
    total: number;
    overdueCount: number;
    totalHoldingHours: number;
  }>();

  // Group by Leader
  const leaderSummaryMap = new Map<string, {
    leaderUserId: string;
    leaderName: string;
    departmentName: string;
    total: number;
    overdueCount: number;
    totalHoldingHours: number;
  }>();

  let totalHoldingHours = 0;
  let totalOverdue = 0;

  for (const item of items) {
    totalHoldingHours += item.holdingHours;
    if (item.isOverdue) totalOverdue += 1;

    // Dept map
    const deptKey = item.departmentId || "unknown";
    if (!deptSummaryMap.has(deptKey)) {
      deptSummaryMap.set(deptKey, {
        departmentId: item.departmentId,
        departmentName: item.departmentName,
        leaderName: item.leaderName,
        total: 0,
        overdueCount: 0,
        totalHoldingHours: 0,
      });
    }
    const dSummary = deptSummaryMap.get(deptKey)!;
    dSummary.total += 1;
    if (item.isOverdue) dSummary.overdueCount += 1;
    dSummary.totalHoldingHours += item.holdingHours;

    // Leader map
    const leaderKey = item.leaderName || "unknown";
    if (!leaderSummaryMap.has(leaderKey)) {
      leaderSummaryMap.set(leaderKey, {
        leaderUserId: item.leaderUserId,
        leaderName: item.leaderName,
        departmentName: item.departmentName,
        total: 0,
        overdueCount: 0,
        totalHoldingHours: 0,
      });
    }
    const lSummary = leaderSummaryMap.get(leaderKey)!;
    lSummary.total += 1;
    if (item.isOverdue) lSummary.overdueCount += 1;
    lSummary.totalHoldingHours += item.holdingHours;
  }

  const departmentSummary = Array.from(deptSummaryMap.values())
    .map((d) => ({
      departmentId: d.departmentId,
      departmentName: d.departmentName,
      leaderName: d.leaderName,
      total: d.total,
      overdueCount: d.overdueCount,
      avgHoldingHours: d.total > 0 ? Math.round(d.totalHoldingHours / d.total) : 0,
    }))
    .sort((a, b) => b.total - a.total);

  const leaderSummary = Array.from(leaderSummaryMap.values())
    .map((l) => ({
      leaderUserId: l.leaderUserId,
      leaderName: l.leaderName,
      departmentName: l.departmentName,
      total: l.total,
      overdueCount: l.overdueCount,
      avgHoldingHours: l.total > 0 ? Math.round(l.totalHoldingHours / l.total) : 0,
    }))
    .sort((a, b) => b.total - a.total);

  const avgHoldingHours = items.length > 0 ? Math.round(totalHoldingHours / items.length) : 0;

  return {
    data: {
      items,
      summary: {
        totalLate: items.length,
        overdueCount: totalOverdue,
        avgHoldingHours,
        affectedDepartmentsCount: departmentSummary.length,
        // Không tính vào báo cáo vì chưa đọc được luồng eOffice của chúng.
        unsyncedCount,
        lastSyncedAt,
      },
      departmentSummary,
      leaderSummary,
    },
    meta: {
      total: items.length,
      generatedAt: new Date().toISOString(),
    },
  };
};
