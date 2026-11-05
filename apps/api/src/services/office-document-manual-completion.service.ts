import { isValidObjectId } from "mongoose";
import OfficeDocumentContextModel from "../models/office-document-context.model";
import type { AuthUser } from "../types/auth";
import { badRequest, conflict, notFound } from "../utils/http-error";
import {
  appendOfficeDocumentManagementNote,
  effectiveOfficeDocumentCompletion,
  effectiveOfficeDocumentReworkCount,
  incomingScoreChanges,
  incomingScoreSourceWrites,
} from "./office-document-completion.service";
import { assertCanManageOfficeDocumentOwner } from "./office-document-not-required.service";
import { officeDocumentNotRequiredStatus } from "./office-document-not-required-state.service";

const vietnamDateKey = (date: Date) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Ho_Chi_Minh",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(date);

/**
 * A leader may be recording work that finished days ago, and each late working
 * day costs a quarter of the score, so the date is theirs to state. Today keeps
 * the real time; an earlier day uses the end of office hours, as PL4 imports do.
 */
const parseCompletedAt = (value: unknown, now: Date) => {
  const today = vietnamDateKey(now);
  const raw = value === undefined || value === null || value === "" ? today : String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw badRequest("Ngày hoàn thành không hợp lệ.");
  const date = new Date(`${raw}T17:00:00+07:00`);
  if (Number.isNaN(date.getTime()) || vietnamDateKey(date) !== raw) {
    throw badRequest("Ngày hoàn thành không hợp lệ.");
  }
  if (raw > today) throw badRequest("Ngày hoàn thành không được sau hôm nay.");
  return { completedAt: raw === today ? now : date, label: raw.split("-").reverse().join("/") };
};

const provided = (value: unknown) => value !== undefined && value !== null && value !== "";

const parseScore = (value: unknown) => {
  if (!provided(value)) return null;
  const score = Number(value);
  if (!Number.isFinite(score) || score < 0 || score > 1_000_000) {
    throw badRequest("Điểm phải là số từ 0 đến 1.000.000.");
  }
  return score;
};

const parseReworkCount = (value: unknown) => {
  if (!provided(value)) return null;
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw badRequest("Số lần làm lại phải là số nguyên không âm.");
  }
  return count;
};

/**
 * Writes the score and rework count where they count on this task. Leaving either
 * out keeps what the task already has. Both also live outside the completion, so
 * undoing it does not lose what the leader entered.
 */
const scoringWrites = (actor: AuthUser, context: any, score: number | null, reworkCount: number | null, now: Date) => ({
  ...(score === null
    ? {}
    : {
        "management.manualScore": score,
        ...incomingScoreSourceWrites(context, score),
        ...(incomingScoreChanges(context, score)
          ? { "management.scoreEditedBy": actor.id, "management.scoreEditedAt": now }
          : {}),
      }),
  ...(reworkCount === null
    ? {}
    : {
        "management.overrides.reworkCount": reworkCount,
        ...(context.management?.kpiImport?.importKey
          ? { "management.kpiImport.reworkCount": reworkCount }
          : {}),
      }),
});

const loadTask = async (actor: AuthUser, id: unknown) => {
  const contextId = String(id ?? "");
  if (!isValidObjectId(contextId)) throw badRequest("id must be a valid ObjectId.");
  const context: any = await OfficeDocumentContextModel.findById(contextId).lean();
  if (!context) throw notFound("Office document context was not found.");
  if (actor.role.code !== "ADMIN" && String(context.organizationId ?? "") !== actor.organization) {
    throw notFound("Office document context was not found.");
  }
  if (context.pageType !== "incoming") throw badRequest("Chỉ nhiệm vụ mới được xác nhận hoàn thành.");
  await assertCanManageOfficeDocumentOwner(actor, context);
  return context;
};

const appendNote = (context: any, entry: string) => appendOfficeDocumentManagementNote({
  contextId: String(context._id),
  organizationId: String(context.organizationId ?? ""),
  entry,
});

/**
 * Marks a task done without waiting for eOffice. It is recorded as a business
 * completion, not on statusSync, because statusSync belongs to the eOffice sync.
 * The sync skips business-completed tasks, so it cannot undo this. The completion's
 * own point stays null so the score keeps coming from manualScore; its rework count
 * is always set because a business completion overrides the one on the task.
 */
export const completeOfficeDocumentManuallyService = async (
  actor: AuthUser,
  id: unknown,
  body: Record<string, unknown> = {},
) => {
  const context = await loadTask(actor, id);
  if (effectiveOfficeDocumentCompletion(context).completed) {
    throw conflict("Nhiệm vụ đã hoàn thành.");
  }
  if (["PENDING", "CONFIRMED"].includes(officeDocumentNotRequiredStatus(context))) {
    throw conflict("Nhiệm vụ đang trong quy trình việc không cần làm. Hãy xử lý đề nghị đó trước.");
  }
  const now = new Date();
  const { completedAt, label } = parseCompletedAt(body.completedDate, now);
  const score = parseScore(body.score);
  const reworkCount = parseReworkCount(body.reworkCount);
  const updated: any = await OfficeDocumentContextModel.findOneAndUpdate(
    {
      _id: context._id,
      "statusSync.completed": { $ne: true },
      "management.businessCompletion.completed": { $ne: true },
      "management.notRequired.status": { $nin: ["PENDING", "CONFIRMED"] },
    },
    {
      $set: {
        "management.businessCompletion.completed": true,
        "management.businessCompletion.evidenceType": "MANUAL",
        "management.businessCompletion.evidenceId": null,
        "management.businessCompletion.submittedBy": actor.id,
        "management.businessCompletion.submittedAt": completedAt,
        "management.businessCompletion.approvedBy": actor.id,
        "management.businessCompletion.approvedAt": now,
        "management.businessCompletion.point": null,
        "management.businessCompletion.reworkCount": reworkCount ?? effectiveOfficeDocumentReworkCount(context),
        ...scoringWrites(actor, context, score, reworkCount, now),
      },
    },
    { new: true, runValidators: true },
  ).lean();
  if (!updated) throw conflict("Trạng thái nhiệm vụ vừa thay đổi, hãy tải lại rồi thử lại.");
  const details = [
    `ngày hoàn thành ${label}`,
    ...(score === null ? [] : [`điểm ${score}`]),
    ...(reworkCount === null ? [] : [`làm lại ${reworkCount} lần`]),
  ].join(", ");
  await appendNote(context, `${actor.fullName || actor.username} xác nhận hoàn thành nhiệm vụ: ${details}.`);
  return { data: { id: String(context._id), completed: true, completedAt } };
};

/** Takes back a manual completion; the eOffice sync picks the task up again. */
export const undoOfficeDocumentManualCompletionService = async (actor: AuthUser, id: unknown) => {
  const context = await loadTask(actor, id);
  const updated: any = await OfficeDocumentContextModel.findOneAndUpdate(
    {
      _id: context._id,
      "management.businessCompletion.completed": true,
      "management.businessCompletion.evidenceType": "MANUAL",
    },
    {
      $set: {
        "management.businessCompletion.completed": false,
        "management.businessCompletion.evidenceType": null,
        "management.businessCompletion.evidenceId": null,
        "management.businessCompletion.submittedBy": null,
        "management.businessCompletion.submittedAt": null,
        "management.businessCompletion.approvedBy": null,
        "management.businessCompletion.approvedAt": null,
        "management.businessCompletion.point": null,
        "management.businessCompletion.reworkCount": 0,
      },
    },
    { new: true, runValidators: true },
  ).lean();
  if (!updated) throw conflict("Nhiệm vụ không ở trạng thái hoàn thành thủ công.");
  await appendNote(context, `${actor.fullName || actor.username} đã bỏ xác nhận hoàn thành nhiệm vụ.`);
  return { data: { id: String(context._id), completed: false } };
};
