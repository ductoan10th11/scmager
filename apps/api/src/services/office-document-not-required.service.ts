import { isValidObjectId } from "mongoose";
import OfficeDocumentContextModel from "../models/office-document-context.model";
import type { AuthUser } from "../types/auth";
import { badRequest, conflict, forbidden, notFound } from "../utils/http-error";
import { appendOfficeDocumentManagementNote } from "./office-document-completion.service";
import { notifyDepartmentLeaders, notifyRoleUsers, notifyUser } from "./notification.service";
import { officeDocumentOwnerDirectoryFor } from "./office-document-owner-directory.service";
import {
  effectiveOfficeDocumentOwner,
  effectiveOfficeDocumentOwnerId,
} from "./office-document-owner.service";
import { officeDocumentNotRequiredStatus } from "./office-document-not-required-state.service";

const idOf = (value: any) => String(value?._id ?? value ?? "");
const actorName = (actor: AuthUser) => actor.fullName || actor.username || "";

// These roles span the organization, so a department with no leader is not stuck.
const ORGANIZATION_DECIDER_ROLES = ["ADMIN", "OFFICE_CHIEF", "COMMUNE_LEADER"];
const MAX_TEXT_LENGTH = 2_000;

const requiredText = (value: unknown, emptyMessage: string, tooLongMessage: string) => {
  const text = String(value ?? "").trim();
  if (!text) throw badRequest(emptyMessage);
  if (text.length > MAX_TEXT_LENGTH) throw badRequest(tooLongMessage);
  return text;
};

const optionalText = (value: unknown, tooLongMessage: string) => {
  const text = String(value ?? "").trim();
  if (text.length > MAX_TEXT_LENGTH) throw badRequest(tooLongMessage);
  return text;
};

const loadContext = async (actor: AuthUser, id: unknown) => {
  const contextId = String(id ?? "");
  if (!isValidObjectId(contextId)) throw badRequest("id must be a valid ObjectId.");
  const context: any = await OfficeDocumentContextModel.findById(contextId).lean();
  if (!context) throw notFound("Office document context was not found.");
  if (actor.role.code !== "ADMIN" && String(context.organizationId ?? "") !== actor.organization) {
    throw notFound("Office document context was not found.");
  }
  if (context.pageType !== "incoming") {
    throw badRequest("Chỉ văn bản đến mới được chuyển lại lãnh đạo là việc không cần làm.");
  }
  return context;
};

const symbolOf = (context: any) =>
  context.management?.overrides?.soKyHieu ?? context.observation?.soKyHieu ?? "";

const summarize = (context: any) => {
  const state = context.management?.notRequired ?? {};
  return {
    id: idOf(context._id),
    soKyHieu: symbolOf(context),
    subject: context.management?.overrides?.subject ?? context.observation?.subject ?? "",
    notRequired: {
      status: state.status ?? "NONE",
      reason: state.reason ?? "",
      decisionNote: state.decisionNote ?? "",
      requestedBy: state.requestedBy ? idOf(state.requestedBy) : null,
      requestedByName: state.requestedByName ?? "",
      requestedAt: state.requestedAt ?? null,
      decidedBy: state.decidedBy ? idOf(state.decidedBy) : null,
      decidedAt: state.decidedAt ?? null,
      history: state.history ?? [],
    },
  };
};

const ownerOf = async (context: any) => effectiveOfficeDocumentOwner(context, {
  directory: await officeDocumentOwnerDirectoryFor(context),
});

/**
 * The leader of the owner's department, or anyone senior across the organization.
 * Ownership comes from the effective owner: the assignment on the document usually
 * names whoever dispatched it, and that leader may sit in another department.
 */
export const assertCanManageOfficeDocumentOwner = async (actor: AuthUser, context: any) => {
  if (ORGANIZATION_DECIDER_ROLES.includes(actor.role.code)) return;
  if (actor.role.code !== "DEPARTMENT_LEADER") {
    throw forbidden("Chỉ lãnh đạo mới thực hiện được thao tác này.");
  }
  const owner = await ownerOf(context);
  if (!actor.department || owner.departmentId !== actor.department) {
    throw forbidden("Trưởng phòng chỉ xử lý việc của chuyên viên trong phòng mình.");
  }
};

/**
 * Applies a state change only if the document is still in the state it was read
 * in, so two leaders deciding at once cannot both win and lose a history entry.
 * Only management.notRequired is written: never management.updatedBy, which would
 * turn the document into a manual assignment, nor assignmentMode or the assignment.
 */
const applyTransition = async (
  actor: AuthUser,
  context: any,
  input: {
    from: Record<string, unknown>;
    action: "REQUESTED" | "CONFIRMED" | "REJECTED" | "CANCELLED" | "RESTORED";
    note: string;
    at: Date;
    set: Record<string, unknown>;
  },
): Promise<any> => OfficeDocumentContextModel.findOneAndUpdate(
    { _id: context._id, ...input.from },
    {
      $set: Object.fromEntries(
        Object.entries(input.set).map(([field, value]) => [`management.notRequired.${field}`, value]),
      ),
      $push: {
        "management.notRequired.history": {
          action: input.action,
          actor: actor.id,
          actorName: actorName(actor),
          note: input.note,
          actedAt: input.at,
        },
      },
    },
    { new: true, runValidators: true },
  ).lean();

const transition = async (
  actor: AuthUser,
  context: any,
  input: Parameters<typeof applyTransition>[2] & { conflictMessage: string },
) => {
  const { conflictMessage, ...change } = input;
  const updated = await applyTransition(actor, context, change);
  if (!updated) throw conflict(conflictMessage);
  return updated;
};

const appendNote = (context: any, entry: string) => appendOfficeDocumentManagementNote({
  contextId: idOf(context._id),
  organizationId: String(context.organizationId ?? ""),
  entry,
});

/** The specialist who owns a document hands it back as assigned by mistake. */
export const requestOfficeDocumentNotRequiredService = async (
  actor: AuthUser,
  id: unknown,
  body: Record<string, unknown>,
) => {
  const context = await loadContext(actor, id);
  if (actor.role.code !== "SPECIALIST" || effectiveOfficeDocumentOwnerId(context) !== actor.id) {
    throw forbidden("Chỉ chuyên viên đang phụ trách văn bản mới được chuyển lại lãnh đạo.");
  }
  const status = officeDocumentNotRequiredStatus(context);
  if (status === "PENDING") throw conflict("Văn bản đang chờ lãnh đạo xem xét.");
  if (status === "CONFIRMED") throw conflict("Lãnh đạo đã xác nhận văn bản này không cần làm.");
  // eOffice alone marking it done proves nothing about the work; a submitted
  // result does, so that document cannot be called unnecessary afterwards.
  if (context.management?.businessCompletion?.completed === true) {
    throw conflict("Văn bản đã có kết quả nên không thể chuyển lại là việc không cần làm.");
  }
  const reason = requiredText(body.reason, "Nhập lý do chuyển lại lãnh đạo.", "Lý do quá dài.");

  const now = new Date();
  const updated = await transition(actor, context, {
    from: {
      "management.notRequired.status": { $nin: ["PENDING", "CONFIRMED"] },
      "management.businessCompletion.completed": { $ne: true },
    },
    action: "REQUESTED",
    note: reason,
    at: now,
    set: {
      status: "PENDING",
      reason,
      requestedBy: actor.id,
      requestedByName: actorName(actor),
      requestedAt: now,
      decisionNote: "",
      decidedBy: null,
      decidedAt: null,
    },
    conflictMessage: "Trạng thái văn bản vừa thay đổi, hãy tải lại rồi thử lại.",
  });
  await appendNote(context, `${actorName(actor)} chuyển lại lãnh đạo: việc không cần làm. Lý do: ${reason}`);

  // Everyone who can act on it: the leaders of the owner's department and the
  // organization-wide roles. Leaders of other departments cannot decide it.
  const owner = await ownerOf(context);
  const notification = {
    actor: actor.id,
    type: "OFFICE_DOCUMENT_NOT_REQUIRED_REQUESTED",
    title: "Có văn bản đề nghị xem xét là việc không cần làm",
    message: `${symbolOf(context)}: ${reason}`,
    relatedModel: "IncomingDocument",
    relatedId: idOf(context._id),
    metadata: { reason, dedupeKey: `not-required:${idOf(context._id)}:${now.getTime()}` },
  };
  await notifyDepartmentLeaders(owner.departmentId, notification);
  for (const roleCode of ORGANIZATION_DECIDER_ROLES) {
    await notifyRoleUsers(roleCode, String(context.organizationId ?? ""), notification);
  }

  return { data: summarize(updated) };
};

/** The requester takes their own pending request back. */
export const cancelOfficeDocumentNotRequiredService = async (actor: AuthUser, id: unknown) => {
  const context = await loadContext(actor, id);
  const state = context.management?.notRequired;
  if (state?.status !== "PENDING") throw conflict("Không có đề nghị nào đang chờ xem xét.");
  if (idOf(state.requestedBy) !== actor.id) {
    throw forbidden("Chỉ người gửi mới hủy được đề nghị.");
  }
  const now = new Date();
  const updated = await transition(actor, context, {
    from: { "management.notRequired.status": "PENDING" },
    action: "CANCELLED",
    note: "",
    at: now,
    set: { status: "CANCELLED", decidedAt: now },
    conflictMessage: "Đề nghị vừa được lãnh đạo xử lý.",
  });
  await appendNote(context, `${actorName(actor)} đã hủy đề nghị việc không cần làm.`);
  return { data: summarize(updated) };
};

/**
 * Moving a task to someone else answers a pending request: the requester no
 * longer holds it, and leaving it pending would park it in the new owner's review
 * section, out of their KPI, with nobody having asked for that. Someone deciding
 * in the same instant simply wins, so a lost race is not an error here.
 */
export const closeNotRequiredAfterReassignment = async (actor: AuthUser, context: any) => {
  if (context.management?.notRequired?.status !== "PENDING") return;
  const now = new Date();
  const closed = await applyTransition(actor, context, {
    from: { "management.notRequired.status": "PENDING" },
    action: "CANCELLED",
    note: "Đã giao lại cho người khác.",
    at: now,
    set: { status: "CANCELLED", decidedBy: actor.id, decidedAt: now },
  });
  if (closed) {
    await appendNote(context, `${actorName(actor)} đã giao lại văn bản nên đề nghị việc không cần làm được đóng.`);
  }
};

/** A leader settles the request. Rejecting needs a reason, accepting does not. */
export const decideOfficeDocumentNotRequiredService = async (
  actor: AuthUser,
  id: unknown,
  body: Record<string, unknown>,
) => {
  const context = await loadContext(actor, id);
  await assertCanManageOfficeDocumentOwner(actor, context);
  const state = context.management?.notRequired;
  if (state?.status !== "PENDING") throw conflict("Không có đề nghị nào đang chờ xem xét.");

  const accept = body.accept === true || body.accept === "true";
  const decisionNote = accept
    ? optionalText(body.note, "Ý kiến quá dài.")
    : requiredText(body.note, "Nhập lý do từ chối.", "Lý do quá dài.");
  // A result can still be approved while the request waits. The work was done
  // then, and confirming would silently drop its points from the KPI.
  if (accept && context.management?.businessCompletion?.completed === true) {
    throw conflict("Văn bản đã có kết quả được duyệt nên không thể xác nhận không cần làm.");
  }

  const now = new Date();
  const updated = await transition(actor, context, {
    from: {
      "management.notRequired.status": "PENDING",
      ...(accept ? { "management.businessCompletion.completed": { $ne: true } } : {}),
    },
    action: accept ? "CONFIRMED" : "REJECTED",
    note: decisionNote,
    at: now,
    set: {
      status: accept ? "CONFIRMED" : "REJECTED",
      decisionNote,
      decidedBy: actor.id,
      decidedAt: now,
    },
    conflictMessage: "Đề nghị vừa thay đổi, hãy tải lại rồi thử lại.",
  });

  const entry = accept
    ? `${actorName(actor)} xác nhận việc không cần làm; văn bản không tính vào KPI.${decisionNote ? ` Ý kiến: ${decisionNote}` : ""}`
    : `${actorName(actor)} từ chối đề nghị việc không cần làm; văn bản tính KPI lại theo hạn cũ. Lý do: ${decisionNote}`;
  await appendNote(context, entry);

  const requesterId = idOf(state.requestedBy);
  if (requesterId) {
    await notifyUser(requesterId, {
      actor: actor.id,
      type: accept ? "OFFICE_DOCUMENT_NOT_REQUIRED_CONFIRMED" : "OFFICE_DOCUMENT_NOT_REQUIRED_REJECTED",
      title: accept ? "Văn bản được xác nhận không cần làm" : "Đề nghị việc không cần làm bị từ chối",
      message: `${symbolOf(context)}: ${entry}`,
      relatedModel: "IncomingDocument",
      relatedId: idOf(context._id),
      metadata: { note: decisionNote },
    });
  }

  return { data: summarize(updated) };
};

/**
 * Undoes a confirmed exclusion, which is why the exclusion can be soft. The
 * document returns as if never requested, with its original deadline; the
 * request and this undo both stay in the history.
 */
export const restoreOfficeDocumentNotRequiredService = async (
  actor: AuthUser,
  id: unknown,
  body: Record<string, unknown> = {},
) => {
  const context = await loadContext(actor, id);
  await assertCanManageOfficeDocumentOwner(actor, context);
  const state = context.management?.notRequired;
  if (state?.status !== "CONFIRMED") throw conflict("Văn bản không ở trạng thái đã xác nhận không cần làm.");
  const note = optionalText(body.note, "Ý kiến quá dài.");

  const now = new Date();
  const updated = await transition(actor, context, {
    from: { "management.notRequired.status": "CONFIRMED" },
    action: "RESTORED",
    note,
    at: now,
    set: {
      status: "NONE",
      reason: "",
      requestedBy: null,
      requestedByName: "",
      requestedAt: null,
      decisionNote: "",
      decidedBy: null,
      decidedAt: null,
    },
    conflictMessage: "Trạng thái văn bản vừa thay đổi, hãy tải lại rồi thử lại.",
  });
  const entry = `${actorName(actor)} khôi phục văn bản đã xác nhận không cần làm; văn bản tính KPI lại theo hạn cũ.${note ? ` Ý kiến: ${note}` : ""}`;
  await appendNote(context, entry);

  const requesterId = idOf(state.requestedBy);
  if (requesterId) {
    await notifyUser(requesterId, {
      actor: actor.id,
      type: "OFFICE_DOCUMENT_NOT_REQUIRED_RESTORED",
      title: "Văn bản được khôi phục vào danh sách tính KPI",
      message: `${symbolOf(context)}: ${entry}`,
      relatedModel: "IncomingDocument",
      relatedId: idOf(context._id),
      metadata: { note },
    });
  }

  return { data: summarize(updated) };
};
