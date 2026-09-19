import { isValidObjectId } from "mongoose";
import OfficeDocumentContextModel from "../models/office-document-context.model";
import type { AuthUser } from "../types/auth";
import { badRequest, conflict, forbidden, notFound } from "../utils/http-error";
import {
  appendOfficeDocumentManagementNote,
  effectiveOfficeDocumentPoint,
  effectiveOfficeDocumentReworkCount,
} from "./office-document-completion.service";
import { notifyRoleUsers, notifyUser } from "./notification.service";

const idOf = (value: any) => String(value?._id ?? value ?? "");

// Leaders who settle a complaint about a document's point or rework count.
const DECIDER_ROLES = ["ADMIN", "OFFICE_CHIEF", "COMMUNE_LEADER", "DEPARTMENT_LEADER"];

const parsePoint = (value: unknown, field: string) => {
  if (value === undefined || value === null || value === "") return null;
  const point = Number(value);
  if (!Number.isFinite(point) || point < 0 || point > 1_000_000) {
    throw badRequest(`${field} must be a non-negative number.`);
  }
  return point;
};

const parseReworkCount = (value: unknown, field: string) => {
  if (value === undefined || value === null || value === "") return null;
  const count = Number(value);
  if (!Number.isFinite(count) || !Number.isInteger(count) || count < 0 || count > 10_000) {
    throw badRequest(`${field} must be a non-negative integer.`);
  }
  return count;
};

const loadContext = async (actor: AuthUser, id: unknown) => {
  const contextId = String(id ?? "");
  if (!isValidObjectId(contextId)) throw badRequest("id must be a valid ObjectId.");
  const context: any = await OfficeDocumentContextModel.findById(contextId);
  if (!context) throw notFound("Office document context was not found.");
  if (actor.role.code !== "ADMIN" && String(context.organizationId ?? "") !== actor.organization) {
    throw notFound("Office document context was not found.");
  }
  return context;
};

const currentValues = (context: any) => ({
  point: effectiveOfficeDocumentPoint(context),
  reworkCount: effectiveOfficeDocumentReworkCount(context),
});

const summarize = (context: any) => {
  const complaint = context.management?.scoreComplaint ?? {};
  return {
    id: idOf(context._id),
    soKyHieu: context.management?.overrides?.soKyHieu ?? context.observation?.soKyHieu ?? "",
    subject: context.management?.overrides?.subject ?? context.observation?.subject ?? "",
    current: currentValues(context),
    complaint: {
      status: complaint.status ?? "NONE",
      requestedPoint: complaint.requestedPoint ?? null,
      requestedReworkCount: complaint.requestedReworkCount ?? null,
      approvedPoint: complaint.approvedPoint ?? null,
      approvedReworkCount: complaint.approvedReworkCount ?? null,
      reason: complaint.reason ?? "",
      decisionNote: complaint.decisionNote ?? "",
      requestedBy: complaint.requestedBy ? idOf(complaint.requestedBy) : null,
      requestedAt: complaint.requestedAt ?? null,
      decidedBy: complaint.decidedBy ? idOf(complaint.decidedBy) : null,
      decidedAt: complaint.decidedAt ?? null,
      history: complaint.history ?? [],
    },
  };
};

/** The specialist who owns the product disputes its point / rework count. */
export const requestOfficeDocumentComplaintService = async (
  actor: AuthUser,
  id: unknown,
  body: Record<string, unknown>,
) => {
  const context = await loadContext(actor, id);
  const ownerId = String(context.management?.assignment?.userId ?? "");
  if (ownerId !== actor.id && actor.role.code === "SPECIALIST") {
    throw forbidden("Bạn chỉ được khiếu nại sản phẩm do chính mình thực hiện.");
  }
  if (!ownerId) throw conflict("Văn bản chưa có người thực hiện nên chưa thể khiếu nại.");
  if (context.management?.scoreComplaint?.status === "PENDING") {
    throw conflict("Đang có một khiếu nại chờ lãnh đạo quyết định.");
  }

  const requestedPoint = parsePoint(body.requestedPoint, "requestedPoint");
  const requestedReworkCount = parseReworkCount(body.requestedReworkCount, "requestedReworkCount");
  if (requestedPoint === null && requestedReworkCount === null) {
    throw badRequest("Nhập điểm đề xuất hoặc số lần làm lại đề xuất.");
  }
  const reason = String(body.reason ?? "").trim();
  if (!reason) throw badRequest("Nhập lý do khiếu nại.");
  if (reason.length > 2_000) throw badRequest("Lý do khiếu nại quá dài.");

  const now = new Date();
  const history = [...(context.management?.scoreComplaint?.history ?? [])];
  history.push({
    action: "REQUESTED", actor: actor.id, requestedPoint, requestedReworkCount,
    approvedPoint: null, approvedReworkCount: null, note: reason, actedAt: now,
  });
  context.set("management.scoreComplaint", {
    status: "PENDING", requestedPoint, requestedReworkCount,
    approvedPoint: null, approvedReworkCount: null, reason, decisionNote: "",
    requestedBy: actor.id, requestedAt: now, decidedBy: null, decidedAt: null, history,
  });
  await context.save();

  const values = currentValues(context);
  for (const roleCode of DECIDER_ROLES) {
    await notifyRoleUsers(roleCode, String(context.organizationId ?? ""), {
      actor: actor.id,
      type: "WORK_DECLARATION_POINT_ADJUSTMENT_REQUESTED",
      title: "Có khiếu nại điểm / số lần làm lại",
      message: `${summarize(context).soKyHieu}: hiện ${values.point} điểm, ${values.reworkCount} lần làm lại`,
      relatedModel: "IncomingDocument",
      relatedId: idOf(context._id),
      metadata: { requestedPoint, requestedReworkCount, reason, dedupeKey: `complaint:${idOf(context._id)}:${now.getTime()}` },
    });
  }

  return { data: summarize(context) };
};

/** A leader accepts or rejects the complaint; both outcomes need a reason. */
export const decideOfficeDocumentComplaintService = async (
  actor: AuthUser,
  id: unknown,
  body: Record<string, unknown>,
) => {
  if (!DECIDER_ROLES.includes(actor.role.code)) {
    throw forbidden("Chỉ lãnh đạo mới quyết định khiếu nại.");
  }
  const context = await loadContext(actor, id);
  const complaint = context.management?.scoreComplaint;
  if (complaint?.status !== "PENDING") throw conflict("Không có khiếu nại nào đang chờ quyết định.");

  const accept = body.accept === true || body.accept === "true";
  const decisionNote = String(body.note ?? "").trim();
  if (!decisionNote) throw badRequest("Nhập lý do cho quyết định.");
  if (decisionNote.length > 2_000) throw badRequest("Lý do quá dài.");

  const approvedPoint = accept
    ? (body.approvedPoint === undefined ? complaint.requestedPoint ?? null : parsePoint(body.approvedPoint, "approvedPoint"))
    : null;
  const approvedReworkCount = accept
    ? (body.approvedReworkCount === undefined ? complaint.requestedReworkCount ?? null : parseReworkCount(body.approvedReworkCount, "approvedReworkCount"))
    : null;

  const now = new Date();
  const before = currentValues(context);
  complaint.status = accept ? "APPROVED" : "REJECTED";
  complaint.approvedPoint = approvedPoint;
  complaint.approvedReworkCount = approvedReworkCount;
  complaint.decisionNote = decisionNote;
  complaint.decidedBy = actor.id;
  complaint.decidedAt = now;
  complaint.history.push({
    action: accept ? "APPROVED" : "REJECTED", actor: actor.id,
    requestedPoint: complaint.requestedPoint, requestedReworkCount: complaint.requestedReworkCount,
    approvedPoint, approvedReworkCount, note: decisionNote, actedAt: now,
  });

  // An accepted complaint rewrites the document's own numbers; only the field
  // that was actually disputed changes.
  if (accept) {
    if (approvedPoint !== null) context.set("management.manualScore", approvedPoint);
    if (approvedReworkCount !== null) {
      const overrides = { ...(context.management?.overrides ?? {}) };
      overrides.reworkCount = approvedReworkCount;
      context.set("management.overrides", overrides);
      if (context.management?.businessCompletion?.completed === true) {
        context.set("management.businessCompletion.reworkCount", approvedReworkCount);
      }
    }
  }
  context.markModified("management.scoreComplaint");
  context.markModified("management");
  await context.save();

  const parts = [accept ? "Khiếu nại được CHẤP NHẬN." : "Khiếu nại KHÔNG được chấp nhận."];
  if (complaint.requestedPoint !== null && complaint.requestedPoint !== undefined) {
    parts.push(`Điểm: ${before.point} -> ${accept ? approvedPoint : before.point} (đề xuất ${complaint.requestedPoint}).`);
  }
  if (complaint.requestedReworkCount !== null && complaint.requestedReworkCount !== undefined) {
    parts.push(`Số lần làm lại: ${before.reworkCount} -> ${accept ? approvedReworkCount : before.reworkCount} (đề xuất ${complaint.requestedReworkCount}).`);
  }
  parts.push(`Lý do: ${decisionNote}`);
  await appendOfficeDocumentManagementNote({
    contextId: idOf(context._id),
    organizationId: String(context.organizationId ?? ""),
    entry: parts.join(" "),
  });

  const requesterId = idOf(complaint.requestedBy);
  if (requesterId) {
    await notifyUser(requesterId, {
      actor: actor.id,
      type: accept ? "WORK_DECLARATION_POINT_ADJUSTMENT_APPROVED" : "WORK_DECLARATION_POINT_ADJUSTMENT_REJECTED",
      title: accept ? "Khiếu nại đã được chấp nhận" : "Khiếu nại không được chấp nhận",
      message: parts.join(" "),
      relatedModel: "IncomingDocument",
      relatedId: idOf(context._id),
      metadata: { approvedPoint, approvedReworkCount, note: decisionNote },
    });
  }

  return { data: summarize(context) };
};

/** The requester withdraws their own pending complaint. */
export const cancelOfficeDocumentComplaintService = async (actor: AuthUser, id: unknown) => {
  const context = await loadContext(actor, id);
  const complaint = context.management?.scoreComplaint;
  if (complaint?.status !== "PENDING") throw conflict("Không có khiếu nại nào đang chờ quyết định.");
  if (idOf(complaint.requestedBy) !== actor.id) {
    throw forbidden("Chỉ người gửi mới hủy được khiếu nại.");
  }
  const now = new Date();
  complaint.status = "CANCELLED";
  complaint.decidedAt = now;
  complaint.history.push({
    action: "CANCELLED", actor: actor.id,
    requestedPoint: complaint.requestedPoint, requestedReworkCount: complaint.requestedReworkCount,
    approvedPoint: null, approvedReworkCount: null, note: "", actedAt: now,
  });
  context.markModified("management.scoreComplaint");
  context.markModified("management");
  await context.save();
  return { data: summarize(context) };
};
