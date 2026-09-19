<script setup>
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ArrowUpRight,
  Building2,
  Calendar as CalendarIcon,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FilePenLine,
  FileText,
  History,
  Link2,
  Loader2,
  MessageSquareWarning,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Send,
  Trash2,
  Upload,
  Users,
  X,
  XCircle,
} from "lucide-vue-next";
import { useRoute, useRouter } from "vue-router";
import { CalendarDate } from "@internationalized/date";
import { Calendar } from "@/components/ui/calendar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import SlidingTabs from "@/components/ui/sliding-tabs/SlidingTabs.vue";
import Pl4ImportDialog from "@/features/performance/components/Pl4ImportDialog.vue";
import { http } from "@/shared/api/http";
import { useAuth } from "@/features/auth/composables/useAuth";

const activeTab = ref("incoming");
const router = useRouter();
const route = useRoute();
const loading = ref(false);
const detailLoading = ref(false);
const error = ref(null);
const items = ref([]);
const departments = ref([]);
const users = ref([]);
const selected = ref(null);
const formOpen = ref(false);
const bulkImportOpen = ref(false);
const deleteOpen = ref(false);
const formMode = ref("create");
const saving = ref(false);
const contextToDelete = ref(null);
const formError = ref("");
const relatedTask = ref(null);
const relatedTaskLoading = ref(false);
const relatedTaskError = ref("");
// Symbol the record already carried when the edit form opened; an unchanged
// one is never re-validated (see openEdit).
const initialRelatedSymbol = ref("");
// Record the edit form is working on — kept apart from `selected`, which drives
// the detail panel.
const editTarget = ref(null);
const approvalOpen = ref(false);
const approvalLoading = ref(false);
const approvalSaving = ref(false);
const approvalError = ref("");
const approvalItems = ref([]);
const approvalMeta = ref({ total: 0, approvers: [] });
const approvalTab = ref("pending");
const approvalSelectedId = ref("");
const approvalNote = ref("");
const approvalApproverId = ref("");
const pendingApprovalCount = ref(0);
const receivedDatePickerOpen = ref(false);
const dueDatePickerOpen = ref(false);
const createdDatePickerOpen = ref(false);
const search = ref("");
const filters = reactive({
  departmentId: "",
  userId: "",
  deadlineStatuses: [],
  scoreState: "",
  complaintState: "",
  dateField: "observed",
  dateFrom: "",
  dateTo: "",
});
const pagination = ref({ page: 1, limit: 25, total: 0, totalPages: 1 });

// Sắp xếp tương tác trên Header
const sortField = ref("");
const sortOrder = ref("asc");

const toggleSort = (field) => {
  if (sortField.value === field) {
    if (sortOrder.value === "asc") {
      sortOrder.value = "desc";
    } else {
      sortField.value = "";
      sortOrder.value = "asc";
    }
  } else {
    sortField.value = field;
    sortOrder.value = "asc";
  }
};

const sortedItems = computed(() => {
  if (!sortField.value) return items.value;
  const list = [...items.value];
  const orderMultiplier = sortOrder.value === "asc" ? 1 : -1;

  return list.sort((a, b) => {
    if (sortField.value === "dueDate") {
      const aDate = new Date(tracking(a).dueAt || getValue(a, "dueDate") || 0).getTime();
      const bDate = new Date(tracking(b).dueAt || getValue(b, "dueDate") || 0).getTime();
      return (aDate - bDate) * orderMultiplier;
    }
    if (sortField.value === "score") {
      const aScore = Number(tracking(a).rawScore ?? -1);
      const bScore = Number(tracking(b).rawScore ?? -1);
      return (aScore - bScore) * orderMultiplier;
    }
    if (sortField.value === "reworkCount") {
      const aRework = Number(getValue(a, "reworkCount") ?? 0);
      const bRework = Number(getValue(b, "reworkCount") ?? 0);
      return (aRework - bRework) * orderMultiplier;
    }
    if (sortField.value === "priority") {
      const aP = String(getValue(a, "priority") || "");
      const bP = String(getValue(b, "priority") || "");
      return aP.localeCompare(bP, "vi") * orderMultiplier;
    }
    if (sortField.value === "observedAt") {
      const aTime = new Date(a?.observedAt || a?.capturedAt || a?.updatedAt || 0).getTime();
      const bTime = new Date(b?.observedAt || b?.capturedAt || b?.updatedAt || 0).getTime();
      return (aTime - bTime) * orderMultiplier;
    }
    return 0;
  });
});

const hasActiveFilters = computed(() => {
  return Boolean(
    filters.departmentId ||
    filters.userId ||
    filters.deadlineStatuses.length > 0 ||
    filters.scoreState ||
    filters.complaintState ||
    filters.dateFrom ||
    filters.dateTo ||
    search.value.trim()
  );
});

const resetFilters = () => {
  filters.departmentId = "";
  filters.userId = "";
  filters.deadlineStatuses = [];
  filters.scoreState = "";
  filters.complaintState = "";
  filters.dateFrom = "";
  filters.dateTo = "";
  search.value = "";
};

const toggleDeadlineStatus = (statusId) => {
  const index = filters.deadlineStatuses.indexOf(statusId);
  if (index >= 0) {
    filters.deadlineStatuses.splice(index, 1);
  } else {
    filters.deadlineStatuses.push(statusId);
  }
};

const TABS = [
  { id: "incoming", label: "Nhiệm vụ", icon: FileText },
  { id: "outgoing", label: "Sản phẩm", icon: Send },
];
const MANUAL_TABS = [
  { id: "incoming", label: "Nhiệm vụ", icon: FileText },
  { id: "outgoing", label: "Sản phẩm", icon: Send },
  { id: "outgoing_c2", label: "Sản phẩm C2", icon: FilePenLine },
];
const APPROVAL_TABS = [
  { id: "pending", label: "Chờ duyệt" },
  { id: "history", label: "Lịch sử" },
];
let searchTimer = null;
let relatedTaskTimer = null;
let relatedTaskRequestSequence = 0;
let listRequestSequence = 0;
let activeForegroundRequests = 0;
let listDebounceTimer = null;
let detailRequestSequence = 0;
const { user, loadMe } = useAuth();
const canManage = computed(() =>
  ["ADMIN", "OFFICE_CHIEF", "COMMUNE_LEADER", "DEPARTMENT_LEADER"].includes(
    user.value?.role?.code,
  ),
);
const canImportKpi = computed(() =>
  ["ADMIN", "OFFICE_CHIEF", "COMMUNE_LEADER", "DEPARTMENT_LEADER", "SPECIALIST"].includes(
    user.value?.role?.code,
  ),
);
const canCreateProduct = computed(() =>
  ["ADMIN", "OFFICE_CHIEF", "COMMUNE_LEADER", "DEPARTMENT_LEADER", "SPECIALIST"].includes(
    user.value?.role?.code,
  ),
);
const canReviewResults = computed(() =>
  ["OFFICE_CHIEF", "COMMUNE_LEADER", "DEPARTMENT_LEADER"].includes(
    user.value?.role?.code,
  ),
);
const availableManualTabs = computed(() =>
  user.value?.role?.code === "SPECIALIST"
    ? MANUAL_TABS.filter((tab) => tab.id !== "incoming")
    : MANUAL_TABS,
);
const currentUserId = computed(() => String(user.value?._id || user.value?.id || ""));
const currentDepartmentId = computed(() =>
  String(user.value?.department?._id || user.value?.department || ""),
);
const currentDepartmentName = computed(() =>
  user.value?.department?.name
  || departments.value.find(
    (department) => String(department._id) === currentDepartmentId.value,
  )?.name
  || "",
);
const usersForFilter = computed(() =>
  users.value.filter(
    (person) =>
      !filters.departmentId ||
      String(person.department?._id || person.department || "") ===
        String(filters.departmentId),
  ),
);
const departmentFilterValue = computed({
  get: () => filters.departmentId || "__all_departments__",
  set: (value) => { filters.departmentId = value === "__all_departments__" ? "" : value; },
});
const userFilterValue = computed({
  get: () => filters.userId || "__all_users__",
  set: (value) => { filters.userId = value === "__all_users__" ? "" : value; },
});
const vietnamToday = () => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Ho_Chi_Minh",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).formatToParts(new Date())
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${parts.day}/${parts.month}/${parts.year}`;
};
const blankForm = () => ({
  pageType: activeTab.value === "incoming" ? "incoming" : "outgoing",
  subject: "",
  soKyHieu: "",
  receivedDate: "",
  dueDate: "",
  createdDate: activeTab.value === "incoming" ? "" : vietnamToday(),
  documentForm: "",
  priority: "Thường",
  draftingUnit: "",
  relatedIncomingSoKyHieu: "",
  note: "",
  departmentId: "",
  userId: "",
  manualScore: "",
  reworkCount: 0,
  completed: false,
  managementNote: "",
});
const form = ref(blankForm());
const generatedReference = ref("");
const referenceEdited = ref(false);
const productRequiresApproval = computed(() =>
  Boolean(form.value.relatedIncomingSoKyHieu.trim())
  && ["SPECIALIST", "DEPARTMENT_LEADER"].includes(user.value?.role?.code),
);
// True while the related-task symbol is still the one the record was opened
// with — a link that predates this edit and must not block saving.
const isUnchangedRelatedSymbol = computed(() => (
  Boolean(initialRelatedSymbol.value)
  && form.value.relatedIncomingSoKyHieu.trim() === initialRelatedSymbol.value
));
const formDepartmentValue = computed({
  get: () => form.value.departmentId || "__none_department__",
  set: (value) => {
    form.value.departmentId = value === "__none_department__" ? "" : value;
    if (form.value.userId && !users.value.some((person) => String(person._id) === String(form.value.userId) && (!form.value.departmentId || String(person.department?._id || person.department || "") === String(form.value.departmentId)))) form.value.userId = "";
  },
});
const formUserValue = computed({
  get: () => form.value.userId || "__none_user__",
  set: (value) => { form.value.userId = value === "__none_user__" ? "" : value; },
});
const formDraftingUnitValue = computed({
  get: () => departments.value.find((department) => department.name === form.value.draftingUnit)?._id || "__none_drafting_unit__",
  set: (value) => {
    const department = departments.value.find((item) => String(item._id) === String(value));
    form.value.draftingUnit = department?.name || "";
  },
});
const approvalSelected = computed(() =>
  approvalItems.value.find(
    (item) => String(item._id) === String(approvalSelectedId.value),
  ) || approvalItems.value[0] || null,
);
const resultLinks = computed(() =>
  Array.isArray(selected.value?.resultLinks) ? selected.value.resultLinks : [],
);
const productReconciliation = computed(() =>
  selected.value?.pageType === "incoming"
    ? null
    : selected.value?.management?.product || {},
);
const productStateLabel = (state) => ({
  LINKED_RESULT: "Đã liên kết nhiệm vụ",
  PENDING_RELATION: "Chờ đối soát liên kết",
  STANDALONE_PRODUCT: "Sản phẩm độc lập",
  RESOLVED: "Đã map người soạn",
  UNRESOLVED: "Chưa map người soạn",
  APPROVED: "Đã chốt KPI",
  PENDING: "Chờ duyệt điểm",
  NOT_APPLICABLE: "Dùng điểm nhiệm vụ",
}[state] || "Chưa đối soát");
const productStateVariant = (state) =>
  ["LINKED_RESULT", "RESOLVED", "APPROVED"].includes(state)
    ? "default"
    : ["PENDING_RELATION", "PENDING"].includes(state)
      ? "outline"
      : "secondary";
const linkedCounterpart = (link, context = selected.value) =>
  context?.pageType === "incoming"
    ? link?.outgoingDocument
    : link?.incomingDocument || link?.outgoingDocument;
const historyActorLabel = (entry) =>
  entry?.actor?.fullName || entry?.actor?.username || "Hệ thống";
const formatDateTime = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleString("vi-VN");
};

const calendarDateFromVietnam = (value) => {
  const match = String(value ?? "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return match ? new CalendarDate(Number(match[3]), Number(match[2]), Number(match[1])) : undefined;
};
const calendarDateToVietnam = (value) => value
  ? `${String(value.day).padStart(2, "0")}/${String(value.month).padStart(2, "0")}/${value.year}`
  : "";
const receivedCalendarDate = computed({
  get: () => calendarDateFromVietnam(form.value.receivedDate),
  set: (value) => { form.value.receivedDate = calendarDateToVietnam(value); receivedDatePickerOpen.value = false; },
});
const dueCalendarDate = computed({
  get: () => calendarDateFromVietnam(form.value.dueDate),
  set: (value) => { form.value.dueDate = calendarDateToVietnam(value); dueDatePickerOpen.value = false; },
});
const createdCalendarDate = computed({
  get: () => calendarDateFromVietnam(form.value.createdDate),
  set: (value) => { form.value.createdDate = calendarDateToVietnam(value); createdDatePickerOpen.value = false; },
});
const formatManualDate = (value) => value || "Chọn ngày";

const filterDateFromPickerOpen = ref(false);
const filterDateToPickerOpen = ref(false);

const calendarDateFromISO = (value) => {
  const [year, month, day] = String(value ?? "").split("-").map(Number);
  return Number.isInteger(year) && Number.isInteger(month) && Number.isInteger(day)
    ? new CalendarDate(year, month, day)
    : undefined;
};

const formatFilterDateDisplay = (value, placeholder = "Chọn ngày") => {
  const [year, month, day] = String(value ?? "").split("-");
  return year && month && day ? `${day}/${month}/${year}` : placeholder;
};

const filterDateFromCalendarDate = computed({
  get: () => calendarDateFromISO(filters.dateFrom),
  set: (value) => {
    filters.dateFrom = value ? value.toString() : "";
    filterDateFromPickerOpen.value = false;
  },
});

const filterDateToCalendarDate = computed({
  get: () => calendarDateFromISO(filters.dateTo),
  set: (value) => {
    filters.dateTo = value ? value.toString() : "";
    filterDateToPickerOpen.value = false;
  },
});
const updateReworkCount = (value) => {
  if (value === "" || value === null || value === undefined) {
    form.value.reworkCount = "";
    return;
  }
  const parsed = Number(value);
  form.value.reworkCount = Number.isFinite(parsed)
    ? Math.max(0, Math.trunc(parsed))
    : 0;
};

watch(
  () => form.value.pageType,
  (pageType) => {
    if (pageType !== "incoming") {
      form.value.dueDate = "";
      if (!form.value.createdDate) form.value.createdDate = vietnamToday();
      applySelfAssignment();
    }
    relatedTask.value = null;
    relatedTaskError.value = "";
  },
);

watch(
  () => form.value.relatedIncomingSoKyHieu,
  () => {
    relatedTaskRequestSequence += 1;
    if (relatedTaskTimer) clearTimeout(relatedTaskTimer);
    relatedTask.value = null;
    relatedTaskError.value = "";
    if (
      !formOpen.value
      || form.value.pageType === "incoming"
      || !form.value.relatedIncomingSoKyHieu.trim()
    ) return;
    relatedTaskTimer = setTimeout(
      () => resolveRelatedTask({ showError: false }),
      400,
    );
  },
);

const tabConfig = computed(() =>
  activeTab.value === "incoming"
    ? {
        icon: FileText,
        pageType: "incoming",
        empty: "Chưa có nhiệm vụ từ extension.",
        sourceLabel: "Nhiệm vụ",
      }
    : {
        icon: Send,
        pageType: "outgoing,outgoing_c2",
        empty: "Chưa có sản phẩm từ extension.",
        sourceLabel: "Sản phẩm",
      },
);

const getValue = (context, field) =>
  context?.[field] ??
  context?.management?.overrides?.[field] ??
  context?.observation?.[field] ??
  (field === "documentId" ? context?.externalDocumentId : undefined) ??
  (field === "url" ? context?.sourceUrl : undefined) ??
  "";
const identity = (context) => context?._id || context?.id;
const personId = (value) => String(value?._id || value || "");
const canEditContext = (context) => {
  if (canManage.value) return true;
  return user.value?.role?.code === "SPECIALIST"
    && context?.pageType !== "incoming"
    && personId(context?.management?.assignment?.userId) === currentUserId.value;
};
// A specialist may dispute the point or the rework count recorded against any
// work of theirs — the incoming task as well as the product — because both
// carry a score that lands in the monthly KPI. A leader settles it with a
// reason. The API applies the same ownership rule, so nothing here is a
// shortcut around it.
const complaintOf = (context) => context?.management?.scoreComplaint ?? null;
const complaintCount = (context) => {
  const history = complaintOf(context)?.history ?? [];
  const requests = history.filter((h) => h.action === "REQUESTED");
  if (requests.length > 0) return requests.length;
  return complaintOf(context)?.status && complaintOf(context)?.status !== "NONE" ? 1 : 0;
};
const complaintStatusLabel = (status) => ({
  PENDING: "Chờ lãnh đạo quyết định",
  APPROVED: "Khiếu nại được chấp nhận",
  REJECTED: "Khiếu nại không được chấp nhận",
  CANCELLED: "Khiếu nại đã hủy",
}[status] || "");
const canRequestComplaint = (context) => (
  personId(context?.management?.assignment?.userId) === currentUserId.value
  && complaintOf(context)?.status !== "PENDING"
);
const canDecideComplaint = (context) => canManage.value && complaintOf(context)?.status === "PENDING";

const complaintOpen = ref(false);
const complaintMode = ref("request");
const complaintTarget = ref(null);
const complaintSaving = ref(false);
const complaintError = ref("");
const complaintForm = ref({ requestedPoint: "", requestedReworkCount: "", reason: "", approvedPoint: "", approvedReworkCount: "", note: "" });

const openComplaint = (context, mode) => {
  const complaint = complaintOf(context) ?? {};
  complaintTarget.value = context;
  complaintMode.value = mode;
  complaintError.value = "";
  complaintForm.value = {
    requestedPoint: complaint.requestedPoint ?? "",
    requestedReworkCount: complaint.requestedReworkCount ?? "",
    reason: complaint.reason ?? "",
    approvedPoint: complaint.requestedPoint ?? "",
    approvedReworkCount: complaint.requestedReworkCount ?? "",
    note: "",
  };
  complaintOpen.value = true;
};

const submitComplaint = async (action) => {
  const context = complaintTarget.value;
  if (!context) return;
  complaintSaving.value = true;
  complaintError.value = "";
  try {
    const id = identity(context);
    if (action === "request") {
      await http(`/api/office-document-contexts/${id}/complaint/request`, {
        method: "POST",
        body: {
          ...(complaintForm.value.requestedPoint !== "" ? { requestedPoint: Number(complaintForm.value.requestedPoint) } : {}),
          ...(complaintForm.value.requestedReworkCount !== "" ? { requestedReworkCount: Number(complaintForm.value.requestedReworkCount) } : {}),
          reason: complaintForm.value.reason.trim(),
        },
      });
    } else if (action === "cancel") {
      await http(`/api/office-document-contexts/${id}/complaint/cancel`, { method: "POST", body: {} });
    } else {
      await http(`/api/office-document-contexts/${id}/complaint/decide`, {
        method: "POST",
        body: {
          accept: action === "accept",
          ...(action === "accept" && complaintForm.value.approvedPoint !== "" ? { approvedPoint: Number(complaintForm.value.approvedPoint) } : {}),
          ...(action === "accept" && complaintForm.value.approvedReworkCount !== "" ? { approvedReworkCount: Number(complaintForm.value.approvedReworkCount) } : {}),
          note: complaintForm.value.note.trim(),
        },
      });
    }
    complaintOpen.value = false;
    await fetchContexts(pagination.value.page, true);
    await openContext(selected.value && identity(selected.value) === id ? selected.value : (context || { _id: id }));
  } catch (requestError) {
    complaintError.value = requestError.message || "Không thể cập nhật khiếu nại.";
  } finally {
    complaintSaving.value = false;
  }
};

const displayIdentifier = (context) =>
  getValue(context, "soKyHieu") || getValue(context, "documentId") || "—";
const contextType = (context) =>
  getValue(context, "pageType") || context?.pageType || "—";
const typeLabel = (context) =>
  ({
    incoming: "Nhiệm vụ",
    outgoing: "Sản phẩm",
    outgoing_c2: "Sản phẩm C2",
  })[contextType(context)] || contextType(context);
const formatCapturedAt = (context) => {
  const value =
    context?.observedAt ||
    context?.capturedAt ||
    context?.updatedAt ||
    context?.createdAt;
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleString("vi-VN");
};

const queryString = (page = 1) =>
  new URLSearchParams({
    page: String(page),
    limit: String(pagination.value.limit),
    pageType: tabConfig.value.pageType,
    ...(search.value.trim() ? { search: search.value.trim() } : {}),
    ...(filters.departmentId ? { departmentId: filters.departmentId } : {}),
    ...(filters.userId ? { userId: filters.userId } : {}),
    ...(filters.deadlineStatuses.length
      ? { deadlineStatus: filters.deadlineStatuses.join(",") }
      : {}),
    ...(filters.scoreState ? { scoreState: filters.scoreState } : {}),
    ...(filters.complaintState ? { complaintState: filters.complaintState } : {}),
    ...(filters.dateField ? { dateField: filters.dateField } : {}),
    ...(filters.dateFrom ? { dateFrom: filters.dateFrom } : {}),
    ...(filters.dateTo ? { dateTo: filters.dateTo } : {}),
  }).toString();

// Set while a document is being opened from a notification. Switching tabs to
// reach it triggers a list reload, and that reload would otherwise clear the
// panel the notification just opened.
const focusLock = ref(false);

const fetchContexts = async (page = 1, keepSelection = false, isBackground = false) => {
  const requestSequence = ++listRequestSequence;
  if (!isBackground) {
    activeForegroundRequests++;
    loading.value = true;
    error.value = null;
  }
  try {
    const response = await http(
      `/api/office-document-contexts?${queryString(page)}`,
    );
    if (requestSequence !== listRequestSequence) return;
    items.value = response.data ?? [];
    pagination.value = response.pagination ?? pagination.value;
    if (!keepSelection && !focusLock.value) {
      selected.value = null;
    } else if (selected.value) {
      const found = items.value.find((i) => identity(i) === identity(selected.value));
      if (found) {
        selected.value = { ...selected.value, ...found };
      }
    }
  } catch (requestError) {
    if (requestSequence !== listRequestSequence) return;
    if (!isBackground) {
      error.value =
        requestError.message || "Không thể tải dữ liệu ngữ cảnh văn bản.";
      items.value = [];
      if (!keepSelection && !focusLock.value) selected.value = null;
    }
  } finally {
    if (!isBackground) {
      activeForegroundRequests = Math.max(0, activeForegroundRequests - 1);
    }
    if (activeForegroundRequests === 0 || requestSequence === listRequestSequence) {
      loading.value = false;
    }
  }
};

const openContext = async (context) => {
  selected.value = context;
  const id = identity(context);
  if (!id) return;
  const requestSequence = ++detailRequestSequence;
  detailLoading.value = true;
  try {
    const response = await http(`/api/office-document-contexts/${id}`);
    if (
      requestSequence === detailRequestSequence &&
      identity(selected.value) === id
    )
      selected.value = {
        ...context,
        ...(response.data ?? {}),
        tracking: response.data?.tracking ?? context?.tracking,
      };
  } catch (requestError) {
    if (
      requestSequence === detailRequestSequence &&
      identity(selected.value) === id
    )
      error.value =
        requestError.message || "Không thể tải chi tiết ngữ cảnh văn bản.";
  } finally {
    if (
      requestSequence === detailRequestSequence &&
      identity(selected.value) === id
    )
      detailLoading.value = false;
  }
};

/**
 * Jumps to the counterpart of the open record — a task's product or a product's
 * task. They live on different tabs, so the tab is switched and the list
 * reloaded before the counterpart is opened.
 */
const closeContext = () => {
  detailRequestSequence += 1;
  detailLoading.value = false;
  selected.value = null;
};

const tracking = (context) => context?.tracking || {};
// A product has no deadline of its own; it is on time or late by the task it
// answers, so the inherited deadline is what gets shown.
const isLinkedProduct = (context) => Boolean(tracking(context).relatedIncoming?.id);
/**
 * Badge on the identifier telling whether the record is paired with its
 * counterpart — a task with the product answering it, or a product with the
 * task it answers. Unpaired products are the ones with no point and no deadline.
 */
const linkBadge = (context) => {
  const info = tracking(context);
  if (context?.pageType === "incoming") {
    return info.relatedProduct?.id
      ? {
        label: "Đã có sản phẩm",
        title: `Sản phẩm trả lời: ${info.relatedProduct.soKyHieu || "—"}`,
        class: "bg-emerald-50 text-emerald-700",
      }
      : null;
  }
  if (info.relatedIncoming?.id) {
    return {
      label: "Đã liên kết",
      title: `Nhiệm vụ nguồn: ${info.relatedIncoming.soKyHieu || "—"}`,
      class: "bg-emerald-50 text-emerald-700",
    };
  }
  if (info.relatedIncoming?.soKyHieu) {
    return {
      label: "Chưa tìm thấy nhiệm vụ",
      title: `Có ghi ${info.relatedIncoming.soKyHieu} nhưng nhiệm vụ chưa có trong eWork`,
      class: "bg-amber-50 text-amber-700",
    };
  }
  return { label: "Chưa liên kết", title: "Chưa ghi nhiệm vụ liên quan", class: "bg-zinc-100 text-zinc-500" };
};
const showsDeadline = (context) => (
  context?.pageType === "incoming" ? Boolean(tracking(context).dueAt) : isLinkedProduct(context)
);
const dueDateLabel = (context) => {
  const own = getValue(context, "dueDate");
  if (own) return own;
  const inherited = tracking(context).dueAt;
  if (!inherited) return "—";
  const date = new Date(inherited);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("vi-VN");
};
const deadlineLabel = (context) => {
  const state = tracking(context).deadlineStatus;
  const dueAt = tracking(context).dueAt
    ? new Date(tracking(context).dueAt)
    : null;
  if (!dueAt || Number.isNaN(dueAt.getTime())) return "Chưa có hạn";
  const days = Math.ceil((dueAt.getTime() - Date.now()) / 86_400_000);
  if (state === "DONE_ON_TIME") return "Đã làm đúng hạn";
  if (state === "DONE_LATE") return "Đã làm chậm hạn";
  if (days < 0) return `Quá hạn ${Math.abs(days)} ngày`;
  if (days === 0) return "Còn hạn hôm nay";
  return `Còn hạn ${days} ngày`;
};
const deadlineClass = (context) =>
  ({
    DONE_ON_TIME: "bg-emerald-50 text-emerald-700 border-emerald-200",
    DONE_LATE: "bg-amber-50 text-amber-700 border-amber-200",
    PENDING_IN_TIME: "bg-sky-50 text-sky-700 border-sky-200",
    PENDING_OVERDUE: "bg-rose-50 text-rose-700 border-rose-200",
  })[tracking(context).deadlineStatus] ||
  "bg-zinc-50 text-zinc-600 border-zinc-200";
const recipientsLabel = (context) =>
  (getValue(context, "recipients") || [])
    .map((recipient) => recipient.fullName || recipient.department)
    .filter(Boolean)
    .join(", ");
const assigneeLabel = (context) =>
  context?.pageType === "incoming"
    ? context?.management?.assignment?.fullName
      || recipientsLabel(context)
      || "Chưa có người nhận"
    : getValue(context, "draftingUser")
      || context?.management?.assignment?.fullName
      || "Chưa có người soạn thảo";
/**
 * The counterpart is shown inside the same detail panel through a second tab,
 * so a task and the product answering it can be read side by side without
 * leaving the page or switching the list tab.
 */
const counterpartTab = ref("self");
const counterpart = ref(null);
const counterpartLoading = ref(false);
const counterpartTarget = computed(() => (
  tracking(selected.value)?.relatedProduct || tracking(selected.value)?.relatedIncoming || null
));

const loadCounterpart = async () => {
  const target = counterpartTarget.value;
  counterpart.value = null;
  if (!target?.id) return;
  counterpartLoading.value = true;
  try {
    const response = await http(`/api/office-document-contexts/${target.id}`);
    counterpart.value = response.data ?? null;
  } catch {
    counterpart.value = null;
  } finally {
    counterpartLoading.value = false;
  }
};

watch(counterpartTarget, (target) => {
  counterpartTab.value = "self";
  if (target?.id) loadCounterpart();
  else counterpart.value = null;
});

// Full switch: replaces the open record with its counterpart, list tab included.
const openCounterpart = async (target) => {
  if (!target?.id) return;
  const goingToProduct = activeTab.value === "incoming";
  activeTab.value = goingToProduct ? "outgoing" : "incoming";
  search.value = target.soKyHieu || "";
  await fetchContexts(1);
  const found = items.value.find((context) => identity(context) === target.id);
  if (found) await openContext(found);
  else error.value = "Không mở được văn bản liên kết. Hãy thử tìm theo số ký hiệu.";
};

const workflowLabel = (context) =>
  tracking(context).statusLabel || "Chưa đồng bộ trạng thái";

const resolveRelatedTask = async ({ showError = true } = {}) => {
  const requestSequence = ++relatedTaskRequestSequence;
  const symbol = form.value.relatedIncomingSoKyHieu.trim();
  relatedTask.value = null;
  relatedTaskError.value = "";
  if (!symbol || form.value.pageType === "incoming") return null;
  relatedTaskLoading.value = true;
  try {
    const response = await http(
      `/api/document-result-links/resolve?soKyHieu=${encodeURIComponent(symbol)}`,
    );
    if (
      requestSequence !== relatedTaskRequestSequence
      || symbol !== form.value.relatedIncomingSoKyHieu.trim()
    ) return null;
    relatedTask.value = response.data ?? null;
    const assignment = relatedTask.value?.assignee ?? {};
    if (!assignment.userId) {
      relatedTaskError.value =
        "Nhiệm vụ chưa được gán người làm nên chưa thể nhận sản phẩm.";
      if (showError) formError.value = relatedTaskError.value;
      return null;
    }
    if (assignment.departmentId) {
      form.value.departmentId = String(
        assignment.departmentId?._id ?? assignment.departmentId,
      );
    }
    if (assignment.userId) {
      form.value.userId = String(assignment.userId?._id ?? assignment.userId);
    }
    return relatedTask.value;
  } catch (requestError) {
    if (requestSequence !== relatedTaskRequestSequence) return null;
    relatedTaskError.value =
      requestError.message || "Không tìm thấy nhiệm vụ liên quan.";
    if (showError) formError.value = relatedTaskError.value;
    return null;
  } finally {
    if (requestSequence === relatedTaskRequestSequence) {
      relatedTaskLoading.value = false;
    }
  }
};

const resultStatusLabel = (status) =>
  ({
    PENDING_APPROVAL: "Chờ duyệt",
    APPROVED: "Đã duyệt",
    RETURNED: "Cần bổ sung",
    SUPERSEDED: "Đã thay thế",
  })[status] || status;

const resultStatusVariant = (status) =>
  status === "APPROVED"
    ? "default"
    : status === "RETURNED"
      ? "destructive"
      : "secondary";
const approvalActionLabel = (action) =>
  ({
    SUBMITTED: "Đã gửi duyệt",
    FORWARDED: "Đã chuyển duyệt",
    APPROVED: "Đã duyệt",
    RETURNED: "Đã trả lại",
    SUPERSEDED: "Đã thay thế",
  })[action] || action;

const fetchPendingApprovalCount = async () => {
  if (!canReviewResults.value) {
    pendingApprovalCount.value = 0;
    return;
  }
  try {
    const response = await http(
      "/api/document-result-links?pendingForMe=true&page=1&limit=1",
    );
    pendingApprovalCount.value = Number(response.meta?.total || 0);
  } catch {
    pendingApprovalCount.value = 0;
  }
};
const handleNotificationChanged = () => fetchPendingApprovalCount();

const fetchResultApprovals = async () => {
  if (!canReviewResults.value) return;
  approvalLoading.value = true;
  approvalError.value = "";
  try {
    const query = approvalTab.value === "pending"
      ? "pendingForMe=true"
      : "status=APPROVED,RETURNED";
    const response = await http(
      `/api/document-result-links?${query}&page=1&limit=100`,
    );
    approvalItems.value = response.data ?? [];
    approvalMeta.value = response.meta ?? { total: 0, approvers: [] };
    if (
      !approvalItems.value.some(
        (item) => String(item._id) === String(approvalSelectedId.value),
      )
    ) {
      approvalSelectedId.value = String(approvalItems.value[0]?._id || "");
    }
  } catch (requestError) {
    approvalError.value =
      requestError.message || "Không thể tải danh sách duyệt sản phẩm.";
    approvalItems.value = [];
  } finally {
    approvalLoading.value = false;
  }
};

const openResultApprovals = async () => {
  approvalOpen.value = true;
  approvalTab.value = "pending";
  approvalNote.value = "";
  approvalApproverId.value = "";
  await fetchResultApprovals();
};

const decideResult = async (action) => {
  const link = approvalSelected.value;
  if (!link || approvalSaving.value) return;
  if (
    ["return", "forward"].includes(action)
    && !approvalNote.value.trim()
  ) {
    approvalError.value =
      action === "return"
        ? "Cần nhập lý do trả lại."
        : "Cần nhập lý do chuyển duyệt.";
    return;
  }
  if (action === "forward" && !approvalApproverId.value) {
    approvalError.value = "Cần chọn người nhận duyệt.";
    return;
  }
  approvalSaving.value = true;
  approvalError.value = "";
  try {
    await http(`/api/document-result-links/${link._id}/${action}`, {
      method: "POST",
      body: {
        revision: link.revision,
        note: approvalNote.value.trim() || undefined,
        ...(action === "forward"
          ? { approverId: approvalApproverId.value }
          : {}),
      },
    });
    approvalNote.value = "";
    approvalApproverId.value = "";
    await Promise.all([
      fetchResultApprovals(),
      fetchPendingApprovalCount(),
      selected.value ? openContext(selected.value) : Promise.resolve(),
    ]);
  } catch (requestError) {
    if (
      String(requestError.message ?? "").includes(
        "Document result link was not found",
      )
    ) {
      await Promise.all([
        fetchResultApprovals(),
        fetchPendingApprovalCount(),
      ]);
      approvalError.value =
        "Yêu cầu duyệt không còn tồn tại hoặc đã được xử lý. Danh sách đã được cập nhật.";
      return;
    }
    approvalError.value =
      requestError.message || "Không thể cập nhật yêu cầu duyệt.";
  } finally {
    approvalSaving.value = false;
  }
};

const fetchFilterOptions = async () => {
  if (!canCreateProduct.value) return;
  try {
    const [departmentResponse, userResponse] = await Promise.all([
      http("/api/departments?limit=100"),
      http("/api/users?limit=100&status=ACTIVE"),
    ]);
    departments.value = departmentResponse.data ?? [];
    users.value = userResponse.data ?? [];
  } catch {
    // CUD remains usable; the backend validates any assignment that is saved.
  }
};

const applySelfAssignment = () => {
  if (user.value?.role?.code !== "SPECIALIST") return;
  form.value.pageType =
    form.value.pageType === "outgoing_c2" ? "outgoing_c2" : "outgoing";
  form.value.departmentId = currentDepartmentId.value;
  form.value.userId = currentUserId.value;
  form.value.draftingUnit =
    currentDepartmentName.value
    || user.value?.departmentName
    || form.value.draftingUnit;
};

const openCreate = async () => {
  formMode.value = "create";
  formError.value = "";
  form.value = blankForm();
  generatedReference.value = "";
  referenceEdited.value = false;
  if (user.value?.role?.code === "SPECIALIST") {
    form.value.pageType = "outgoing";
    form.value.createdDate = vietnamToday();
  }
  applySelfAssignment();
  relatedTask.value = null;
  relatedTaskError.value = "";
  initialRelatedSymbol.value = "";
  formOpen.value = true;
  try {
    const response = await http("/api/office-document-contexts/manual-reference");
    generatedReference.value = response?.data?.soKyHieu || "";
    if (!referenceEdited.value) form.value.soKyHieu = generatedReference.value;
  } catch {
    formError.value = "Không thể cấp số ký hiệu tự động. Hãy thử lại.";
  }
};

const openProductForTask = async (context) => {
  formMode.value = "create";
  formError.value = "";
  form.value = blankForm();
  generatedReference.value = "";
  referenceEdited.value = false;
  form.value.pageType = "outgoing";
  form.value.createdDate = vietnamToday();
  form.value.relatedIncomingSoKyHieu = getValue(context, "soKyHieu");
  initialRelatedSymbol.value = "";
  applySelfAssignment();
  formOpen.value = true;
  try {
    const response = await http("/api/office-document-contexts/manual-reference");
    generatedReference.value = response?.data?.soKyHieu || "";
    if (!referenceEdited.value) form.value.soKyHieu = generatedReference.value;
    await resolveRelatedTask();
  } catch (requestError) {
    formError.value =
      requestError.message || "Không thể chuẩn bị biểu mẫu sản phẩm.";
  }
};

const declareWorkForTask = (context) => {
  const id = identity(context);
  if (!id) return;
  closeContext();
  router.push({ path: "/assignments", query: { sourceDocument: id } });
};

const openEdit = (context) => {
  formMode.value = "edit";
  formError.value = "";
  // The record being edited is tracked on its own. Assigning it to `selected`
  // would fling the detail panel open behind the form, which is not what the
  // Sửa button was asked to do.
  editTarget.value = context;
  form.value = {
    pageType: context.pageType,
    subject: getValue(context, "subject"),
    soKyHieu: getValue(context, "soKyHieu"),
    receivedDate: getValue(context, "receivedDate"),
    dueDate: getValue(context, "dueDate"),
    createdDate: getValue(context, "createdDate"),
    documentForm: getValue(context, "documentForm"),
    priority: getValue(context, "priority"),
    draftingUnit: getValue(context, "draftingUnit"),
    relatedIncomingSoKyHieu: getValue(context, "relatedIncomingSoKyHieu"),
    note: getValue(context, "note"),
    departmentId: context.management?.assignment?.departmentId || "",
    userId: context.management?.assignment?.userId || "",
    // Fall back to the point actually in force (inherited from the task, or read
    // off eOffice) so the field is never blank on a document that has a score.
    manualScore: context.management?.manualScore
      ?? context.tracking?.rawScore
      ?? context.management?.overrides?.point
      ?? context.observation?.point
      ?? "",
    reworkCount: getValue(context, "reworkCount") ?? 0,
    completed:
      context.statusSync?.completed === true
      || context.management?.businessCompletion?.completed === true,
    managementNote: context.management?.note || "",
  };
  relatedTask.value = null;
  relatedTaskError.value = "";
  // The link this product was saved with stays valid even if the task itself
  // was never brought into scmager, so editing (say, to fill in a point) must
  // not be blocked by it. Only a symbol the user actually changes is re-checked.
  initialRelatedSymbol.value = form.value.relatedIncomingSoKyHieu.trim();
  if (form.value.pageType !== "incoming" && form.value.relatedIncomingSoKyHieu) {
    resolveRelatedTask({ showError: false });
  }
  formOpen.value = true;
};

const saveContext = async () => {
  if (!form.value.subject.trim()) {
    formError.value = "Trích yếu văn bản là bắt buộc.";
    return;
  }
  const score = Number(form.value.manualScore);
  if (!form.value.departmentId || !form.value.userId) {
    formError.value = "Đơn vị phụ trách và người làm là bắt buộc.";
    return;
  }
  if (form.value.manualScore === "" || !Number.isFinite(score) || score < 0) {
    formError.value = "Điểm phải là số lớn hơn hoặc bằng 0.";
    return;
  }
  if (form.value.pageType === "incoming") {
    if (!form.value.dueDate) {
      formError.value = "Hạn xử lý là bắt buộc với nhiệm vụ.";
      return;
    }
  } else {
    if (!form.value.createdDate || !form.value.draftingUnit) {
      formError.value = "Ngày tạo, đơn vị soạn thảo, đơn vị phụ trách và người làm là bắt buộc với văn bản đi.";
      return;
    }
    const relatedSymbol = form.value.relatedIncomingSoKyHieu.trim();
    // Re-check only a symbol the user typed or changed. Keeping an existing
    // link that points at a task absent from scmager must not block an edit
    // such as filling in the point.
    if (relatedSymbol && relatedSymbol !== initialRelatedSymbol.value) {
      const resolved = await resolveRelatedTask();
      if (!resolved) return;
    }
  }
  saving.value = true;
  formError.value = "";
  try {
    const payload = { ...form.value };
    if (
      formMode.value === "create"
      && !referenceEdited.value
    ) {
      delete payload.soKyHieu;
    }
    const management = {
      assignment: {
        departmentId: payload.departmentId || "",
        userId: payload.userId || "",
      },
      manualScore: payload.manualScore,
      note: payload.managementNote,
    };
    delete payload.departmentId;
    delete payload.userId;
    delete payload.manualScore;
    delete payload.managementNote;
    payload.management = management;
    if (formMode.value === "edit") {
      delete payload.pageType;
      delete payload.documentId;
      await http(`/api/office-document-contexts/${identity(editTarget.value)}`, {
        method: "PATCH",
        body: payload,
      });
    } else {
      await http("/api/office-document-contexts", {
        method: "POST",
        body: payload,
      });
    }
    formOpen.value = false;
    await Promise.all([
      fetchContexts(1, formMode.value === "edit"),
      fetchPendingApprovalCount(),
    ]);
    // Refresh the detail panel only when it was already open on this record.
    if (formMode.value === "edit" && identity(selected.value) === identity(editTarget.value)) {
      await openContext(editTarget.value);
    }
  } catch (requestError) {
    formError.value = requestError.message || "Không thể lưu văn bản.";
  } finally {
    saving.value = false;
  }
};

const askDelete = (context) => {
  contextToDelete.value = context;
  deleteOpen.value = true;
};

const deleteContext = async () => {
  const context = contextToDelete.value;
  if (!context) return;
  saving.value = true;
  formError.value = "";
  try {
    await http(`/api/office-document-contexts/${identity(context)}`, {
      method: "DELETE",
    });
    if (identity(selected.value) === identity(context)) closeContext();
    deleteOpen.value = false;
    contextToDelete.value = null;
    await fetchContexts(1);
  } catch (requestError) {
    formError.value = requestError.message || "Không thể xóa văn bản.";
  } finally {
    saving.value = false;
  }
};

const observedFields = computed(() =>
  selected.value
    ? [
        ["Mã văn bản nguồn", getValue(selected.value, "documentId")],
        ["Số ký hiệu", getValue(selected.value, "soKyHieu")],
        ["Hạn hiển thị trên eOffice", getValue(selected.value, "dueDate")],
        ["Ngày đến", getValue(selected.value, "receivedDate")],
        ["Ngày tạo", getValue(selected.value, "createdDate")],
        ["Độ khẩn", getValue(selected.value, "priority")],
        ["Hình thức", getValue(selected.value, "documentForm")],
        ["Đơn vị soạn thảo", getValue(selected.value, "draftingUnit")],
        ["Người soạn thảo", getValue(selected.value, "draftingUser")],
        [
          "Nhiệm vụ liên quan",
          getValue(selected.value, "relatedIncomingSoKyHieu"),
        ],
      ].filter(([, value]) => value !== "")
    : [],
);

const recipients = computed(() => getValue(selected.value, "recipients") || []);
const timeline = computed(() => getValue(selected.value, "timeline") || []);
const timelineAction = (entry) => {
  const explicitAction = String(entry?.["Thao tác"] || "").trim();
  if (explicitAction) return explicitAction;
  const content = String(entry?.["Nội dung"] || "").trim();
  return content.match(/^Thao tác:\s*(.+)$/i)?.[1]?.trim() || "";
};
const timelineNote = (entry) => {
  const content = String(entry?.["Nội dung"] || "").trim();
  const action = timelineAction(entry);
  return content === `Thao tác: ${action}` || content === action ? "" : content;
};
const timelineActor = (entry) =>
  String(entry?.["Người gửi"] || entry?.["Người thực hiện"] || "Chưa xác định");
const timelineTime = (entry) =>
  String(
    entry?.["Thời gian"] ||
      entry?.["Đã xử lý"] ||
      entry?.["Đang xử lý"] ||
      entry?.["Chưa xử lý"] ||
      "",
  );
const sourceUrl = computed(() => getValue(selected.value, "url"));
const senderInfo = computed(() => {
  const sender = getValue(selected.value, "sender");
  const details = sender && typeof sender === "object" ? sender : {};
  return {
    fullName: details.fullName || getValue(selected.value, "senderUser"),
    userId: details.userId || getValue(selected.value, "senderUserId"),
    department:
      details.department || getValue(selected.value, "senderDepartment"),
  };
});
const hasSenderInfo = computed(() =>
  Object.values(senderInfo.value).some(Boolean),
);

watch(search, () => {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => fetchContexts(1), 350);
});

const debouncedFetchContexts = (page = 1) => {
  if (listDebounceTimer) clearTimeout(listDebounceTimer);
  listDebounceTimer = setTimeout(() => {
    fetchContexts(page);
  }, 35);
};

watch(activeTab, () => {
  filters.deadlineStatuses = [];
  if (
    activeTab.value === "outgoing" &&
    ["due", "received", "synced", "completed"].includes(filters.dateField)
  ) {
    filters.dateField = "observed";
  }
  debouncedFetchContexts(1);
});
watch(approvalTab, () => {
  approvalSelectedId.value = "";
  approvalNote.value = "";
  approvalApproverId.value = "";
  if (approvalOpen.value) fetchResultApprovals();
});
watch(
  () => filters.departmentId,
  () => {
    if (
      !usersForFilter.value.some(
        (person) => String(person._id) === String(filters.userId),
      )
    ) {
      filters.userId = "";
    }
  },
);
watch(filters, () => debouncedFetchContexts(1), { deep: true });
/**
 * A notification links straight to one document. Opening it here saves the user
 * from hunting through the list, and the query is cleared so a later refresh
 * does not reopen the same panel.
 */
const openFocusedFromQuery = async () => {
  const focusId = String(route.query.focus ?? "");
  if (!focusId) return;
  router.replace({ path: route.path, query: {} });
  focusLock.value = true;
  try {
    const response = await http(`/api/office-document-contexts/${focusId}`);
    const context = response.data;
    if (!context) return;
    if (context.pageType && context.pageType !== activeTab.value) {
      activeTab.value = context.pageType === "incoming" ? "incoming" : "outgoing";
      await fetchContexts(1, true);
    }
    await openContext(context);
    // Release only after the tab watcher's own reload has settled, otherwise it
    // lands last and wipes the selection again.
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 400));
  } catch {
    error.value = "Không mở được văn bản từ thông báo. Có thể văn bản đã bị xóa.";
  } finally {
    focusLock.value = false;
  }
};

let pollTimer = null;

onMounted(async () => {
  window.addEventListener("notification:changed", handleNotificationChanged);
  await loadMe().catch(() => null);
  await fetchFilterOptions();
  await Promise.all([fetchContexts(), fetchPendingApprovalCount()]);
  await openFocusedFromQuery();

  // Polling 10 RPM (mỗi 6 giây) tự động làm mới ngầm nếu không mở dialog/form và tab đang active
  pollTimer = setInterval(() => {
    if (
      typeof document !== "undefined" &&
      document.visibilityState === "visible" &&
      !formOpen.value &&
      !bulkImportOpen.value &&
      !deleteOpen.value &&
      !approvalOpen.value &&
      !complaintOpen.value
    ) {
      fetchContexts(pagination.value.page, true, true);
      fetchPendingApprovalCount();
    }
  }, 6000);
});
watch(() => route.query.focus, (value) => { if (value) openFocusedFromQuery(); });
onUnmounted(() => {
  window.removeEventListener("notification:changed", handleNotificationChanged);
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (searchTimer) clearTimeout(searchTimer);
  if (relatedTaskTimer) clearTimeout(relatedTaskTimer);
  if (listDebounceTimer) clearTimeout(listDebounceTimer);
  loading.value = false;
  activeForegroundRequests = 0;
});
</script>

<template>
  <section class="flex h-full min-h-0 flex-col overflow-hidden bg-zinc-50/60">
    <header class="shrink-0 border-b border-zinc-200/70 bg-white px-4 py-4 sm:px-6">
      <div
        class="mx-auto flex max-w-[1560px] flex-wrap items-center justify-between gap-3"
      >
        <div>
          <h1 class="flex items-center gap-2 text-xl font-bold text-zinc-900">
            <FileText class="h-5 w-5 text-sky-600" /> Văn bản
          </h1>
          <p class="mt-1 text-sm text-zinc-500">
            Ngữ cảnh quan sát từ eOffice do extension gửi; không phải
          </p>
        </div>
        <div class="flex items-center gap-2">
          <Button
            v-if="canReviewResults"
            variant="outline"
            class="rounded-full"
            @click="openResultApprovals"
          >
            <CheckCircle2 class="mr-2 h-4 w-4 text-emerald-600" />
            Duyệt sản phẩm
            <Badge
              class="ml-2 min-w-6 justify-center rounded-full"
              variant="secondary"
            >
              {{ pendingApprovalCount }}
            </Badge>
          </Button>
          <Button
            v-if="canImportKpi"
            variant="outline"
            class="rounded-full"
            @click="bulkImportOpen = true"
            ><Upload class="mr-2 h-4 w-4" /> Thêm hàng loạt</Button
          >
          <Button
            v-if="canCreateProduct"
            class="rounded-full bg-sky-600 text-white hover:bg-sky-700"
            @click="openCreate"
            ><Plus class="mr-2 h-4 w-4" />
            {{
              user?.role?.code === "SPECIALIST"
                ? "Khai báo sản phẩm"
                : "Giao việc, khai báo công việc"
            }}</Button
          >
        </div>
      </div>
    </header>

    <main class="mx-auto w-full max-w-[1560px] flex-1 overflow-y-auto px-4 py-5 sm:px-6">
      <div class="space-y-4">
        <!-- Tabs & Ô tìm kiếm -->
        <div class="flex flex-col justify-start gap-4 md:flex-row md:items-center">
          <div class="shrink-0">
            <SlidingTabs :tabs="TABS" v-model="activeTab" />
          </div>
          <div class="relative w-full md:w-[380px]">
            <Search
              class="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400"
            />
            <Input
              v-model="search"
              class="h-10 rounded-full border-zinc-200/90 bg-white pl-9 pr-9 text-sm shadow-xs transition-colors focus-visible:border-sky-500 focus-visible:ring-sky-500/20"
              placeholder="Tìm mã, số ký hiệu, trích yếu hoặc đơn vị..."
            />
            <button
              v-if="search"
              type="button"
              class="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
              @click="search = ''"
            >
              <X class="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <!-- Toolbar Lọc & Sắp xếp cao cấp -->
        <div class="rounded-2xl border border-zinc-200/80 bg-white p-4 shadow-xs space-y-3.5">
          <!-- Hàng 1: Selects & Date pickers -->
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3 items-center">
            <!-- Đơn vị -->
            <div class="lg:col-span-3">
              <Select v-model="departmentFilterValue">
                <SelectTrigger class="h-9 w-full rounded-full border-zinc-200/80 bg-zinc-50/60 px-3.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100/60 focus:ring-sky-500/20">
                  <div class="flex items-center gap-2 truncate">
                    <Building2 class="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                    <SelectValue />
                  </div>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all_departments__">Tất cả đơn vị</SelectItem>
                  <SelectItem v-for="department in departments" :key="department._id" :value="department._id">{{ department.name }}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <!-- Người làm -->
            <div class="lg:col-span-3">
              <Select v-model="userFilterValue">
                <SelectTrigger class="h-9 w-full rounded-full border-zinc-200/80 bg-zinc-50/60 px-3.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100/60 focus:ring-sky-500/20">
                  <div class="flex items-center gap-2 truncate">
                    <Users class="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                    <SelectValue />
                  </div>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all_users__">Tất cả người làm</SelectItem>
                  <SelectItem v-for="person in usersForFilter" :key="person._id" :value="person._id">{{ person.fullName }}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <!-- Nhóm Ngày -->
            <div class="sm:col-span-2 lg:col-span-6 flex flex-wrap sm:flex-nowrap items-center gap-2">
              <Select v-model="filters.dateField">
                <SelectTrigger class="h-9 min-w-[145px] w-full sm:w-auto rounded-full border-zinc-200/80 bg-zinc-50/60 px-3 text-xs font-medium text-zinc-700 hover:bg-zinc-100/60">
                  <div class="flex items-center gap-1.5 truncate">
                    <CalendarIcon class="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                    <SelectValue />
                  </div>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="observed">Thời gian ghi nhận</SelectItem>
                  <SelectItem v-if="activeTab === 'incoming'" value="due">Hạn xử lý</SelectItem>
                  <SelectItem v-if="activeTab === 'incoming'" value="received">Ngày đến</SelectItem>
                  <SelectItem value="created">Ngày tạo</SelectItem>
                  <SelectItem v-if="activeTab === 'incoming'" value="synced">Lần đồng bộ</SelectItem>
                  <SelectItem v-if="activeTab === 'incoming'" value="completed">Ngày hoàn tất</SelectItem>
                </SelectContent>
              </Select>

              <div class="flex items-center gap-1.5 w-full sm:w-auto">
                <Popover v-model:open="filterDateFromPickerOpen">
                  <PopoverTrigger as-child>
                    <Button
                      variant="outline"
                      class="h-9 w-36 justify-between rounded-full border-zinc-200/80 bg-zinc-50/60 px-3.5 text-xs text-zinc-700 hover:bg-zinc-100/60 font-medium"
                    >
                      <span>{{ formatFilterDateDisplay(filters.dateFrom, 'Từ ngày') }}</span>
                      <CalendarIcon class="h-3.5 w-3.5 text-zinc-400 shrink-0" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="start" class="w-auto p-0 rounded-2xl shadow-xl border-zinc-200">
                    <Calendar v-model="filterDateFromCalendarDate" locale="vi-VN" :max-value="filterDateToCalendarDate" initial-focus />
                  </PopoverContent>
                </Popover>

                <span class="text-xs text-zinc-400 font-medium shrink-0">→</span>

                <Popover v-model:open="filterDateToPickerOpen">
                  <PopoverTrigger as-child>
                    <Button
                      variant="outline"
                      class="h-9 w-36 justify-between rounded-full border-zinc-200/80 bg-zinc-50/60 px-3.5 text-xs text-zinc-700 hover:bg-zinc-100/60 font-medium"
                    >
                      <span>{{ formatFilterDateDisplay(filters.dateTo, 'Đến ngày') }}</span>
                      <CalendarIcon class="h-3.5 w-3.5 text-zinc-400 shrink-0" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" class="w-auto p-0 rounded-2xl shadow-xl border-zinc-200">
                    <Calendar v-model="filterDateToCalendarDate" locale="vi-VN" :min-value="filterDateFromCalendarDate" initial-focus />
                  </PopoverContent>
                </Popover>
              </div>

              <Button
                v-if="filters.dateFrom || filters.dateTo"
                variant="ghost"
                size="sm"
                class="h-8 w-8 rounded-full p-0 text-zinc-400 hover:text-zinc-700"
                title="Xóa lọc ngày"
                @click="filters.dateFrom = ''; filters.dateTo = ''"
              >
                <X class="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          <!-- Hàng 2: Trạng thái hạn & bộ lọc nhanh (Pill Filter Chips) -->
          <div class="flex flex-wrap items-center justify-between gap-2.5 pt-2.5 border-t border-zinc-100">
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-xs font-semibold text-zinc-400 mr-0.5">Trạng thái:</span>

              <template v-if="activeTab === 'incoming'">
                <!-- Done on time -->
                <button
                  type="button"
                  class="inline-flex items-center gap-1.5 h-7 rounded-full border px-3 text-xs font-medium transition-all duration-150"
                  :class="filters.deadlineStatuses.includes('DONE_ON_TIME')
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-800 shadow-xs ring-1 ring-emerald-200'
                    : 'border-zinc-200/70 bg-white text-zinc-600 hover:border-zinc-300 hover:bg-zinc-50'"
                  @click="toggleDeadlineStatus('DONE_ON_TIME')"
                >
                  <span class="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  Đã làm đúng hạn
                </button>

                <!-- Done late -->
                <button
                  type="button"
                  class="inline-flex items-center gap-1.5 h-7 rounded-full border px-3 text-xs font-medium transition-all duration-150"
                  :class="filters.deadlineStatuses.includes('DONE_LATE')
                    ? 'border-amber-300 bg-amber-50 text-amber-800 shadow-xs ring-1 ring-amber-200'
                    : 'border-zinc-200/70 bg-white text-zinc-600 hover:border-zinc-300 hover:bg-zinc-50'"
                  @click="toggleDeadlineStatus('DONE_LATE')"
                >
                  <span class="h-1.5 w-1.5 rounded-full bg-amber-500" />
                  Đã làm chậm hạn
                </button>

                <!-- Pending in time -->
                <button
                  type="button"
                  class="inline-flex items-center gap-1.5 h-7 rounded-full border px-3 text-xs font-medium transition-all duration-150"
                  :class="filters.deadlineStatuses.includes('PENDING_IN_TIME')
                    ? 'border-sky-300 bg-sky-50 text-sky-800 shadow-xs ring-1 ring-sky-200'
                    : 'border-zinc-200/70 bg-white text-zinc-600 hover:border-zinc-300 hover:bg-zinc-50'"
                  @click="toggleDeadlineStatus('PENDING_IN_TIME')"
                >
                  <span class="h-1.5 w-1.5 rounded-full bg-sky-500" />
                  Chưa làm còn hạn
                </button>

                <!-- Pending overdue -->
                <button
                  type="button"
                  class="inline-flex items-center gap-1.5 h-7 rounded-full border px-3 text-xs font-medium transition-all duration-150"
                  :class="filters.deadlineStatuses.includes('PENDING_OVERDUE')
                    ? 'border-rose-300 bg-rose-50 text-rose-800 shadow-xs ring-1 ring-rose-200'
                    : 'border-zinc-200/70 bg-white text-zinc-600 hover:border-zinc-300 hover:bg-zinc-50'"
                  @click="toggleDeadlineStatus('PENDING_OVERDUE')"
                >
                  <span class="h-1.5 w-1.5 rounded-full bg-rose-500" />
                  Chưa làm quá hạn
                </button>
              </template>

              <!-- Awaiting score -->
              <button
                type="button"
                class="inline-flex items-center gap-1.5 h-7 rounded-full border px-3 text-xs font-medium transition-all duration-150"
                :class="filters.scoreState === 'AWAITING_SCORE'
                  ? 'border-amber-300 bg-amber-100/80 text-amber-900 shadow-xs ring-1 ring-amber-300 font-semibold'
                  : 'border-zinc-200/70 bg-white text-zinc-600 hover:border-zinc-300 hover:bg-zinc-50'"
                @click="filters.scoreState = filters.scoreState === 'AWAITING_SCORE' ? '' : 'AWAITING_SCORE'"
              >
                <Clock3 class="h-3 w-3 text-amber-600" />
                Chưa có điểm
                <span v-if="filters.scoreState === 'AWAITING_SCORE'" class="rounded-full bg-amber-200/90 px-1.5 text-[10px] text-amber-950 font-bold">
                  {{ pagination.total }}
                </span>
              </button>

              <!-- Complaint pending -->
              <button
                type="button"
                class="inline-flex items-center gap-1.5 h-7 rounded-full border px-3 text-xs font-medium transition-all duration-150"
                :class="filters.complaintState === 'PENDING'
                  ? 'border-rose-300 bg-rose-100/80 text-rose-900 shadow-xs ring-1 ring-rose-300 font-semibold'
                  : 'border-zinc-200/70 bg-white text-zinc-600 hover:border-zinc-300 hover:bg-zinc-50'"
                @click="filters.complaintState = filters.complaintState === 'PENDING' ? '' : 'PENDING'"
              >
                <MessageSquareWarning class="h-3 w-3 text-rose-600" />
                Đang có khiếu nại
                <span v-if="filters.complaintState === 'PENDING'" class="rounded-full bg-rose-200/90 px-1.5 text-[10px] text-rose-950 font-bold">
                  {{ pagination.total }}
                </span>
              </button>
            </div>

            <!-- Nút Reset bộ lọc -->
            <Button
              v-if="hasActiveFilters"
              variant="ghost"
              size="sm"
              class="h-7 rounded-full px-2.5 text-xs text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100"
              @click="resetFilters"
            >
              <RotateCcw class="mr-1.5 h-3 w-3" />
              Đặt lại bộ lọc
            </Button>
          </div>
        </div>

        <div
          v-if="error"
          class="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700"
        >
          {{ error }}
        </div>

        <!-- Bảng danh sách văn bản chuẩn Shadcn -->
        <section
          class="overflow-hidden rounded-2xl border border-zinc-200/80 bg-white shadow-xs"
        >
          <div v-if="loading" class="space-y-3 p-5">
            <div
              v-for="index in 6"
              :key="index"
              class="h-14 animate-pulse rounded-lg bg-zinc-100/80"
            />
          </div>
          <div v-else-if="sortedItems.length" class="overflow-x-auto">
            <Table class="w-full min-w-[1120px]">
              <TableHeader class="bg-zinc-50/75 border-b border-zinc-200/70">
                <TableRow class="hover:bg-transparent">
                  <TableHead class="w-[380px] px-4 py-3.5 text-xs font-semibold text-zinc-600">
                    Văn bản
                  </TableHead>

                  <TableHead
                    v-if="activeTab === 'incoming'"
                    class="w-[120px] px-4 py-3.5 text-xs font-semibold text-zinc-600 cursor-pointer select-none group hover:text-zinc-900"
                    @click="toggleSort('dueDate')"
                  >
                    <div class="flex items-center gap-1">
                      <span>Hạn</span>
                      <ArrowUp v-if="sortField === 'dueDate' && sortOrder === 'asc'" class="h-3.5 w-3.5 text-sky-600" />
                      <ArrowDown v-else-if="sortField === 'dueDate' && sortOrder === 'desc'" class="h-3.5 w-3.5 text-sky-600" />
                      <ArrowUpDown v-else class="h-3 w-3 text-zinc-400 opacity-40 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </TableHead>

                  <TableHead v-if="activeTab === 'incoming'" class="w-[150px] px-4 py-3.5 text-xs font-semibold text-zinc-600">
                    Tình trạng hạn
                  </TableHead>

                  <TableHead class="w-[170px] px-4 py-3.5 text-xs font-semibold text-zinc-600">
                    {{ activeTab === "incoming" ? "Người làm" : "Người soạn thảo" }}
                  </TableHead>

                  <TableHead v-if="activeTab === 'incoming'" class="w-[180px] px-4 py-3.5 text-xs font-semibold text-zinc-600">
                    Trạng thái
                  </TableHead>

                  <TableHead
                    class="w-[110px] px-4 py-3.5 text-xs font-semibold text-zinc-600 cursor-pointer select-none group hover:text-zinc-900"
                    @click="toggleSort('score')"
                  >
                    <div class="flex items-center gap-1">
                      <span>Điểm</span>
                      <ArrowUp v-if="sortField === 'score' && sortOrder === 'asc'" class="h-3.5 w-3.5 text-sky-600" />
                      <ArrowDown v-else-if="sortField === 'score' && sortOrder === 'desc'" class="h-3.5 w-3.5 text-sky-600" />
                      <ArrowUpDown v-else class="h-3 w-3 text-zinc-400 opacity-40 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </TableHead>

                  <TableHead
                    class="w-[110px] px-4 py-3.5 text-xs font-semibold text-zinc-600 cursor-pointer select-none group hover:text-zinc-900"
                    @click="toggleSort('reworkCount')"
                  >
                    <div class="flex items-center gap-1">
                      <span>Lần làm lại</span>
                      <ArrowUp v-if="sortField === 'reworkCount' && sortOrder === 'asc'" class="h-3.5 w-3.5 text-sky-600" />
                      <ArrowDown v-else-if="sortField === 'reworkCount' && sortOrder === 'desc'" class="h-3.5 w-3.5 text-sky-600" />
                      <ArrowUpDown v-else class="h-3 w-3 text-zinc-400 opacity-40 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </TableHead>

                  <TableHead
                    class="w-[110px] px-4 py-3.5 text-xs font-semibold text-zinc-600 cursor-pointer select-none group hover:text-zinc-900"
                    @click="toggleSort('priority')"
                  >
                    <div class="flex items-center gap-1">
                      <span>Độ khẩn</span>
                      <ArrowUp v-if="sortField === 'priority' && sortOrder === 'asc'" class="h-3.5 w-3.5 text-sky-600" />
                      <ArrowDown v-else-if="sortField === 'priority' && sortOrder === 'desc'" class="h-3.5 w-3.5 text-sky-600" />
                      <ArrowUpDown v-else class="h-3 w-3 text-zinc-400 opacity-40 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </TableHead>

                  <TableHead
                    class="w-[150px] px-4 py-3.5 text-xs font-semibold text-zinc-600 cursor-pointer select-none group hover:text-zinc-900"
                    @click="toggleSort('observedAt')"
                  >
                    <div class="flex items-center gap-1">
                      <span>Ghi nhận lúc</span>
                      <ArrowUp v-if="sortField === 'observedAt' && sortOrder === 'asc'" class="h-3.5 w-3.5 text-sky-600" />
                      <ArrowDown v-else-if="sortField === 'observedAt' && sortOrder === 'desc'" class="h-3.5 w-3.5 text-sky-600" />
                      <ArrowUpDown v-else class="h-3 w-3 text-zinc-400 opacity-40 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </TableHead>

                  <TableHead v-if="canCreateProduct" class="w-[130px] px-4 py-3.5 text-right text-xs font-semibold text-zinc-600">
                    Thao tác
                  </TableHead>
                </TableRow>
              </TableHeader>

              <TableBody class="divide-y divide-zinc-100">
                <TableRow
                  v-for="context in sortedItems"
                  :key="identity(context)"
                  class="cursor-pointer transition-colors duration-150 hover:bg-zinc-50/80"
                  :class="
                    identity(selected) === identity(context)
                      ? 'bg-sky-50/70 border-l-4 border-l-sky-600 font-medium'
                      : ''
                  "
                  @click="openContext(context)"
                >
                  <TableCell class="px-4 py-3.5">
                    <div class="flex items-start gap-2.5">
                      <component
                        :is="tabConfig.icon"
                        class="mt-0.5 h-4 w-4 shrink-0 text-sky-600"
                      />
                      <div class="min-w-0">
                        <div class="flex flex-wrap items-center gap-1.5">
                          <strong class="text-zinc-900 text-sm font-semibold tracking-tight">{{
                            displayIdentifier(context)
                          }}</strong>
                          <!-- Link badge -->
                          <span
                            v-if="linkBadge(context)"
                            class="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold"
                            :class="linkBadge(context).class"
                            :title="linkBadge(context).title"
                          >
                            <Link2 class="h-3 w-3" />{{ linkBadge(context).label }}
                          </span>
                        </div>
                        <p class="mt-1 line-clamp-2 text-xs leading-relaxed text-zinc-600">
                          {{
                            getValue(context, "subject") ||
                            "Không có trích yếu."
                          }}
                        </p>
                      </div>
                    </div>
                  </TableCell>

                  <TableCell
                    v-if="activeTab === 'incoming'"
                    class="whitespace-nowrap px-4 py-3.5 text-xs text-zinc-600 font-medium"
                  >
                    {{ dueDateLabel(context) }}
                  </TableCell>

                  <TableCell v-if="activeTab === 'incoming'" class="px-4 py-3.5">
                    <span
                      v-if="tracking(context).deadlineStatus && tracking(context).deadlineStatus !== 'NO_DEADLINE'"
                      class="inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold shadow-2xs"
                      :class="deadlineClass(context)"
                    >
                      {{ deadlineLabel(context) }}
                    </span>
                    <span v-else class="text-zinc-300">—</span>
                  </TableCell>

                  <TableCell class="px-4 py-3.5 text-xs text-zinc-700">
                    {{ assigneeLabel(context) }}
                  </TableCell>

                  <TableCell
                    v-if="activeTab === 'incoming'"
                    class="max-w-[220px] px-4 py-3.5 text-xs text-zinc-700 truncate"
                  >
                    {{ workflowLabel(context) }}
                  </TableCell>

                  <TableCell class="px-4 py-3.5 text-xs">
                    <span
                      v-if="tracking(context).awaitingScore"
                      class="inline-flex items-center rounded-full bg-amber-100/90 px-2 py-0.5 text-xs font-bold text-amber-900 whitespace-nowrap shadow-2xs"
                      title="Văn bản đã xong nhưng chưa được chấm điểm"
                    >
                      Chưa chấm
                    </span>
                    <strong v-else class="text-sm font-bold text-zinc-900">
                      {{ tracking(context).rawScore ?? "—" }}
                    </strong>
                    <span
                      v-if="complaintOf(context)?.status === 'PENDING'"
                      class="ml-1.5 inline-flex items-center rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700 whitespace-nowrap"
                      title="Đang có khiếu nại chờ lãnh đạo quyết định"
                    >
                      Khiếu nại
                    </span>
                  </TableCell>

                  <TableCell class="px-4 py-3.5 text-xs text-zinc-700">
                    <span
                      v-if="(getValue(context, 'reworkCount') ?? 0) > 0"
                      class="inline-flex items-center rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-xs font-bold text-amber-800"
                    >
                      {{ getValue(context, 'reworkCount') }} lần
                    </span>
                    <span v-else class="text-zinc-400">0</span>
                  </TableCell>

                  <TableCell class="px-4 py-3.5 text-xs text-zinc-600">
                    <span
                      v-if="getValue(context, 'priority')"
                      class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                      :class="getValue(context, 'priority') === 'Hỏa tốc'
                        ? 'bg-rose-100 text-rose-800 font-bold'
                        : getValue(context, 'priority') === 'Thượng khẩn'
                          ? 'bg-amber-100 text-amber-800 font-semibold'
                          : 'bg-zinc-100 text-zinc-700'"
                    >
                      {{ getValue(context, 'priority') }}
                    </span>
                    <span v-else class="text-zinc-300">—</span>
                  </TableCell>

                  <TableCell class="whitespace-nowrap px-4 py-3.5 text-xs text-zinc-600">
                    {{ formatCapturedAt(context) }}
                  </TableCell>

                  <TableCell v-if="canCreateProduct" class="px-4 py-3.5 text-right">
                    <div class="flex justify-end gap-1">
                      <Button
                        v-if="canRequestComplaint(context)"
                        variant="ghost"
                        size="icon"
                        class="h-7 w-7 rounded-full text-zinc-500 hover:text-amber-700 hover:bg-amber-50"
                        title="Khiếu nại điểm / số lần làm lại"
                        @click.stop="openComplaint(context, 'request')"
                      ><MessageSquareWarning class="h-3.5 w-3.5" /></Button>
                      <Button
                        v-if="canDecideComplaint(context)"
                        variant="ghost"
                        size="icon"
                        class="h-7 w-7 rounded-full text-amber-600 hover:text-amber-800 hover:bg-amber-50"
                        title="Duyệt khiếu nại"
                        @click.stop="openComplaint(context, 'decide')"
                      ><MessageSquareWarning class="h-3.5 w-3.5" /></Button>
                      <Button
                        v-if="canEditContext(context)"
                        variant="ghost"
                        size="icon"
                        class="h-7 w-7 rounded-full text-zinc-500 hover:text-sky-700 hover:bg-sky-50"
                        title="Sửa"
                        @click.stop="openEdit(context)"
                      ><Pencil class="h-3.5 w-3.5" /></Button>
                      <Button
                        v-if="canEditContext(context)"
                        variant="ghost"
                        size="icon"
                        class="h-7 w-7 rounded-full text-zinc-500 hover:text-rose-700 hover:bg-rose-50"
                        title="Xóa"
                        @click.stop="askDelete(context)"
                      ><Trash2 class="h-3.5 w-3.5" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
          <div
            v-else
            class="py-16 text-center text-sm font-medium text-zinc-400"
          >
            {{ tabConfig.empty }}
          </div>
          <footer
            class="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 px-4 py-3"
          >
            <span class="text-xs font-medium text-zinc-500"
              >{{ pagination.total }}
              {{ tabConfig.sourceLabel.toLowerCase() }} · trang
              {{ pagination.page }}/{{
                Math.max(pagination.totalPages, 1)
              }}</span
            >
            <div class="flex gap-2">
              <Button
                variant="outline"
                size="icon"
                class="h-8 w-8"
                title="Trang trước"
                :disabled="loading || pagination.page <= 1"
                @click="fetchContexts(pagination.page - 1)"
                ><ChevronLeft class="h-4 w-4" /></Button
              ><Button
                variant="outline"
                size="icon"
                class="h-8 w-8"
                title="Trang sau"
                :disabled="loading || pagination.page >= pagination.totalPages"
                @click="fetchContexts(pagination.page + 1)"
                ><ChevronRight class="h-4 w-4"
              /></Button>
            </div>
          </footer>
        </section>
      </div>
    </main>

    <Teleport to="body"
      ><Transition name="office-context-drawer"
        ><div v-if="selected" class="fixed inset-0 z-50">
          <button
            class="absolute inset-0 bg-zinc-950/30"
            aria-label="Đóng"
            @click="closeContext"
          />
          <aside
            class="absolute right-0 top-0 flex h-full w-full max-w-[680px] flex-col bg-white shadow-2xl"
          >
            <header
              class="flex items-start justify-between border-b border-zinc-200 px-5 py-4"
            >
              <div>
                <p class="text-base font-bold text-zinc-900">
                  Chi tiết ngữ cảnh văn bản
                </p>
                <p class="mt-0.5 text-sm text-zinc-500">
                  {{ typeLabel(selected) }} · ghi nhận
                  {{ formatCapturedAt(selected) }}
                </p>
              </div>
              <div class="flex gap-1">
                <Button
                  v-if="selected.pageType === 'incoming'"
                  variant="outline"
                  size="sm"
                  @click="declareWorkForTask(selected)"
                >
                  Khai báo việc
                </Button>
                <Button
                  v-if="selected.pageType === 'incoming'"
                  size="sm"
                  class="bg-sky-600 text-white hover:bg-sky-700"
                  @click="openProductForTask(selected)"
                >
                  Thêm sản phẩm
                </Button>
                <Button
                  v-if="canRequestComplaint(selected)"
                  size="sm"
                  variant="outline"
                  class="border-amber-300 bg-white text-amber-800 hover:bg-amber-50"
                  @click="openComplaint(selected, 'request')"
                >
                  Khiếu nại điểm
                </Button>
                <Button
                  v-if="canDecideComplaint(selected)"
                  size="sm"
                  class="bg-amber-600 text-white hover:bg-amber-700"
                  @click="openComplaint(selected, 'decide')"
                >
                  Duyệt khiếu nại
                </Button>
                <Button
                  v-if="canEditContext(selected)"
                  variant="ghost"
                  size="icon"
                  class="h-8 w-8"
                  title="Sửa"
                  @click="openEdit(selected)"
                  ><Pencil class="h-4 w-4" /></Button
                ><Button
                  variant="ghost"
                  size="icon"
                  class="h-8 w-8"
                  title="Đóng"
                  @click="closeContext"
                  ><X class="h-4 w-4"
                /></Button>
              </div>
            </header>
            <div class="flex-1 overflow-y-auto px-5 py-5">
              <div v-if="detailLoading" class="space-y-3">
                <div
                  v-for="index in 6"
                  :key="index"
                  class="h-12 animate-pulse rounded bg-zinc-100"
                />
              </div>
              <template v-else>
                <section
                  v-if="complaintOf(selected) && complaintOf(selected).status !== 'NONE'"
                  class="mb-4 rounded-xl border p-3 text-xs transition-all space-y-2"
                  :class="{
                    'border-amber-300/80 bg-amber-50/50': complaintOf(selected).status === 'PENDING',
                    'border-emerald-300/80 bg-emerald-50/50': complaintOf(selected).status === 'APPROVED',
                    'border-rose-300/80 bg-rose-50/50': complaintOf(selected).status === 'REJECTED',
                    'border-zinc-300 bg-zinc-50/70': complaintOf(selected).status === 'CANCELLED',
                  }"
                >
                  <!-- Row 1: Header (Badge status + Lần khiếu nại + Action) -->
                  <div class="flex items-center justify-between gap-2">
                    <div class="flex items-center gap-2 flex-wrap">
                      <span
                        class="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide whitespace-nowrap shrink-0"
                        :class="{
                          'bg-amber-100 text-amber-900 border border-amber-300': complaintOf(selected).status === 'PENDING',
                          'bg-emerald-100 text-emerald-900 border border-emerald-300': complaintOf(selected).status === 'APPROVED',
                          'bg-rose-100 text-rose-900 border border-rose-300': complaintOf(selected).status === 'REJECTED',
                          'bg-zinc-100 text-zinc-800 border border-zinc-300': complaintOf(selected).status === 'CANCELLED',
                        }"
                      >
                        <MessageSquareWarning v-if="complaintOf(selected).status === 'PENDING'" class="h-3 w-3" />
                        <CheckCircle2 v-else-if="complaintOf(selected).status === 'APPROVED'" class="h-3 w-3 text-emerald-600" />
                        <XCircle v-else-if="complaintOf(selected).status === 'REJECTED'" class="h-3 w-3 text-rose-600" />
                        {{ complaintStatusLabel(complaintOf(selected).status) }}
                      </span>

                      <span class="text-zinc-600 font-semibold text-[11px]">
                        (Khiếu nại lần {{ complaintCount(selected) }})
                      </span>
                    </div>

                    <div class="flex items-center gap-2 shrink-0">
                      <Button
                        v-if="canDecideComplaint(selected)"
                        size="sm"
                        class="h-7 rounded-md bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs px-2.5 shadow-2xs whitespace-nowrap shrink-0"
                        @click.stop="openComplaint(selected, 'decide')"
                      >
                        Duyệt khiếu nại
                      </Button>
                      <button
                        v-if="complaintOf(selected).status === 'PENDING' && personId(complaintOf(selected).requestedBy) === currentUserId"
                        type="button"
                        class="text-xs font-semibold text-rose-600 hover:text-rose-800 hover:underline transition-colors whitespace-nowrap"
                        :disabled="complaintSaving"
                        @click="complaintTarget = selected; submitComplaint('cancel')"
                      >
                        Hủy khiếu nại
                      </button>
                    </div>
                  </div>

                  <!-- Row 2: Metrics summary (Inline compact stats) -->
                  <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs pt-1.5 border-t border-zinc-200/60">
                    <div class="flex items-center gap-1.5">
                      <span class="text-zinc-500 font-semibold">Đề xuất nhân sự:</span>
                      <span v-if="complaintOf(selected).requestedPoint !== null" class="font-extrabold text-zinc-900">
                        {{ complaintOf(selected).requestedPoint }} điểm
                      </span>
                      <span v-if="complaintOf(selected).requestedReworkCount !== null" class="text-zinc-700 font-semibold">
                        ({{ complaintOf(selected).requestedReworkCount }} lần làm lại)
                      </span>
                    </div>

                    <div v-if="complaintOf(selected).status === 'APPROVED'" class="flex items-center gap-1.5">
                      <span class="text-emerald-800 font-bold">Mức điểm chốt:</span>
                      <span v-if="complaintOf(selected).approvedPoint !== null" class="inline-flex items-center px-2 py-0.5 rounded bg-emerald-600 text-white font-extrabold text-xs shadow-2xs">
                        {{ complaintOf(selected).approvedPoint }} điểm
                      </span>
                      <span v-if="complaintOf(selected).approvedReworkCount !== null" class="text-emerald-900 font-semibold">
                        ({{ complaintOf(selected).approvedReworkCount }} lần làm lại)
                      </span>
                    </div>
                  </div>

                  <!-- Row 3 & 4: Text content (Minimalist inline lines) -->
                  <div class="space-y-1 text-xs pt-0.5">
                    <p v-if="complaintOf(selected).reason" class="text-zinc-800">
                      <span class="font-bold text-zinc-500">Lý do:</span>
                      <span class="ml-1 font-medium">{{ complaintOf(selected).reason }}</span>
                    </p>

                    <p v-if="complaintOf(selected).decisionNote" class="text-zinc-900">
                      <span class="font-bold text-amber-900">Ý kiến lãnh đạo:</span>
                      <span class="ml-1 font-medium">{{ complaintOf(selected).decisionNote }}</span>
                    </p>
                  </div>
                </section>
                <section class="border-b border-zinc-100 pb-5">
                  <span
                    class="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-bold text-sky-700"
                    >Dữ liệu quan sát</span
                  >
                  <h2 class="mt-4 text-lg font-bold leading-7 text-zinc-900">
                    {{ getValue(selected, "subject") || "Không có trích yếu." }}
                  </h2>
                  <p class="mt-2 text-sm text-zinc-500">
                    {{ displayIdentifier(selected) }}
                  </p>
                </section>
                <section
                  v-if="productReconciliation"
                  class="border-b border-zinc-100 py-5"
                >
                  <h3 class="text-xs font-bold uppercase text-zinc-400">
                    Trạng thái đối soát
                  </h3>
                  <div class="mt-3 flex flex-wrap gap-2">
                    <Badge :variant="productStateVariant(productReconciliation.classification)">
                      {{ productStateLabel(productReconciliation.classification) }}
                    </Badge>
                    <Badge :variant="productStateVariant(productReconciliation.performerStatus)">
                      {{ productStateLabel(productReconciliation.performerStatus) }}
                    </Badge>
                    <Badge :variant="productStateVariant(productReconciliation.scoreStatus)">
                      {{ productStateLabel(productReconciliation.scoreStatus) }}
                    </Badge>
                  </div>
                  <p
                    v-if="productReconciliation.lastError"
                    class="mt-3 text-sm leading-5 text-amber-700"
                  >
                    {{ productReconciliation.lastError }}
                  </p>
                </section>
                <section class="border-b border-zinc-100 py-5">
                  <h3 class="text-xs font-bold uppercase text-zinc-400">
                    Thông tin ghi nhận
                  </h3>
                  <dl
                    class="mt-3 grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2 text-sm"
                  >
                    <div v-for="[label, value] in observedFields" :key="label">
                      <dt class="font-semibold text-zinc-400">{{ label }}</dt>
                      <dd class="mt-1 break-words text-zinc-800">
                        {{ value }}
                      </dd>
                    </div>
                  </dl>
                </section>
                <section class="border-b border-zinc-100 py-5">
                  <div class="flex items-center justify-between gap-3">
                    <h3 class="text-xs font-bold uppercase text-zinc-400">
                      {{
                        selected.pageType === "incoming"
                          ? "Sản phẩm xử lý"
                          : resultLinks.some((link) => link.incomingDocument)
                            ? "Nhiệm vụ nguồn"
                            : "Tính hiệu suất"
                      }}
                    </h3>
                    <Badge variant="secondary" class="rounded-full">
                      {{ resultLinks.length }} liên kết
                    </Badge>
                  </div>
                  <div v-if="resultLinks.length" class="mt-3 space-y-2">
                    <article
                      v-for="link in resultLinks"
                      :key="link._id"
                      class="rounded-lg border border-zinc-200 p-3"
                    >
                      <div class="flex items-start justify-between gap-3">
                        <div class="min-w-0">
                          <p class="font-semibold text-zinc-900">
                            {{ displayIdentifier(linkedCounterpart(link)) }}
                          </p>
                          <p class="mt-1 line-clamp-2 text-sm text-zinc-600">
                            {{
                              getValue(linkedCounterpart(link), "subject")
                              || "Không có trích yếu."
                            }}
                          </p>
                        </div>
                        <Badge
                          :variant="resultStatusVariant(link.status)"
                          class="shrink-0 rounded-full"
                        >
                          {{ resultStatusLabel(link.status) }}
                        </Badge>
                      </div>
                      <p class="mt-2 text-xs text-zinc-500">
                        Người thực hiện:
                        {{
                          link.performedBy?.fullName
                            || link.submittedBy?.fullName
                            || "—"
                        }}
                        · {{ formatDateTime(link.submittedAt) }}
                      </p>
                    </article>
                  </div>
                  <p v-else class="mt-3 text-sm text-zinc-500">
                    {{
                      selected.pageType === "incoming"
                        ? "Chưa có sản phẩm hoặc công việc được liên kết."
                        : productReconciliation?.classification === "PENDING_RELATION"
                          ? "Đang chờ đối soát với nhiệm vụ nguồn."
                          : productReconciliation?.scoreStatus === "APPROVED"
                            ? "Sản phẩm độc lập đã được duyệt điểm KPI."
                            : "Sản phẩm độc lập chỉ được tính KPI sau khi lãnh đạo duyệt điểm."
                    }}
                  </p>
                </section>
                <section
                  v-if="hasSenderInfo"
                  class="border-b border-zinc-100 py-5"
                >
                  <h3 class="text-xs font-bold uppercase text-zinc-400">
                    Người gửi API
                  </h3>
                  <dl
                    class="mt-3 grid grid-cols-1 gap-x-5 gap-y-4 text-sm sm:grid-cols-2"
                  >
                    <div v-if="senderInfo.fullName">
                      <dt class="font-semibold text-zinc-400">Họ tên</dt>
                      <dd class="mt-1 break-words text-zinc-800">
                        {{ senderInfo.fullName }}
                      </dd>
                    </div>
                    <div v-if="senderInfo.userId">
                      <dt class="font-semibold text-zinc-400">Mã người dùng</dt>
                      <dd class="mt-1 break-words text-zinc-800">
                        {{ senderInfo.userId }}
                      </dd>
                    </div>
                    <div v-if="senderInfo.department">
                      <dt class="font-semibold text-zinc-400">Đơn vị</dt>
                      <dd class="mt-1 break-words text-zinc-800">
                        {{ senderInfo.department }}
                      </dd>
                    </div>
                  </dl>
                </section>
                <section v-if="counterpartTarget" class="border-b border-zinc-100 py-5">
                  <div class="flex flex-wrap items-center justify-between gap-2">
                    <SlidingTabs
                      v-model="counterpartTab"
                      :tabs="[
                        { id: 'self', label: selected.pageType === 'incoming' ? 'Nhiệm vụ này' : 'Sản phẩm này' },
                        { id: 'other', label: tracking(selected).relatedProduct ? 'Sản phẩm trả lời' : 'Nhiệm vụ nguồn' },
                      ]"
                    />
                    <Button
                      v-if="counterpartTab === 'other' && counterpartTarget.id"
                      size="sm"
                      variant="outline"
                      class="gap-1.5"
                      @click="openCounterpart(counterpartTarget)"
                    >
                      <ArrowUpRight class="h-4 w-4" />Mở riêng
                    </Button>
                  </div>

                  <div v-if="counterpartTab === 'other'" class="mt-4">
                    <div v-if="counterpartLoading" class="h-24 animate-pulse rounded-lg bg-zinc-100" />
                    <div v-else-if="counterpart" class="rounded-lg border border-zinc-200 bg-zinc-50/60 p-4">
                      <p class="text-sm font-bold text-zinc-900">{{ displayIdentifier(counterpart) }}</p>
                      <p class="mt-1 text-sm text-zinc-700">{{ getValue(counterpart, "subject") || "—" }}</p>
                      <dl class="mt-3 grid grid-cols-2 gap-3 text-xs">
                        <div><dt class="text-zinc-500">Người xử lý</dt><dd class="mt-0.5 font-semibold text-zinc-800">{{ assigneeLabel(counterpart) }}</dd></div>
                        <div><dt class="text-zinc-500">Hạn xử lý</dt><dd class="mt-0.5 font-semibold text-zinc-800">{{ dueDateLabel(counterpart) }}</dd></div>
                        <div><dt class="text-zinc-500">Điểm</dt><dd class="mt-0.5 font-semibold text-zinc-800">{{ tracking(counterpart).rawScore ?? "Chưa chấm" }}</dd></div>
                        <div><dt class="text-zinc-500">Lần làm lại</dt><dd class="mt-0.5 font-semibold text-zinc-800">{{ getValue(counterpart, "reworkCount") ?? 0 }}</dd></div>
                      </dl>
                      <p v-if="getValue(counterpart, 'note')" class="mt-3 whitespace-pre-wrap rounded-md bg-white p-3 text-xs leading-5 text-zinc-600">
                        {{ getValue(counterpart, "note") }}
                      </p>
                    </div>
                    <p v-else class="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                      {{ counterpartTarget.soKyHieu }} — chưa có trong eWork nên không xem được chi tiết.
                    </p>
                  </div>
                </section>
                <section
                  v-if="getValue(selected, 'note') || selected.management?.note || getValue(selected, 'comment')"
                  class="border-b border-zinc-100 py-5"
                >
                  <h3 class="text-xs font-bold uppercase text-zinc-400">Ghi chú</h3>
                  <div v-if="getValue(selected, 'note')" class="mt-3">
                    <p class="text-[11px] font-semibold text-zinc-500">Nội dung khi chuyển văn thư</p>
                    <p class="mt-1 whitespace-pre-wrap rounded-md bg-zinc-50 p-3 text-sm leading-6 text-zinc-700">
                      {{ getValue(selected, "note") }}
                    </p>
                  </div>
                  <div v-if="selected.management?.note" class="mt-3">
                    <p class="text-[11px] font-semibold text-zinc-500">Ghi chú quản lý (gồm quyết định khiếu nại)</p>
                    <p class="mt-1 whitespace-pre-wrap rounded-md bg-amber-50/60 p-3 text-sm leading-6 text-zinc-700">
                      {{ selected.management.note }}
                    </p>
                  </div>
                  <div v-if="getValue(selected, 'comment')" class="mt-3">
                    <p class="text-[11px] font-semibold text-zinc-500">Ghi chú nguồn</p>
                    <p class="mt-1 whitespace-pre-wrap rounded-md bg-zinc-50 p-3 text-sm leading-6 text-zinc-700">
                      {{ getValue(selected, "comment") }}
                    </p>
                  </div>
                </section>
                <section class="border-b border-zinc-100 py-5">
                  <h3
                    class="flex items-center gap-2 text-xs font-bold uppercase text-zinc-400"
                  >
                    <Users class="h-4 w-4" /> Người nhận ({{
                      recipients.length
                    }})
                  </h3>
                  <div v-if="recipients.length" class="mt-3 space-y-2">
                    <article
                      v-for="(recipient, index) in recipients"
                      :key="`${recipient.userId}-${index}`"
                      class="rounded-md border border-zinc-200 p-3"
                    >
                      <p class="font-semibold text-zinc-800">
                        {{ recipient.fullName || recipient.department || "—" }}
                      </p>
                      <p class="mt-1 text-xs text-zinc-500">
                        {{ recipient.department || "—" }} ·
                        {{ recipient.role || "—" }} ·
                        {{ recipient.entityType || "—" }}
                      </p>
                    </article>
                  </div>
                  <p v-else class="mt-3 text-sm text-zinc-400">
                    Không có người nhận trong payload.
                  </p>
                </section>
                <section class="border-b border-zinc-100 py-5">
                  <h3
                    class="flex items-center gap-2 text-xs font-bold uppercase text-zinc-400"
                  >
                    <Clock3 class="h-4 w-4" /> Nhật ký xử lý ({{
                      timeline.length
                    }})
                  </h3>
                  <ol
                    v-if="timeline.length"
                    class="relative mt-4 ml-2 space-y-5 border-l border-sky-200"
                  >
                    <li
                      v-for="(entry, index) in timeline"
                      :key="index"
                      class="relative pl-6"
                    >
                      <span
                        class="absolute top-1.5 -left-[7px] h-3 w-3 rounded-full border-2 border-white bg-sky-500 shadow-sm"
                      />
                      <div
                        class="rounded-md border border-zinc-200 bg-white p-3 shadow-sm"
                      >
                        <div
                          class="flex flex-wrap items-center justify-between gap-2"
                        >
                          <p class="font-semibold text-zinc-800">
                            {{ timelineActor(entry) }}
                          </p>
                          <span class="text-xs font-medium text-zinc-500">
                            {{ timelineTime(entry) || "Chưa có thời gian" }}
                          </span>
                        </div>
                        <p
                          class="mt-2 inline-flex rounded-full px-2 py-1 text-xs font-semibold"
                          :class="
                            timelineAction(entry)
                              ? 'bg-sky-50 text-sky-700'
                              : 'bg-amber-50 text-amber-700'
                          "
                        >
                          {{ timelineAction(entry) || "Ghi chú / chỉ đạo" }}
                        </p>
                        <p
                          v-if="timelineNote(entry)"
                          class="mt-2 whitespace-pre-wrap text-sm leading-6 text-zinc-600"
                        >
                          {{ timelineNote(entry) }}
                        </p>
                        <div
                          class="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500"
                        >
                          <span v-if="entry['Mã nhật ký']"
                            >Mã nhật ký: {{ entry["Mã nhật ký"] }}</span
                          >
                          <span v-if="entry['Người nhận']"
                            >Người nhận: {{ entry["Người nhận"] }}</span
                          >
                          <span v-if="entry['Chưa xử lý']"
                            >Nhận: {{ entry["Chưa xử lý"] }}</span
                          >
                          <span v-if="entry['Đang xử lý']"
                            >Xử lý: {{ entry["Đang xử lý"] }}</span
                          >
                          <span v-if="entry['Đã xử lý']"
                            >Hoàn tất bước: {{ entry["Đã xử lý"] }}</span
                          >
                        </div>
                      </div>
                    </li>
                  </ol>
                  <p v-else class="mt-3 text-sm text-zinc-400">
                    Chưa có nhật ký xử lý.
                  </p>
                </section>
                <section v-if="sourceUrl" class="py-5">
                  <h3 class="text-xs font-bold uppercase text-zinc-400">
                    URL nguồn
                  </h3>
                  <a
                    :href="sourceUrl"
                    target="_blank"
                    rel="noreferrer"
                    class="mt-2 block break-all text-sm text-sky-700 hover:underline"
                    >{{ sourceUrl }}</a
                  >
                </section></template
              >
            </div>
          </aside>
        </div></Transition
      ></Teleport
    >
    <Pl4ImportDialog v-model:open="bulkImportOpen" @imported="fetchContexts(1, true)" />

    <Dialog v-model:open="complaintOpen">
      <DialogContent class="sm:max-w-[520px]">
        <div class="space-y-5">
          <div>
            <DialogTitle class="text-lg font-bold text-zinc-900">
              {{ complaintMode === 'request' ? 'Khiếu nại điểm / số lần làm lại' : 'Duyệt khiếu nại' }}
            </DialogTitle>
            <p class="mt-1 text-sm text-zinc-500">{{ displayIdentifier(complaintTarget) }}</p>
          </div>

          <div class="rounded-lg bg-zinc-50 px-4 py-3 text-sm">
            <span class="text-zinc-500">Hiện tại</span>
            <strong class="ml-2 text-zinc-900">
              {{ tracking(complaintTarget).score ?? 0 }} điểm ·
              {{ getValue(complaintTarget, 'reworkCount') ?? 0 }} lần làm lại
            </strong>
          </div>

          <template v-if="complaintMode === 'request'">
            <label class="grid gap-2 text-sm font-semibold text-zinc-700">
              Điểm đề xuất (bỏ trống nếu không khiếu nại điểm)
              <Input v-model="complaintForm.requestedPoint" type="number" min="0" step="0.5" class="h-10" />
            </label>
            <label class="grid gap-2 text-sm font-semibold text-zinc-700">
              Số lần làm lại đề xuất (bỏ trống nếu không khiếu nại)
              <Input v-model="complaintForm.requestedReworkCount" type="number" min="0" step="1" class="h-10" />
            </label>
            <label class="grid gap-2 text-sm font-semibold text-zinc-700">
              Lý do khiếu nại
              <Textarea v-model="complaintForm.reason" class="min-h-24 resize-none" placeholder="Nêu rõ căn cứ đề nghị điều chỉnh..." />
            </label>
          </template>

          <template v-else>
            <div class="rounded-xl border border-amber-200 bg-amber-50/70 p-4 text-sm space-y-1">
              <div class="flex items-center justify-between">
                <span class="text-xs font-bold uppercase tracking-wider text-amber-800">Đề xuất từ nhân sự</span>
                <span class="font-extrabold text-amber-900 text-sm">
                  <template v-if="complaintOf(complaintTarget)?.requestedPoint !== null">{{ complaintOf(complaintTarget)?.requestedPoint }} điểm</template>
                  <template v-if="complaintOf(complaintTarget)?.requestedPoint !== null && complaintOf(complaintTarget)?.requestedReworkCount !== null"> · </template>
                  <template v-if="complaintOf(complaintTarget)?.requestedReworkCount !== null">{{ complaintOf(complaintTarget)?.requestedReworkCount }} lần làm lại</template>
                </span>
              </div>
              <p class="text-xs text-amber-900/90 whitespace-pre-wrap pt-1">
                Lý do: {{ complaintOf(complaintTarget)?.reason || 'Không có lý do.' }}
              </p>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label v-if="complaintOf(complaintTarget)?.requestedPoint !== null" class="grid gap-1.5 text-xs font-bold text-zinc-700">
                <span>Mức điểm cuối cùng được chấp nhận</span>
                <Input v-model="complaintForm.approvedPoint" type="number" min="0" step="0.5" class="h-10 rounded-xl bg-white border-zinc-200 focus:ring-2 focus:ring-emerald-500/20" placeholder="Nhập điểm chốt" />
              </label>
              <label v-if="complaintOf(complaintTarget)?.requestedReworkCount !== null" class="grid gap-1.5 text-xs font-bold text-zinc-700">
                <span>Số lần làm lại chốt</span>
                <Input v-model="complaintForm.approvedReworkCount" type="number" min="0" step="1" class="h-10 rounded-xl bg-white border-zinc-200 focus:ring-2 focus:ring-emerald-500/20" placeholder="Nhập số lần làm lại chốt" />
              </label>
            </div>

            <label class="grid gap-1.5 text-xs font-bold text-zinc-700">
              <span>Lý do / Ý kiến quyết định (bắt buộc)</span>
              <Textarea v-model="complaintForm.note" class="min-h-24 rounded-xl border-zinc-200 resize-none" placeholder="Ghi rõ căn cứ chấp nhận hoặc từ chối..." />
            </label>
          </template>

          <p v-if="complaintError" class="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{{ complaintError }}</p>

          <div class="flex flex-wrap items-center justify-end gap-2.5 pt-2 border-t border-zinc-100">
            <Button variant="ghost" class="rounded-full font-bold" :disabled="complaintSaving" @click="complaintOpen = false">Hủy</Button>
            <template v-if="complaintMode === 'request'">
              <Button
                class="rounded-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold"
                :disabled="complaintSaving || !complaintForm.reason.trim() || (complaintForm.requestedPoint === '' && complaintForm.requestedReworkCount === '')"
                @click="submitComplaint('request')"
              >Gửi khiếu nại</Button>
            </template>
            <template v-else>
              <Button
                variant="outline"
                class="rounded-full border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 hover:text-rose-800 font-bold gap-1.5 px-5"
                :disabled="complaintSaving || !complaintForm.note.trim()"
                @click="submitComplaint('reject')"
              >
                <XCircle class="w-4 h-4 text-rose-600" />
                Từ chối khiếu nại
              </Button>
              <Button
                class="rounded-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold gap-1.5 px-5 shadow-sm"
                :disabled="complaintSaving || !complaintForm.note.trim()"
                @click="submitComplaint('accept')"
              >
                <CheckCircle2 class="w-4 h-4 text-white" />
                Chấp nhận khiếu nại
              </Button>
            </template>
          </div>
        </div>
      </DialogContent>
    </Dialog>
    <Dialog v-model:open="formOpen"
      ><DialogContent class="max-h-[calc(100vh-1rem)] w-[calc(100vw-2rem)] gap-3 overflow-y-auto p-5 sm:max-w-[760px]"
        ><DialogHeader
          ><DialogTitle>{{
            formMode === "create"
              ? user?.role?.code === "SPECIALIST"
                ? "Khai báo sản phẩm"
                : "Giao việc, khai báo công việc"
              : "Sửa nhiệm vụ / sản phẩm"
          }}</DialogTitle
          ><DialogDescription
            >{{
              productRequiresApproval && form.pageType !== "incoming"
                ? "Sản phẩm sẽ được gửi cấp có thẩm quyền duyệt trước khi tính KPI."
                : "Thông tin và phân công được quản lý trên eWork."
            }}</DialogDescription
          ></DialogHeader
        >
        <div class="space-y-4 py-1">
          <section class="space-y-2">
            <div class="grid gap-1.5 text-sm font-medium">
                  <span>Loại dữ liệu</span>
              <div :class="formMode === 'edit' ? 'pointer-events-none opacity-60' : ''">
                <SlidingTabs :tabs="availableManualTabs" v-model="form.pageType" />
              </div>
            </div>
            <div
              class="grid gap-3 sm:grid-cols-2"
              :class="form.pageType === 'outgoing_c2' ? 'md:grid-cols-3' : ''"
            >
              <label
                class="grid gap-1.5 text-sm font-medium"
                :class="form.pageType === 'outgoing_c2' ? 'sm:col-span-2 md:col-span-3' : 'sm:col-span-2'"
              >
                <span>Trích yếu *</span>
                <Textarea v-model="form.subject" rows="2" class="min-h-16 rounded-xl focus-visible:ring-0 focus-visible:ring-offset-0" />
              </label>
              <label class="grid gap-1.5 text-sm font-medium">
                <span>Số ký hiệu</span>
                <Input
                  v-model="form.soKyHieu"
                  class="rounded-xl"
                  @update:model-value="referenceEdited = true"
                />
              </label>
              <label class="grid gap-1.5 text-sm font-medium">
                <span>Độ khẩn</span>
                <Select v-model="form.priority">
                  <SelectTrigger class="h-10 rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Thường">Thường</SelectItem>
                    <SelectItem value="Gấp">Gấp</SelectItem>
                    <SelectItem value="Khẩn cấp">Khẩn cấp</SelectItem>
                  </SelectContent>
                </Select>
              </label>

              <template v-if="form.pageType === 'incoming'">
                <div class="grid gap-1.5 text-sm font-medium">
                  <span>Ngày đến</span>
                  <Popover v-model:open="receivedDatePickerOpen">
                    <PopoverTrigger as-child>
                      <Button variant="outline" class="h-10 justify-between rounded-xl px-4 font-normal">
                        <span>{{ formatManualDate(form.receivedDate) }}</span>
                        <CalendarDays class="h-4 w-4 text-zinc-500" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="start" class="w-auto rounded-xl p-0">
                      <Calendar v-model="receivedCalendarDate" locale="vi-VN" :max-value="dueCalendarDate" initial-focus />
                    </PopoverContent>
                  </Popover>
                </div>
                <div class="grid gap-1.5 text-sm font-medium">
                  <span>Hạn xử lý</span>
                  <Popover v-model:open="dueDatePickerOpen">
                    <PopoverTrigger as-child>
                      <Button variant="outline" class="h-10 justify-between rounded-xl px-4 font-normal">
                        <span>{{ formatManualDate(form.dueDate) }}</span>
                        <CalendarDays class="h-4 w-4 text-zinc-500" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="end" class="w-auto rounded-xl p-0">
                      <Calendar v-model="dueCalendarDate" locale="vi-VN" :min-value="receivedCalendarDate" initial-focus />
                    </PopoverContent>
                  </Popover>
                </div>
                <div
                  v-if="formMode === 'create' || editTarget?.origin === 'MANUAL'"
                  class="flex min-h-10 items-center justify-start gap-2.5 sm:col-span-2"
                >
                  <Switch v-model:checked="form.completed" />
                  <div class="min-w-0">
                    <p class="text-sm font-medium text-zinc-900">Đã xử lý</p>
                    <p class="text-xs text-zinc-500">Đánh dấu văn bản đến đã hoàn tất.</p>
                  </div>
                </div>
              </template>

              <template v-else>
                <div class="grid gap-1.5 text-sm font-medium">
                  <span>Ngày tạo</span>
                  <Popover v-model:open="createdDatePickerOpen">
                    <PopoverTrigger as-child>
                      <Button variant="outline" class="h-10 justify-between rounded-xl px-4 font-normal">
                        <span>{{ formatManualDate(form.createdDate) }}</span>
                        <CalendarDays class="h-4 w-4 text-zinc-500" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="start" class="w-auto rounded-xl p-0">
                      <Calendar v-model="createdCalendarDate" locale="vi-VN" initial-focus />
                    </PopoverContent>
                  </Popover>
                </div>
                <label v-if="form.pageType === 'outgoing_c2'" class="grid gap-1.5 text-sm font-medium">
                  <span>Hình thức</span>
                  <Input v-model="form.documentForm" class="rounded-xl" />
                </label>
                <label class="grid gap-1.5 text-sm font-medium">
                  <span>Nhiệm vụ liên quan</span>
                  <Input v-model="form.relatedIncomingSoKyHieu" class="rounded-xl" placeholder="Số ký hiệu nhiệm vụ" />
                </label>
                <div
                  v-if="form.relatedIncomingSoKyHieu"
                  class="sm:col-span-2 md:col-span-3"
                >
                  <div
                    v-if="relatedTaskLoading"
                    class="flex items-center gap-2 rounded-lg bg-zinc-50 px-3 py-2 text-sm text-zinc-500"
                  >
                    <Loader2 class="h-4 w-4 animate-spin" />
                    Đang kiểm tra nhiệm vụ...
                  </div>
                  <div
                    v-else-if="relatedTask"
                    class="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2"
                  >
                    <p class="text-sm font-semibold text-emerald-800">
                      {{ relatedTask.soKyHieu }}
                    </p>
                    <p class="mt-0.5 line-clamp-2 text-xs text-emerald-700">
                      {{ relatedTask.subject }}
                    </p>
                  </div>
                  <div
                    v-else-if="relatedTaskError && isUnchangedRelatedSymbol"
                    class="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
                  >
                    Nhiệm vụ này chưa có trong eWork nên không hiển thị được chi tiết. Bạn vẫn lưu được các thay đổi khác.
                  </div>
                  <div
                    v-else-if="relatedTaskError"
                    class="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
                  >
                    {{ relatedTaskError }}
                  </div>
                </div>
                <label
                  class="grid gap-1.5 text-sm font-medium"
                  :class="form.pageType === 'outgoing_c2' ? 'sm:col-span-2 md:col-span-3' : 'sm:col-span-2'"
                >
                  <span>Đơn vị soạn thảo</span>
                  <Select v-model="formDraftingUnitValue">
                    <SelectTrigger class="h-10 rounded-xl"><SelectValue placeholder="Chọn đơn vị soạn thảo" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none_drafting_unit__">Chọn đơn vị soạn thảo</SelectItem>
                      <SelectItem v-for="department in departments" :key="department._id" :value="department._id">{{ department.name }}</SelectItem>
                    </SelectContent>
                  </Select>
                </label>
              </template>
            </div>
          </section>

          <section class="border-t border-zinc-100 pt-3">
            <p class="text-xs font-bold uppercase text-zinc-400">Phân công và KPI</p>
            <div class="mt-2 grid gap-3 sm:grid-cols-2">
              <label class="grid gap-1.5 text-sm font-medium">
                <span>Đơn vị phụ trách</span>
                <div
                  v-if="relatedTask"
                  class="flex h-10 items-center rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-700"
                >
                  {{ relatedTask.assignee?.departmentName || "Chưa gán phòng ban" }}
                </div>
                <div
                  v-else-if="user?.role?.code === 'SPECIALIST'"
                  class="flex h-10 items-center rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-700"
                >
                  {{ currentDepartmentName || "Phòng ban của bạn" }}
                </div>
                <Select v-else v-model="formDepartmentValue">
                  <SelectTrigger class="h-10 rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none_department__">Chưa phân công</SelectItem>
                    <SelectItem v-for="department in departments" :key="department._id" :value="department._id">{{ department.name }}</SelectItem>
                  </SelectContent>
                </Select>
              </label>
              <label class="grid gap-1.5 text-sm font-medium">
                <span>{{ form.pageType === "incoming" ? "Người làm" : "Người soạn thảo" }}</span>
                <div
                  v-if="relatedTask"
                  class="flex h-10 items-center rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-sm font-medium text-zinc-700"
                >
                  {{ relatedTask.assignee?.fullName || "Nhiệm vụ chưa gán người làm" }}
                </div>
                <div
                  v-else-if="user?.role?.code === 'SPECIALIST'"
                  class="flex h-10 items-center rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-sm font-medium text-zinc-700"
                >
                  {{ user?.fullName }}
                </div>
                <Select v-else v-model="formUserValue">
                  <SelectTrigger class="h-10 rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none_user__">Chưa phân công</SelectItem>
                    <SelectItem v-for="person in users.filter((person) => !form.departmentId || String(person.department?._id || person.department || '') === String(form.departmentId))" :key="person._id" :value="person._id">{{ person.fullName }}</SelectItem>
                  </SelectContent>
                </Select>
              </label>
              <label class="grid gap-1.5 text-sm font-medium">
                <span>Điểm</span>
                <Input v-model="form.manualScore" type="number" min="0" step="0.5" class="h-10 rounded-xl" />
                <span v-if="relatedTask" class="text-xs font-normal text-zinc-500">
                  KPI lấy {{ relatedTask.point ?? 0 }} điểm từ nhiệm vụ liên quan.
                </span>
              </label>
              <label class="grid gap-1.5 text-sm font-medium">
                <span>Lần làm lại</span>
                <Input
                  :model-value="form.reworkCount"
                  type="number"
                  min="0"
                  step="1"
                  inputmode="numeric"
                  class="h-10 rounded-xl"
                  @update:model-value="updateReworkCount"
                />
              </label>
              <label class="grid gap-1.5 text-sm font-medium">
                <span>Ghi chú nguồn</span>
                <Input v-model="form.note" class="rounded-xl" />
              </label>
              <label class="grid gap-1.5 text-sm font-medium">
                <span>Ghi chú quản lý</span>
                <Textarea v-model="form.managementNote" rows="1" class="min-h-10 rounded-xl focus-visible:ring-0 focus-visible:ring-offset-0" />
              </label>
            </div>
          </section>
        </div>
        <p v-if="formError" class="text-sm font-medium text-rose-600">
          {{ formError }}
        </p>
        <DialogFooter
          ><Button
            variant="outline"
            :disabled="saving"
            @click="formOpen = false"
            >Hủy</Button
          ><Button
            :disabled="saving"
            class="bg-sky-600 text-white hover:bg-sky-700"
            @click="saveContext"
            ><Loader2 v-if="saving" class="mr-2 h-4 w-4 animate-spin" />{{
              formMode === "create" && form.pageType !== "incoming" && productRequiresApproval
                ? "Lưu và gửi duyệt"
                : formMode === "create"
                  ? "Lưu"
                  : "Lưu thay đổi"
            }}</Button
          ></DialogFooter
        ></DialogContent
      ></Dialog
    >
    <Dialog v-model:open="approvalOpen">
      <DialogContent
        class="h-[min(780px,calc(100vh-2rem))] w-[calc(100vw-2rem)] grid-rows-[auto_auto_minmax(0,1fr)_auto] overflow-hidden p-0 sm:max-w-[1040px]"
      >
        <DialogHeader class="border-b border-zinc-200 px-6 py-5">
          <DialogTitle>Duyệt sản phẩm xử lý</DialogTitle>
          <DialogDescription>
            Kiểm tra sản phẩm, người thực hiện và KPI trước khi xác nhận.
          </DialogDescription>
        </DialogHeader>
        <div class="px-6 pt-4">
          <SlidingTabs :tabs="APPROVAL_TABS" v-model="approvalTab" />
        </div>
        <div
          class="grid min-h-0 grid-cols-1 grid-rows-[minmax(0,0.8fr)_minmax(0,1.2fr)] gap-0 overflow-hidden md:grid-cols-[320px_minmax(0,1fr)] md:grid-rows-1"
        >
          <div class="min-h-0 overflow-y-auto border-b border-zinc-200 p-4 md:border-b-0 md:border-r">
            <div v-if="approvalLoading" class="space-y-2">
              <div
                v-for="index in 5"
                :key="index"
                class="h-20 animate-pulse rounded-lg bg-zinc-100"
              />
            </div>
            <div v-else-if="approvalItems.length" class="space-y-2">
              <button
                v-for="link in approvalItems"
                :key="link._id"
                type="button"
                class="w-full rounded-lg border p-3 text-left transition-colors"
                :class="
                  String(link._id) === String(approvalSelected?._id)
                    ? 'border-sky-300 bg-sky-50'
                    : 'border-zinc-200 hover:bg-zinc-50'
                "
                @click="approvalSelectedId = String(link._id)"
              >
                <div class="flex items-start justify-between gap-2">
                  <p class="font-semibold text-zinc-900">
                    {{ displayIdentifier(link.outgoingDocument) }}
                  </p>
                  <Badge
                    :variant="resultStatusVariant(link.status)"
                    class="shrink-0 rounded-full"
                  >
                    {{ resultStatusLabel(link.status) }}
                  </Badge>
                </div>
                <p class="mt-1 line-clamp-2 text-xs leading-5 text-zinc-600">
                  {{ getValue(link.outgoingDocument, "subject") }}
                </p>
                <p class="mt-2 text-xs text-zinc-400">
                  {{
                    link.performedBy?.fullName
                      || link.submittedBy?.fullName
                      || "—"
                  }}
                </p>
              </button>
            </div>
            <p v-else class="py-12 text-center text-sm text-zinc-400">
              {{
                approvalTab === "pending"
                  ? "Không có sản phẩm chờ bạn duyệt."
                  : "Chưa có lịch sử duyệt."
              }}
            </p>
          </div>

          <div class="min-h-0 overflow-y-auto p-5">
            <template v-if="approvalSelected">
              <section>
                <div class="flex items-center gap-2 text-xs font-bold uppercase text-zinc-400">
                  <FileText class="h-4 w-4" />
                  {{
                    approvalSelected.incomingDocument
                      ? "Nhiệm vụ nguồn"
                      : "Nguồn công việc"
                  }}
                </div>
                <template v-if="approvalSelected.incomingDocument">
                  <p class="mt-3 font-bold text-zinc-900">
                    {{ displayIdentifier(approvalSelected.incomingDocument) }}
                  </p>
                  <p class="mt-1 text-sm leading-6 text-zinc-600">
                    {{ getValue(approvalSelected.incomingDocument, "subject") }}
                  </p>
                </template>
                <p v-else class="mt-3 text-sm leading-6 text-zinc-600">
                  Sản phẩm do nhân sự tự khai báo, không gắn với nhiệm vụ có sẵn.
                </p>
              </section>
              <section class="mt-5 border-t border-zinc-100 pt-5">
                <div class="flex items-center gap-2 text-xs font-bold uppercase text-zinc-400">
                  <Send class="h-4 w-4" />
                  Sản phẩm nộp
                </div>
                <p class="mt-3 font-bold text-zinc-900">
                  {{ displayIdentifier(approvalSelected.outgoingDocument) }}
                </p>
                <p class="mt-1 text-sm leading-6 text-zinc-600">
                  {{ getValue(approvalSelected.outgoingDocument, "subject") }}
                </p>
                <dl class="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
                  <div>
                    <dt class="text-zinc-400">Người khai báo</dt>
                    <dd class="mt-1 font-medium text-zinc-800">
                      {{ approvalSelected.submittedBy?.fullName || "—" }}
                    </dd>
                  </div>
                  <div>
                    <dt class="text-zinc-400">Người thực hiện</dt>
                    <dd class="mt-1 font-medium text-zinc-800">
                      {{
                        approvalSelected.performedBy?.fullName
                          || approvalSelected.submittedBy?.fullName
                          || "—"
                      }}
                    </dd>
                  </div>
                  <div>
                    <dt class="text-zinc-400">Thời điểm nộp</dt>
                    <dd class="mt-1 font-medium text-zinc-800">
                      {{ formatDateTime(approvalSelected.submittedAt) }}
                    </dd>
                  </div>
                </dl>
              </section>
              <section class="mt-5 border-t border-zinc-100 pt-5">
                <h3 class="text-xs font-bold uppercase text-zinc-400">
                  Lịch sử duyệt
                </h3>
                <ol class="mt-3 space-y-3">
                  <li
                    v-for="(entry, index) in approvalSelected.approval?.history || []"
                    :key="`${entry.actedAt}-${index}`"
                    class="border-l-2 border-zinc-200 pl-3"
                  >
                    <p class="text-sm font-semibold text-zinc-800">
                      {{ approvalActionLabel(entry.action) }}
                    </p>
                    <p class="mt-0.5 text-xs text-zinc-500">
                      {{ historyActorLabel(entry) }} ·
                      {{ formatDateTime(entry.actedAt) }}
                    </p>
                    <p v-if="entry.note" class="mt-1 text-sm text-zinc-600">
                      {{ entry.note }}
                    </p>
                  </li>
                </ol>
              </section>
              <section
                v-if="approvalTab === 'pending'"
                class="sticky bottom-0 z-10 -mx-5 mt-5 space-y-3 border-t border-zinc-100 bg-white px-5 py-4"
              >
                <Textarea
                  v-model="approvalNote"
                  rows="2"
                  class="rounded-xl"
                  placeholder="Ý kiến duyệt hoặc lý do trả lại/chuyển duyệt"
                />
                <Select
                  v-if="approvalMeta.approvers?.length"
                  v-model="approvalApproverId"
                >
                  <SelectTrigger class="h-10 rounded-xl">
                    <SelectValue placeholder="Chọn người để chuyển duyệt" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem
                      v-for="approver in approvalMeta.approvers"
                      :key="approver.id"
                      :value="approver.id"
                    >
                      {{ approver.fullName }} · {{ approver.position }}
                    </SelectItem>
                  </SelectContent>
                </Select>
                <div class="flex flex-wrap justify-end gap-2">
                  <Button
                    variant="outline"
                    :disabled="approvalSaving"
                    @click="decideResult('return')"
                  >
                    Trả lại
                  </Button>
                  <Button
                    v-if="approvalMeta.approvers?.length"
                    variant="outline"
                    :disabled="approvalSaving"
                    @click="decideResult('forward')"
                  >
                    <ArrowUpRight class="mr-2 h-4 w-4" />
                    Chuyển duyệt
                  </Button>
                  <Button
                    class="bg-emerald-600 text-white hover:bg-emerald-700"
                    :disabled="approvalSaving"
                    @click="decideResult('approve')"
                  >
                    <Loader2
                      v-if="approvalSaving"
                      class="mr-2 h-4 w-4 animate-spin"
                    />
                    Duyệt
                  </Button>
                </div>
              </section>
            </template>
          </div>
        </div>
        <p
          v-if="approvalError"
          class="border-t border-rose-100 bg-rose-50 px-6 py-3 text-sm font-medium text-rose-700"
        >
          {{ approvalError }}
        </p>
      </DialogContent>
    </Dialog>
    <Dialog v-model:open="deleteOpen"
      ><DialogContent class="sm:max-w-[420px]"
        ><DialogHeader
          ><DialogTitle>Xóa văn bản?</DialogTitle
          ><DialogDescription
            >Văn bản sẽ bị xóa khỏi eWork. Với văn bản extension, payload gửi
            lại có thể tạo lại bản ghi.</DialogDescription
          ></DialogHeader
        >
        <p v-if="formError" class="text-sm font-medium text-rose-600">
          {{ formError }}
        </p>
        <DialogFooter
          ><Button
            variant="outline"
            :disabled="saving"
            @click="deleteOpen = false"
            >Hủy</Button
          ><Button
            variant="destructive"
            :disabled="saving"
            @click="deleteContext"
            ><Loader2 v-if="saving" class="mr-2 h-4 w-4 animate-spin" />Xóa văn
            bản</Button
          ></DialogFooter
        ></DialogContent
      ></Dialog
    >
  </section>
</template>

<style scoped>
.office-context-drawer-enter-active,
.office-context-drawer-leave-active {
  transition: opacity 180ms ease;
}
.office-context-drawer-enter-active > aside,
.office-context-drawer-leave-active > aside {
  transition: transform 240ms cubic-bezier(0.22, 1, 0.36, 1);
}
.office-context-drawer-enter-from,
.office-context-drawer-leave-to {
  opacity: 0;
}
.office-context-drawer-enter-from > aside,
.office-context-drawer-leave-to > aside {
  transform: translateX(100%);
}
</style>
