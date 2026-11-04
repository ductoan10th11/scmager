<script setup>
import { computed } from "vue";
import { Ban, CheckCircle2, Clock3, RotateCcw, XCircle } from "lucide-vue-next";
import { Button } from "@/components/ui/button";
import { notRequiredOf, notRequiredStatus } from "../composables/useNotRequired";

const props = defineProps({
  context: { type: Object, default: null },
  canCancel: { type: Boolean, default: false },
  canDecide: { type: Boolean, default: false },
  canRestore: { type: Boolean, default: false },
});
const emit = defineEmits(["action"]);

const STATUS = {
  PENDING: { label: "Chờ lãnh đạo xem xét", box: "border-amber-300/80 bg-amber-50/50", badge: "bg-amber-100 text-amber-900 border-amber-300", icon: Clock3 },
  CONFIRMED: { label: "Đã xác nhận không cần làm", box: "border-zinc-300 bg-zinc-50/70", badge: "bg-zinc-100 text-zinc-800 border-zinc-300", icon: Ban },
  REJECTED: { label: "Lãnh đạo từ chối đề nghị", box: "border-rose-300/80 bg-rose-50/50", badge: "bg-rose-100 text-rose-900 border-rose-300", icon: XCircle },
  CANCELLED: { label: "Đề nghị đã hủy", box: "border-zinc-300 bg-zinc-50/70", badge: "bg-zinc-100 text-zinc-800 border-zinc-300", icon: XCircle },
  // A restored document is back to normal; only its history is left to show.
  NONE: { label: "Đã khôi phục", box: "border-emerald-300/80 bg-emerald-50/50", badge: "bg-emerald-100 text-emerald-900 border-emerald-300", icon: CheckCircle2 },
};

const HISTORY_LABELS = {
  REQUESTED: "Đề nghị",
  CONFIRMED: "Xác nhận không cần làm",
  REJECTED: "Từ chối",
  CANCELLED: "Hủy đề nghị",
  RESTORED: "Khôi phục",
};

const state = computed(() => notRequiredOf(props.context));
const status = computed(() => STATUS[notRequiredStatus(props.context)] ?? STATUS.NONE);
const history = computed(() => state.value?.history ?? []);
const visible = computed(() => notRequiredStatus(props.context) !== "NONE" || history.value.length > 0);
const kpiHint = computed(() => ({
  PENDING: "Chưa tính vào KPI cho đến khi lãnh đạo quyết định.",
  CONFIRMED: "Không tính vào KPI. Lãnh đạo có thể khôi phục nếu xác nhận nhầm.",
  REJECTED: "Tính KPI bình thường theo hạn xử lý ban đầu.",
}[notRequiredStatus(props.context)] ?? ""));

const formatDateTime = (value) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleString("vi-VN") : "";
};
</script>

<template>
  <section v-if="visible" class="mb-4 space-y-2 rounded-xl border p-3 text-xs" :class="status.box">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="flex flex-wrap items-center gap-2">
        <span class="font-bold text-zinc-900">Việc không cần làm</span>
        <span class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold" :class="status.badge">
          <component :is="status.icon" class="h-3 w-3" />
          {{ status.label }}
        </span>
      </div>
      <div class="flex items-center gap-2">
        <Button v-if="canDecide" size="sm" class="h-7 bg-amber-600 text-xs text-white hover:bg-amber-700" @click="emit('action', 'decide')">
          Xem xét
        </Button>
        <Button v-if="canCancel" size="sm" variant="outline" class="h-7 text-xs" @click="emit('action', 'cancel')">
          Hủy đề nghị
        </Button>
        <Button v-if="canRestore" size="sm" variant="outline" class="h-7 gap-1 text-xs" @click="emit('action', 'restore')">
          <RotateCcw class="h-3 w-3" />
          Khôi phục
        </Button>
      </div>
    </div>

    <p v-if="kpiHint" class="font-medium text-zinc-600">{{ kpiHint }}</p>
    <p v-if="state?.reason" class="text-zinc-800">
      <span class="font-bold text-zinc-500">Lý do:</span>
      <span class="ml-1 font-medium">{{ state.reason }}</span>
    </p>
    <p v-if="state?.decisionNote" class="text-zinc-900">
      <span class="font-bold text-amber-900">Ý kiến lãnh đạo:</span>
      <span class="ml-1 font-medium">{{ state.decisionNote }}</span>
    </p>

    <ol v-if="history.length" class="space-y-0.5 border-t border-zinc-200/60 pt-2 text-[11px] text-zinc-600">
      <li v-for="(entry, index) in history" :key="index">
        <span class="font-semibold text-zinc-700">{{ HISTORY_LABELS[entry.action] || entry.action }}</span>
        <template v-if="entry.actorName"> · {{ entry.actorName }}</template>
        <template v-if="entry.actedAt"> · {{ formatDateTime(entry.actedAt) }}</template>
        <template v-if="entry.note"> · {{ entry.note }}</template>
      </li>
    </ol>
  </section>
</template>
