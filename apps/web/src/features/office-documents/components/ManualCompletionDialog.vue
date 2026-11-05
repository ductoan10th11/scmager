<script setup>
import { computed, ref, watch } from "vue";
import { CheckCircle2, RotateCcw } from "lucide-vue-next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { http } from "@/shared/api/http";

const props = defineProps({
  open: { type: Boolean, default: false },
  mode: { type: String, default: "complete" },
  context: { type: Object, default: null },
  documentId: { type: String, default: "" },
  label: { type: String, default: "" },
});
const emit = defineEmits(["update:open", "saved"]);

const vietnamToday = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Ho_Chi_Minh",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());

const currentReworkCount = (context) => {
  const management = context?.management ?? {};
  if (management.kpiImport?.importKey) return management.kpiImport.reworkCount ?? 0;
  return management.overrides?.reworkCount ?? context?.observation?.reworkCount ?? 0;
};

const today = ref(vietnamToday());
const completedDate = ref(today.value);
const score = ref("0");
const reworkCount = ref("0");
const saving = ref(false);
const error = ref("");

watch(() => props.open, (open) => {
  if (!open) return;
  today.value = vietnamToday();
  completedDate.value = today.value;
  // What the task already has, so a quick confirm never wipes an existing score.
  score.value = String(props.context?.tracking?.rawScore ?? 0);
  reworkCount.value = String(currentReworkCount(props.context));
  error.value = "";
});

const completing = computed(() => props.mode === "complete");

const submit = async () => {
  const parsedScore = Number(String(score.value).trim().replace(",", "."));
  const parsedRework = Number(String(reworkCount.value).trim());
  if (completing.value) {
    if (String(score.value).trim() === "" || !Number.isFinite(parsedScore) || parsedScore < 0 || parsedScore > 1000000) {
      error.value = "Điểm phải là số từ 0 đến 1.000.000.";
      return;
    }
    if (String(reworkCount.value).trim() === "" || !Number.isSafeInteger(parsedRework) || parsedRework < 0) {
      error.value = "Số lần làm lại phải là số nguyên không âm.";
      return;
    }
    if (!completedDate.value) {
      error.value = "Chọn ngày hoàn thành.";
      return;
    }
  }
  saving.value = true;
  error.value = "";
  try {
    const path = completing.value ? "manual-completion" : "manual-completion/undo";
    await http(`/api/office-document-contexts/${props.documentId}/${path}`, {
      method: "POST",
      body: completing.value
        ? { score: parsedScore, reworkCount: parsedRework, completedDate: completedDate.value }
        : {},
    });
    emit("update:open", false);
    emit("saved", props.context);
  } catch (requestError) {
    error.value = requestError.message || "Không thể cập nhật nhiệm vụ.";
  } finally {
    saving.value = false;
  }
};
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="max-w-lg rounded-2xl">
      <DialogTitle>{{ completing ? "Xác nhận hoàn thành" : "Bỏ xác nhận hoàn thành" }}</DialogTitle>
      <DialogDescription>{{ label }}</DialogDescription>
      <p class="text-sm leading-6 text-zinc-700">
        <template v-if="completing">
          Nhiệm vụ được tính là đã hoàn thành ngay, không chờ dữ liệu từ eOffice, và ngừng đồng bộ trạng thái.
          Ngày hoàn thành quyết định số ngày chậm tiến độ trong KPI.
        </template>
        <template v-else>
          Nhiệm vụ trở lại trạng thái chưa hoàn thành và tiếp tục đồng bộ trạng thái từ eOffice.
        </template>
      </p>
      <div v-if="completing" class="grid gap-3 sm:grid-cols-2">
        <label class="grid gap-1.5 text-sm font-medium">
          <span>Điểm</span>
          <Input v-model="score" type="text" inputmode="decimal" class="h-10 rounded-xl" />
        </label>
        <label class="grid gap-1.5 text-sm font-medium">
          <span>Làm lại</span>
          <Input v-model="reworkCount" type="text" inputmode="numeric" class="h-10 rounded-xl" />
        </label>
        <label class="grid gap-1.5 text-sm font-medium sm:col-span-2">
          <span>Ngày hoàn thành</span>
          <Input v-model="completedDate" type="date" :max="today" class="h-10 rounded-xl" />
        </label>
      </div>
      <p v-if="error" role="alert" class="text-sm font-medium text-rose-700">{{ error }}</p>
      <div class="flex justify-end gap-2 border-t border-zinc-100 pt-3">
        <Button variant="ghost" :disabled="saving" @click="emit('update:open', false)">Đóng</Button>
        <Button
          :disabled="saving"
          :class="completing ? 'bg-emerald-600 text-white hover:bg-emerald-700' : ''"
          :variant="completing ? 'default' : 'outline'"
          @click="submit"
        >
          <CheckCircle2 v-if="completing" class="h-4 w-4" />
          <RotateCcw v-else class="h-4 w-4" />
          {{ saving ? "Đang lưu..." : completing ? "Xác nhận hoàn thành" : "Bỏ hoàn thành" }}
        </Button>
      </div>
    </DialogContent>
  </Dialog>
</template>
