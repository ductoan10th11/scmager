import { isValidObjectId } from "mongoose";
import {
  AuditLogModel,
  DocumentResultLinkModel,
  OfficeDocumentContextModel,
  UserModel,
} from "../models";
import { userRepository } from "../repositories/user.repository";
import type { AuthUser } from "../types/auth";
import { badRequest, conflict, forbidden, notFound } from "../utils/http-error";
import {
  createNotification,
  markAllDocumentResultNotificationsRead,
} from "./notification.service";
import {
  applyOfficeDocumentBusinessCompletion,
  clearOfficeDocumentBusinessCompletion,
  effectiveOfficeDocumentPoint,
  effectiveOfficeDocumentReworkCount,
  normalizeOfficeDocumentSymbol,
} from "./office-document-completion.service";
import { parseOfficeDate } from "./office-document-projection.service";

const idOf = (value: any) => String(value?._id ?? value ?? "");
const isAdmin = (actor: AuthUser) => actor.role.code === "ADMIN";
const isOrganizationLeader = (actor: AuthUser) =>
  ["OFFICE_CHIEF", "COMMUNE_LEADER"].includes(actor.role.code);
const isDepartmentLeader = (actor: AuthUser) =>
  actor.role.code === "DEPARTMENT_LEADER";
const isDuplicateKeyError = (error: any) => Number(error?.code) === 11000;

export const DOCUMENT_RESULT_INCOMING_POPULATE_SELECT =
  "_id organizationId externalDocumentId pageType observation management statusSync observedAt";
export const DOCUMENT_RESULT_OUTGOING_POPULATE_SELECT =
  "_id organizationId externalDocumentId pageType observation management statusSync observedAt";

const assertObjectId = (value: unknown, field: string) => {
  const result = String(value ?? "");
  if (!isValidObjectId(result)) throw badRequest(`${field} must be a valid ObjectId.`);
  return result;
};

const normalizedNote = (value: unknown, required = false) => {
  if (value === undefined || value === null) {
    if (required) throw badRequest("note is required.");
    return null;
  }
  if (typeof value !== "string") throw badRequest("note must be a string.");
  const result = value.trim().slice(0, 2_000);
  if (required && !result) throw badRequest("note is required.");
  return result || null;
};

const expectedRevision = (value: unknown) => {
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw badRequest("revision must be a positive integer.");
  }
  return revision;
};

const ensureOrganization = (actor: AuthUser, organizationId: unknown) => {
  if (isAdmin(actor)) return;
  if (!actor.organization || actor.organization !== idOf(organizationId)) {
    throw notFound("Document result link was not found.");
  }
};

const personMatchesActor = (person: any, actor: AuthUser) => {
  const values = [person?.userId, person?.username, person?.externalUsername]
    .map((value) => String(value ?? "").trim().toLowerCase())
    .filter(Boolean);
  return values.includes(actor.id.toLowerCase())
    || values.includes(String(actor.username ?? "").trim().toLowerCase());
};

const canReadIncoming = (actor: AuthUser, incoming: any) => {
  ensureOrganization(actor, incoming.organizationId);
  if (isAdmin(actor) || isOrganizationLeader(actor)) return true;
  const assignment = incoming.management?.assignment ?? {};
  const processing = incoming.statusSync?.processing ?? {};
  const directlyAssigned = idOf(assignment.userId) === actor.id
    || personMatchesActor(processing.currentAssignee, actor)
    || (processing.assignees ?? []).some((item: any) => personMatchesActor(item, actor));
  if (actor.role.code === "SPECIALIST") {
    return directlyAssigned
      || (incoming.observation?.recipients ?? []).some(
        (recipient: any) => recipient.role === "main" && personMatchesActor(recipient, actor),
      );
  }
  return directlyAssigned
    || (actor.department
      && (
        idOf(assignment.departmentId) === actor.department
        || (processing.assignees ?? []).some(
          (item: any) => idOf(item.departmentId) === actor.department,
        )
      ));
};

const canUseOutgoing = (actor: AuthUser, outgoing: any) => {
  ensureOrganization(actor, outgoing.organizationId);
  if (isAdmin(actor) || isOrganizationLeader(actor)) return true;
  const assignment = outgoing.management?.assignment ?? {};
  if (isDepartmentLeader(actor)) {
    return idOf(assignment.userId) === actor.id
      || Boolean(actor.department && idOf(assignment.departmentId) === actor.department);
  }
  return idOf(assignment.userId) === actor.id
    || personMatchesActor({
      userId: outgoing.management?.overrides?.draftingUserId
        ?? outgoing.observation?.draftingUserId,
    }, actor);
};

export const canReadDocumentResultLink = (
  actor: AuthUser,
  link: any,
  requireBothSides = false,
) => {
  const incoming = link?.incomingDocument;
  const outgoing = link?.outgoingDocument;
  if (!outgoing) return false;
  const canReadSource = incoming ? canReadIncoming(actor, incoming) : true;
  const canReadResult = canUseOutgoing(actor, outgoing);
  return requireBothSides
    ? canReadSource && canReadResult
    : canReadSource || canReadResult;
};

const loadIncomingById = async (actor: AuthUser, id: string) => {
  const incoming: any = await OfficeDocumentContextModel.findOne({
    _id: id,
    pageType: "incoming",
  }).lean();
  if (!incoming || !canReadIncoming(actor, incoming)) {
    throw notFound("Nhiệm vụ liên quan không tồn tại hoặc nằm ngoài phạm vi.");
  }
  return incoming;
};

const symbolOf = (context: any) =>
  context.management?.overrides?.soKyHieu
  ?? context.observation?.soKyHieu
  ?? "";

const resolveIncomingBySymbol = async (actor: AuthUser, rawSymbol: unknown) => {
  const symbol = normalizeOfficeDocumentSymbol(rawSymbol);
  if (!symbol) throw badRequest("soKyHieu is required.");
  if (!actor.organization && !isAdmin(actor)) {
    throw forbidden("User has no organization assigned.");
  }
  const candidates: any[] = await OfficeDocumentContextModel.find({
    pageType: "incoming",
    ...(actor.organization ? { organizationId: actor.organization } : {}),
    $or: [
      { normalizedSoKyHieu: symbol },
      { normalizedSoKyHieu: "" },
      { normalizedSoKyHieu: { $exists: false } },
    ],
  })
    .select("organizationId observation statusSync management normalizedSoKyHieu")
    .limit(5_000)
    .lean();
  const matches = candidates.filter(
    (context) => normalizeOfficeDocumentSymbol(symbolOf(context)) === symbol
      && canReadIncoming(actor, context),
  );
  if (!matches.length) {
    throw notFound("Không tìm thấy nhiệm vụ có số ký hiệu này trong phạm vi của bạn.");
  }
  if (matches.length > 1) {
    throw conflict("Số ký hiệu khớp nhiều nhiệm vụ. Hãy mở nhiệm vụ và liên kết trực tiếp.", {
      matches: matches.map((item) => ({
        id: idOf(item),
        soKyHieu: symbolOf(item),
        subject: item.management?.overrides?.subject ?? item.observation?.subject ?? "",
      })),
    });
  }
  const incoming = matches[0];
  if (!incoming.normalizedSoKyHieu) {
    await OfficeDocumentContextModel.updateOne(
      { _id: incoming._id },
      { $set: { normalizedSoKyHieu: symbol } },
    );
  }
  return incoming;
};

const loadOutgoing = async (actor: AuthUser, id: string) => {
  const outgoing: any = await OfficeDocumentContextModel.findOne({
    _id: id,
    pageType: { $in: ["outgoing", "outgoing_c2"] },
  }).lean();
  if (!outgoing || !canUseOutgoing(actor, outgoing)) {
    throw notFound("Sản phẩm không tồn tại hoặc nằm ngoài phạm vi.");
  }
  return outgoing;
};

const submittedAtFor = (outgoing: any, fallback: Date) => {
  const observed = {
    ...(outgoing.observation ?? {}),
    ...(outgoing.management?.overrides ?? {}),
  };
  const timelineDates = (observed.timeline ?? [])
    .flatMap((entry: any) => [
      entry?.["Thời gian"],
      entry?.["Đã xử lý"],
      entry?.["Đang xử lý"],
    ])
    .map((value: unknown) => parseOfficeDate(value))
    .filter((value: Date | null): value is Date => Boolean(value));
  if (timelineDates.length) {
    return timelineDates.sort(
      (left: Date, right: Date) => right.getTime() - left.getTime(),
    )[0];
  }
  return parseOfficeDate(outgoing.observedAt)
    ?? parseOfficeDate(observed.createdDate)
    ?? fallback;
};

const populateLink = (query: any) => query
  .populate(
    "incomingDocument",
    DOCUMENT_RESULT_INCOMING_POPULATE_SELECT,
  )
  .populate(
    "outgoingDocument",
    DOCUMENT_RESULT_OUTGOING_POPULATE_SELECT,
  )
  .populate("submittedBy", "_id username fullName position department role")
  .populate("performedBy", "_id username fullName position department role")
  .populate("approval.currentApprover", "_id username fullName position role")
  .populate("approval.history.actor", "_id username fullName position")
  .populate("approval.history.fromApprover", "_id username fullName position")
  .populate("approval.history.toApprover", "_id username fullName position");

const reload = async (id: string) => {
  const link = await populateLink(DocumentResultLinkModel.findById(id));
  if (!link) throw notFound("Document result link was not found.");
  return link;
};

const eligibleApproversFor = async (actor: AuthUser, organizationId: string) => {
  const users: any[] = await userRepository.findAssignmentParticipants({
    organization: organizationId,
    status: "ACTIVE",
  });
  return users.filter((candidate: any) => {
    if (idOf(candidate) === actor.id) return false;
    if (["OFFICE_CHIEF", "COMMUNE_LEADER"].includes(candidate.role?.code)) return true;
    return candidate.role?.code === "DEPARTMENT_LEADER"
      && actor.department
      && idOf(candidate.department) === actor.department;
  });
};

const fixedApproverFor = async (
  actor: AuthUser,
  organizationId: string,
  requestedApprover: unknown,
) => {
  if (isOrganizationLeader(actor)) return { selfApproved: true, currentApprover: actor.id };
  if (actor.role.code === "SPECIALIST") {
    return { selfApproved: false, currentApprover: null };
  }
  if (!isDepartmentLeader(actor)) {
    throw forbidden("Vai trò này không được gửi duyệt liên kết sản phẩm.");
  }
  const candidates: any[] = await userRepository.findAssignmentParticipants({
    organization: organizationId,
    status: "ACTIVE",
  });
  const requestedId = requestedApprover
    ? assertObjectId(requestedApprover, "approverId")
    : "";
  const target = requestedId
    ? candidates.find((candidate: any) => idOf(candidate) === requestedId)
    : candidates.find((candidate: any) =>
      ["OFFICE_CHIEF", "COMMUNE_LEADER"].includes(candidate.role?.code));
  if (!target || !["OFFICE_CHIEF", "COMMUNE_LEADER"].includes(target.role?.code)) {
    throw badRequest("Trưởng phòng phải gửi Chánh văn phòng hoặc Lãnh đạo xã duyệt.");
  }
  return { selfApproved: false, currentApprover: idOf(target) };
};

const canApproveOpen = async (actor: AuthUser, link: any) => {
  if (!link.approval?.openToHigher || isAdmin(actor)) return false;
  ensureOrganization(actor, link.organization);
  if (isOrganizationLeader(actor)) return true;
  if (!isDepartmentLeader(actor) || !actor.department) return false;
  const performer: any = link.performedBy?._id
    ? link.performedBy
    : await userRepository.findPublicById(
      idOf(link.performedBy ?? link.submittedBy),
    );
  return idOf(performer?.department) === actor.department;
};

const canDecide = async (actor: AuthUser, link: any) =>
  idOf(link.approval?.currentApprover) === actor.id
  || canApproveOpen(actor, link);

const createAudit = (
  actor: AuthUser,
  action: string,
  link: any,
  metadata: Record<string, unknown> = {},
) => AuditLogModel.create({
  actor: actor.id,
  action,
  entityModel: "DocumentResultLink",
  entityId: link._id,
  organization: link.organization,
  department: actor.department,
  metadata,
});

const notify = (
  recipient: string,
  actor: AuthUser,
  type: string,
  title: string,
  link: any,
  revision: number,
  message?: string,
) => createNotification({
  recipient,
  actor: actor.id,
  type,
  title,
  message,
  relatedModel: "DocumentResultLink",
  relatedId: idOf(link),
  metadata: {
    revision,
    dedupeKey: `document-result:${idOf(link)}:${type}:${revision}`,
  },
});

const applyLinkCompletion = async (
  link: any,
  incoming: any,
  outgoing: any,
  approvedBy: string,
  approvedAt: Date,
) => {
  if (!incoming) return { standalone: true };
  const values = documentResultCompletionValues(
    incoming,
    link.approval?.history ?? [],
  );
  return applyOfficeDocumentBusinessCompletion({
  incomingDocumentId: idOf(link.incomingDocument),
  organizationId: idOf(link.organization),
  evidenceType: "DOCUMENT_RESULT",
  evidenceId: idOf(link),
  submittedBy: idOf(link.performedBy ?? link.submittedBy),
  submittedAt: new Date(link.submittedAt),
  approvedBy,
  approvedAt,
  point: values.point,
  reworkCount: values.reworkCount,
});
};

export const documentResultCompletionValues = (
  incoming: any,
  approvalHistory: any[] = [],
) => ({
  point: effectiveOfficeDocumentPoint(incoming),
  reworkCount: effectiveOfficeDocumentReworkCount(incoming)
    + approvalHistory.filter(
      (entry: any) => entry.action === "RETURNED",
    ).length,
});

export const resolveDocumentResultPerformerId = (
  actorId: string,
  outgoing: any,
  incoming?: any,
) => {
  const draftingUserId = idOf(
    outgoing.management?.overrides?.draftingUserId
    ?? outgoing.observation?.draftingUserId,
  );
  if (isValidObjectId(draftingUserId)) return draftingUserId;
  const assignedUserId = idOf(outgoing.management?.assignment?.userId);
  if (isValidObjectId(assignedUserId)) return assignedUserId;
  const sourceAssigneeId = idOf(incoming?.management?.assignment?.userId);
  return isValidObjectId(sourceAssigneeId) ? sourceAssigneeId : actorId;
};

const resolveDocumentResultPerformer = async (
  actorId: string,
  outgoing: any,
  incoming?: any,
) => {
  const organizationId = idOf(outgoing.organizationId);
  const observed = {
    ...(outgoing.observation ?? {}),
    ...(outgoing.management?.overrides ?? {}),
  };
  const draftingUserId = String(observed.draftingUserId ?? "").trim();
  const draftingUser = String(observed.draftingUser ?? "").trim();
  const usernameCandidates = draftingUserId
    ? [...new Set([
      draftingUserId.toLowerCase(),
      draftingUserId.toLowerCase().replace(/\.lsn$/u, ""),
    ])]
    : [];
  const identityFilters: Record<string, unknown>[] = [];
  if (isValidObjectId(draftingUserId)) {
    identityFilters.push({ _id: draftingUserId });
  }
  if (usernameCandidates.length) {
    identityFilters.push({ username: { $in: usernameCandidates } });
  }
  if (draftingUser) identityFilters.push({ fullName: draftingUser });
  if (identityFilters.length) {
    const users: any[] = await UserModel.find({
      organization: organizationId,
      status: "ACTIVE",
      $or: identityFilters,
    })
      .select("_id")
      .limit(2)
      .lean();
    if (users.length === 1) return idOf(users[0]);
  }
  return resolveDocumentResultPerformerId(actorId, outgoing, incoming);
};

const finalizeLinkApproval = async ({
  actor,
  link,
  incoming,
  outgoing,
  now,
  note,
}: {
  actor: AuthUser;
  link: any;
  incoming: any;
  outgoing: any;
  now: Date;
  note: string | null;
}) => {
  const linkId = idOf(link);
  const organizationId = idOf(link.organization);
  const incomingDocumentId = idOf(link.incomingDocument);
  const source = await applyLinkCompletion(
    link,
    incoming,
    outgoing,
    actor.id,
    now,
  );
  if (!source) {
    throw conflict(
      "Nhiệm vụ nguồn đã được hoàn thành bằng một kết quả khác.",
    );
  }

  const updated: any = await DocumentResultLinkModel.findOneAndUpdate(
    {
      _id: linkId,
      status: "PENDING_APPROVAL",
      revision: Number(link.revision),
    },
    {
      $set: {
        status: "APPROVED",
        approvedAt: now,
        "approval.currentApprover": actor.id,
        "approval.openToHigher": false,
        "approval.approvedAt": now,
      },
      $inc: { revision: 1 },
      $push: {
        "approval.history": {
          action: "APPROVED",
          actor: actor.id,
          fromApprover: actor.id,
          toApprover: null,
          note,
          actedAt: now,
        },
      },
    },
    { new: true, runValidators: true },
  );
  if (updated) return updated;

  const latest: any = await DocumentResultLinkModel.findById(linkId).lean();
  if (incoming && latest?.status !== "APPROVED") {
    await clearOfficeDocumentBusinessCompletion({
      incomingDocumentId,
      organizationId,
      evidenceType: "DOCUMENT_RESULT",
      evidenceId: linkId,
    });
  }
  throw conflict("Sản phẩm đã được người khác xử lý. Hãy tải lại.");
};

export const resolveDocumentResultLinkService = async (
  actor: AuthUser,
  query: Record<string, unknown>,
) => {
  const incoming = await resolveIncomingBySymbol(actor, query.soKyHieu);
  return {
    data: {
      id: idOf(incoming),
      soKyHieu: symbolOf(incoming),
      subject: incoming.management?.overrides?.subject ?? incoming.observation?.subject ?? "",
      dueDate: incoming.management?.overrides?.dueDate ?? incoming.observation?.dueDate ?? "",
      assignee: incoming.management?.assignment ?? null,
      point: effectiveOfficeDocumentPoint(incoming),
    },
  };
};

export const listDocumentResultLinksService = async (
  actor: AuthUser,
  query: Record<string, unknown>,
) => {
  const allowed = new Set([
    "incomingDocumentId",
    "outgoingDocumentId",
    "pendingForMe",
    "status",
    "page",
    "limit",
  ]);
  for (const key of Object.keys(query)) {
    if (!allowed.has(key)) throw badRequest(`Unsupported query parameter: ${key}.`);
  }
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 30));
  const filter: Record<string, unknown> = {};
  if (!isAdmin(actor)) {
    if (!actor.organization) throw forbidden("User has no organization assigned.");
    filter.organization = actor.organization;
  }
  if (query.incomingDocumentId) {
    filter.incomingDocument = assertObjectId(query.incomingDocumentId, "incomingDocumentId");
  }
  if (query.outgoingDocumentId) {
    filter.outgoingDocument = assertObjectId(query.outgoingDocumentId, "outgoingDocumentId");
  }
  if (query.status) {
    const requestedStatuses = String(query.status)
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const invalid = requestedStatuses.find(
      (value) => ![
        "PENDING_APPROVAL",
        "APPROVED",
        "RETURNED",
        "SUPERSEDED",
      ].includes(value),
    );
    if (invalid) throw badRequest(`status is invalid: ${invalid}.`);
    if (requestedStatuses.length) filter.status = { $in: requestedStatuses };
  }
  if (query.pendingForMe === "true") {
    filter.status = "PENDING_APPROVAL";
    filter.$or = [
      { "approval.currentApprover": actor.id },
      { "approval.openToHigher": true },
    ];
  }
  const links: any[] = await populateLink(
    DocumentResultLinkModel.find(filter).sort({ updatedAt: -1 }),
  );
  const visible = [];
  for (const link of links) {
    const incoming = link.incomingDocument;
    const outgoing = link.outgoingDocument;
    if (!outgoing) continue;
    if (!canReadDocumentResultLink(actor, link)) continue;
    if (query.pendingForMe === "true" && !(await canDecide(actor, link))) continue;
    visible.push(link);
  }
  const start = (page - 1) * limit;
  const participants: any[] = actor.organization
    ? await userRepository.findAssignmentParticipants({
      organization: actor.organization,
      status: "ACTIVE",
    })
    : [];
  const approvers = participants
    .filter((candidate: any) => {
      if (idOf(candidate) === actor.id) return false;
      if (isDepartmentLeader(actor)) {
        return ["OFFICE_CHIEF", "COMMUNE_LEADER"].includes(
          candidate.role?.code,
        );
      }
      if (actor.role.code === "OFFICE_CHIEF") {
        return candidate.role?.code === "COMMUNE_LEADER";
      }
      return false;
    })
    .map((candidate: any) => ({
      id: idOf(candidate),
      fullName: candidate.fullName ?? "",
      position: candidate.position ?? "",
      roleCode: candidate.role?.code ?? "",
    }));
  return {
    data: visible.slice(start, start + limit),
    meta: {
      page,
      limit,
      total: visible.length,
      totalPages: Math.ceil(visible.length / limit),
      approvers,
    },
  };
};

export const createDocumentResultLinkService = async (
  actor: AuthUser,
  body: Record<string, unknown>,
) => {
  const outgoingId = assertObjectId(body.outgoingDocumentId, "outgoingDocumentId");
  const outgoing = await loadOutgoing(actor, outgoingId);
  const hasIncomingReference = Boolean(
    body.incomingDocumentId
    || String(body.soKyHieu ?? "").trim(),
  );
  if (!hasIncomingReference) {
    throw badRequest(
      "Nhiệm vụ liên quan là bắt buộc khi tạo liên kết sản phẩm.",
    );
  }
  const incoming = body.incomingDocumentId
    ? await loadIncomingById(
      actor,
      assertObjectId(body.incomingDocumentId, "incomingDocumentId"),
    )
    : await resolveIncomingBySymbol(actor, body.soKyHieu);
  if (
    incoming
    && idOf(incoming.organizationId) !== idOf(outgoing.organizationId)
  ) {
    throw forbidden("Nhiệm vụ và sản phẩm phải thuộc cùng tổ chức.");
  }
  const existingForOutgoing: any = await DocumentResultLinkModel.findOne({
    organization: outgoing.organizationId,
    outgoingDocument: outgoing._id,
  });
  if (
    existingForOutgoing
    && idOf(existingForOutgoing.incomingDocument) !== idOf(incoming)
  ) {
    throw conflict("Sản phẩm đã được liên kết với một nhiệm vụ khác.", {
      id: idOf(existingForOutgoing),
      status: existingForOutgoing.status,
    });
  }
  const existing = existingForOutgoing;
  if (existing && existing.status !== "RETURNED") {
    throw conflict("Sản phẩm đã được liên kết với nhiệm vụ này.", {
      id: idOf(existing),
      status: existing.status,
    });
  }
  if (
    existing
    && ![idOf(existing.submittedBy), idOf(existing.performedBy)].includes(actor.id)
  ) {
    throw forbidden("Chỉ người đã khai báo sản phẩm mới được gửi duyệt lại.");
  }

  const now = new Date();
  const submittedAt = submittedAtFor(outgoing, now);
  const approver = await fixedApproverFor(
    actor,
    idOf(outgoing.organizationId),
    body.approverId,
  );
  const note = normalizedNote(body.note);
  const performedBy = await resolveDocumentResultPerformer(
    actor.id,
    outgoing,
    incoming,
  );
  let link: any;
  const resubmitted = Boolean(existing);
  if (existing) {
    const updated = await DocumentResultLinkModel.findOneAndUpdate(
      { _id: existing._id, status: "RETURNED", revision: existing.revision },
      {
        $set: {
          status: "PENDING_APPROVAL",
          submittedAt,
          approvedAt: null,
          performedBy,
          "approval.currentApprover": approver.currentApprover,
          "approval.openToHigher": !approver.selfApproved && !approver.currentApprover,
          "approval.submittedAt": now,
          "approval.approvedAt": null,
          "approval.returnedAt": null,
        },
        $inc: { revision: 1 },
        $push: {
          "approval.history": {
            action: "SUBMITTED",
            actor: actor.id,
            fromApprover: null,
            toApprover: approver.currentApprover,
            note,
            actedAt: now,
          },
        },
      },
      { new: true, runValidators: true },
    );
    if (!updated) throw conflict("Liên kết đã thay đổi. Hãy tải lại.");
    link = updated;
  } else {
    try {
      link = await DocumentResultLinkModel.create({
        organization: outgoing.organizationId,
        incomingDocument: incoming?._id ?? null,
        outgoingDocument: outgoing._id,
        status: "PENDING_APPROVAL",
        submittedBy: actor.id,
        performedBy,
        submittedAt,
        approvedAt: null,
        revision: 1,
        approval: {
          currentApprover: approver.currentApprover,
          openToHigher: !approver.selfApproved && !approver.currentApprover,
          submittedAt: now,
          approvedAt: null,
          history: [{
            action: "SUBMITTED",
            actor: actor.id,
            fromApprover: null,
            toApprover: approver.currentApprover,
            note,
            actedAt: now,
          }],
        },
      });
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw conflict("Sản phẩm đã được liên kết với một nhiệm vụ khác.");
      }
      throw error;
    }
  }

  if (approver.selfApproved) {
    try {
      link = await finalizeLinkApproval({
        actor,
        link,
        incoming,
        outgoing,
        now,
        note,
      });
    } catch (error) {
      if (resubmitted) {
        await DocumentResultLinkModel.updateOne(
          {
            _id: link._id,
            status: "PENDING_APPROVAL",
            revision: link.revision,
          },
          {
            $set: {
              status: "RETURNED",
              approvedAt: null,
              "approval.currentApprover": null,
              "approval.openToHigher": false,
              "approval.approvedAt": null,
              "approval.returnedAt": now,
            },
            $inc: { revision: 1 },
          },
        );
      } else {
        await DocumentResultLinkModel.deleteOne({
          _id: link._id,
          status: "PENDING_APPROVAL",
        });
      }
      throw error;
    }
  } else {
    const recipients = approver.currentApprover
      ? [{ _id: approver.currentApprover }]
      : await eligibleApproversFor(actor, idOf(outgoing.organizationId));
    await Promise.allSettled(recipients.map((recipient: any) => notify(
      idOf(recipient),
      actor,
      "DOCUMENT_RESULT_SUBMITTED",
      "Có sản phẩm chờ duyệt",
      link,
      Number(link.revision),
      outgoing.observation?.subject ?? "",
    )));
  }
  await Promise.allSettled([
    createAudit(actor, approver.selfApproved
      ? "DOCUMENT_RESULT_LINK_APPROVED"
      : "DOCUMENT_RESULT_LINK_SUBMITTED", link, {
      incomingDocumentId: idOf(incoming),
      outgoingDocumentId: idOf(outgoing),
      revision: link.revision,
    }),
  ]);
  return { data: await reload(idOf(link)) };
};

export const approveDocumentResultLinkService = async (
  actor: AuthUser,
  id: unknown,
  body: Record<string, unknown>,
) => {
  const linkId = assertObjectId(id, "id");
  const revision = expectedRevision(body.revision);
  const current: any = await reload(linkId);
  ensureOrganization(actor, current.organization);
  if (current.status !== "PENDING_APPROVAL") {
    throw conflict("Sản phẩm không còn ở trạng thái chờ duyệt.");
  }
  if (!(await canDecide(actor, current))) throw forbidden("Bạn không có quyền duyệt sản phẩm này.");
  const now = new Date();
  const note = normalizedNote(body.note);
  if (Number(current.revision) !== revision) {
    throw conflict("Sản phẩm đã thay đổi. Hãy tải lại.");
  }
  const outgoing: any = current.outgoingDocument;
  const updated = await finalizeLinkApproval({
    actor,
    link: current,
    incoming: current.incomingDocument ?? null,
    outgoing,
    now,
    note,
  });
  const recipients = [...new Set([
    idOf(updated.submittedBy),
    idOf(updated.performedBy ?? updated.submittedBy),
  ].filter(Boolean))];
  await Promise.allSettled([
    markAllDocumentResultNotificationsRead(linkId),
    createAudit(actor, "DOCUMENT_RESULT_LINK_APPROVED", updated, {
      revision: updated.revision,
    }),
    ...recipients.map((recipient) => notify(
      recipient,
      actor,
      "DOCUMENT_RESULT_APPROVED",
      "Sản phẩm đã được duyệt",
      updated,
      Number(updated.revision),
    )),
  ]);
  return { data: await reload(linkId) };
};

export const returnDocumentResultLinkService = async (
  actor: AuthUser,
  id: unknown,
  body: Record<string, unknown>,
) => {
  const linkId = assertObjectId(id, "id");
  const revision = expectedRevision(body.revision);
  const note = normalizedNote(body.note, true);
  const current: any = await reload(linkId);
  ensureOrganization(actor, current.organization);
  if (current.status !== "PENDING_APPROVAL") {
    throw conflict("Sản phẩm không còn ở trạng thái chờ duyệt.");
  }
  if (!(await canDecide(actor, current))) throw forbidden("Bạn không có quyền trả lại sản phẩm này.");
  const now = new Date();
  const updated: any = await DocumentResultLinkModel.findOneAndUpdate(
    { _id: linkId, status: "PENDING_APPROVAL", revision },
    {
      $set: {
        status: "RETURNED",
        "approval.currentApprover": null,
        "approval.openToHigher": false,
        "approval.returnedAt": now,
      },
      $inc: { revision: 1 },
      $push: {
        "approval.history": {
          action: "RETURNED",
          actor: actor.id,
          fromApprover: actor.id,
          toApprover: current.submittedBy?._id ?? current.submittedBy,
          note,
          actedAt: now,
        },
      },
    },
    { new: true, runValidators: true },
  );
  if (!updated) throw conflict("Sản phẩm đã được người khác xử lý. Hãy tải lại.");
  const recipients = [...new Set([
    idOf(updated.submittedBy),
    idOf(updated.performedBy ?? updated.submittedBy),
  ].filter(Boolean))];
  await Promise.allSettled([
    markAllDocumentResultNotificationsRead(linkId),
    createAudit(actor, "DOCUMENT_RESULT_LINK_RETURNED", updated, {
      note,
      revision: updated.revision,
    }),
    ...recipients.map((recipient) => notify(
      recipient,
      actor,
      "DOCUMENT_RESULT_RETURNED",
      "Sản phẩm cần bổ sung",
      updated,
      Number(updated.revision),
      note ?? undefined,
    )),
  ]);
  return { data: await reload(linkId) };
};

export const forwardDocumentResultLinkService = async (
  actor: AuthUser,
  id: unknown,
  body: Record<string, unknown>,
) => {
  const linkId = assertObjectId(id, "id");
  const revision = expectedRevision(body.revision);
  const targetId = assertObjectId(body.approverId, "approverId");
  const note = normalizedNote(body.note, true);
  const current: any = await reload(linkId);
  ensureOrganization(actor, current.organization);
  if (current.status !== "PENDING_APPROVAL") {
    throw conflict("Sản phẩm không còn ở trạng thái chờ duyệt.");
  }
  if (!(await canDecide(actor, current))) throw forbidden("Bạn không có quyền chuyển duyệt sản phẩm này.");
  const target: any = await userRepository.findPublicById(targetId);
  if (!target || idOf(target.organization) !== idOf(current.organization) || target.status !== "ACTIVE") {
    throw badRequest("Người duyệt mới không hợp lệ.");
  }
  const validTarget = isDepartmentLeader(actor)
    ? ["OFFICE_CHIEF", "COMMUNE_LEADER"].includes(target.role?.code)
    : actor.role.code === "OFFICE_CHIEF"
      ? target.role?.code === "COMMUNE_LEADER"
      : false;
  if (!validTarget || targetId === actor.id) {
    throw forbidden("Chỉ được chuyển lên người duyệt cấp cao hơn.");
  }
  const now = new Date();
  const updated: any = await DocumentResultLinkModel.findOneAndUpdate(
    { _id: linkId, status: "PENDING_APPROVAL", revision },
    {
      $set: {
        "approval.currentApprover": targetId,
        "approval.openToHigher": false,
      },
      $inc: { revision: 1 },
      $push: {
        "approval.history": {
          action: "FORWARDED",
          actor: actor.id,
          fromApprover: actor.id,
          toApprover: targetId,
          note,
          actedAt: now,
        },
      },
    },
    { new: true, runValidators: true },
  );
  if (!updated) throw conflict("Sản phẩm đã được người khác xử lý. Hãy tải lại.");
  await Promise.allSettled([
    markAllDocumentResultNotificationsRead(linkId),
    createAudit(actor, "DOCUMENT_RESULT_LINK_FORWARDED", updated, {
      targetId,
      note,
      revision: updated.revision,
    }),
    notify(
      targetId,
      actor,
      "DOCUMENT_RESULT_FORWARDED",
      "Sản phẩm được chuyển duyệt",
      updated,
      Number(updated.revision),
      note ?? undefined,
    ),
  ]);
  return { data: await reload(linkId) };
};
