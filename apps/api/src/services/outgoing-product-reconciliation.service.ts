import { createHash } from "node:crypto";
import AuditLogModel from "../models/audit-log.model";
import DocumentResultLinkModel from "../models/document-result-link.model";
import OfficeDocumentContextModel from "../models/office-document-context.model";
import RoleModel from "../models/role.model";
import UserModel from "../models/user.model";
import {
  getAllOutgoingPublishedDocuments,
  getCsrfToken,
  getDocDetail,
  getLatestTrackLogPoint,
  getOutgoingDocumentDetail,
  getTrackLog,
  type OutgoingDocumentListItem,
  type TrackLogItem,
} from "./langson-dwr.service";
import {
  applyOfficeDocumentBusinessCompletion,
  clearOfficeDocumentBusinessCompletion,
  normalizeOfficeDocumentSymbol,
} from "./office-document-completion.service";
import { parseOfficeDate } from "./office-document-projection.service";
import {
  resolveContextManagementAssignment,
  upsertOfficeDocumentContext,
} from "./office-document-context.service";

const SOURCE_ORIGIN = process.env.LANGSON_APP_ORIGIN
  ?? "https://vanphongdientu.langson.gov.vn";
const ORG_PREFIX = process.env.LANGSON_ORG_PREFIX
  ?? "QLVB_LSN_XATHIENTAN.";
const MANAGER_ROLES = ["ADMIN", "OFFICE_CHIEF", "COMMUNE_LEADER", "DEPARTMENT_LEADER"];

const idOf = (value: any) => String(value?._id ?? value ?? "");

const vietnamYear = (date = new Date()) => Number(
  new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
  }).format(date),
);

const dateInYear = (value: unknown, year: number) => {
  const match = String(value ?? "").match(/^(\d{2})\/(\d{2})\/(\d{4})/u);
  return match ? Number(match[3]) === year : false;
};

const sourceFingerprint = (value: unknown) => createHash("sha256")
  .update(JSON.stringify(value))
  .digest("hex");

const needsReconciliation = (context: any) => {
  const state = context?.management?.product ?? {};
  const nextRetryAt = state.nextRetryAt ? new Date(state.nextRetryAt) : null;
  if (nextRetryAt && nextRetryAt.getTime() > Date.now()) return false;
  return !state.lastReconciledAt
    || state.performerStatus !== "RESOLVED"
    || state.classification === "PENDING_RELATION"
    || !state.classification
    || !state.scoreStatus
    || Boolean(state.lastError);
};

const retryDelayMs = (attempts: number) => Math.min(
  6 * 60 * 60_000,
  5 * 60_000 * (2 ** Math.min(7, Math.max(0, attempts - 1))),
);

const writeReconciliation = async (
  context: any,
  update: Record<string, unknown>,
  reason: string,
  retry = false,
) => {
  const previous = context.management?.product ?? {};
  const attempts = retry ? Math.min(1_000, Number(previous.attempts ?? 0) + 1) : 0;
  update["management.product.attempts"] = attempts;
  update["management.product.nextRetryAt"] = retry
    ? new Date(Date.now() + retryDelayMs(attempts))
    : null;
  const nextState = {
    classification: String(
      update["management.product.classification"] ?? previous.classification ?? "",
    ),
    performerStatus: String(
      update["management.product.performerStatus"] ?? previous.performerStatus ?? "",
    ),
    scoreStatus: String(
      update["management.product.scoreStatus"] ?? previous.scoreStatus ?? "",
    ),
  };
  const stateChanged = nextState.classification !== String(previous.classification ?? "")
    || nextState.performerStatus !== String(previous.performerStatus ?? "")
    || nextState.scoreStatus !== String(previous.scoreStatus ?? "");
  const operation: Record<string, unknown> = { $set: update };
  if (stateChanged) {
    operation.$push = {
      "management.product.history": {
        $each: [{ ...nextState, reason, recordedAt: new Date() }],
        $slice: -50,
      },
    };
  }
  await OfficeDocumentContextModel.updateOne({ _id: context._id }, operation);

  const previousOwner = idOf(context.management?.assignment?.userId);
  const nextOwner = idOf(update["management.assignment.userId"]);
  if (nextOwner && previousOwner !== nextOwner && !context.management?.updatedBy) {
    await AuditLogModel.create({
      actor: null,
      action: "OFFICE_PRODUCT_OWNER_RECONCILED",
      entityModel: "OfficeDocumentContext",
      entityId: context._id,
      organization: context.organizationId ?? null,
      metadata: { previousOwner: previousOwner || null, nextOwner, source: "EOFFICE_DRAFTER" },
    });
  }
};

const timelineFrom = (trackLogs: TrackLogItem[]) => trackLogs.map((item) => ({
  "Mã nhật ký": item.id,
  TT: item.sequence == null ? "" : String(item.sequence),
  "Người gửi": [
    item.sender.fullName,
    item.sender.username ? `(${item.sender.username})` : "",
  ].filter(Boolean).join(" "),
  "Người nhận": [
    item.receiver.fullName,
    item.receiver.username ? `(${item.receiver.username})` : "",
  ].filter(Boolean).join(" "),
  "Thao tác": item.action,
  "Nội dung": item.comment || item.content || item.action,
  "Thời gian": item.completedAt || item.processingAt || item.receivedAt || "",
}));


// eOffice prefixes the routing remark with a scoring header
// ("Điểm: 0.9, Làm lại: 1"). The extension already strips it before sending, so
// the same is done here to keep both paths writing the identical note.
const withoutScoreHeader = (text: string) => text
  .replace(/^\s*(?:điểm|diem)\s*:\s*[-\d.,]+\s*(?:[,;]\s*)?/iu, '')
  .replace(/^\s*(?:làm\s*lại|lam\s*lai)\s*:\s*\d+\s*(?:[,;]\s*)?/iu, '')
  .trim();

/**
 * Whoever routes a document on eOffice types their remarks into one free-text
 * box — the rework count lives inside that same text. Both the count and the
 * text itself are read off the newest entry that carries them, so the note the
 * clerk actually wrote shows up in scmager instead of being dropped.
 */
const routingSignalFrom = (trackLogs: TrackLogItem[]) => {
  const latest = [...trackLogs].sort(
    (left, right) => Number(right.sequence ?? 0) - Number(left.sequence ?? 0),
  );
  let note = "";
  for (const item of latest) {
    const text = `${item.comment ?? ""} ${item.content ?? ""}`.trim();
    if (!text) continue;
    if (!note) note = withoutScoreHeader(text);
    const match = text.match(/(?:làm\s*lại|lam\s*lai)\s*:\s*(\d+)/iu);
    if (match) return { reworkCount: Number(match[1]), note: withoutScoreHeader(text) };
  }
  return { reworkCount: 0, note };
};

const reworkCountFrom = (trackLogs: TrackLogItem[]) => routingSignalFrom(trackLogs).reworkCount;

const sourceActorAssignment = async (
  organizationId: string,
  trackLog: TrackLogItem | null,
) => trackLog
  ? resolveContextManagementAssignment({
      pageType: "outgoing",
      observation: {
        draftingUserId: trackLog.sender.username,
        draftingUser: trackLog.sender.fullName,
      },
    }, organizationId)
  : null;

const roleCodeFor = async (userId: string) => {
  const user: any = await UserModel.findById(userId)
    .select("role")
    .populate("role", "code")
    .lean();
  return String(user?.role?.code ?? "");
};

const managerForOrganization = async (organizationId: string) => {
  const roles = await RoleModel.find({
    code: { $in: ["OFFICE_CHIEF", "COMMUNE_LEADER"] },
  }).select("_id level").sort({ level: 1 }).lean();
  if (!roles.length) return null;
  return UserModel.findOne({
    organization: organizationId,
    status: "ACTIVE",
    role: { $in: roles.map((role: any) => role._id) },
  }).select("_id").lean();
};

const upsertIncomingSource = async (
  externalDocumentId: string,
  organizationId: string,
  csrfToken: string,
) => {
  const sourceHost = new URL(SOURCE_ORIGIN).host.toLowerCase();
  const existing = await OfficeDocumentContextModel.findOne({
    sourceHost,
    pageType: "incoming",
    externalDocumentId,
  }).lean();
  if (existing) {
    const existingOrganizationId = idOf(existing.organizationId);
    if (existingOrganizationId && existingOrganizationId !== organizationId) {
      throw new Error(`Incoming source ${externalDocumentId} belongs to another organization`);
    }
    if (!existingOrganizationId) {
      const assignment = await resolveContextManagementAssignment(
        existing,
        organizationId,
      );
      await OfficeDocumentContextModel.updateOne(
        { _id: existing._id, organizationId: null },
        {
          $set: {
            organizationId,
            tenantResolution: "DRAFTING_USER",
            ...(assignment ? {
              "management.assignment.departmentId": assignment.departmentId,
              "management.assignment.departmentName": assignment.departmentName,
              "management.assignment.userId": assignment.userId,
              "management.assignment.fullName": assignment.fullName,
            } : {}),
          },
        },
      );
      return OfficeDocumentContextModel.findById(existing._id).lean();
    }
    return existing;
  }
  // Scheduled Langson synchronization only reconciles records observed by
  // the extension. Missing incoming documents must not be created here.
  return null;
};

const autoLinkOfficialRelation = async (
  product: any,
  incoming: any,
  performerId: string,
) => {
  const organizationId = idOf(product.organizationId);
  const manager: any = await managerForOrganization(organizationId);
  if (!manager) throw new Error("No organization leader is available for official relation audit");
  const now = new Date();
  const productValues = {
    ...(product.observation ?? {}),
    ...(product.management?.overrides ?? {}),
  };
  const submittedAt = parseOfficeDate(productValues.createdDate) ?? now;
  let linkChanged = false;
  let link: any = await DocumentResultLinkModel.findOne({
    organization: organizationId,
    outgoingDocument: product._id,
  }).lean();
  if (link && idOf(link.incomingDocument) !== idOf(incoming)) {
    throw new Error("Product is already linked to another source task");
  }
  if (!link) {
    linkChanged = true;
    link = await DocumentResultLinkModel.create({
      organization: organizationId,
      incomingDocument: incoming._id,
      outgoingDocument: product._id,
      status: "APPROVED",
      submittedBy: performerId,
      performedBy: performerId,
      submittedAt,
      approvedAt: now,
      revision: 1,
      approval: {
        currentApprover: manager._id,
        openToHigher: false,
        submittedAt,
        approvedAt: now,
        history: [{
          action: "APPROVED",
          actor: manager._id,
          fromApprover: null,
          toApprover: null,
          note: "Quan hệ chính thức từ eOffice.",
          actedAt: now,
        }],
      },
    });
  } else if (link.status !== "APPROVED") {
    linkChanged = true;
    link = await DocumentResultLinkModel.findByIdAndUpdate(
      link._id,
      {
        $set: {
          status: "APPROVED",
          performedBy: performerId,
          approvedAt: now,
          "approval.currentApprover": manager._id,
          "approval.openToHigher": false,
          "approval.approvedAt": now,
        },
        $inc: { revision: 1 },
        $push: {
          "approval.history": {
            action: "APPROVED",
            actor: manager._id,
            note: "Quan hệ chính thức từ eOffice.",
            actedAt: now,
          },
        },
      },
      { new: true, runValidators: true },
    ).lean();
  }
  if (!link) throw new Error("Official document relation could not be persisted");
  const completion = await applyOfficeDocumentBusinessCompletion({
    incomingDocumentId: idOf(incoming),
    organizationId,
    evidenceType: "DOCUMENT_RESULT",
    evidenceId: idOf(link),
    submittedBy: performerId,
    submittedAt,
    approvedBy: idOf(manager),
    approvedAt: now,
    point: incoming.management?.manualScore
      ?? incoming.management?.overrides?.point
      ?? incoming.observation?.point
      ?? null,
    reworkCount: Number(
      incoming.management?.overrides?.reworkCount
      ?? incoming.observation?.reworkCount
      ?? 0,
    ),
  });
  if (!completion) {
    await DocumentResultLinkModel.findByIdAndUpdate(link._id, {
      $set: { status: "SUPERSEDED" },
      $inc: { revision: 1 },
      $push: {
        "approval.history": {
          action: "SUPERSEDED",
          actor: manager._id,
          note: "Nhiệm vụ nguồn đã hoàn thành bằng bằng chứng khác.",
          actedAt: now,
        },
      },
    });
    throw new Error("Source task is already completed by different evidence");
  }
  if (linkChanged) {
    await AuditLogModel.create({
      actor: manager._id,
      action: "DOCUMENT_RESULT_LINK_AUTO_APPROVED",
      entityModel: "DocumentResultLink",
      entityId: link._id,
      organization: organizationId,
      metadata: {
        incomingDocumentId: idOf(incoming),
        outgoingDocumentId: idOf(product),
        source: "EOFFICE",
      },
    });
  }
  return link;
};

const supersedeRemovedOfficialRelation = async (product: any) => {
  if (product.management?.product?.classification !== "LINKED_RESULT") return;
  const organizationId = idOf(product.organizationId);
  const link: any = await DocumentResultLinkModel.findOne({
    organization: organizationId,
    outgoingDocument: product._id,
    status: "APPROVED",
  }).lean();
  if (!link) return;
  const manager: any = await managerForOrganization(organizationId);
  if (!manager) throw new Error("No organization leader is available to supersede relation");
  await clearOfficeDocumentBusinessCompletion({
    incomingDocumentId: idOf(link.incomingDocument),
    organizationId,
    evidenceType: "DOCUMENT_RESULT",
    evidenceId: idOf(link),
  });
  await DocumentResultLinkModel.findByIdAndUpdate(link._id, {
    $set: { status: "SUPERSEDED" },
    $inc: { revision: 1 },
    $push: {
      "approval.history": {
        action: "SUPERSEDED",
        actor: manager._id,
        note: "eOffice không còn ghi nhận quan hệ nhiệm vụ nguồn.",
        actedAt: new Date(),
      },
    },
  });
};

export type OutgoingProductSyncSummary = {
  year: number;
  discovered: number;
  created: number;
  updated: number;
  linked: number;
  standalone: number;
  pendingRelation: number;
  unresolved: number;
  approvedPoints: number;
  skipped: number;
  skippedMissing: number;
  failed: number;
  errors: string[];
};

const reconcileProduct = async (
  context: any,
  options: {
    csrfToken: string;
    relatedIncomingExternalIds?: string[];
    pointInfo?: ReturnType<typeof getLatestTrackLogPoint>;
    sourceFingerprint?: string;
  },
) => {
  const organizationId = idOf(context.organizationId);
  if (!organizationId) {
    await writeReconciliation(context, {
        "management.product.performerStatus": "UNRESOLVED",
        "management.product.lastError": "Organization is unresolved",
        "management.product.lastReconciledAt": new Date(),
      }, "Organization is unresolved", true);
    return "unresolved" as const;
  }
  const managedAssignment = context.management?.updatedBy
    ? context.management?.assignment ?? null
    : null;
  const assignment = context.management?.updatedBy
    ? (managedAssignment?.userId ? managedAssignment : null)
    : await resolveContextManagementAssignment(context, organizationId);
  const pointInfo = options.pointInfo ?? null;
  const pointActor = await sourceActorAssignment(
    organizationId,
    pointInfo?.trackLog ?? null,
  );
  const pointActorRole = pointActor?.userId
    ? await roleCodeFor(idOf(pointActor.userId))
    : "";
  const sourcePointApproved = Boolean(
    pointInfo && pointActor?.userId && MANAGER_ROLES.includes(pointActorRole),
  );
  const relatedIds: string[] = [...new Set<string>((
    options.relatedIncomingExternalIds === undefined
      ? context.management?.product?.relatedIncomingExternalIds ?? []
      : options.relatedIncomingExternalIds
  ).map((value: unknown) => String(value)).filter(Boolean))];
  const relatedSymbol = String(
    context.management?.overrides?.relatedIncomingSoKyHieu
    ?? context.observation?.relatedIncomingSoKyHieu
    ?? "",
  ).trim();
  const now = new Date();
  const update: Record<string, unknown> = {
    "management.assignment.departmentId": assignment?.departmentId ?? null,
    "management.assignment.departmentName": assignment?.departmentName ?? "",
    "management.assignment.userId": assignment?.userId ?? null,
    "management.assignment.fullName": assignment?.fullName ?? "",
    "management.product.performerStatus": assignment ? "RESOLVED" : "UNRESOLVED",
    "management.product.relatedIncomingExternalIds": relatedIds,
    "management.product.proposedPoint": pointInfo?.point
      ?? context.management?.product?.proposedPoint
      ?? context.observation?.point
      ?? null,
    "management.product.sourcePointTrackLogId": pointInfo?.trackLogId
      ?? context.management?.product?.sourcePointTrackLogId
      ?? "",
    "management.product.sourceFingerprint": options.sourceFingerprint
      ?? context.management?.product?.sourceFingerprint
      ?? "",
    "management.product.lastReconciledAt": now,
    "management.product.lastError": "",
  };
  if (sourcePointApproved) {
    update["management.manualScore"] = pointInfo?.point;
    update["management.product.scoreStatus"] = "APPROVED";
    update["management.product.scoreSource"] = "EOFFICE";
    update["management.product.approvedBy"] = pointActor?.userId;
    update["management.product.approvedAt"] = now;
  } else if (context.management?.product?.scoreSource === "EOFFICE") {
    update["management.manualScore"] = null;
    update["management.product.scoreStatus"] = "PENDING";
    update["management.product.scoreSource"] = pointInfo ? "EOFFICE" : "NONE";
    update["management.product.approvedBy"] = null;
    update["management.product.approvedAt"] = null;
  } else if (context.management?.product?.scoreStatus !== "APPROVED") {
    update["management.product.scoreStatus"] = "PENDING";
    update["management.product.scoreSource"] = pointInfo ? "EOFFICE" : "NONE";
  }

  if (!assignment) {
    update["management.product.classification"] = relatedIds.length || relatedSymbol
      ? "PENDING_RELATION"
      : "STANDALONE_PRODUCT";
    update["management.product.lastError"] = "Drafting user is unresolved or ambiguous";
    await writeReconciliation(
      context,
      update,
      "Drafting user is unresolved or ambiguous",
      true,
    );
    return "unresolved" as const;
  }

  if (!relatedIds.length && !relatedSymbol) {
    await supersedeRemovedOfficialRelation(context);
    update["management.product.classification"] = "STANDALONE_PRODUCT";
    await writeReconciliation(context, update, "No source task relation");
    return "standalone" as const;
  }

  let incoming: any = null;
  for (const externalId of relatedIds) {
    try {
      incoming = await upsertIncomingSource(externalId, organizationId, options.csrfToken);
      if (incoming && idOf(incoming.organizationId) === organizationId) break;
    } catch (error) {
      update["management.product.lastError"] = error instanceof Error
        ? error.message
        : String(error);
      incoming = null;
    }
  }
  if (!incoming && relatedSymbol) {
    const matches: any[] = await OfficeDocumentContextModel.find({
      organizationId,
      pageType: "incoming",
      normalizedSoKyHieu: normalizeOfficeDocumentSymbol(relatedSymbol),
    }).limit(2).lean();
    if (matches.length === 1) incoming = matches[0];
    else if (matches.length > 1) {
      update["management.product.lastError"] = "Related incoming symbol is ambiguous";
    }
  }
  if (!incoming) {
    update["management.product.classification"] = "PENDING_RELATION";
    update["management.product.lastError"] = update["management.product.lastError"]
      || "Related incoming document is not available";
    await writeReconciliation(
      context,
      update,
      String(update["management.product.lastError"]),
      true,
    );
    return "pendingRelation" as const;
  }

  await autoLinkOfficialRelation(context, incoming, idOf(assignment.userId));
  update["management.product.classification"] = "LINKED_RESULT";
  update["management.product.scoreStatus"] = "NOT_APPLICABLE";
  update["management.product.scoreSource"] = "SOURCE_TASK";
  await writeReconciliation(context, update, "Official eOffice relation linked");
  return "linked" as const;
};

const persistPublishedProduct = async (
  item: OutgoingDocumentListItem,
  csrfToken: string,
) => {
  const sourceHost = new URL(SOURCE_ORIGIN).host.toLowerCase();
  const existing: any = await OfficeDocumentContextModel.findOne({
    sourceHost,
    pageType: { $in: ["outgoing", "outgoing_c2"] },
    externalDocumentId: item.documentId,
  })
    .select("_id pageType management.product")
    .lean();
  if (!existing) return { created: false, outcome: "missing" as const };

  const [detail, trackLogs] = await Promise.all([
    getOutgoingDocumentDetail(item.documentId, csrfToken),
    getTrackLog(item.documentId, ORG_PREFIX, csrfToken),
  ]);
  const pointInfo = getLatestTrackLogPoint(trackLogs);
  const routingSignal = routingSignalFrom(trackLogs);
  const fingerprint = sourceFingerprint({ item, detail, trackLogs });
  const previous: any = await OfficeDocumentContextModel.findOne({
    sourceHost,
    pageType: existing.pageType,
    externalDocumentId: item.documentId,
  })
    .select("management.product observation")
    .lean();
  if (
    previous?.management?.product?.sourceFingerprint === fingerprint
    && !needsReconciliation(previous)
  ) {
    return { created: false, outcome: "skipped" as const };
  }
  const result = await upsertOfficeDocumentContext({
    available: true,
    modalOpen: false,
    pageType: existing.pageType,
    title: "Văn bản đi",
    documentId: item.documentId,
    subject: item.trichYeu,
    soKyHieu: item.soKyHieu,
    receivedDate: "",
    dueDate: "",
    documentForm: detail.documentType ?? item.hinhThuc,
    priority: detail.priority ?? item.doKhan,
    createdDate: detail.issuedDate ?? detail.createdDate ?? item.ngayVanBan,
    draftingUnit: detail.draftingOrganization ?? item.donViSoanThao,
    draftingUnitId: "",
    draftingUser: detail.drafter.fullName ?? "",
    draftingUserId: detail.drafter.username ?? "",
    senderUser: previous?.observation?.senderUser ?? "",
    senderUserId: previous?.observation?.senderUserId ?? "",
    senderDepartment: previous?.observation?.senderDepartment ?? "",
    sender: previous?.observation?.sender ?? { userId: "", fullName: "", department: "" },
    relatedIncomingSoKyHieu: "",
    // The extension is the source of truth for these four fields. Reconciliation
    // only fills them in when the extension has not supplied a value, so a sync
    // never overwrites what the extension (or a person) already recorded.
    comment: previous?.observation?.comment || pointInfo?.comment || "",
    point: previous?.observation?.point ?? pointInfo?.point ?? null,
    reworkCount: previous?.observation?.reworkCount || routingSignal.reworkCount,
    note: previous?.observation?.note || routingSignal.note || "",
    recipients: [],
    timeline: timelineFrom(trackLogs),
    url: `${SOURCE_ORIGIN}/qlvbdh_lsn/main?documentId=${encodeURIComponent(item.documentId)}`,
  }, { createIfMissing: false });
  if (!result.data) return { created: false, outcome: "missing" as const };
  const context: any = await OfficeDocumentContextModel.findById(result.data.id).lean();
  if (!context) throw new Error(`Outgoing product ${item.documentId} was not persisted`);
  const outcome = await reconcileProduct(context, {
    csrfToken,
    relatedIncomingExternalIds: detail.originalDocumentIds,
    pointInfo,
    sourceFingerprint: fingerprint,
  });
  return { created: result.data.created, outcome };
};

const markProductFailure = async (
  externalDocumentId: string,
  pageType: "outgoing" | "outgoing_c2",
  message: string,
) => {
  const filter = {
    sourceHost: new URL(SOURCE_ORIGIN).host.toLowerCase(),
    pageType,
    externalDocumentId,
  };
  const current: any = await OfficeDocumentContextModel.findOne(filter)
    .select("management.product.attempts")
    .lean();
  if (!current) return;
  const attempts = Math.min(
    1_000,
    Number(current.management?.product?.attempts ?? 0) + 1,
  );
  await OfficeDocumentContextModel.updateOne(
    { _id: current._id },
    {
      $set: {
        "management.product.lastError": message,
        "management.product.lastReconciledAt": new Date(),
        "management.product.nextRetryAt": new Date(Date.now() + retryDelayMs(attempts)),
        "management.product.attempts": attempts,
      },
    },
  );
};

export async function syncCurrentYearOutgoingProducts(options: {
  year?: number;
  dryRun?: boolean;
  maxPages?: number;
} = {}): Promise<OutgoingProductSyncSummary> {
  const year = options.year ?? vietnamYear();
  const summary: OutgoingProductSyncSummary = {
    year,
    discovered: 0,
    created: 0,
    updated: 0,
    linked: 0,
    standalone: 0,
    pendingRelation: 0,
    unresolved: 0,
    approvedPoints: 0,
    skipped: 0,
    skippedMissing: 0,
    failed: 0,
    errors: [],
  };
  const csrfToken = await getCsrfToken();
  const items = await getAllOutgoingPublishedDocuments({
    year,
    maxPages: options.maxPages,
    csrfToken,
  });
  summary.discovered = items.length;
  if (options.dryRun) {
    const existing: any[] = await OfficeDocumentContextModel.find({
      sourceHost: new URL(SOURCE_ORIGIN).host.toLowerCase(),
      pageType: { $in: ["outgoing", "outgoing_c2"] },
      externalDocumentId: { $in: items.map((item) => item.documentId) },
    }).select("externalDocumentId").lean();
    const existingIds = new Set(existing.map((item) => String(item.externalDocumentId)));
    summary.skippedMissing = items.filter((item) => !existingIds.has(item.documentId)).length;
    summary.updated = items.length - summary.skippedMissing;
    return summary;
  }

  for (const item of items) {
    try {
      const result = await persistPublishedProduct(item, csrfToken);
      if (result.outcome === "skipped") {
        summary.skipped += 1;
      } else if (result.outcome === "missing") {
        summary.skippedMissing += 1;
      } else {
        summary[result.created ? "created" : "updated"] += 1;
        summary[result.outcome] += 1;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      summary.failed += 1;
      summary.errors.push(`${item.documentId}: ${message}`);
      await markProductFailure(item.documentId, "outgoing", message).catch(() => undefined);
    }
  }

  const publishedContexts: any[] = await OfficeDocumentContextModel.find({
    sourceHost: new URL(SOURCE_ORIGIN).host.toLowerCase(),
    pageType: { $in: ["outgoing", "outgoing_c2"] },
    externalDocumentId: { $in: items.map((item) => item.documentId) },
  }).select("organizationId").lean();
  const organizationIds = [...new Set(
    publishedContexts.map((item) => idOf(item.organizationId)).filter(Boolean),
  )];
  const tenantScope = organizationIds.length
    ? { $or: [{ organizationId: { $in: organizationIds } }, { organizationId: null }] }
    : { organizationId: null };
  const stored: any[] = await OfficeDocumentContextModel.find({
    sourceHost: new URL(SOURCE_ORIGIN).host.toLowerCase(),
    pageType: { $in: ["outgoing", "outgoing_c2"] },
    ...tenantScope,
  })
    .select("organizationId pageType externalDocumentId observation management origin observedAt")
    .lean();
  const storedInYear = stored.filter((item) => dateInYear(
    item.management?.overrides?.createdDate ?? item.observation?.createdDate,
    year,
  ));
  for (const context of storedInYear) {
    if (items.some((item) => item.documentId === context.externalDocumentId)) continue;
    if (!needsReconciliation(context)) {
      summary.skipped += 1;
      continue;
    }
    try {
      const outcome = await reconcileProduct(context, { csrfToken });
      summary[outcome] += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      summary.failed += 1;
      summary.errors.push(`${context.externalDocumentId}: ${message}`);
      await markProductFailure(
        context.externalDocumentId,
        context.pageType,
        message,
      ).catch(() => undefined);
    }
  }
  const approvedProducts: any[] = await OfficeDocumentContextModel.find({
    sourceHost: new URL(SOURCE_ORIGIN).host.toLowerCase(),
    pageType: { $in: ["outgoing", "outgoing_c2"] },
    "management.product.scoreStatus": "APPROVED",
    ...tenantScope,
  })
    .select("observation.createdDate management.overrides.createdDate")
    .lean();
  summary.approvedPoints = approvedProducts.filter((context) => dateInYear(
    context.management?.overrides?.createdDate ?? context.observation?.createdDate,
    year,
  )).length;
  return summary;
}

export const outgoingProductReconciliationInternals = {
  dateInYear,
  needsReconciliation,
  reworkCountFrom,
  retryDelayMs,
  sourceFingerprint,
  upsertIncomingSource,
};
