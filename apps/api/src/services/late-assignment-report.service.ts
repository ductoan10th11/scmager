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
  receivedAt: string | null;
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

export const fetchLateAssignmentRows = async (
  actor: AuthUser,
  query: Record<string, unknown>,
): Promise<LateAssignmentRow[]> => {
  if (actor.role.code === "SPECIALIST") {
    throw forbidden("Chuyên viên không có quyền truy cập báo cáo này.");
  }

  const departmentId = resolveScopedDepartmentId(actor, query);
  const search = String(query.search ?? "").trim().toLowerCase();
  const slaHours = Math.max(0, Number(query.slaHours ?? 24));
  const filterType = String(query.filterType ?? "ALL_LATE"); // "ALL_LATE", "SLA_24", "SLA_48", "OVERDUE", "ALL_PENDING"

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
    if (participant.roleCode) return participant.roleCode;
    if (participant.userId && userMap.has(String(participant.userId))) {
      return (userMap.get(String(participant.userId)).role as any)?.code ?? null;
    }
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
    .sort({ updatedAt: -1 })
    .lean();

  const now = new Date();
  const rows: LateAssignmentRow[] = [];

  for (const context of contexts) {
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

    // 3. Nếu vẫn đang dừng ở Chánh văn phòng (chưa chuyển về phòng ban, chưa giao chuyên viên)
    if (currentAssigneeRole === "OFFICE_CHIEF" && !assignment.departmentId) {
      continue; // Đang ở Chánh VP, không tính chậm cho Trưởng phòng
    }

    // 4. Xác định phòng ban và Trưởng phòng đang giữ văn bản
    let targetDeptId = String(assignment.departmentId || currentAssignee?.departmentId || "");
    if (!targetDeptId && currentAssignee?.userId) {
      const leader = userMap.get(String(currentAssignee.userId));
      if (leader?.department) targetDeptId = String(leader.department);
    }
    if (!targetDeptId && assignment.userId) {
      const u = userMap.get(String(assignment.userId));
      if (u?.department) targetDeptId = String(u.department);
    }

    const isAtDepartmentLeader =
      currentAssigneeRole === "DEPARTMENT_LEADER" ||
      Boolean(targetDeptId);

    if (!isAtDepartmentLeader) continue;

    if (departmentId && targetDeptId !== departmentId) continue;

    // 5. Calculate timing and overdue
    const deptInfo = targetDeptId ? deptMap.get(targetDeptId) : null;
    const departmentName = assignment.departmentName || deptInfo?.name || "Phòng ban";
    const leaderInfo = targetDeptId ? leaderByDeptId.get(targetDeptId) : null;

    const isClerk = (actor: any) => {
      const u = String(actor?.username || actor?.externalUsername || "").toLowerCase();
      const n = String(actor?.fullName || actor?.externalFullName || "").toLowerCase();
      return u.includes("vanthu") || n.includes("văn thư");
    };

    const hasRealAssigneeName = Boolean(currentAssignee?.fullName || currentAssignee?.externalFullName) && !isClerk(currentAssignee);
    const leaderName = hasRealAssigneeName
      ? (currentAssignee.fullName || currentAssignee.externalFullName)
      : (leaderInfo?.fullName || `Trưởng phòng (${departmentName})`);
    const leaderUserId = currentAssignee?.userId
      ? String(currentAssignee.userId)
      : (leaderInfo?.id || "");

    const assignedTime = parseOfficeDate(currentAssignee?.assignedAt)
      || (context.management?.updatedAt ? new Date(context.management.updatedAt) : null)
      || (context.observedAt ? new Date(context.observedAt) : null)
      || parseOfficeDate(overrides.receivedDate ?? observation.receivedDate)
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
      receivedAt: assignedTime ? assignedTime.toISOString() : null,
      holdingHours,
      holdingDays,
      dueAt: dueAt ? dueAt.toISOString() : null,
      deadlineStatus,
      isOverdue,
      priority: String(overrides.priority ?? observation.priority ?? "Bình thường"),
      documentForm: String(overrides.documentForm ?? observation.documentForm ?? "Công văn"),
    });
  }

  // Sort by holdingHours descending (most delayed first)
  rows.sort((a, b) => b.holdingHours - a.holdingHours || (b.isOverdue ? 1 : 0) - (a.isOverdue ? 1 : 0));
  return rows;
};

export const lateAssignmentReportService = async (
  actor: AuthUser,
  query: Record<string, unknown>,
) => {
  const items = await fetchLateAssignmentRows(actor, query);

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
