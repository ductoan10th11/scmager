<script setup>
import { computed, ref, watch } from "vue";
import { CheckCircle2, RotateCcw, XCircle } from "lucide-vue-next";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { http } from "@/shared/api/http";
import { notRequiredOf } from "../composables/useNotRequired";

const props = defineProps({
  open: { type: Boolean, default: false },
  mode: { type: String, default: "request" },
  context: { type: Object, default: null },
  documentId: { type: String, default: "" },
  label: { type: String, default: "" },
});
const emit = defineEmits(["update:open", "saved"]);

const TITLES = {
  request: "Chuyển lại lãnh đạo (việc không cần làm)",
  cancel: "Hủy đề nghị việc không cần làm",
  decide: "Xem xét việc không cần làm",
  restore: "Khôi phục vào danh sách tính KPI",
};
const DESCRIPTIONS = {
  request: "Văn bản chuyển sang mục Công việc cần xem xét và chưa tính KPI cho đến khi lãnh đạo quyết định. Nếu bị từ chối, văn bản trở lại danh sách với hạn xử lý ban đầu và vẫn tính chậm hạn.",
  cancel: "Văn bản trở lại danh sách tính KPI như bình thường.",
  decide: "Xác nhận: văn bản không tính KPI, vẫn được lưu lại. Từ chối: văn bản tính KPI theo hạn xử lý ban đầu.",
  restore: "Văn bản tính KPI trở lại theo hạn xử lý ban đầu. Lịch sử đề nghị vẫn được giữ.",
};

const text = ref("");
const saving = ref(false);
const error = ref("");

watch(() => props.open, (open) => {
  if (!open) return;
  text.value = "";
  error.value = "";
});

const reason = computed(() => notRequiredOf(props.context)?.reason ?? "");
const trimmed = computed(() => text.value.trim());

const submit = async (path, body) => {
  saving.value = true;
  error.value = "";
  try {
    await http(`/api/office-document-contexts/${props.documentId}/not-required/${path}`, { method: "POST", body });
    emit("update:open", false);
    emit("saved", props.context);
  } catch (requestError) {
    error.value = requestError.message || "Không thể cập nhật việc không cần làm.";
  } finally {
    saving.value = false;
  }
};
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="sm:max-w-[520px]">
      <div class="space-y-4">
        <div>
          <DialogTitle class="text-lg font-bold text-zinc-900">{{ TITLES[mode] }}</DialogTitle>
          <p class="mt-1 text-sm text-zinc-500">{{ label }}</p>
        </div>
        <DialogDescription class="text-sm text-zinc-600">{{ DESCRIPTIONS[mode] }}</DialogDescription>

        <div v-if="mode === 'decide'" class="rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-sm">
          <span class="text-xs font-bold uppercase tracking-wider text-amber-800">Lý do của chuyên viên</span>
          <p class="mt-1 whitespace-pre-wrap text-amber-900">{{ reason || "Không có lý do." }}</p>
        </div>

        <label v-if="mode === 'request'" class="grid gap-2 text-sm font-semibold text-zinc-700">
          Lý do (bắt buộc)
          <Textarea v-model="text" class="min-h-24 resize-none" placeholder="Vì sao đây là việc không cần làm..." />
        </label>
        <label v-else-if="mode === 'decide'" class="grid gap-2 text-sm font-semibold text-zinc-700">
          Ý kiến (bắt buộc khi từ chối)
          <Textarea v-model="text" class="min-h-24 resize-none" placeholder="Ghi rõ căn cứ quyết định..." />
        </label>
        <label v-else-if="mode === 'restore'" class="grid gap-2 text-sm font-semibold text-zinc-700">
          Ý kiến (không bắt buộc)
          <Textarea v-model="text" class="min-h-20 resize-none" />
        </label>

        <p v-if="error" class="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{{ error }}</p>

        <div class="flex flex-wrap items-center justify-end gap-2.5 border-t border-zinc-100 pt-3">
          <Button variant="ghost" class="rounded-full font-bold" :disabled="saving" @click="emit('update:open', false)">Đóng</Button>
          <Button
            v-if="mode === 'request'"
            class="rounded-full bg-indigo-600 font-bold text-white hover:bg-indigo-700"
            :disabled="saving || !trimmed"
            @click="submit('request', { reason: trimmed })"
          >Gửi đề nghị</Button>
          <Button
            v-else-if="mode === 'cancel'"
            class="rounded-full bg-zinc-800 font-bold text-white hover:bg-zinc-900"
            :disabled="saving"
            @click="submit('cancel', {})"
          >Hủy đề nghị</Button>
          <template v-else-if="mode === 'decide'">
            <Button
              variant="outline"
              class="gap-1.5 rounded-full border-rose-200 bg-rose-50 font-bold text-rose-700 hover:bg-rose-100"
              :disabled="saving || !trimmed"
              @click="submit('decide', { accept: false, note: trimmed })"
            >
              <XCircle class="h-4 w-4" />
              Từ chối
            </Button>
            <Button
              class="gap-1.5 rounded-full bg-emerald-600 font-bold text-white hover:bg-emerald-700"
              :disabled="saving"
              @click="submit('decide', { accept: true, note: trimmed })"
            >
              <CheckCircle2 class="h-4 w-4" />
              Xác nhận không cần làm
            </Button>
          </template>
          <Button
            v-else
            class="gap-1.5 rounded-full bg-sky-600 font-bold text-white hover:bg-sky-700"
            :disabled="saving"
            @click="submit('restore', { note: trimmed })"
          >
            <RotateCcw class="h-4 w-4" />
            Khôi phục
          </Button>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>
