<script setup>
import { computed, onMounted, reactive, ref, watch } from "vue";
import {
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileText,
  Pencil,
  Plus,
  Loader2,
  RefreshCw,
  Search,
  Send,
  Trash2,
  Users,
  X,
} from "lucide-vue-next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import SlidingTabs from "@/components/ui/sliding-tabs/SlidingTabs.vue";
import { http } from "@/shared/api/http";
import { useAuth } from "@/features/auth/composables/useAuth";

const activeTab = ref("incoming");
const loading = ref(false);
const detailLoading = ref(false);
const error = ref(null);
const items = ref([]);
const departments = ref([]);
const users = ref([]);
const selected = ref(null);
const formOpen = ref(false);
const deleteOpen = ref(false);
const formMode = ref("create");
const saving = ref(false);
const contextToDelete = ref(null);
const formError = ref("");
const search = ref("");
const filters = reactive({
  departmentId: "",
  userId: "",
  deadlineStatuses: [],
  dateField: "observed",
  dateFrom: "",
  dateTo: "",
});
const pagination = ref({ page: 1, limit: 25, total: 0, totalPages: 1 });
const TABS = [
  { id: "incoming", label: "Văn bản đến", icon: FileText },
  { id: "outgoing", label: "Văn bản đi", icon: Send },
];
let searchTimer = null;
let listRequestSequence = 0;
let detailRequestSequence = 0;
const { user, loadMe } = useAuth();
const canManage = computed(() =>
  ["ADMIN", "OFFICE_CHIEF", "COMMUNE_LEADER", "DEPARTMENT_LEADER"].includes(
    user.value?.role?.code,
  ),
);
const usersForFilter = computed(() =>
  users.value.filter(
    (person) =>
      !filters.departmentId ||
      String(person.department?._id || person.department || "") ===
        String(filters.departmentId),
  ),
);
const blankForm = () => ({
  pageType: activeTab.value === "incoming" ? "incoming" : "outgoing",
  documentId: "",
  subject: "",
  soKyHieu: "",
  receivedDate: "",
  dueDate: "",
  priority: "",
  draftingUnit: "",
  note: "",
  departmentId: "",
  userId: "",
  manualScore: "",
  managementNote: "",
});
const form = ref(blankForm());

const tabConfig = computed(() =>
  activeTab.value === "incoming"
    ? {
        icon: FileText,
        pageType: "incoming",
        empty: "Chưa có ngữ cảnh văn bản đến từ extension.",
        sourceLabel: "Văn bản đến",
      }
    : {
        icon: Send,
        pageType: "outgoing,outgoing_c2",
        empty: "Chưa có ngữ cảnh văn bản đi từ extension.",
        sourceLabel: "Văn bản đi",
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
const displayIdentifier = (context) =>
  getValue(context, "soKyHieu") || getValue(context, "documentId") || "—";
const contextType = (context) =>
  getValue(context, "pageType") || context?.pageType || "—";
const typeLabel = (context) =>
  ({
    incoming: "Văn bản đến",
    outgoing: "Văn bản đi",
    outgoing_c2: "Dự thảo C2",
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
    ...(filters.dateField ? { dateField: filters.dateField } : {}),
    ...(filters.dateFrom ? { dateFrom: filters.dateFrom } : {}),
    ...(filters.dateTo ? { dateTo: filters.dateTo } : {}),
  }).toString();

const fetchContexts = async (page = 1, keepSelection = false) => {
  const requestSequence = ++listRequestSequence;
  loading.value = true;
  error.value = null;
  try {
    const response = await http(
      `/api/office-document-contexts?${queryString(page)}`,
    );
    if (requestSequence !== listRequestSequence) return;
    items.value = response.data ?? [];
    pagination.value = response.pagination ?? pagination.value;
    if (!keepSelection) selected.value = null;
  } catch (requestError) {
    if (requestSequence !== listRequestSequence) return;
    error.value =
      requestError.message || "Không thể tải dữ liệu ngữ cảnh văn bản.";
    items.value = [];
    if (!keepSelection) selected.value = null;
  } finally {
    if (requestSequence === listRequestSequence) loading.value = false;
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
      selected.value = response.data ?? context;
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

const closeContext = () => {
  detailRequestSequence += 1;
  detailLoading.value = false;
  selected.value = null;
};

const tracking = (context) => context?.tracking || {};
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
    ? recipientsLabel(context) || "Chưa có người nhận"
    : getValue(context, "draftingUser") || "Chưa có người soạn thảo";
const workflowLabel = (context) =>
  tracking(context).statusLabel || "Chưa đồng bộ trạng thái";

const fetchFilterOptions = async () => {
  if (!canManage.value) return;
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

const openCreate = () => {
  formMode.value = "create";
  formError.value = "";
  form.value = blankForm();
  formOpen.value = true;
};

const openEdit = (context) => {
  formMode.value = "edit";
  formError.value = "";
  selected.value = context;
  form.value = {
    pageType: context.pageType,
    documentId: context.externalDocumentId || "",
    subject: getValue(context, "subject"),
    soKyHieu: getValue(context, "soKyHieu"),
    receivedDate: getValue(context, "receivedDate"),
    dueDate: getValue(context, "dueDate"),
    priority: getValue(context, "priority"),
    draftingUnit: getValue(context, "draftingUnit"),
    note: getValue(context, "note"),
    departmentId: context.management?.assignment?.departmentId || "",
    userId: context.management?.assignment?.userId || "",
    manualScore: context.management?.manualScore ?? "",
    managementNote: context.management?.note || "",
  };
  formOpen.value = true;
};

const saveContext = async () => {
  if (!form.value.subject.trim()) {
    formError.value = "Trích yếu văn bản là bắt buộc.";
    return;
  }
  saving.value = true;
  formError.value = "";
  try {
    const payload = { ...form.value };
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
      await http(`/api/office-document-contexts/${identity(selected.value)}`, {
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
    await fetchContexts(1, formMode.value === "edit");
    if (formMode.value === "edit") await openContext(selected.value);
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
          "Văn bản đến liên quan",
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

watch(activeTab, () => {
  filters.deadlineStatuses = [];
  if (
    activeTab.value === "outgoing" &&
    ["due", "received", "synced", "completed"].includes(filters.dateField)
  ) {
    filters.dateField = "observed";
  }
  fetchContexts(1);
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
watch(filters, () => fetchContexts(1), { deep: true });
onMounted(async () => {
  await loadMe().catch(() => null);
  await fetchFilterOptions();
  fetchContexts();
});
</script>

<template>
  <section class="h-full overflow-auto bg-zinc-50/60">
    <header class="border-b border-zinc-200/70 bg-white px-4 py-4 sm:px-6">
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
            v-if="canManage"
            class="bg-sky-600 text-white hover:bg-sky-700"
            @click="openCreate"
            ><Plus class="mr-2 h-4 w-4" /> Thêm văn bản</Button
          >
          <Button
            class="bg-zinc-900 text-white hover:bg-zinc-700"
            :disabled="loading"
            @click="fetchContexts(pagination.page, true)"
          >
            <Loader2 v-if="loading" class="mr-2 h-4 w-4 animate-spin" />
            <RefreshCw v-else class="mr-2 h-4 w-4" /> Tải lại
          </Button>
        </div>
      </div>
    </header>

    <main class="mx-auto w-full max-w-[1560px] px-4 py-5 sm:px-6">
      <div class="space-y-4">
        <div
          class="flex flex-col justify-start gap-4 md:flex-row md:items-center"
        >
          <div class="shrink-0">
            <SlidingTabs :tabs="TABS" v-model="activeTab" />
          </div>
          <div class="relative w-full md:w-[360px]">
            <Search
              class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400"
            />
            <Input
              v-model="search"
              class="h-10 rounded-full border-zinc-200 pl-9 pr-4 shadow-sm"
              placeholder="Tìm mã, số ký hiệu, trích yếu hoặc đơn vị..."
            />
          </div>
        </div>

        <div
          class="grid gap-3 rounded-md border border-zinc-200 bg-white p-3 lg:grid-cols-[minmax(180px,1fr)_minmax(180px,1fr)_minmax(160px,1fr)_150px_150px]"
        >
          <select
            v-model="filters.departmentId"
            class="h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm"
          >
            <option value="">Tất cả đơn vị</option>
            <option
              v-for="department in departments"
              :key="department._id"
              :value="department._id"
            >
              {{ department.name }}
            </option>
          </select>
          <select
            v-model="filters.userId"
            class="h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm"
          >
            <option value="">Tất cả người làm</option>
            <option
              v-for="person in usersForFilter"
              :key="person._id"
              :value="person._id"
            >
              {{ person.fullName }}
            </option>
          </select>
          <select
            v-model="filters.dateField"
            class="h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm"
          >
            <option value="observed">Thời gian ghi nhận</option>
            <option v-if="activeTab === 'incoming'" value="due">
              Hạn xử lý
            </option>
            <option v-if="activeTab === 'incoming'" value="received">
              Ngày đến
            </option>
            <option value="created">Ngày tạo</option>
            <option v-if="activeTab === 'incoming'" value="synced">
              Lần đồng bộ
            </option>
            <option v-if="activeTab === 'incoming'" value="completed">
              Ngày hoàn tất
            </option>
          </select>
          <Input v-model="filters.dateFrom" type="date" title="Từ ngày" />
          <Input v-model="filters.dateTo" type="date" title="Đến ngày" />
          <div
            v-if="activeTab === 'incoming'"
            class="flex flex-wrap gap-x-4 gap-y-2 text-xs font-medium text-zinc-700 lg:col-span-5"
          >
            <label
              v-for="status in [
                { id: 'DONE_ON_TIME', label: 'Đã làm đúng hạn' },
                { id: 'DONE_LATE', label: 'Đã làm chậm hạn' },
                { id: 'PENDING_IN_TIME', label: 'Chưa làm còn hạn' },
                { id: 'PENDING_OVERDUE', label: 'Chưa làm quá hạn' },
              ]"
              :key="status.id"
              class="flex items-center gap-2"
              ><input
                v-model="filters.deadlineStatuses"
                type="checkbox"
                :value="status.id"
                class="h-4 w-4 rounded border-zinc-300 text-sky-600"
              />{{ status.label }}</label
            >
          </div>
        </div>

        <div
          v-if="error"
          class="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700"
        >
          {{ error }}
        </div>

        <section
          class="overflow-hidden rounded-md border border-zinc-200 bg-white shadow-sm"
        >
          <div v-if="loading" class="space-y-3 p-5">
            <div
              v-for="index in 6"
              :key="index"
              class="h-14 animate-pulse rounded-md bg-zinc-100"
            />
          </div>
          <div v-else-if="items.length" class="overflow-x-auto">
            <table class="w-full min-w-[1120px] text-sm">
              <thead
                class="border-b border-zinc-100 bg-zinc-50 text-left text-xs font-semibold text-zinc-500"
              >
                <tr>
                  <th class="px-4 py-3">Văn bản</th>
                  <th v-if="activeTab === 'incoming'" class="px-4 py-3">Hạn</th>
                  <th v-if="activeTab === 'incoming'" class="px-4 py-3">
                    Tình trạng hạn
                  </th>
                  <th class="px-4 py-3">Người làm</th>
                  <th v-if="activeTab === 'incoming'" class="px-4 py-3">
                    Trạng thái
                  </th>
                  <th class="px-4 py-3">Điểm</th>
                  <th class="px-4 py-3">Lần làm lại</th>
                  <th class="px-4 py-3">Độ khẩn</th>
                  <th class="px-4 py-3">Ghi nhận lúc</th>
                  <th v-if="canManage" class="px-4 py-3 text-right">
                    Thao tác
                  </th>
                </tr>
              </thead>
              <tbody class="divide-y divide-zinc-100">
                <tr
                  v-for="context in items"
                  :key="identity(context)"
                  class="cursor-pointer hover:bg-sky-50/40"
                  :class="
                    identity(selected) === identity(context)
                      ? 'bg-sky-50/70'
                      : ''
                  "
                  @click="openContext(context)"
                >
                  <td class="max-w-[460px] px-4 py-3">
                    <div class="flex items-start gap-2">
                      <component
                        :is="tabConfig.icon"
                        class="mt-0.5 h-4 w-4 shrink-0 text-sky-600"
                      />
                      <div class="min-w-0">
                        <strong class="block text-zinc-900">{{
                          displayIdentifier(context)
                        }}</strong>
                        <p
                          class="mt-1 line-clamp-2 text-xs leading-5 text-zinc-600"
                        >
                          {{
                            getValue(context, "subject") ||
                            "Không có trích yếu."
                          }}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td
                    v-if="activeTab === 'incoming'"
                    class="whitespace-nowrap px-4 py-3 text-zinc-600"
                  >
                    {{ getValue(context, "dueDate") || "—" }}
                  </td>
                  <td v-if="activeTab === 'incoming'" class="px-4 py-3">
                    <span
                      class="whitespace-nowrap rounded-full border px-2 py-1 text-xs font-semibold"
                      :class="deadlineClass(context)"
                      >{{ deadlineLabel(context) }}</span
                    >
                  </td>
                  <td class="px-4 py-3 text-zinc-700">
                    {{ assigneeLabel(context) }}
                  </td>
                  <td
                    v-if="activeTab === 'incoming'"
                    class="max-w-[240px] px-4 py-3 text-zinc-700"
                  >
                    {{ workflowLabel(context) }}
                  </td>
                  <td class="px-4 py-3 font-semibold text-zinc-700">
                    {{ tracking(context).score ?? "—" }}
                  </td>
                  <td class="px-4 py-3 text-zinc-700">
                    {{ getValue(context, "reworkCount") ?? 0 }}
                  </td>
                  <td class="px-4 py-3 text-zinc-600">
                    {{ getValue(context, "priority") || "—" }}
                  </td>
                  <td class="whitespace-nowrap px-4 py-3 text-zinc-600">
                    {{ formatCapturedAt(context) }}
                  </td>
                  <td v-if="canManage" class="px-4 py-3 text-right">
                    <div class="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        class="h-8 w-8 text-zinc-500 hover:text-sky-700"
                        title="Sửa"
                        @click.stop="openEdit(context)"
                        ><Pencil class="h-4 w-4" /></Button
                      ><Button
                        variant="ghost"
                        size="icon"
                        class="h-8 w-8 text-zinc-500 hover:text-rose-700"
                        title="Xóa"
                        @click.stop="askDelete(context)"
                        ><Trash2 class="h-4 w-4"
                      /></Button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
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
                  v-if="canManage"
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
              <template v-else
                ><section class="border-b border-zinc-100 pb-5">
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
                <section
                  v-if="getValue(selected, 'comment')"
                  class="border-b border-zinc-100 py-5"
                >
                  <h3 class="text-xs font-bold uppercase text-zinc-400">
                    Ghi chú nguồn
                  </h3>
                  <p
                    class="mt-3 whitespace-pre-wrap rounded-md bg-zinc-50 p-3 text-sm leading-6 text-zinc-700"
                  >
                    {{ getValue(selected, "comment") }}
                  </p>
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
    <Dialog v-model:open="formOpen"
      ><DialogContent class="max-h-[92vh] overflow-y-auto sm:max-w-[620px]"
        ><DialogHeader
          ><DialogTitle>{{
            formMode === "create" ? "Thêm văn bản thủ công" : "Sửa văn bản"
          }}</DialogTitle
          ><DialogDescription
            >Thông tin nguồn và phân công/điểm thủ công được quản lý trên eWork;
            extension không nhận thêm trường nào.</DialogDescription
          ></DialogHeader
        >
        <div class="grid gap-4 py-2 sm:grid-cols-2">
          <label class="grid gap-1.5 text-sm font-medium"
            ><span>Loại văn bản</span
            ><select
              v-model="form.pageType"
              :disabled="formMode === 'edit'"
              class="h-10 rounded-md border border-zinc-200 bg-white px-3 disabled:bg-zinc-100"
            >
              <option value="incoming">Văn bản đến</option>
              <option value="outgoing">Văn bản đi</option>
            </select></label
          ><label class="grid gap-1.5 text-sm font-medium"
            ><span>Mã văn bản nguồn</span
            ><Input
              v-model="form.documentId"
              :disabled="formMode === 'edit'"
              placeholder="Để trống để tự sinh" /></label
          ><label class="grid gap-1.5 text-sm font-medium sm:col-span-2"
            ><span>Trích yếu *</span
            ><Textarea v-model="form.subject" rows="3" /></label
          ><label class="grid gap-1.5 text-sm font-medium"
            ><span>Số ký hiệu</span><Input v-model="form.soKyHieu" /></label
          ><label class="grid gap-1.5 text-sm font-medium"
            ><span>Ngày đến</span
            ><Input
              v-model="form.receivedDate"
              placeholder="dd/mm/yyyy" /></label
          ><label class="grid gap-1.5 text-sm font-medium"
            ><span>Hạn xử lý</span
            ><Input v-model="form.dueDate" placeholder="dd/mm/yyyy" /></label
          ><label class="grid gap-1.5 text-sm font-medium"
            ><span>Độ khẩn</span><Input v-model="form.priority" /></label
          ><label class="grid gap-1.5 text-sm font-medium sm:col-span-2"
            ><span>Đơn vị soạn thảo</span><Input v-model="form.draftingUnit"
          /></label>
          <div class="sm:col-span-2 border-t border-zinc-100 pt-4">
            <p class="text-xs font-bold uppercase text-zinc-400">
              Quản lý thủ công
            </p>
          </div>
          <label class="grid gap-1.5 text-sm font-medium"
            ><span>Đơn vị phụ trách</span
            ><select
              v-model="form.departmentId"
              class="h-10 rounded-md border border-zinc-200 bg-white px-3"
            >
              <option value="">Chưa phân công</option>
              <option
                v-for="department in departments"
                :key="department._id"
                :value="department._id"
              >
                {{ department.name }}
              </option>
            </select></label
          ><label class="grid gap-1.5 text-sm font-medium"
            ><span>Người làm</span
            ><select
              v-model="form.userId"
              class="h-10 rounded-md border border-zinc-200 bg-white px-3"
            >
              <option value="">Chưa phân công</option>
              <option
                v-for="person in users.filter(
                  (person) =>
                    !form.departmentId ||
                    String(
                      person.department?._id || person.department || '',
                    ) === String(form.departmentId),
                )"
                :key="person._id"
                :value="person._id"
              >
                {{ person.fullName }}
              </option>
            </select></label
          ><label class="grid gap-1.5 text-sm font-medium"
            ><span>Điểm thủ công</span
            ><Input
              v-model="form.manualScore"
              type="number"
              min="0"
              step="0.5" /></label
          ><label class="grid gap-1.5 text-sm font-medium"
            ><span>Ghi chú nguồn</span><Input v-model="form.note" /></label
          ><label class="grid gap-1.5 text-sm font-medium sm:col-span-2"
            ><span>Ghi chú quản lý</span
            ><Textarea v-model="form.managementNote" rows="3"
          /></label>
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
              formMode === "create" ? "Thêm văn bản" : "Lưu thay đổi"
            }}</Button
          ></DialogFooter
        ></DialogContent
      ></Dialog
    >
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
