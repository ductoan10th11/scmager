import { nextTick, reactive, watch } from "vue";

const MAX_SCORE = 1_000_000;

/**
 * Reads what was typed into a score cell. Real scores look like 1.18, and
 * Vietnamese users type 1,18, so a comma counts as the decimal separator. Returns
 * null for anything that is not a score from 0 to MAX_SCORE.
 */
export const parseScoreInput = (text) => {
  const normalized = String(text).trim().replace(",", ".");
  if (!/^(\d+\.?\d*|\.\d+)$/.test(normalized)) return null;
  const score = Number(normalized);
  return score <= MAX_SCORE ? score : null;
};

/**
 * State for editing a score directly in a table cell. Edits are keyed by record
 * id, never by row object or index, because a list refresh replaces every row
 * object and may reorder them while someone is typing.
 *
 * - rows: computed list in display order, which is what the keyboard walks.
 * - saveScore(id, score): persists and updates the list; rejects with the message
 *   to show.
 */
export const useInlineScoreEdit = ({ rows, identity, currentScore, canEdit, saveScore }) => {
  const edits = reactive({});
  // Set for the length of a list re-render when it holds the focused input.
  let refocusId = null;

  const inputFor = (id) => document.querySelector(`[data-score-edit-id="${id}"]`);
  const cellFor = (id) => document.querySelector(`[data-score-cell-id="${id}"]`);

  const begin = async (context) => {
    const id = identity(context);
    if (!edits[id]) {
      const score = currentScore(context);
      edits[id] = {
        value: score === null ? "" : String(score),
        original: score,
        error: "",
        saving: false,
        leftDuringSave: false,
      };
    }
    await nextTick();
    const input = inputFor(id);
    input?.focus();
    input?.select();
  };

  // Resolves true when the edit is finished, whether or not that took a request,
  // and false when the cell has to stay in edit mode.
  const finish = async (id) => {
    const edit = edits[id];
    if (!String(edit.value).trim()) {
      delete edits[id];
      return true;
    }
    const score = parseScoreInput(edit.value);
    if (score === null) {
      edit.error = `Điểm phải là số từ 0 đến ${MAX_SCORE.toLocaleString("vi-VN")}.`;
      return false;
    }
    if (score === edit.original) {
      delete edits[id];
      return true;
    }
    edit.saving = true;
    edit.error = "";
    try {
      await saveScore(id, score);
      delete edits[id];
      return true;
    } catch (requestError) {
      edit.saving = false;
      edit.error = requestError?.message || "Không thể lưu điểm.";
      return false;
    }
  };

  const onCellClick = (event, context) => {
    if (!canEdit(context)) return;
    // The row itself opens the detail panel.
    event.stopPropagation();
    begin(context);
  };

  const onKeydown = async (event, id) => {
    const edit = edits[id];
    if (!edit) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (edit.saving) return;
      delete edits[id];
      await nextTick();
      cellFor(id)?.focus();
      return;
    }
    if (event.key !== "Enter" && event.key !== "Tab") return;
    event.preventDefault();
    if (edit.saving) return;
    // Taken before saving: the save can re-sort the list, and the leader means the
    // row they could see next to this one.
    const list = rows.value;
    const index = list.findIndex((row) => identity(row) === id);
    const step = event.key === "Tab" && event.shiftKey ? -1 : 1;
    const targetId = identity(list[index + step]);
    if (!(await finish(id))) return;
    // Clicking elsewhere during the save beats the keyboard move.
    if (edit.leftDuringSave) return;
    const target = rows.value.find((row) => identity(row) === targetId);
    if (target) {
      await begin(target);
    } else {
      await nextTick();
      cellFor(id)?.focus();
    }
  };

  const onBlur = (id) => {
    const edit = edits[id];
    // Enter or Tab may have closed the edit already, and a re-render blurs an input
    // it moves without the user having left.
    if (!edit || refocusId === id) return;
    if (edit.saving) {
      edit.leftDuringSave = true;
      return;
    }
    finish(id);
  };

  // Moving a focused element in the DOM blurs it, and a refresh that reorders the
  // rows does exactly that. Without this the blur would save a half-typed score.
  watch(rows, () => {
    refocusId = document.activeElement?.dataset?.scoreEditId ?? null;
  }, { flush: "pre" });
  watch(rows, () => {
    const id = refocusId;
    refocusId = null;
    if (id && edits[id]) inputFor(id)?.focus();
  }, { flush: "post" });

  return { edits, onCellClick, onKeydown, onBlur };
};
