import { isValidObjectId } from "mongoose";
import OfficeDocumentContextModel from "../models/office-document-context.model";
import DepartmentModel from "../models/department.model";
import UserModel from "../models/user.model";
import DocumentResultLinkModel from "../models/document-result-link.model";
import ConfigModel from "../models/config.model";
import type { AuthUser } from "../types/auth";
import { badRequest, conflict, forbidden, notFound } from "../utils/http-error";
import {
  getCsrfToken,
  getDocDetail,
  getDocList,
  getLatestTrackLogPoint,
  getTrackLog,
  isCompletedDocumentTrackLog,
  LANGSON_COMPLETED_RULE,
  newestNgayDenFilter,
  type TrackLogItem,
} from "./langson-dwr.service";
import { resolveDocumentWorkflow } from "./document-workflow.service";
import {
  effectiveOfficeDocumentCompletion,
  effectiveOfficeDocumentPoint,
  effectiveOfficeProductPoint,
  normalizeOfficeDocumentSymbol,
} from "./office-document-completion.service";
import {
  canReadDocumentResultLink,
  createDocumentResultLinkService,
  DOCUMENT_RESULT_INCOMING_POPULATE_SELECT,
  DOCUMENT_RESULT_OUTGOING_POPULATE_SELECT,
  resolveDocumentResultLinkService,
} from "./document-result-link.service";

const PAGE_TYPES = ["incoming", "outgoing", "outgoing_c2"] as const;
const RECIPIENT_ROLES = [
  "main",
  "collaborator",
  "view",
  "co_send",
  "co_process",
];
const ENTITY_TYPES = ["person", "unit"];
type Input = Record<string, unknown>;
const MANAGER_ROLES = new Set([
  "ADMIN",
  "OFFICE_CHIEF",
  "COMMUNE_LEADER",
  "DEPARTMENT_LEADER",
]);

const personMatchesActor = (person: any, actor: AuthUser) => {
  const identities = new Set(
    [actor.id, actor.username, actor.fullName]
      .map(normalizedIdentity)
      .filter(Boolean),
  );
  return [
    person?.userId,
    person?.externalUsername,
    person?.username,
    person?.fullName,
    person?.externalFullName,
  ].some((value) => identities.has(normalizedIdentity(value)));
};

const actorCanReadOfficeDocument = (context: any, actor: AuthUser) => {
  if (["ADMIN", "OFFICE_CHIEF", "COMMUNE_LEADER"].includes(actor.role.code)) return true;

  const assignment = context.management?.assignment ?? {};
  const processing = context.statusSync?.processing ?? {};
  const observation = {
    ...(context.observation ?? {}),
    ...(context.management?.overrides ?? {}),
  };
  const participantMatches = (person: any) => personMatchesActor(person, actor);
  const directlyAssigned = participantMatches(assignment)
    || participantMatches(processing.currentAssignee)
    || (processing.assignees ?? []).some(participantMatches);

  if (actor.role.code === "DEPARTMENT_LEADER") {
    return directlyAssigned
      || (actor.department && String(assignment.departmentId ?? "") === actor.department)
      || (processing.assignees ?? []).some(
        (participant: any) => String(participant?.departmentId ?? "") === actor.department,
      );
  }

  if (context.pageType !== "incoming") {
    return directlyAssigned || participantMatches({
      userId: observation.draftingUserId ?? observation.senderUserId,
      fullName: observation.draftingUser ?? observation.senderUser,
    });
  }

  // Co-processors are intentionally excluded. Only the primary recipient may view
  // a document before the workflow has been resolved into processing.assignees.
  return directlyAssigned || (observation.recipients ?? []).some(
    (recipient: any) => recipient?.role === "main" && participantMatches(recipient),
  );
};
const MANAGED_FIELDS = [
  "title",
  "subject",
  "soKyHieu",
  "receivedDate",
  "dueDate",
  "documentForm",
  "priority",
  "createdDate",
  "draftingUnit",
  "draftingUnitId",
  "draftingUser",
  "draftingUserId",
  "senderUser",
  "senderUserId",
  "senderDepartment",
  "sender",
  "relatedIncomingSoKyHieu",
  "comment",
  "point",
  "reworkCount",
  "note",
  "recipients",
  "timeline",
] as const;

const string = (
  value: unknown,
  field: string,
  max: number,
  required = false,
) => {
  if (value === undefined || value === null) {
    if (required) throw badRequest(`${field} is required.`);
    return "";
  }
  if (typeof value !== "string") throw badRequest(`${field} must be a string.`);
  const result = value.trim();
  if (required && !result) throw badRequest(`${field} is required.`);
  if (result.length > max)
    throw badRequest(`${field} must be ${max} characters or fewer.`);
  return result;
};

const bool = (value: unknown, field: string) => {
  if (typeof value !== "boolean")
    throw badRequest(`${field} must be a boolean.`);
  return value;
};

const record = (value: unknown, field: string): Input => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw badRequest(`${field} must be an object.`);
  return value as Input;
};

const normalizeTimeline = (value: unknown) => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 100)
    throw badRequest("timeline must be an array containing at most 100 items.");
  return value.map((entry, index) => {
    const item = record(entry, `timeline[${index}]`);
    const fields = Object.entries(item);
    if (fields.length > 32)
      throw badRequest(`timeline[${index}] must contain at most 32 fields.`);
    return Object.fromEntries(
      fields.map(([key, itemValue]) => [
        string(key, `timeline[${index}] key`, 120, true),
        string(itemValue, `timeline[${index}].${key}`, 2000),
      ]),
    );
  });
};

const normalizeRecipients = (value: unknown) => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 200)
    throw badRequest(
      "recipients must be an array containing at most 200 items.",
    );
  return value.map((entry, index) => {
    const item = record(entry, `recipients[${index}]`);
    const role = string(item.role, `recipients[${index}].role`, 30, true);
    const entityType = string(
      item.entityType,
      `recipients[${index}].entityType`,
      20,
      true,
    );
    if (!RECIPIENT_ROLES.includes(role))
      throw badRequest(`recipients[${index}].role is invalid.`);
    if (!ENTITY_TYPES.includes(entityType))
      throw badRequest(`recipients[${index}].entityType is invalid.`);
    return {
      userId: string(item.userId, `recipients[${index}].userId`, 240),
      department: string(
        item.department,
        `recipients[${index}].department`,
        500,
      ),
      fullName: string(item.fullName, `recipients[${index}].fullName`, 500),
      role,
      entityType,
    };
  });
};

const normalizeSender = (value: unknown) => {
  if (value === undefined || value === null)
    return { userId: "", fullName: "", department: "" };
  const sender = record(value, "sender");
  const allowed = new Set(["userId", "fullName", "department"]);
  for (const key of Object.keys(sender)) {
    if (!allowed.has(key))
      throw badRequest(`Unsupported sender field: ${key}.`);
  }
  return {
    userId: string(sender.userId, "sender.userId", 240),
    fullName: string(sender.fullName, "sender.fullName", 500),
    department: string(sender.department, "sender.department", 500),
  };
};

const usernameVariants = (value: unknown) => {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return [];
  const withoutLangsonSuffix = raw.replace(/\.lsn$/u, "");
  return [...new Set([raw, withoutLangsonSuffix].filter(Boolean))];
};

const normalizedIdentity = (value: unknown) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\.lsn$/iu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

type TenantResolution = "SENDER" | "RECIPIENT" | "DRAFTING_USER" | "DEPARTMENT" | "AMBIGUOUS" | "UNRESOLVED";

type TenantMatch = {
  organizationId: string | null;
  resolution: TenantResolution;
};

type ResolvedManagementAssignment = {
  departmentId: unknown | null;
  departmentName: string;
  userId: unknown | null;
  fullName: string;
};

const tenantFromUsernames = async (
  values: unknown[],
  resolution: Exclude<TenantResolution, "DEPARTMENT" | "AMBIGUOUS" | "UNRESOLVED">,
): Promise<TenantMatch | null> => {
  const usernames = [...new Set(values.flatMap(usernameVariants))];
  if (!usernames.length) return null;
  const users = await UserModel.find({
    username: { $in: usernames },
    status: "ACTIVE",
    organization: { $ne: null },
  }).select("organization").lean();
  const organizations = [...new Set(users.map((user: any) => String(user.organization ?? "")).filter(Boolean))];
  if (!organizations.length) return null;
  if (organizations.length !== 1) return { organizationId: null, resolution: "AMBIGUOUS" };
  return { organizationId: organizations[0], resolution };
};

const tenantFromDepartments = async (values: unknown[]): Promise<TenantMatch | null> => {
  const names = new Set(values.map(normalizedIdentity).filter(Boolean));
  if (!names.size) return null;
  const departments = await DepartmentModel.find({ isActive: true, organization: { $ne: null } })
    .select("name organization")
    .lean();
  const organizations = [...new Set(
    departments
      .filter((department: any) => names.has(normalizedIdentity(department.name)))
      .map((department: any) => String(department.organization ?? ""))
      .filter(Boolean),
  )];
  if (!organizations.length) return null;
  if (organizations.length !== 1) return { organizationId: null, resolution: "AMBIGUOUS" };
  return { organizationId: organizations[0], resolution: "DEPARTMENT" };
};

const resolveContextTenant = async (context: { pageType: string; observation: any }): Promise<TenantMatch> => {
  const observation = context.observation ?? {};
  const senderIds = [observation.sender?.userId, observation.senderUserId];
  const recipientIds = (observation.recipients ?? [])
    .filter((recipient: any) => recipient?.entityType === "person")
    .map((recipient: any) => recipient.userId);
  const draftingIds = [observation.draftingUserId];
  const userGroups = context.pageType === "incoming"
    ? [[senderIds, "SENDER"], [recipientIds, "RECIPIENT"], [draftingIds, "DRAFTING_USER"]] as const
    : [[senderIds, "SENDER"], [draftingIds, "DRAFTING_USER"], [recipientIds, "RECIPIENT"]] as const;

  for (const [ids, resolution] of userGroups) {
    const match = await tenantFromUsernames(ids, resolution);
    if (match) return match;
  }

  return (await tenantFromDepartments([
    observation.sender?.department,
    observation.senderDepartment,
    observation.draftingUnit,
    ...(observation.recipients ?? []).map((recipient: any) => recipient.department || recipient.fullName),
  ])) ?? { organizationId: null, resolution: "UNRESOLVED" };
};

/**
 * Extension observations identify people by their eOffice username, while the
 * application assigns KPI by its internal User id. The main recipient is the
 * first authoritative owner of an incoming document; never infer ownership
 * from collaborators or "Đồng xử lý" recipients.
 */
const assignmentFromUsernames = async (
  values: unknown[],
  organizationId: string | null,
): Promise<ResolvedManagementAssignment | null> => {
  const usernames = [...new Set(values.flatMap(usernameVariants))];
  if (!usernames.length) return null;
  const filter: Record<string, unknown> = {
    username: { $in: usernames },
    status: "ACTIVE",
  };
  if (organizationId) filter.organization = organizationId;
  const users = await UserModel.find(filter)
    .select("_id fullName department organization")
    .lean();
  const uniqueUsers = [...new Map(users.map((user: any) => [String(user._id), user])).values()];
  if (uniqueUsers.length !== 1) return null;

  const user: any = uniqueUsers[0];
  const department = user.department
    ? await DepartmentModel.findOne({
        _id: user.department,
        isActive: true,
        ...(organizationId ? { organization: organizationId } : {}),
      })
        .select("_id name")
        .lean()
    : null;
  return {
    departmentId: department?._id ?? null,
    departmentName: department?.name ?? "",
    userId: user._id,
    fullName: user.fullName ?? "",
  };
};

const resolveContextManagementAssignment = async (
  context: { pageType: string; observation: any },
  organizationId: string | null,
): Promise<ResolvedManagementAssignment | null> => {
  const observation = context.observation ?? {};
  const recipients = Array.isArray(observation.recipients)
    ? observation.recipients
    : [];
  const mainRecipientIds = recipients
    .filter((recipient: any) => recipient?.entityType === "person" && recipient?.role === "main")
    .map((recipient: any) => recipient.userId);
  const draftingIds = [observation.draftingUserId];
  const senderIds = [observation.sender?.userId, observation.senderUserId];

  // Incoming documents belong to the person receiving the work. Outgoing
  // records are supporting evidence, so prefer their drafter/sender instead.
  const groups = context.pageType === "incoming"
    ? [mainRecipientIds, draftingIds, senderIds]
    : [draftingIds, senderIds, mainRecipientIds];
  for (const ids of groups) {
    const assignment = await assignmentFromUsernames(ids, organizationId);
    if (assignment) return assignment;
  }
  return null;
};

export const normalizeOfficeDocumentContext = (payload: unknown) => {
  const body = record(payload, "Request body");
  const allowed = new Set([
    "available",
    "pageType",
    "title",
    "documentId",
    "subject",
    "soKyHieu",
    "receivedDate",
    "dueDate",
    "documentForm",
    "priority",
    "createdDate",
    "draftingUnit",
    "draftingUnitId",
    "draftingUser",
    "draftingUserId",
    "senderUser",
    "senderUserId",
    "senderDepartment",
    "sender",
    "relatedIncomingSoKyHieu",
    "comment",
    "point",
    "reworkCount",
    "note",
    "recipients",
    "timeline",
    "modalOpen",
    "url",
  ]);
  for (const key of Object.keys(body)) {
    if (!allowed.has(key))
      throw badRequest(`Unsupported payload field: ${key}.`);
  }
  const pageType = string(body.pageType, "pageType", 20, true);
  if (!PAGE_TYPES.includes(pageType as (typeof PAGE_TYPES)[number]))
    throw badRequest("pageType is invalid.");
  const sourceUrl = string(body.url, "url", 2048, true);
  let sourceHost: string;
  try {
    const parsed = new URL(sourceUrl);
    if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname)
      throw new Error("invalid protocol");
    sourceHost = parsed.host.toLowerCase();
  } catch {
    throw badRequest("url must be an absolute http(s) URL.");
  }
  const point =
    body.point === null || body.point === undefined || body.point === ""
      ? null
      : Number(body.point);
  if (
    point !== null &&
    (!Number.isFinite(point) || Math.abs(point) > 1_000_000)
  )
    throw badRequest("point must be a finite number.");
  const reworkCount =
    body.reworkCount === undefined ||
    body.reworkCount === null ||
    body.reworkCount === ""
      ? 0
      : Number(body.reworkCount);
  if (
    !Number.isSafeInteger(reworkCount) ||
    reworkCount < 0 ||
    reworkCount > 10000
  )
    throw badRequest("reworkCount must be an integer from 0 to 10000.");
  const soKyHieu = string(body.soKyHieu, "soKyHieu", 500);
  return {
    sourceHost,
    pageType,
    externalDocumentId: string(body.documentId, "documentId", 240, true),
    sourceUrl,
    normalizedSoKyHieu: normalizeOfficeDocumentSymbol(soKyHieu),
    observation: {
      available: bool(body.available, "available"),
      modalOpen: bool(body.modalOpen, "modalOpen"),
      title: string(body.title, "title", 500),
      subject: string(body.subject, "subject", 4000),
      soKyHieu,
      receivedDate: string(body.receivedDate, "receivedDate", 100),
      dueDate: string(body.dueDate, "dueDate", 100),
      documentForm: string(body.documentForm, "documentForm", 300),
      priority: string(body.priority, "priority", 200),
      createdDate: string(body.createdDate, "createdDate", 100),
      draftingUnit: string(body.draftingUnit, "draftingUnit", 500),
      draftingUnitId: string(body.draftingUnitId, "draftingUnitId", 240),
      draftingUser: string(body.draftingUser, "draftingUser", 500),
      draftingUserId: string(body.draftingUserId, "draftingUserId", 240),
      senderUser: string(body.senderUser, "senderUser", 500),
      senderUserId: string(body.senderUserId, "senderUserId", 240),
      senderDepartment: string(body.senderDepartment, "senderDepartment", 500),
      sender: normalizeSender(body.sender),
      relatedIncomingSoKyHieu: string(
        body.relatedIncomingSoKyHieu,
        "relatedIncomingSoKyHieu",
        500,
      ),
      comment: string(body.comment, "comment", 12000),
      point,
      reworkCount,
      note: string(body.note, "note", 12000),
      recipients: normalizeRecipients(body.recipients),
      timeline: normalizeTimeline(body.timeline),
    },
  };
};

export const upsertOfficeDocumentContext = async (payload: unknown) => {
  const normalized = normalizeOfficeDocumentContext(payload);
  const tenant = await resolveContextTenant(normalized);
  const filter = {
    sourceHost: normalized.sourceHost,
    pageType: normalized.pageType,
    externalDocumentId: normalized.externalDocumentId,
  };
  const previous = await OfficeDocumentContextModel.findOne(filter)
    .select("management.assignment management.updatedBy")
    .lean();
  // Any management edit, including intentionally clearing an assignment, is
  // authoritative over extension-derived ownership.
  const isManaged = Boolean(previous?.management?.updatedBy);
  const assignment = isManaged
    ? null
    : await resolveContextManagementAssignment(normalized, tenant.organizationId);
  const observedAt = new Date();
  const update = () =>
    OfficeDocumentContextModel.findOneAndUpdate(
      filter,
      {
        $set: {
          ...normalized,
          ...(tenant.organizationId ? {
            organizationId: tenant.organizationId,
            tenantResolution: tenant.resolution,
          } : {}),
          ...(assignment
            ? {
                "management.assignment.departmentId": assignment.departmentId,
                "management.assignment.departmentName": assignment.departmentName,
                "management.assignment.userId": assignment.userId,
                "management.assignment.fullName": assignment.fullName,
              }
            : {}),
          observedAt,
        },
      },
      { new: true, runValidators: true },
    );
  const existing = await update();
  if (existing) {
    return {
      data: {
        id: String(existing._id),
        created: false,
        sourceHost: normalized.sourceHost,
        pageType: normalized.pageType,
        externalDocumentId: normalized.externalDocumentId,
      },
    };
  }

  try {
    const created = await OfficeDocumentContextModel.create({
      ...normalized,
      organizationId: tenant.organizationId,
      tenantResolution: tenant.resolution,
      ...(assignment
        ? {
            management: { assignment },
          }
        : {}),
      observedAt,
    });
    return {
      data: {
        id: String(created._id),
        created: true,
        sourceHost: normalized.sourceHost,
        pageType: normalized.pageType,
        externalDocumentId: normalized.externalDocumentId,
      },
    };
  } catch (error: any) {
    if (error?.code !== 11000) throw error;
    const recovered = await update();
    if (!recovered) throw error;
    return {
      data: {
        id: String(recovered._id),
        created: false,
        sourceHost: normalized.sourceHost,
        pageType: normalized.pageType,
        externalDocumentId: normalized.externalDocumentId,
      },
    };
  }
};

/** One-time repair for extension contexts received before tenant/owner mapping. */
export const backfillOfficeDocumentContextTenants = async () => {
  const contexts = await OfficeDocumentContextModel.find({
    $or: [
      { organizationId: null },
      { "management.assignment.userId": null, "management.updatedBy": null },
    ],
  })
    .select("pageType observation organizationId management.assignment management.updatedBy")
    .lean();
  let resolved = 0;
  let ambiguous = 0;
  let assignmentResolved = 0;
  for (const context of contexts as any[]) {
    const tenant = context.organizationId
      ? { organizationId: String(context.organizationId), resolution: "UNRESOLVED" as TenantResolution }
      : await resolveContextTenant(context);
    const assignment = context.management?.updatedBy || context.management?.assignment?.userId
      ? null
      : await resolveContextManagementAssignment(context, tenant.organizationId);
    const update: Record<string, unknown> = {};
    if (!context.organizationId) {
      update.organizationId = tenant.organizationId;
      update.tenantResolution = tenant.resolution;
    }
    if (assignment) {
      update["management.assignment.departmentId"] = assignment.departmentId;
      update["management.assignment.departmentName"] = assignment.departmentName;
      update["management.assignment.userId"] = assignment.userId;
      update["management.assignment.fullName"] = assignment.fullName;
      assignmentResolved += 1;
    }
    await OfficeDocumentContextModel.updateOne(
      { _id: context._id },
      Object.keys(update).length ? { $set: update } : {},
    );
    if (!context.organizationId) {
      if (tenant.organizationId) resolved += 1;
      else if (tenant.resolution === "AMBIGUOUS") ambiguous += 1;
    }
  }
  const unresolved = contexts.filter((context: any) => !context.organizationId).length - resolved - ambiguous;
  return { scanned: contexts.length, resolved, ambiguous, unresolved, assignmentResolved };
};

export const listOfficeDocumentContexts = async (
  actor: AuthUser,
  query: Record<string, unknown>,
) => {
  const allowed = [
    "page",
    "limit",
    "tab",
    "pageType",
    "search",
    "departmentId",
    "userId",
    "deadlineStatus",
    "dateField",
    "dateFrom",
    "dateTo",
  ];
  for (const [key, value] of Object.entries(query)) {
    if (!allowed.includes(key))
      throw badRequest(`Unsupported query parameter: ${key}.`);
    if (Array.isArray(value)) throw badRequest(`${key} must be provided once.`);
  }
  const page = query.page === undefined ? 1 : Number(query.page);
  const requestedLimit = query.limit === undefined ? 25 : Number(query.limit);
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isSafeInteger(requestedLimit) ||
    requestedLimit < 1
  )
    throw badRequest("page and limit must be positive integers.");
  const limit = Math.min(requestedLimit, 100);
  const skip = (page - 1) * limit;
  if (!Number.isSafeInteger(skip)) throw badRequest("page is too large.");
  const selection = String(query.pageType ?? query.tab ?? "incoming");
  const pageType =
    selection === "incoming"
      ? "incoming"
      : selection === "outgoing" ||
          selection === "outgoing,outgoing_c2" ||
          selection === "outgoing_c2,outgoing"
        ? { $in: ["outgoing", "outgoing_c2"] }
        : selection === "outgoing_c2"
          ? "outgoing_c2"
          : null;
  if (!pageType)
    throw badRequest("pageType must be incoming, outgoing, or outgoing_c2.");
  const search = string(query.search, "search", 120);
  const regex = search
    ? new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
    : null;
  const filter: Record<string, unknown> = { pageType };
  if (actor.role.code !== "ADMIN") {
    if (!actor.organization) throw forbidden("User has no organization assigned.");
    filter.organizationId = actor.organization;
  }
  if (regex)
    filter.$or = [
      { externalDocumentId: regex },
      { "observation.subject": regex },
      { "observation.soKyHieu": regex },
      { "observation.draftingUnit": regex },
    ];
  const departmentId = string(query.departmentId, "departmentId", 240);
  const userId = string(query.userId, "userId", 240);
  const requestedDeadlineStatuses = string(
    query.deadlineStatus,
    "deadlineStatus",
    200,
  )
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const deadlineStatuses = new Set([
    "DONE_ON_TIME",
    "DONE_LATE",
    "PENDING_IN_TIME",
    "PENDING_OVERDUE",
  ]);
  if (requestedDeadlineStatuses.some((value) => !deadlineStatuses.has(value)))
    throw badRequest("deadlineStatus is invalid.");
  const dateField = string(query.dateField, "dateField", 30) || "observed";
  if (
    !["observed", "due", "received", "created", "synced", "completed"].includes(
      dateField,
    )
  )
    throw badRequest("dateField is invalid.");
  const parseFilterDate = (value: string, end = false) => {
    if (!value) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
      throw badRequest("dateFrom and dateTo must use YYYY-MM-DD.");
    const parsed = new Date(
      `${value}T${end ? "23:59:59.999" : "00:00:00.000"}+07:00`,
    );
    if (Number.isNaN(parsed.getTime()))
      throw badRequest("dateFrom and dateTo are invalid.");
    return parsed;
  };
  const dateFrom = parseFilterDate(string(query.dateFrom, "dateFrom", 20));
  const dateTo = parseFilterDate(string(query.dateTo, "dateTo", 20), true);
  if (dateFrom && dateTo && dateFrom > dateTo)
    throw badRequest("dateFrom must be before dateTo.");

  const parseDocumentDate = (value: unknown, end = false): Date | null => {
    if (!value) return null;
    if (value instanceof Date) return value;
    const raw = String(value).trim();
    const vietnam = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (vietnam) {
      const [, day, month, year] = vietnam;
      return new Date(
        `${year}-${month}-${day}T${end ? "23:59:59.999" : "00:00:00.000"}+07:00`,
      );
    }
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };
  const trackingFor = (context: any) => {
    const sync = context.statusSync ?? {};
    const processing = sync.processing ?? {};
    const managedAssignment = context.management?.assignment ?? {};
    const isOfficeClerk = (participant: any) =>
      String(
        participant?.externalUsername ?? participant?.username ?? "",
      ).toLowerCase() === "vanthu-xathientan" ||
      String(participant?.externalFullName ?? participant?.fullName ?? "")
        .toLowerCase()
        .includes("văn thư xã thiện tân");
    const processedAssignee =
      [...(processing.assignees ?? [])]
        .filter(
          (participant: any) =>
            participant?.fullName && !isOfficeClerk(participant),
        )
        .sort((left: any, right: any) =>
          String(right.processedAt ?? right.assignedAt ?? "").localeCompare(
            String(left.processedAt ?? left.assignedAt ?? ""),
          ),
        )[0] ?? {};
    const workflowAssignee = processing.currentAssignee?.fullName
      ? processing.currentAssignee
      : processedAssignee;
    const assignee = managedAssignment.fullName
      ? {
          source: "MANUAL",
          userId: managedAssignment.userId
            ? String(managedAssignment.userId)
            : "",
          fullName: managedAssignment.fullName,
          departmentId: managedAssignment.departmentId
            ? String(managedAssignment.departmentId)
            : "",
          departmentName: managedAssignment.departmentName ?? "",
        }
      : {
          source: "INGEST",
          userId: workflowAssignee.userId
            ? String(workflowAssignee.userId)
            : "",
          fullName: workflowAssignee.fullName ?? "",
          departmentId: workflowAssignee.departmentId
            ? String(workflowAssignee.departmentId)
            : "",
          departmentName: "",
        };
    const observed = (field: string) =>
      context.management?.overrides?.[field] ?? context.observation?.[field];
    const dueAt = parseDocumentDate(observed("dueDate"), true);
    const completion = effectiveOfficeDocumentCompletion(context);
    const completedAt = completion.completedAt;
    const completed = completion.completed;
    const now = new Date();
    const deadlineStatus = !dueAt
      ? "NO_DEADLINE"
      : completed
        ? (completedAt ?? now) <= dueAt
          ? "DONE_ON_TIME"
          : "DONE_LATE"
        : now <= dueAt
          ? "PENDING_IN_TIME"
          : "PENDING_OVERDUE";
    const status = completed
      ? "COMPLETED"
      : context.pageType !== "incoming"
        ? "NOT_SYNCED"
        : String(sync.status || "PENDING_RESPONSE");
    const officialActorName = workflowAssignee.fullName || "Chuyên viên";
    const responseCreator =
      [...(sync.trackLogs ?? [])]
        .filter(
          (trackLog: any) =>
            String(trackLog?.action ?? "")
              .normalize("NFC")
              .trim()
              .toLowerCase() === "đã tạo phúc đáp",
        )
        .sort(
          (left: any, right: any) =>
            Number(right?.sequence ?? 0) - Number(left?.sequence ?? 0),
        )[0]?.sender?.fullName || officialActorName;
    const statusLabel =
      status === "COMPLETED"
        ? "Đã xử lý"
        : status === "RESPONSE_CREATED"
          ? `${responseCreator} đã tạo phúc đáp`
          : status === "IN_PROGRESS"
            ? `${workflowAssignee.fullName || "Chưa xác định"} đang xử lý`
            : status === "PENDING_RESPONSE"
              ? "Văn thư chưa tạo phúc đáp"
              : "Chưa đồng bộ trạng thái";
    const date =
      dateField === "due"
        ? dueAt
        : dateField === "received"
          ? parseDocumentDate(observed("receivedDate"))
          : dateField === "created"
            ? parseDocumentDate(observed("createdDate"))
            : dateField === "synced"
              ? parseDocumentDate(sync.lastSyncedAt)
              : dateField === "completed"
                ? completedAt
                : parseDocumentDate(context.observedAt);
    const score = effectiveOfficeDocumentPoint(context);
    return {
      assignee,
      dueAt,
      completedAt,
      deadlineStatus,
      status,
      statusLabel,
      date,
      score,
      manualScore: context.management?.manualScore ?? null,
      completionSource: completion.source,
    };
  };

  const allItems = await OfficeDocumentContextModel.find(filter)
    .sort({ updatedAt: -1 })
    .lean();
  const selectedUser =
    userId && isValidObjectId(userId)
      ? await UserModel.findOne({ _id: userId, status: "ACTIVE" })
          .select("_id username fullName department")
          .lean()
      : null;
  const selectedDepartment =
    departmentId && isValidObjectId(departmentId)
      ? await DepartmentModel.findOne({ _id: departmentId, isActive: true })
          .select("_id name")
          .lean()
      : null;
  const departmentUsers = selectedDepartment
    ? await UserModel.find({
        department: selectedDepartment._id,
        status: "ACTIVE",
      })
        .select("_id username fullName department")
        .lean()
    : [];
  const matchesPeople = (context: any, tracking: any, people: any[]) => {
    const ids = new Set(people.map((person) => String(person._id)));
    const identities = new Set(
      people
        .flatMap((person) => [
          normalizedIdentity(person.username),
          normalizedIdentity(person.fullName),
        ])
        .filter(Boolean),
    );
    const observed = (field: string) =>
      context.management?.overrides?.[field] ?? context.observation?.[field];
    const matches = (id: unknown, ...values: unknown[]) =>
      ids.has(String(id ?? "")) ||
      values.some((value) => identities.has(normalizedIdentity(value)));
    const manual = context.management?.assignment ?? {};
    if (matches(manual.userId, manual.fullName)) return true;
    if (matches(tracking.assignee?.userId, tracking.assignee?.fullName))
      return true;
    if (context.pageType === "incoming") {
      return (observed("recipients") ?? []).some((recipient: any) =>
        matches(
          recipient.userId,
          recipient.userId,
          recipient.fullName,
          recipient.department,
        ),
      );
    }
    return matches(
      observed("draftingUserId"),
      observed("draftingUserId"),
      observed("draftingUser"),
    );
  };
  const relatedIncomingSymbols = [
    ...new Set(
      allItems
        .filter((context: any) => context.pageType !== "incoming")
        .map((context: any) =>
          String(
            context.management?.overrides?.relatedIncomingSoKyHieu ??
              context.observation?.relatedIncomingSoKyHieu ??
              "",
          ).trim(),
        )
        .map(normalizeOfficeDocumentSymbol)
        .filter(Boolean),
    ),
  ];
  const linkedIncoming = relatedIncomingSymbols.length
    ? await OfficeDocumentContextModel.find({
        pageType: "incoming",
        ...(actor.role.code !== "ADMIN"
          ? { organizationId: actor.organization }
          : {}),
        normalizedSoKyHieu: { $in: relatedIncomingSymbols },
      }).lean()
    : [];
  const incomingPoints = new Map(
    linkedIncoming.map((context: any) => {
      const symbol = String(
        context.management?.overrides?.soKyHieu ??
          context.observation?.soKyHieu ??
          "",
      ).trim();
      const score =
        context.management?.manualScore ??
        context.management?.overrides?.point ??
        context.observation?.point ??
        null;
      return [
        `${context.organizationId ?? ""}|${normalizeOfficeDocumentSymbol(symbol)}`,
        score,
      ];
    }),
  );
  const itemsWithTracking = allItems.map((context: any) => {
    const tracking = trackingFor(context);
    if (context.pageType !== "incoming") {
      const relatedSymbol = String(
        context.management?.overrides?.relatedIncomingSoKyHieu ??
          context.observation?.relatedIncomingSoKyHieu ??
          "",
      ).trim();
      const relatedPoint = relatedSymbol
        ? incomingPoints.get(
          `${context.organizationId ?? ""}|${normalizeOfficeDocumentSymbol(relatedSymbol)}`,
        )
        : undefined;
      tracking.score = effectiveOfficeProductPoint(context, relatedPoint);
    }
    return { ...context, tracking };
  });
  const items = itemsWithTracking.filter((context: any) => {
    const tracking = context.tracking;
    if (!actorCanReadOfficeDocument(context, actor)) return false;
    if (userId && !selectedUser) return false;
    if (departmentId && !selectedDepartment) return false;
    if (
      selectedUser &&
      selectedDepartment &&
      String(selectedUser.department ?? "") !== String(selectedDepartment._id)
    )
      return false;
    if (selectedUser && !matchesPeople(context, tracking, [selectedUser]))
      return false;
    if (selectedDepartment) {
      const isManualDepartment =
        String(context.management?.assignment?.departmentId ?? "") ===
        String(selectedDepartment._id);
      const isWorkflowDepartment =
        String(tracking.assignee?.departmentId ?? "") ===
        String(selectedDepartment._id);
      const isUnitRecipient =
        context.pageType === "incoming" &&
        (
          context.management?.overrides?.recipients ??
          context.observation?.recipients ??
          []
        ).some(
          (recipient: any) =>
            recipient.entityType === "unit" &&
            normalizedIdentity(recipient.department || recipient.fullName) ===
              normalizedIdentity(selectedDepartment.name),
        );
      if (
        !isManualDepartment &&
        !isWorkflowDepartment &&
        !isUnitRecipient &&
        !matchesPeople(context, tracking, departmentUsers)
      )
        return false;
    }
    if (
      requestedDeadlineStatuses.length &&
      !requestedDeadlineStatuses.includes(tracking.deadlineStatus)
    )
      return false;
    if (dateFrom && (!tracking.date || tracking.date < dateFrom)) return false;
    if (dateTo && (!tracking.date || tracking.date > dateTo)) return false;
    return true;
  });
  const total = items.length;
  return {
    data: items.slice(skip, skip + limit),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
};

export const getOfficeDocumentContext = async (actor: AuthUser, id: string) => {
  if (!isValidObjectId(id)) throw badRequest("id must be a valid ObjectId.");
  const context = await OfficeDocumentContextModel.findById(id).lean();
  if (!context) throw notFound("Office document context was not found.");
  if (
    actor.role.code !== "ADMIN"
    && (!actor.organization || String(context.organizationId ?? "") !== actor.organization)
  ) throw notFound("Office document context was not found.");
  if (!actorCanReadOfficeDocument(context, actor)) {
    throw notFound("Office document context was not found.");
  }
  const resultLinks = await DocumentResultLinkModel.find({
    organization: context.organizationId,
    $or: [
      { incomingDocument: context._id },
      { outgoingDocument: context._id },
    ],
  })
    .sort({ updatedAt: -1 })
    .populate(
      "incomingDocument",
      DOCUMENT_RESULT_INCOMING_POPULATE_SELECT,
    )
    .populate(
      "outgoingDocument",
      DOCUMENT_RESULT_OUTGOING_POPULATE_SELECT,
    )
    .populate("submittedBy", "_id username fullName position")
    .populate("performedBy", "_id username fullName position")
    .populate("approval.currentApprover", "_id username fullName position")
    .populate("approval.history.actor", "_id username fullName position")
    .populate("approval.history.fromApprover", "_id username fullName position")
    .populate("approval.history.toApprover", "_id username fullName position")
    .lean();
  return {
    data: {
      ...context,
      resultLinks: resultLinks.filter((link: any) =>
        canReadDocumentResultLink(actor, link, true)),
    },
  };
};

const requireManager = (actor: AuthUser) => {
  if (!MANAGER_ROLES.has(actor.role.code))
    throw forbidden("Only management roles can manage documents.");
};

const withoutCoProcessors = (value: unknown) =>
  String(value ?? "")
    .replace(
      /(?:^|\s)đồng\s*xử\s*lý\s*:\s*.*?(?=\s*(?:thao\s*tác|chuyển\s*tới|trả\s*lại)\s*:|$)/giu,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();

const peopleLabel = (people: Array<{ fullName?: string; username?: string }>) =>
  people
    .map((person) =>
      [person.fullName, person.username ? `(${person.username})` : ""]
        .filter(Boolean)
        .join(" "),
    )
    .filter(Boolean)
    .join(", ");

const trackLogsForObservation = (trackLogs: TrackLogItem[]) =>
  trackLogs.map((trackLog) => ({
    "Mã nhật ký": trackLog.id ?? "",
    TT: trackLog.sequence ? String(trackLog.sequence) : "",
    "Người gửi": [
      trackLog.sender.fullName,
      trackLog.sender.username ? `(${trackLog.sender.username})` : "",
    ]
      .filter(Boolean)
      .join(" "),
    "Người nhận": peopleLabel(
      trackLog.recipients?.length ? trackLog.recipients : [trackLog.receiver],
    ),
    "Chưa xử lý": trackLog.receivedAt ?? "",
    "Đang xử lý": trackLog.processingAt ?? "",
    "Đã xử lý": trackLog.completedAt ?? "",
    "Thời gian":
      trackLog.completedAt ??
      trackLog.processingAt ??
      trackLog.receivedAt ??
      "",
    "Thao tác": trackLog.action ?? "",
    "Nội dung":
      withoutCoProcessors(trackLog.comment) ||
      withoutCoProcessors(trackLog.content) ||
      trackLog.action ||
      "",
    "File văn bản": "",
  }));

const reworkCountFrom = (trackLogs: TrackLogItem[]) => {
  const latest = [...trackLogs].sort(
    (left, right) => Number(right.sequence ?? 0) - Number(left.sequence ?? 0),
  );
  for (const trackLog of latest) {
    const match = `${trackLog.content ?? ""} ${trackLog.comment ?? ""}`.match(
      /(?:làm\s*lại|lam\s*lai)\s*:\s*(\d+)/iu,
    );
    if (match) return Number(match[1]);
  }
  return 0;
};

const vietnamDate = (value: Date | null) =>
  value
    ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Ho_Chi_Minh" }).format(
        value,
      )
    : "";

/**
 * A manager-triggered, narrow ingest. It searches incoming documents by the
 * supplied symbol only, persists every exact source match in the same context
 * table as extension data, and never touches legacy ingest models.
 */
export const ingestIncomingBySymbol = async (
  actor: AuthUser,
  payload: unknown,
) => {
  requireManager(actor);
  const body = record(payload, "Request body");
  const allowed = new Set(["soKyHieu"]);
  for (const key of Object.keys(body))
    if (!allowed.has(key))
      throw badRequest(`Unsupported payload field: ${key}.`);
  const soKyHieu = string(body.soKyHieu, "soKyHieu", 500, true);
  const csrf = await getCsrfToken();
  const searchFilter = newestNgayDenFilter({
    so_kyhieu: soKyHieu,
    so_kyhieu_org: soKyHieu,
    config_tim_kiem_chinh_xac_skh: "1",
  });
  const results = (await getDocList(1, 100, searchFilter, csrf)).filter(
    (document) => document.soKyHieu.trim() === soKyHieu,
  );
  if (!results.length)
    throw notFound(
      `Không tìm thấy văn bản đến có số ký hiệu ${soKyHieu} trên eOffice.`,
    );

  const sourceOrigin =
    process.env.LANGSON_APP_ORIGIN ?? "https://vanphongdientu.langson.gov.vn";
  const orgPrefix = process.env.LANGSON_ORG_PREFIX ?? "QLVB_LSN_XATHIENTAN.";
  const now = new Date();
  const saved = await Promise.all(
    results.map(async (document) => {
      const [detail, trackLogs] = await Promise.all([
        getDocDetail(document.documentId, csrf),
        getTrackLog(document.documentId, orgPrefix, csrf),
      ]);
      const completed = isCompletedDocumentTrackLog(trackLogs);
      const processing = await resolveDocumentWorkflow(trackLogs, completed);
      const point = getLatestTrackLogPoint(trackLogs)?.point ?? null;
      const normalized = normalizeOfficeDocumentContext({
        available: true,
        modalOpen: false,
        pageType: "incoming",
        title: "Văn bản đến",
        documentId: document.documentId,
        subject: detail.trichYeu || document.trichYeu,
        soKyHieu: detail.soKyHieu || document.soKyHieu,
        receivedDate: detail.ngayDen || document.ngayDen,
        dueDate: vietnamDate(document.deadline),
        documentForm: detail.hinhThuc || document.hinhThuc,
        priority: detail.doKhan || document.doKhan,
        createdDate: detail.ngayVanBan || document.ngayVanBan,
        draftingUnit: detail.donViBanHanh || document.donViBanHanh,
        draftingUnitId: "",
        draftingUser: detail.nguoiSoan,
        draftingUserId: "",
        senderUser: "",
        senderUserId: "",
        senderDepartment: "",
        sender: { userId: "", fullName: "", department: "" },
        relatedIncomingSoKyHieu: "",
        comment: "",
        point,
        reworkCount: reworkCountFrom(trackLogs),
        note: "",
        recipients: [],
        timeline: trackLogsForObservation(trackLogs),
        url: `${sourceOrigin}/qlvbdh_lsn/main?6yXl=VAN_BAN_DEN_CA_NHAN&documentId=${encodeURIComponent(document.documentId)}`,
      });
      const filter = {
        sourceHost: normalized.sourceHost,
        pageType: normalized.pageType,
        externalDocumentId: normalized.externalDocumentId,
      };
      const update = {
        ...normalized,
        origin: "MANUAL_INGEST",
        observedAt: now,
        statusSync: {
          status: completed
            ? "COMPLETED"
            : processing.status === "IN_PROGRESS"
              ? "IN_PROGRESS"
              : "PENDING_RESPONSE",
          completed,
          completedRule: completed ? LANGSON_COMPLETED_RULE : "",
          completedAt: completed ? now : null,
          trackLogs,
          processing,
          lastSyncedAt: now,
          lastAttemptAt: now,
          nextRetryAt: null,
          attempts: 0,
          lastError: "",
        },
      };
      const context = await OfficeDocumentContextModel.findOneAndUpdate(
        filter,
        { $set: update },
        {
          new: true,
          upsert: true,
          runValidators: true,
          setDefaultsOnInsert: true,
        },
      ).lean();
      return {
        id: String(context?._id),
        externalDocumentId: document.documentId,
        soKyHieu: normalized.observation.soKyHieu,
      };
    }),
  );
  return { data: { soKyHieu, matched: saved.length, items: saved } };
};

const managedInput = (payload: unknown, allowIdentity = false) => {
  const body = record(payload, "Request body");
  const allowed = new Set<string>([
    ...MANAGED_FIELDS,
    "management",
    "completed",
    ...(allowIdentity ? ["pageType", "documentId"] : []),
  ]);
  for (const key of Object.keys(body)) {
    if (!allowed.has(key))
      throw badRequest(`Unsupported managed document field: ${key}.`);
  }
  return body;
};

const observationPayload = (
  input: Input,
  identity: { pageType: string; documentId: string; sourceUrl: string },
  current: Input = {},
) =>
  normalizeOfficeDocumentContext({
    available: true,
    modalOpen: false,
    ...Object.fromEntries(
      MANAGED_FIELDS.map((field) => [field, current[field]]),
    ),
    ...input,
    // The manual form may send documentId: ''. Preserve the generated identity.
    pageType: identity.pageType,
    documentId: identity.documentId,
    url: identity.sourceUrl,
  });

const normalizeManagement = async (
  actor: AuthUser,
  value: unknown,
  forceSelfAssignment = false,
) => {
  if (value === undefined && !forceSelfAssignment) return {};
  const management = value === undefined ? {} : record(value, "management");
  const allowed = new Set(["assignment", "manualScore", "note"]);
  for (const key of Object.keys(management)) {
    if (!allowed.has(key))
      throw badRequest(`Unsupported management field: ${key}.`);
  }
  const result: Record<string, unknown> = {
    "management.updatedBy": actor.id,
    "management.updatedAt": new Date(),
  };
  if (management.manualScore !== undefined) {
    if (management.manualScore === null || management.manualScore === "")
      result["management.manualScore"] = null;
    else {
      const score = Number(management.manualScore);
      if (!Number.isFinite(score) || score < 0 || score > 1_000_000)
        throw badRequest(
          "management.manualScore must be a number from 0 to 1000000.",
        );
      result["management.manualScore"] = score;
    }
  }
  if (management.note !== undefined)
    result["management.note"] = string(
      management.note,
      "management.note",
      12000,
    );
  if (management.assignment !== undefined || forceSelfAssignment) {
    const assignment = forceSelfAssignment
      ? { departmentId: actor.department ?? "", userId: actor.id }
      : record(management.assignment, "management.assignment");
    const assignmentAllowed = new Set(["departmentId", "userId"]);
    for (const key of Object.keys(assignment))
      if (!assignmentAllowed.has(key))
        throw badRequest(`Unsupported management.assignment field: ${key}.`);
    const departmentId = string(
      assignment.departmentId,
      "management.assignment.departmentId",
      240,
    );
    const userId = string(
      assignment.userId,
      "management.assignment.userId",
      240,
    );
    let department: any = null;
    let user: any = null;
    if (departmentId) {
      if (!isValidObjectId(departmentId))
        throw badRequest(
          "management.assignment.departmentId must be a valid ObjectId.",
        );
      department = await DepartmentModel.findOne({
        _id: departmentId,
        isActive: true,
        ...(actor.organization && actor.role.code !== "ADMIN"
          ? { organization: actor.organization }
          : {}),
      }).lean();
      if (!department)
        throw badRequest(
          "management.assignment.departmentId does not exist or is inactive.",
        );
      if (
        actor.role.code === "DEPARTMENT_LEADER"
        && String(department._id) !== String(actor.department ?? "")
      ) {
        throw forbidden(
          "Trưởng phòng chỉ được phân công trong phòng ban của mình.",
        );
      }
    }
    if (userId) {
      if (!isValidObjectId(userId))
        throw badRequest(
          "management.assignment.userId must be a valid ObjectId.",
        );
      user = await UserModel.findOne({
        _id: userId,
        status: "ACTIVE",
        ...(actor.organization && actor.role.code !== "ADMIN"
          ? { organization: actor.organization }
          : {}),
      })
        .select("_id fullName department")
        .lean();
      if (!user)
        throw badRequest(
          "management.assignment.userId does not exist or is inactive.",
        );
      if (
        department &&
        String(user.department ?? "") !== String(department._id)
      )
        throw badRequest(
          "Assigned user must belong to the assigned department.",
        );
      if (!department && user.department)
        department = await DepartmentModel.findById(user.department).lean();
    }
    result["management.assignment.departmentId"] = department?._id ?? null;
    result["management.assignment.departmentName"] = department?.name ?? "";
    result["management.assignment.userId"] = user?._id ?? null;
    result["management.assignment.fullName"] = user?.fullName ?? "";
  }
  return result;
};

export const createManagedOfficeDocumentContext = async (
  actor: AuthUser,
  payload: unknown,
) => {
  const input = managedInput(payload, true);
  const pageType = string(input.pageType, "pageType", 20, true);
  if (!PAGE_TYPES.includes(pageType as (typeof PAGE_TYPES)[number]))
    throw badRequest("pageType is invalid.");
  if (pageType === "incoming") requireManager(actor);
  if (!actor.organization)
    throw forbidden("User has no organization assigned.");
  const subject = string(input.subject, "subject", 4000, true);
  const documentId =
    string(input.documentId, "documentId", 240)
    || `m-${Date.now()}-${Math.floor(Math.random() * 1_000_000).toString().padStart(6, "0")}`;
  const sourceUrl = `https://manual.ework.local/office-document-contexts/${documentId}`;
  const { management: managementInput, completed: completedInput, ...observationInput } = input;
  // Manual references are issued by eWork. Ignore a client-supplied value on
  // create so every manual document follows the same <number>/VBN convention.
  const soKyHieu = await nextManualReference(actor);
  const normalized = observationPayload(
    { ...observationInput, subject, soKyHieu },
    { pageType, documentId, sourceUrl },
  );
  const management = await normalizeManagement(
    actor,
    managementInput,
    actor.role.code === "SPECIALIST",
  );
  if (pageType !== "incoming") {
    normalized.observation.draftingUser = String(
      management["management.assignment.fullName"] ?? "",
    );
    normalized.observation.draftingUserId = String(
      management["management.assignment.userId"] ?? "",
    );
  }
  if (actor.role.code === "SPECIALIST") {
    normalized.observation.draftingUnit = String(
      management["management.assignment.departmentName"] ?? "",
    );
  }
  if (completedInput !== undefined && typeof completedInput !== "boolean")
    throw badRequest("completed must be a boolean.");
  if (pageType !== "incoming") {
    const createdDate = normalized.observation.createdDate;
    const draftingUnit = normalized.observation.draftingUnit;
    const manualScore = management["management.manualScore"];
    if (!createdDate || !draftingUnit || !management["management.assignment.departmentId"] || !management["management.assignment.userId"])
      throw badRequest("Outgoing documents require createdDate, draftingUnit, assigned department, and assigned user.");
    if (manualScore === null || manualScore === undefined)
      throw badRequest("Outgoing documents require a non-negative manual score.");
  } else {
    const dueDate = normalized.observation.dueDate;
    const manualScore = management["management.manualScore"];
    if (
      !dueDate
      || !management["management.assignment.departmentId"]
      || !management["management.assignment.userId"]
    ) {
      throw badRequest(
        "Manual tasks require a due date, assigned department, and assigned user.",
      );
    }
    if (manualScore === null || manualScore === undefined) {
      throw badRequest("Manual tasks require a non-negative score.");
    }
  }
  const completed = pageType !== "incoming" || completedInput === true;
  const now = new Date();
  const created = await OfficeDocumentContextModel.create({
    ...normalized,
    ...management,
    organizationId: actor.organization ?? null,
    tenantResolution: "MANUAL",
    origin: "MANUAL",
    observedAt: now,
    statusSync: {
      status: completed ? "COMPLETED" : "PENDING_RESPONSE",
      completed,
      completedRule: completed ? "MANUAL" : "",
      completedAt: completed ? now : null,
      trackLogs: [],
      processing: null,
      lastSyncedAt: now,
      lastAttemptAt: now,
      nextRetryAt: null,
      attempts: 0,
      lastError: "",
    },
  });
  let resultLink: any = null;
  const relatedIncomingSoKyHieu = normalized.observation.relatedIncomingSoKyHieu;
  if (pageType !== "incoming" && relatedIncomingSoKyHieu) {
    try {
      resultLink = await createDocumentResultLinkService(actor, {
        outgoingDocumentId: String(created._id),
        soKyHieu: relatedIncomingSoKyHieu,
      });
    } catch (error) {
      await OfficeDocumentContextModel.deleteOne({
        _id: created._id,
        origin: "MANUAL",
      });
      throw error;
    }
  }
  return {
    data: {
      ...created.toObject(),
      ...(resultLink?.data ? { resultLink: resultLink.data } : {}),
    },
  };
};

const MANUAL_REFERENCE_PATTERN = /^(\d{1,5})\/VBN$/i;

const nextManualReference = async (actor: AuthUser, reserve = true) => {
  if (!actor.organization) {
    throw forbidden("User has no organization assigned.");
  }
  const counterKey = `manual-office-reference:${actor.organization}`;
  const contexts = await OfficeDocumentContextModel.find({
    origin: "MANUAL",
    organizationId: actor.organization,
  })
    .select("observation.soKyHieu")
    .lean();
  const current = contexts.reduce((maximum, context: any) => {
    const match = String(context.observation?.soKyHieu ?? "").match(MANUAL_REFERENCE_PATTERN);
    return match ? Math.max(maximum, Number(match[1])) : maximum;
  }, 0);
  try {
    await ConfigModel.updateOne(
      { key: counterKey },
      { $setOnInsert: { key: counterKey, value: current } },
      { upsert: true },
    );
  } catch (error: any) {
    if (Number(error?.code) !== 11000) throw error;
  }
  if (!reserve) {
    const counter: any = await ConfigModel.findOne({ key: counterKey })
      .select("value")
      .lean();
    const nextValue = Math.max(current, Number(counter?.value) || 0) + 1;
    if (nextValue > 99_999) {
      throw badRequest("Đã hết dải số ký hiệu văn bản thủ công.");
    }
    return `${nextValue}/VBN`;
  }
  const counter: any = await ConfigModel.findOneAndUpdate(
    { key: counterKey, value: { $lt: 99_999 } },
    { $inc: { value: 1 } },
    { new: true },
  ).lean();
  if (!counter) throw badRequest("Đã hết dải số ký hiệu văn bản thủ công.");
  return `${Number(counter.value)}/VBN`;
};

export const getNextManagedOfficeDocumentReference = async (actor: AuthUser) => {
  if (!actor.organization)
    throw forbidden("User has no organization assigned.");
  return { data: { soKyHieu: await nextManualReference(actor, false) } };
};

export const updateManagedOfficeDocumentContext = async (
  actor: AuthUser,
  id: string,
  payload: unknown,
) => {
  if (!isValidObjectId(id)) throw badRequest("id must be a valid ObjectId.");
  const input = managedInput(payload);
  if (!Object.keys(input).length)
    throw badRequest("At least one managed document field is required.");
  const context = await OfficeDocumentContextModel.findById(id).lean();
  if (!context) throw notFound("Office document context was not found.");
  if (
    actor.role.code !== "ADMIN"
    && (
      !actor.organization
      || String(context.organizationId ?? "") !== actor.organization
      || !actorCanReadOfficeDocument(context, actor)
    )
  ) {
    throw notFound("Office document context was not found.");
  }
  if (
    actor.role.code === "SPECIALIST"
    && (
      context.pageType === "incoming"
      || String(context.management?.assignment?.userId ?? "") !== actor.id
    )
  ) {
    throw forbidden("Bạn chỉ được sửa sản phẩm do chính mình khai báo.");
  }
  if (actor.role.code !== "SPECIALIST") requireManager(actor);
  if (context.pageType !== "incoming") {
    const lockedLink = await DocumentResultLinkModel.exists({
      outgoingDocument: context._id,
      status: { $in: ["PENDING_APPROVAL", "APPROVED"] },
    });
    if (lockedLink) {
      throw conflict(
        "Sản phẩm đã gửi duyệt hoặc đã duyệt nên không thể sửa trực tiếp.",
      );
    }
  }
  const { management: managementInput, completed: completedInput, ...observationInput } = input;
  if (completedInput !== undefined && typeof completedInput !== "boolean")
    throw badRequest("completed must be a boolean.");
  const normalized = observationPayload(
    observationInput,
    {
      pageType: context.pageType,
      documentId: context.externalDocumentId,
      sourceUrl: context.sourceUrl,
    },
    (context.observation ?? {}) as Input,
  );
  const management = await normalizeManagement(actor, managementInput);
  if (
    context.pageType !== "incoming"
    && (
      management["management.assignment.userId"]
      || management["management.assignment.fullName"]
    )
  ) {
    normalized.observation.draftingUser = String(
      management["management.assignment.fullName"] ?? "",
    );
    normalized.observation.draftingUserId = String(
      management["management.assignment.userId"] ?? "",
    );
  }
  const relatedIncomingSoKyHieu =
    context.pageType !== "incoming"
    && Object.prototype.hasOwnProperty.call(
      observationInput,
      "relatedIncomingSoKyHieu",
    )
      ? normalized.observation.relatedIncomingSoKyHieu
      : "";
  if (relatedIncomingSoKyHieu) {
    await resolveDocumentResultLinkService(actor, {
      soKyHieu: relatedIncomingSoKyHieu,
    });
  }
  const observationUpdate =
    context.origin === "MANUAL"
      ? { observation: normalized.observation }
      : {
          ...Object.fromEntries(
            Object.keys(observationInput)
              .filter((field) =>
                (MANAGED_FIELDS as readonly string[]).includes(field),
              )
              .map((field) => [
                `management.overrides.${field}`,
                (normalized.observation as any)[field],
              ]),
          ),
        };
  const updated = await OfficeDocumentContextModel.findByIdAndUpdate(
    id,
    {
      $set: {
        ...observationUpdate,
        ...management,
        ...(Object.prototype.hasOwnProperty.call(observationInput, "soKyHieu")
          ? {
              normalizedSoKyHieu: normalizeOfficeDocumentSymbol(
                normalized.observation.soKyHieu,
              ),
            }
          : {}),
        ...(context.origin === "MANUAL" && context.pageType === "incoming" && completedInput !== undefined
          ? {
              "statusSync.status": completedInput === true ? "COMPLETED" : "PENDING_RESPONSE",
              "statusSync.completed": completedInput === true,
              "statusSync.completedRule": completedInput === true ? "MANUAL" : "",
              "statusSync.completedAt": completedInput === true ? new Date() : null,
            }
          : {}),
      },
    },
    { new: true, runValidators: true },
  ).lean();
  let resultLink: any = null;
  if (
    updated
    && context.pageType !== "incoming"
    && relatedIncomingSoKyHieu
  ) {
    try {
      resultLink = await createDocumentResultLinkService(actor, {
        outgoingDocumentId: String(updated._id),
        soKyHieu: relatedIncomingSoKyHieu,
      });
    } catch (error) {
      await OfficeDocumentContextModel.updateOne(
        { _id: id, updatedAt: updated.updatedAt },
        {
          $set: {
            observation: context.observation,
            management: context.management,
            statusSync: context.statusSync,
            normalizedSoKyHieu: context.normalizedSoKyHieu ?? "",
          },
        },
      );
      throw error;
    }
  }
  return {
    data: {
      ...updated,
      ...(resultLink?.data ? { resultLink: resultLink.data } : {}),
    },
  };
};

export const deleteManagedOfficeDocumentContext = async (
  actor: AuthUser,
  id: string,
) => {
  if (!isValidObjectId(id)) throw badRequest("id must be a valid ObjectId.");
  const context = await OfficeDocumentContextModel.findById(id).lean();
  if (!context) throw notFound("Office document context was not found.");
  if (
    actor.role.code !== "ADMIN"
    && (
      !actor.organization
      || String(context.organizationId ?? "") !== actor.organization
      || !actorCanReadOfficeDocument(context, actor)
    )
  ) {
    throw notFound("Office document context was not found.");
  }
  if (
    actor.role.code === "SPECIALIST"
    && (
      context.pageType === "incoming"
      || String(context.management?.assignment?.userId ?? "") !== actor.id
    )
  ) {
    throw forbidden("Bạn chỉ được xóa sản phẩm do chính mình khai báo.");
  }
  if (actor.role.code !== "SPECIALIST") requireManager(actor);
  const linked = await DocumentResultLinkModel.exists({
    $or: [{ incomingDocument: id }, { outgoingDocument: id }],
    status: { $ne: "SUPERSEDED" },
  });
  if (linked) {
    throw conflict("Không thể xóa dữ liệu đang có liên kết nhiệm vụ - sản phẩm.");
  }
  const deleted = await OfficeDocumentContextModel.findByIdAndDelete(id).lean();
  if (!deleted) throw notFound("Office document context was not found.");
  return { data: { id, deleted: true } };
};
