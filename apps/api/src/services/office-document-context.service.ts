import { isValidObjectId, Types } from "mongoose";
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
  reworkCountIn,
  trackLogNote,
  withoutScoreHeader,
  type TrackLogItem,
} from "./langson-dwr.service";
import { resolveDocumentWorkflow } from "./document-workflow.service";
import {
  appendOfficeDocumentManagementNote,
  incomingScoreChanges,
  incomingScoreSourceWrites,
  effectiveOfficeDocumentCompletion,
  effectiveOfficeDocumentPoint,
  effectiveOfficeDocumentReworkCount,
  effectiveOfficeProductPoint,
  isOfficeDocumentAwaitingScore,
  normalizeOfficeDocumentSymbol,
  rawOfficeDocumentPoint,
} from "./office-document-completion.service";
import {
  canReadDocumentResultLink,
  createDocumentResultLinkService,
  DOCUMENT_RESULT_INCOMING_POPULATE_SELECT,
  DOCUMENT_RESULT_OUTGOING_POPULATE_SELECT,
  resolveDocumentResultLinkService,
} from "./document-result-link.service";
import {
  effectiveOfficeDocumentOwner,
  effectiveOfficeDocumentOwnerId,
  isAssignmentManual,
  type OfficeDocumentCompletionSource,
  type OfficeDocumentOwnerDirectory,
} from "./office-document-owner.service";
import { closeNotRequiredAfterReassignment } from "./office-document-not-required.service";
import {
  loadOfficeDocumentOwnerDirectory,
  officeDocumentOwnerDirectoryFor,
} from "./office-document-owner-directory.service";
import {
  isOfficeDocumentNotRequired,
  officeDocumentNotRequiredStatus,
} from "./office-document-not-required-state.service";

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

const actorCanReadOfficeDocument = (
  context: any,
  actor: AuthUser,
  directory?: OfficeDocumentOwnerDirectory,
) => {
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
    || (processing.assignees ?? []).some(participantMatches)
    || effectiveOfficeDocumentOwnerId(context) === actor.id;

  if (actor.role.code === "DEPARTMENT_LEADER") {
    return directlyAssigned
      || (actor.department && String(assignment.departmentId ?? "") === actor.department)
      || (processing.assignees ?? []).some(
        (participant: any) => String(participant?.departmentId ?? "") === actor.department,
      )
      // The KPI counts the task on their department, so they must be able to open
      // it. A result submitter need not appear in the routing at all, which is
      // why this takes the directory rather than the routing alone.
      || (Boolean(actor.department)
        && effectiveOfficeDocumentOwner(context, { directory }).departmentId === actor.department);
  }

  if (context.pageType !== "incoming") {
    return directlyAssigned
      || (actor.department && String(assignment.departmentId ?? "") === actor.department)
      || participantMatches({
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

// Any clerk account, not just this commune's: eOffice names them all with
// "văn thư" / "vanthu", and handing a document to one of them ends its
// processing.
const isOfficeClerk = (participant: any) => {
  const username = String(participant?.externalUsername ?? participant?.username ?? "").toLowerCase();
  const fullName = String(participant?.externalFullName ?? participant?.fullName ?? "")
    .normalize("NFC")
    .toLocaleLowerCase("vi-VN");
  return username.includes("vanthu") || fullName.includes("văn thư");
};

/** Whoever the routing says holds the document, which need not be its owner. */
const workflowAssigneeOf = (processing: any) => {
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
  return processing.currentAssignee?.fullName
    ? processing.currentAssignee
    : processedAssignee;
};

/**
 * tracking.assignee. For an incoming document it is the KPI owner, so the list
 * column, the "Người làm" filter and the KPI all name the same person. Source
 * INGEST means nobody owns the document and this is merely who holds it.
 */
const trackingAssigneeFor = (
  context: any,
  directory: OfficeDocumentOwnerDirectory,
  completion?: OfficeDocumentCompletionSource,
) => {
  const assignment = context.management?.assignment ?? {};
  if (context.pageType === "incoming") {
    const owner = effectiveOfficeDocumentOwner(context, { completion, directory });
    if (owner.source !== "NONE") return owner;
  } else if (assignment.fullName) {
    return {
      source: "MANUAL",
      userId: assignment.userId ? String(assignment.userId) : "",
      fullName: assignment.fullName,
      departmentId: assignment.departmentId ? String(assignment.departmentId) : "",
      departmentName: assignment.departmentName ?? "",
    };
  }
  const holder = workflowAssigneeOf(context.statusSync?.processing ?? {});
  return {
    source: "INGEST",
    userId: holder.userId ? String(holder.userId) : "",
    fullName: holder.fullName ?? "",
    departmentId: holder.departmentId ? String(holder.departmentId) : "",
    departmentName: "",
  };
};

/**
 * The read rule for a single document. Only a department leader's answer can
 * depend on the owner's current department, and most documents are settled
 * without it, so the user lookup happens last and only for them.
 */
const actorCanOpenOfficeDocument = async (context: any, actor: AuthUser) =>
  actorCanReadOfficeDocument(context, actor)
  || (
    actor.role.code === "DEPARTMENT_LEADER"
    && actorCanReadOfficeDocument(context, actor, await officeDocumentOwnerDirectoryFor(context))
  );

// An aggregation does not cast, so the organization has to arrive as an ObjectId.
const listMatch = (filter: Record<string, unknown>) => ({
  ...filter,
  ...(filter.organizationId
    ? { organizationId: new Types.ObjectId(String(filter.organizationId)) }
    : {}),
});

// What the list needs from each routing participant. A document can carry about a
// hundred of them, and reading those whole was most of the cost of a list request.
const LIST_PARTICIPANT_FIELDS = [
  "userId",
  "username",
  "externalUsername",
  "fullName",
  "externalFullName",
  "departmentId",
  "assignedAt",
  "processedAt",
];

/**
 * Loads every candidate for the list with the bulky arrays cut down in the database.
 * Filtering and sorting need all candidates, because tracking is computed here and
 * not stored, so what can shrink is each document. Recipients keep only those who
 * can decide anything: the main person and units, never the collaborators.
 */
const loadListContexts = (filter: Record<string, unknown>) =>
  OfficeDocumentContextModel.aggregate([
    { $match: listMatch(filter) },
    // Newest arrival first. Not updatedAt: background status retries move that on
    // old documents, which buries whatever was just sent in. _id keeps pages stable.
    { $sort: { observedAt: -1, _id: -1 } },
    {
      $set: {
        "observation.recipients": {
          $filter: {
            input: { $ifNull: ["$observation.recipients", []] },
            as: "recipient",
            cond: {
              $or: [
                { $eq: ["$$recipient.role", "main"] },
                { $eq: ["$$recipient.entityType", "unit"] },
              ],
            },
          },
        },
        "statusSync.processing": {
          $cond: [
            { $isArray: "$statusSync.processing.assignees" },
            {
              $mergeObjects: [
                "$statusSync.processing",
                {
                  assignees: {
                    $map: {
                      input: "$statusSync.processing.assignees",
                      as: "participant",
                      in: Object.fromEntries(
                        LIST_PARTICIPANT_FIELDS.map((field) => [field, `$$participant.${field}`]),
                      ),
                    },
                  },
                },
              ],
            },
            "$statusSync.processing",
          ],
        },
      },
    },
  ]).allowDiskUse(true);

const LIST_CACHE_LIMIT = 8;
const listCache = new Map<string, { token: string; items: any[] }>();

/**
 * Identifies the state of a set of documents without reading them. Every write
 * moves updatedAt, except a score-only edit, which keeps it so the row stays put
 * and moves management.updatedAt instead. The count catches deletions.
 */
const listChangeToken = async (match: Record<string, unknown>) => {
  const [state] = await OfficeDocumentContextModel.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        count: { $sum: 1 },
        updatedAt: { $max: "$updatedAt" },
        managedAt: { $max: "$management.updatedAt" },
      },
    },
  ]).allowDiskUse(true);
  return state ? `${state.count}|${+state.updatedAt}|${+state.managedAt}` : "empty";
};

/**
 * The page polls every few seconds and the documents rarely change between polls,
 * yet reading them is most of a list request. They are reused only while the token
 * still matches, so a list is never stale; there is no expiry to wait out. Callers
 * share these objects and must not change them. A text search is left out: each one
 * would be its own entry and they do not repeat.
 */
const cachedListContexts = async (filter: Record<string, unknown>) => {
  if (filter.$or) return loadListContexts(filter);
  const match = listMatch(filter);
  const key = JSON.stringify(match);
  // Taken before the read, so a write landing during it forces a reload next time.
  const token = await listChangeToken(match);
  const cached = listCache.get(key);
  if (cached?.token === token) return cached.items;
  const items = await loadListContexts(filter);
  listCache.delete(key);
  listCache.set(key, { token, items });
  if (listCache.size > LIST_CACHE_LIMIT) {
    listCache.delete(listCache.keys().next().value as string);
  }
  return items;
};

/** A list row without what only the detail view reads; it fetches its own copy. */
const listRow = (item: any) => {
  const { trackLogs: _trackLogs, processing, ...sync } = item.statusSync ?? {};
  const { assignees: _assignees, ...routing } = processing ?? {};
  return { ...item, statusSync: { ...sync, processing: processing ? routing : null } };
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
    : [[draftingIds, "DRAFTING_USER"], [senderIds, "SENDER"], [recipientIds, "RECIPIENT"]] as const;

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
    status: "ACTIVE",
    $or: [
      { username: { $in: usernames } },
      ...usernames.filter(isValidObjectId).map((value) => ({ _id: value })),
    ],
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

const assignmentFromUniqueFullName = async (
  value: unknown,
  organizationId: string | null,
): Promise<ResolvedManagementAssignment | null> => {
  const identity = normalizedIdentity(value);
  if (!identity) return null;
  const users = await UserModel.find({
    status: "ACTIVE",
    ...(organizationId ? { organization: organizationId } : {}),
  })
    .select("_id fullName department organization")
    .lean();
  const matches = users.filter(
    (user: any) => normalizedIdentity(user.fullName) === identity,
  );
  if (matches.length !== 1) return null;
  const user: any = matches[0];
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

export const resolveContextManagementAssignment = async (
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

  if (context.pageType !== "incoming") {
    return (
      (await assignmentFromUsernames(draftingIds, organizationId))
      ?? (await assignmentFromUniqueFullName(
        observation.draftingUser,
        organizationId,
      ))
    );
  }

  const groups = [mainRecipientIds, draftingIds, senderIds];
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
      note: withoutScoreHeader(string(body.note, "note", 12000)),
      recipients: normalizeRecipients(body.recipients),
      timeline: normalizeTimeline(body.timeline),
    },
  };
};

export type OfficeDocumentContextUpsertOptions = {
  /** Keep synchronization jobs from creating a source document accidentally. */
  createIfMissing?: boolean;
};

export const upsertOfficeDocumentContext = async (
  payload: unknown,
  options: OfficeDocumentContextUpsertOptions = {},
) => {
  const normalized = normalizeOfficeDocumentContext(payload);
  // A task without a due date cannot be measured for lateness, so eOffice
  // ingest never stores one. The observation is dropped whole: an existing
  // record keeps the due date it already has, because a single sync that
  // failed to read the deadline must not erase it.
  if (
    normalized.pageType === "incoming"
    && !normalized.observation.dueDate.trim()
  ) {
    return {
      data: null,
      created: false,
      skipped: true,
      reason: "NO_DEADLINE",
      sourceHost: normalized.sourceHost,
      pageType: normalized.pageType,
      externalDocumentId: normalized.externalDocumentId,
    };
  }
  const filter = {
    sourceHost: normalized.sourceHost,
    pageType: normalized.pageType,
    externalDocumentId: normalized.externalDocumentId,
  };
  const previous = await OfficeDocumentContextModel.findOne(filter)
    .select("management.assignment management.assignmentMode management.product management.manualScore management.overrides management.updatedBy observation.point observation.reworkCount observation.relatedIncomingSoKyHieu")
    .lean();
  // A body only carries what this round declares: a rework-only round sends
  // point null, a score-only round sends rework 0. Neither means the omitted
  // value was withdrawn, so a score recorded earlier survives the later body.
  normalized.observation.point ??= previous?.observation?.point ?? null;
  normalized.observation.reworkCount ||= previous?.observation?.reworkCount ?? 0;

  // ponytail: standalone products without score or rework count are dropped
  // because they carry no evaluation and answer no task.
  if (normalized.pageType !== "incoming") {
    const hasRelatedIncoming = Boolean(
      normalized.observation.relatedIncomingSoKyHieu?.trim()
      || previous?.management?.overrides?.relatedIncomingSoKyHieu?.trim()
      || previous?.observation?.relatedIncomingSoKyHieu?.trim(),
    );
    const isLinkedResult = previous?.management?.product?.classification === "LINKED_RESULT";
    const isStandalone = !hasRelatedIncoming && !isLinkedResult;

    if (isStandalone) {
      const hasObservedPoint = normalized.observation.point !== null;
      const hasObservedRework = (normalized.observation.reworkCount ?? 0) > 0;
      const hasPreviousPoint = previous ? rawOfficeDocumentPoint(previous) !== null : false;
      const hasPreviousRework = previous ? effectiveOfficeDocumentReworkCount(previous) > 0 : false;
      const hasScoreSignal = hasObservedPoint || hasPreviousPoint;
      const hasReworkSignal = hasObservedRework || hasPreviousRework;

      if (!hasScoreSignal && !hasReworkSignal) {
        return {
          data: null,
          created: false,
          skipped: true,
          reason: "STANDALONE_WITHOUT_SCORE_OR_REWORK",
          sourceHost: normalized.sourceHost,
          pageType: normalized.pageType,
          externalDocumentId: normalized.externalDocumentId,
        };
      }
    }
  }

  if (!previous && options.createIfMissing === false) {
    return {
      data: null,
      created: false,
      skipped: true,
      sourceHost: normalized.sourceHost,
      pageType: normalized.pageType,
      externalDocumentId: normalized.externalDocumentId,
    };
  }
  const tenant = await resolveContextTenant(normalized);
  // A manager's assignment, including intentionally clearing one, is
  // authoritative over extension-derived ownership.
  const isManaged = isAssignmentManual(previous);
  const assignment = isManaged
    ? (previous?.management?.assignment?.userId
      ? previous.management.assignment
      : null)
    : await resolveContextManagementAssignment(normalized, tenant.organizationId);
  const observedAt = new Date();
  const isProduct = normalized.pageType !== "incoming";
  const previousProduct = previous?.management?.product ?? {};
  const proposedPoint = normalized.observation.point;
  const sameApprovedPoint =
    previousProduct.scoreStatus === "APPROVED"
    && previousProduct.proposedPoint === proposedPoint;
  const productState = isProduct
    ? {
        "management.product.classification":
          previousProduct.classification === "LINKED_RESULT"
            ? "LINKED_RESULT"
            : normalized.observation.relatedIncomingSoKyHieu
              ? "PENDING_RELATION"
              : "STANDALONE_PRODUCT",
        "management.product.performerStatus": assignment
          ? "RESOLVED"
          : "UNRESOLVED",
        "management.product.scoreStatus":
          previousProduct.classification === "LINKED_RESULT"
            ? "NOT_APPLICABLE"
            : sameApprovedPoint
              ? "APPROVED"
              : "PENDING",
        "management.product.scoreSource": proposedPoint === null ? "NONE" : "EOFFICE",
        "management.product.proposedPoint": proposedPoint,
        "management.product.lastReconciledAt": observedAt,
        "management.product.lastError": "",
      }
    : {};
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
          ...(!isManaged && assignment
            ? {
                "management.assignment.departmentId": assignment.departmentId,
                "management.assignment.departmentName": assignment.departmentName,
                "management.assignment.userId": assignment.userId,
                "management.assignment.fullName": assignment.fullName,
              }
            : {}),
          ...(isProduct && !isManaged && !assignment
            ? {
                "management.assignment.departmentId": null,
                "management.assignment.departmentName": "",
                "management.assignment.userId": null,
                "management.assignment.fullName": "",
              }
            : {}),
          ...productState,
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

  if (options.createIfMissing === false) {
    return {
      data: null,
      created: false,
      skipped: true,
      sourceHost: normalized.sourceHost,
      pageType: normalized.pageType,
      externalDocumentId: normalized.externalDocumentId,
    };
  }

  try {
    const created = await OfficeDocumentContextModel.create({
      ...normalized,
      organizationId: tenant.organizationId,
      tenantResolution: tenant.resolution,
      ...(assignment
        ? {
            management: {
              assignment,
              ...(isProduct
                ? {
                    product: {
                      classification: normalized.observation.relatedIncomingSoKyHieu
                        ? "PENDING_RELATION"
                        : "STANDALONE_PRODUCT",
                      performerStatus: "RESOLVED",
                      scoreStatus: "PENDING",
                      scoreSource: proposedPoint === null ? "NONE" : "EOFFICE",
                      proposedPoint,
                      lastReconciledAt: observedAt,
                    },
                  }
                : {}),
            },
          }
        : isProduct
          ? {
              management: {
                product: {
                  classification: normalized.observation.relatedIncomingSoKyHieu
                    ? "PENDING_RELATION"
                    : "STANDALONE_PRODUCT",
                  performerStatus: "UNRESOLVED",
                  scoreStatus: "PENDING",
                  scoreSource: proposedPoint === null ? "NONE" : "EOFFICE",
                  proposedPoint,
                  lastReconciledAt: observedAt,
                },
              },
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
      { "management.assignment.userId": null, "management.assignmentMode": "AUTO" },
      {
        "management.assignment.userId": null,
        "management.assignmentMode": null,
        "management.updatedBy": null,
      },
    ],
  })
    .select("pageType observation organizationId management.assignment management.assignmentMode management.updatedBy")
    .lean();
  let resolved = 0;
  let ambiguous = 0;
  let assignmentResolved = 0;
  for (const context of contexts as any[]) {
    const tenant = context.organizationId
      ? { organizationId: String(context.organizationId), resolution: "UNRESOLVED" as TenantResolution }
      : await resolveContextTenant(context);
    const assignment = isAssignmentManual(context) || context.management?.assignment?.userId
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
  // Reports read the whole result; the HTTP route never sets this.
  options: { maxLimit?: number } = {},
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
    "scoreState",
    "complaintState",
    "notRequiredState",
    "minHoldingDays",
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
  const limit = Math.min(requestedLimit, options.maxLimit ?? 100);
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
      { "observation.relatedIncomingSoKyHieu": regex },
      { "management.overrides.soKyHieu": regex },
      { "management.overrides.relatedIncomingSoKyHieu": regex },
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
  const scoreState = string(query.scoreState, "scoreState", 30);
  if (scoreState && !["AWAITING_SCORE", "SCORED"].includes(scoreState))
    throw badRequest("scoreState must be AWAITING_SCORE or SCORED.");
  const complaintState = string(query.complaintState, "complaintState", 20);
  if (complaintState && complaintState !== "PENDING")
    throw badRequest("complaintState must be PENDING.");
  const notRequiredState = string(query.notRequiredState, "notRequiredState", 20);
  if (notRequiredState && !["PENDING", "CONFIRMED"].includes(notRequiredState))
    throw badRequest("notRequiredState must be PENDING or CONFIRMED.");
  const minHoldingDaysRaw = string(query.minHoldingDays, "minHoldingDays", 10);
  const minHoldingDays = minHoldingDaysRaw === "" ? null : Number(minHoldingDaysRaw);
  if (minHoldingDays !== null && (!Number.isSafeInteger(minHoldingDays) || minHoldingDays < 0))
    throw badRequest("minHoldingDays must be a non-negative integer.");
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

  /**
   * Outgoing documents carry no workflow state from eOffice — only the flat
   * track log the reconciliation cron stores in observation.timeline. The last
   * entry names whoever the document was handed to, so that recipient is the
   * one still holding it, and how long ago tells us why it is not moving.
   */
  const holderFrom = (context: any) => {
    const timeline = Array.isArray(context.observation?.timeline) ? context.observation.timeline : [];
    if (!timeline.length) return null;
    const latest = [...timeline].sort(
      (left: any, right: any) => Number(right?.TT ?? 0) - Number(left?.TT ?? 0),
    )[0];
    const fullName = String(latest?.["Người nhận"] ?? "").trim();
    if (!fullName) return null;
    const since = parseDocumentDate(latest?.["Thời gian"]);
    const holdingDays = since
      ? Math.max(0, Math.floor((Date.now() - since.getTime()) / 86_400_000))
      : null;
    return {
      fullName,
      since: since ? since.toISOString() : null,
      holdingDays,
      lastAction: String(latest?.["Thao tác"] ?? "").trim(),
      lastNote: String(latest?.["Nội dung"] ?? "").trim(),
    };
  };
  const trackingFor = (context: any) => {
    const sync = context.statusSync ?? {};
    const processing = sync.processing ?? {};
    const managedAssignment = context.management?.assignment ?? {};
    const workflowAssignee = workflowAssigneeOf(processing);
    const completion = effectiveOfficeDocumentCompletion(context);
    const assignee = trackingAssigneeFor(context, ownerDirectory, completion);
    const observed = (field: string) =>
      context.management?.overrides?.[field] ?? context.observation?.[field];
    const dueAt = parseDocumentDate(observed("dueDate"), true);

    /**
     * Where the document sits right now, read off the newest routing entry:
     * handed to a clerk means the processing is finished, handed back to a
     * specialist means it is in someone's hands again — even if eOffice had
     * marked it done earlier.
     */
    const clerkHandoff = (() => {
      if (context.pageType !== "incoming") return null;
      const logs = Array.isArray(sync.trackLogs) ? sync.trackLogs : [];
      if (!logs.length) return null;
      const latest = [...logs].sort(
        (left: any, right: any) => Number(right?.sequence ?? 0) - Number(left?.sequence ?? 0),
      )[0];
      const receivers = latest?.recipients?.length ? latest.recipients : [latest?.receiver];
      const named = (receivers ?? []).filter((person: any) => person?.fullName || person?.username);
      if (!named.length) return null;
      return {
        toClerk: named.every((person: any) => isOfficeClerk(person)),
        at: parseDocumentDate(latest?.completedAt ?? latest?.processingAt ?? latest?.receivedAt),
      };
    })();

    // A leader's confirmation exists precisely because the routing has not caught
    // up, so the routing must not contradict it.
    const manuallyCompleted = completion.source === "MANUAL";
    const completed = manuallyCompleted
      || (clerkHandoff ? clerkHandoff.toClerk : completion.completed);
    const completedAt = manuallyCompleted
      ? completion.completedAt
      : clerkHandoff?.toClerk
        ? (clerkHandoff.at ?? completion.completedAt)
        : (completed ? completion.completedAt : null);
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
        ? (manuallyCompleted ? "Lãnh đạo xác nhận hoàn thành" : "Đã xử lý")
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
    const bottleneck = (() => {
      if (context.pageType !== "incoming") {
        const holder = holderFrom(context);
        return {
          stage: "OUTGOING_HOLDING",
          role: null,
          roleLabel: "Văn bản đi",
          name: holder?.fullName || "Chưa xác định",
          departmentId: null,
          departmentName: null,
          holdingSince: holder?.since ?? null,
          holdingDays: holder?.holdingDays ?? 0,
          holdingHours: holder?.holdingDays != null ? holder.holdingDays * 24 : 0,
          isLate: false,
          label: holder?.fullName ? `Đang giữ: ${holder.fullName}` : "Chưa xác định",
        };
      }

      if (completed) {
        return {
          stage: "COMPLETED",
          role: null,
          roleLabel: "Đã hoàn thành",
          name: assignee.fullName || "Đã hoàn thành",
          departmentId: assignee.departmentId || null,
          departmentName: assignee.departmentName || null,
          holdingSince: completedAt ? completedAt.toISOString() : null,
          holdingDays: 0,
          holdingHours: 0,
          isLate: deadlineStatus === "DONE_LATE",
          label: "Đã hoàn thành",
        };
      }

      // Check if assigned to specialist
      const hasSpecialist = Boolean(assignee.userId)
        || (workflowAssignee?.roleCode === "SPECIALIST" && Boolean(workflowAssignee.fullName));
      if (hasSpecialist) {
        const specName = assignee.fullName || workflowAssignee?.fullName || "Chuyên viên";
        return {
          stage: "SPECIALIST_PROCESSING",
          role: "SPECIALIST",
          roleLabel: "Chuyên viên thụ lý",
          name: specName,
          departmentId: assignee.departmentId || null,
          departmentName: assignee.departmentName || null,
          holdingSince: workflowAssignee?.assignedAt ?? null,
          holdingDays: 0,
          holdingHours: 0,
          isLate: deadlineStatus === "PENDING_OVERDUE",
          label: `Chuyên viên đang xử lý: ${specName}`,
        };
      }

      // Check if assigned to department / department leader
      const hasDepartment = Boolean(assignee.departmentId)
        || Boolean(managedAssignment.departmentId)
        || (workflowAssignee?.roleCode === "DEPARTMENT_LEADER");
      if (hasDepartment) {
        const deptName = assignee.departmentName || managedAssignment.departmentName || "Phòng ban";
        const leaderName = (workflowAssignee?.roleCode === "DEPARTMENT_LEADER" ? workflowAssignee.fullName : null)
          || (deptName ? `Trưởng phòng (${deptName})` : "Trưởng phòng");

        const assignedTime = parseDocumentDate(workflowAssignee?.assignedAt)
          || (context.management?.updatedAt ? new Date(context.management.updatedAt) : null)
          || (context.observedAt ? new Date(context.observedAt) : null)
          || parseDocumentDate(observed("receivedDate"))
          || now;

        const diffMs = Math.max(0, now.getTime() - assignedTime.getTime());
        const holdingHours = Math.floor(diffMs / 3600000);
        const holdingDays = Math.floor(diffMs / 86400000);
        const isLate = holdingHours >= 24 || (dueAt ? dueAt.getTime() <= now.getTime() : false);

        return {
          stage: "DEPARTMENT_LEADER_PENDING",
          role: "DEPARTMENT_LEADER",
          roleLabel: "Trưởng phòng",
          name: leaderName,
          departmentId: assignee.departmentId || managedAssignment.departmentId || null,
          departmentName: deptName,
          holdingSince: assignedTime.toISOString(),
          holdingDays,
          holdingHours,
          isLate,
          label: isLate
            ? `Kẹt tại Trưởng phòng: ${leaderName} (Chậm ${holdingHours >= 48 ? `${holdingDays} ngày` : `${holdingHours}h`})`
            : `Chờ Trưởng phòng giao việc: ${leaderName}`,
        };
      }

      // Neither specialist nor department: Sitting at Office Chief (Chánh văn phòng)
      const receivedTime = parseDocumentDate(observed("receivedDate"))
        || (context.observedAt ? new Date(context.observedAt) : null)
        || now;
      const diffMs = Math.max(0, now.getTime() - receivedTime.getTime());
      const holdingHours = Math.floor(diffMs / 3600000);
      const holdingDays = Math.floor(diffMs / 86400000);
      const isLate = holdingHours >= 24 || (dueAt ? dueAt.getTime() <= now.getTime() : false);

      return {
        stage: "OFFICE_CHIEF_PENDING",
        role: "OFFICE_CHIEF",
        roleLabel: "Chánh văn phòng",
        name: "Chánh văn phòng",
        departmentId: null,
        departmentName: null,
        holdingSince: receivedTime.toISOString(),
        holdingDays,
        holdingHours,
        isLate,
        label: isLate
          ? `Kẹt tại Chánh VP (Chậm phân phòng ${holdingHours >= 48 ? `${holdingDays} ngày` : `${holdingHours}h`})`
          : "Chờ Chánh VP phân phòng",
      };
    })();

    return {
      assignee,
      dueAt,
      completedAt,
      deadlineStatus,
      status,
      statusLabel,
      date,
      score,
      rawScore: rawOfficeDocumentPoint(context),
      awaitingScore: isOfficeDocumentAwaitingScore(context),
      manualScore: context.management?.manualScore ?? null,
      completionSource: completion.source,
      holder: context.pageType === "incoming" || completed ? null : holderFrom(context),
      bottleneck,
      // Filled in by the list pass once both sides of the task/product pair are
      // known, so each row can point at its counterpart.
      relatedIncoming: null as { id: string | null; soKyHieu: string } | null,
      relatedProduct: null as { id: string; soKyHieu: string; documentId?: string; subject?: string } | null,
    };
  };

  const allItems = await cachedListContexts(filter);
  const ownerDirectory = await loadOfficeDocumentOwnerDirectory(
    actor.role.code !== "ADMIN" ? { organization: actor.organization } : {},
  );
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
  const matchesPeople = (
    context: any,
    tracking: any,
    people: any[],
    { byMainPerson = false } = {},
  ) => {
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
    // "Người làm" follows the main person eOffice names. Collaborators are there to
    // read along and never decide this. A leader's explicit assignment replaces the
    // main person, and a document with no main person falls back to its owner.
    if (context.pageType === "incoming") {
      const mainPeople = !byMainPerson || isAssignmentManual(context)
        ? []
        : (observed("recipients") ?? []).filter(
            (recipient: any) => recipient.role === "main" && recipient.entityType === "person",
          );
      if (mainPeople.length) {
        return mainPeople.some((recipient: any) =>
          matches(recipient.userId, recipient.userId, recipient.fullName, recipient.department),
        );
      }
      const ownerId = effectiveOfficeDocumentOwnerId(context);
      return ownerId
        ? ids.has(ownerId)
        : identities.has(normalizedIdentity(tracking.assignee?.fullName));
    }
    const manual = context.management?.assignment ?? {};
    if (matches(manual.userId, manual.fullName)) return true;
    if (matches(tracking.assignee?.userId, tracking.assignee?.fullName))
      return true;
    return matches(
      observed("draftingUserId"),
      observed("draftingUserId"),
      observed("draftingUser"),
    );
  };
  const matchesIncomingDepartment = (context: any, tracking: any) => {
    const selectedId = String(selectedDepartment?._id);
    if (
      String(tracking.assignee?.departmentId ?? "") === selectedId
      || matchesPeople(context, tracking, departmentUsers)
    ) return true;
    if (tracking.assignee?.source !== "INGEST") return false;
    // Nobody owns the document, so where it was routed is all there is to go on.
    // Once it has an owner these are stale and must not place it here.
    return String(context.management?.assignment?.departmentId ?? "") === selectedId
      || (
        context.management?.overrides?.recipients ??
        context.observation?.recipients ??
        []
      ).some(
        (recipient: any) =>
          recipient.entityType === "unit" &&
          normalizedIdentity(recipient.department || recipient.fullName) ===
            normalizedIdentity(selectedDepartment?.name),
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
      })
        .select("-observation.recipients")
        .lean()
    : [];
  // A product answers an incoming task, and it is that task which carries the
  // deadline. Keeping the task's id and deadline alongside its point lets a
  // product show whether it was late and lets the UI jump between the two.
  const incomingByKey = new Map(
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
      const tracking = trackingFor(context);
      return [
        `${context.organizationId ?? ""}|${normalizeOfficeDocumentSymbol(symbol)}`,
        {
          id: String(context._id),
          soKyHieu: symbol,
          score,
          dueAt: tracking.dueAt,
          deadlineStatus: tracking.deadlineStatus,
        },
      ];
    }),
  );

  // The reverse direction: for a list of tasks, which product answers each one.
  const outgoingByIncomingSymbol = new Map<string, { id: string; soKyHieu: string; documentId?: string; subject?: string; createdAt: Date | null }>();
  if (String(pageType) === "incoming") {
    const taskSymbols = allItems
      .map((context: any) => normalizeOfficeDocumentSymbol(
        context.management?.overrides?.soKyHieu ?? context.observation?.soKyHieu ?? "",
      ))
      .filter(Boolean);
    if (taskSymbols.length) {
      const products = await OfficeDocumentContextModel.find({
        pageType: { $in: ["outgoing", "outgoing_c2"] },
        ...(actor.role.code !== "ADMIN" ? { organizationId: actor.organization } : {}),
      })
        .select("_id externalDocumentId organizationId observation.soKyHieu observation.relatedIncomingSoKyHieu observation.subject observation.createdDate observedAt management.overrides")
        .lean();
      for (const product of products as any[]) {
        const relatedSymbol = normalizeOfficeDocumentSymbol(
          product.management?.overrides?.relatedIncomingSoKyHieu
            ?? product.observation?.relatedIncomingSoKyHieu
            ?? "",
        );
        if (!relatedSymbol) continue;
        const key = `${product.organizationId ?? ""}|${relatedSymbol}`;
        if (outgoingByIncomingSymbol.has(key)) continue;
        outgoingByIncomingSymbol.set(key, {
          id: String(product._id),
          soKyHieu: String(
            product.management?.overrides?.soKyHieu ?? product.observation?.soKyHieu ?? "",
          ),
          documentId: String(product.externalDocumentId ?? ""),
          subject: String(
            product.management?.overrides?.subject ?? product.observation?.subject ?? "",
          ),
          createdAt: parseDocumentDate(
            product.management?.overrides?.createdDate ?? product.observation?.createdDate,
          ) ?? (product.observedAt ? new Date(product.observedAt) : null),
        });
      }
    }
  }
  const itemsWithTracking = allItems.map((context: any) => {
    const tracking = trackingFor(context);
    if (context.pageType !== "incoming") {
      const relatedSymbol = String(
        context.management?.overrides?.relatedIncomingSoKyHieu ??
          context.observation?.relatedIncomingSoKyHieu ??
          "",
      ).trim();
      const related = relatedSymbol
        ? incomingByKey.get(
          `${context.organizationId ?? ""}|${normalizeOfficeDocumentSymbol(relatedSymbol)}`,
        )
        : undefined;
      const relatedPoint = related?.score;
      tracking.score = effectiveOfficeProductPoint(context, relatedPoint);
      // A product may inherit its point from the incoming document it answers,
      // so "awaiting a score" has to account for that inherited value too.
      const inherited = relatedPoint === null || relatedPoint === undefined ? null : Number(relatedPoint);
      const inheritedScore = inherited !== null && Number.isFinite(inherited) && inherited >= 0 ? inherited : null;
      tracking.rawScore = inheritedScore ?? tracking.rawScore;
      tracking.awaitingScore = tracking.awaitingScore && tracking.rawScore === null;
      // A product IS the finished work, so it is never "still within deadline" —
      // it was either delivered on time or late, measured by the deadline of the
      // task it answers against the day the product was drafted.
      if (related) {
        tracking.relatedIncoming = { id: related.id, soKyHieu: related.soKyHieu };
        if (!tracking.dueAt) tracking.dueAt = related.dueAt;
        const deliveredAt = parseDocumentDate(
          context.management?.overrides?.createdDate ?? context.observation?.createdDate,
        ) ?? (context.observedAt ? new Date(context.observedAt) : null);
        tracking.deadlineStatus = related.dueAt && deliveredAt
          ? (deliveredAt <= related.dueAt ? "DONE_ON_TIME" : "DONE_LATE")
          : "NO_DEADLINE";
      } else if (relatedSymbol) {
        tracking.relatedIncoming = { id: null, soKyHieu: relatedSymbol };
        tracking.deadlineStatus = "NO_DEADLINE";
      } else {
        tracking.deadlineStatus = "NO_DEADLINE";
      }
    } else {
      const symbol = normalizeOfficeDocumentSymbol(
        context.management?.overrides?.soKyHieu ?? context.observation?.soKyHieu ?? "",
      );
      const product = symbol
        ? outgoingByIncomingSymbol.get(`${context.organizationId ?? ""}|${symbol}`)
        : undefined;
      if (product) {
        tracking.relatedProduct = {
          id: product.id,
          soKyHieu: product.soKyHieu,
          documentId: (product as any).documentId,
          subject: (product as any).subject,
        };
        // Once a product answers the task, the task is done: the product has
        // already been through the leader, so there is nothing left to track.
        tracking.status = "COMPLETED";
        tracking.statusLabel = "Đã xử lý";
        if (!tracking.completedAt) tracking.completedAt = product.createdAt;
        tracking.deadlineStatus = tracking.dueAt && product.createdAt
          ? (product.createdAt <= tracking.dueAt ? "DONE_ON_TIME" : "DONE_LATE")
          : "NO_DEADLINE";
      }
    }
    // A confirmed task is no longer measured against its deadline, so it leaves
    // every deadline filter, and the overdue report built on them, in one place.
    if (isOfficeDocumentNotRequired(context)) tracking.deadlineStatus = "NO_DEADLINE";
    return { ...context, tracking };
  });
  const items = itemsWithTracking.filter((context: any) => {
    const tracking = context.tracking;
    if (context.pageType !== "incoming") {
      const isStandalone = !tracking.relatedIncoming?.id
        && !context.management?.overrides?.relatedIncomingSoKyHieu?.trim()
        && !context.observation?.relatedIncomingSoKyHieu?.trim()
        && context.management?.product?.classification !== "LINKED_RESULT";
      if (isStandalone && tracking.rawScore === null && effectiveOfficeDocumentReworkCount(context) <= 0) {
        return false;
      }
    }
    if (!actorCanReadOfficeDocument(context, actor, ownerDirectory)) return false;
    if (userId && !selectedUser) return false;
    if (departmentId && !selectedDepartment) return false;
    if (
      selectedUser &&
      selectedDepartment &&
      String(selectedUser.department ?? "") !== String(selectedDepartment._id)
    )
      return false;
    if (selectedUser && !matchesPeople(context, tracking, [selectedUser], { byMainPerson: true }))
      return false;
    if (selectedDepartment) {
      if (context.pageType === "incoming") {
        if (!matchesIncomingDepartment(context, tracking)) return false;
      } else {
        const isManualDepartment =
          String(context.management?.assignment?.departmentId ?? "") ===
          String(selectedDepartment._id);
        const isWorkflowDepartment =
          String(tracking.assignee?.departmentId ?? "") ===
          String(selectedDepartment._id);
        if (
          !isManualDepartment &&
          !isWorkflowDepartment &&
          !matchesPeople(context, tracking, departmentUsers)
        )
          return false;
      }
    }
    if (
      requestedDeadlineStatuses.length &&
      !requestedDeadlineStatuses.includes(tracking.deadlineStatus)
    )
      return false;
    if (
      complaintState === "PENDING"
      && context.management?.scoreComplaint?.status !== "PENDING"
    ) return false;
    // A discarded task lives on its own page: it shows only when asked for.
    if (officeDocumentNotRequiredStatus(context) === "CONFIRMED" && notRequiredState !== "CONFIRMED") return false;
    if (notRequiredState && officeDocumentNotRequiredStatus(context) !== notRequiredState) return false;
    if (scoreState === "AWAITING_SCORE" && !tracking.awaitingScore) return false;
    if (scoreState === "SCORED" && tracking.rawScore === null) return false;
    if (
      minHoldingDays !== null &&
      (tracking.holder?.holdingDays == null || tracking.holder.holdingDays < minHoldingDays)
    )
      return false;
    if (dateFrom && (!tracking.date || tracking.date < dateFrom)) return false;
    if (dateTo && (!tracking.date || tracking.date > dateTo)) return false;
    return true;
  });
  const total = items.length;
  return {
    data: items.slice(skip, skip + limit).map(listRow),
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
  if (!(await actorCanOpenOfficeDocument(context, actor))) {
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
      // Only the owner: the rest of tracking is computed for the list, and the
      // client merges this over the row it already holds.
      tracking: {
        assignee: trackingAssigneeFor(context, await officeDocumentOwnerDirectoryFor(context)),
      },
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

// The rework count is typed as free text inside the routing ("Chuyển tới")
// comment box on eOffice. That same box's content is what should populate
// scmager's note field, so both are read off the one matched track log entry.
const routingSignalFrom = (trackLogs: TrackLogItem[]) => {
  const latest = [...trackLogs].sort(
    (left, right) => Number(right.sequence ?? 0) - Number(left.sequence ?? 0),
  );
  for (const trackLog of latest) {
    const text = `${trackLog.content ?? ""} ${trackLog.comment ?? ""}`.trim();
    const reworkCount = reworkCountIn(text);
    if (reworkCount !== null) return { reworkCount, note: trackLogNote(trackLog) };
  }
  return { reworkCount: 0, note: "" };
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
  // Same rule as the extension path: a task with no processing deadline is not
  // accepted, so it never reaches the tracking and scoring screens.
  const withDeadline = results.filter((document) => Boolean(document.deadline));
  if (!withDeadline.length)
    throw badRequest(
      `Văn bản ${soKyHieu} không có hạn xử lý nên không được nhận vào hệ thống.`,
    );

  const sourceOrigin =
    process.env.LANGSON_APP_ORIGIN ?? "https://vanphongdientu.langson.gov.vn";
  const orgPrefix = process.env.LANGSON_ORG_PREFIX ?? "QLVB_LSN_XATHIENTAN.";
  const now = new Date();
  const saved = await Promise.all(
    withDeadline.map(async (document) => {
      const [detail, trackLogs] = await Promise.all([
        getDocDetail(document.documentId, csrf),
        getTrackLog(document.documentId, orgPrefix, csrf),
      ]);
      const completed = isCompletedDocumentTrackLog(trackLogs);
      const processing = await resolveDocumentWorkflow(trackLogs, completed);
      const point = getLatestTrackLogPoint(trackLogs)?.point ?? null;
      const routingSignal = routingSignalFrom(trackLogs);
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
        reworkCount: routingSignal.reworkCount,
        note: routingSignal.note,
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
  const requestedSoKyHieu = Object.prototype.hasOwnProperty.call(
    observationInput,
    "soKyHieu",
  )
    ? string(observationInput.soKyHieu, "soKyHieu", 500)
    : "";
  const soKyHieu = requestedSoKyHieu || await nextManualReference(actor);
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
  if (pageType === "incoming") management["management.assignmentMode"] = "MANUAL";
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
  if (pageType !== "incoming") {
    const proposedPoint = Number(management["management.manualScore"]);
    const managerApproved = actor.role.code !== "SPECIALIST";
    management["management.product.classification"] =
      normalized.observation.relatedIncomingSoKyHieu
        ? "PENDING_RELATION"
        : "STANDALONE_PRODUCT";
    management["management.product.performerStatus"] = "RESOLVED";
    management["management.product.scoreStatus"] = managerApproved
      ? "APPROVED"
      : "PENDING";
    management["management.product.scoreSource"] = "MANUAL";
    management["management.product.proposedPoint"] = proposedPoint;
    management["management.product.approvedBy"] = managerApproved
      ? actor.id
      : null;
    management["management.product.approvedAt"] = managerApproved
      ? now
      : null;
    management["management.product.lastReconciledAt"] = now;
    if (!managerApproved) management["management.manualScore"] = null;
  }
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

/**
 * Whether a submitted assignment keeps the document with its current owner. The
 * edit form always posts one, so this is what tells a real reassignment from a
 * save that merely left the field alone. A department given with no person only
 * counts as unchanged if that is already the department on record.
 */
const assignmentKeepsOwner = (context: any, requested: unknown) => {
  if (!requested || typeof requested !== "object" || Array.isArray(requested)) return false;
  const { userId, departmentId } = requested as Input;
  const requestedUserId = String(userId ?? "").trim();
  if (requestedUserId !== effectiveOfficeDocumentOwnerId(context)) return false;
  const requestedDepartmentId = String(departmentId ?? "").trim();
  return Boolean(requestedUserId)
    || !requestedDepartmentId
    || requestedDepartmentId === String(context.management?.assignment?.departmentId ?? "");
};

/**
 * Editing an incoming document only moves it when the assignee really changes.
 * A kept assignment is dropped before normalizeManagement sees it, both so it is
 * never written and because the owner need not pass the checks on a new assignee:
 * they may have left, or sit outside the editing leader's department.
 *
 * The mode is left alone whenever the document already counts as manual, and that
 * includes legacy rows with no mode. Writing AUTO over one of those would hand it
 * back to the workflow owner on a score edit, and clear it from the review report.
 */
const incomingAssignmentEdit = (context: any, managementInput: unknown) => {
  const body = managementInput && typeof managementInput === "object" && !Array.isArray(managementInput)
    ? (managementInput as Input)
    : null;
  if (body?.assignment !== undefined && !assignmentKeepsOwner(context, body.assignment)) {
    return { managementInput, assignmentMode: "MANUAL" };
  }
  const { assignment: _kept, ...rest } = body ?? {};
  return {
    managementInput: body ? rest : managementInput,
    assignmentMode: isAssignmentManual(context) ? null : "AUTO",
  };
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
      || !(await actorCanOpenOfficeDocument(context, actor))
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
    // A submitted or approved product is frozen for its owner so the approval
    // trail stays trustworthy. A leader can still correct it — typically a time
    // that was declared late — and the correction is written into the
    // management note so the change is never silent.
    if (lockedLink && !MANAGER_ROLES.has(actor.role.code)) {
      throw conflict(
        "Sản phẩm đã gửi duyệt hoặc đã duyệt nên không thể sửa trực tiếp.",
      );
    }
    if (lockedLink) {
      await appendOfficeDocumentManagementNote({
        contextId: String(context._id),
        organizationId: String(context.organizationId ?? ""),
        entry: `${actor.fullName || actor.username} đã sửa sản phẩm sau khi gửi duyệt (${Object.keys(input).join(", ")}).`,
      });
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
  const assignmentEdit = context.pageType === "incoming"
    ? incomingAssignmentEdit(context, managementInput)
    : { managementInput, assignmentMode: null };
  const management = await normalizeManagement(actor, assignmentEdit.managementInput);
  if (assignmentEdit.assignmentMode) {
    management["management.assignmentMode"] = assignmentEdit.assignmentMode;
  }
  if (context.pageType === "incoming") {
    const score = management["management.manualScore"];
    Object.assign(management, incomingScoreSourceWrites(context, score));
    if (incomingScoreChanges(context, score)) {
      management["management.scoreEditedBy"] = actor.id;
      management["management.scoreEditedAt"] = new Date();
    }
  }
  // A task without a due date cannot be measured for lateness, so an edit is
  // never allowed to leave it empty. Automatic ingest from eOffice is a
  // different path and stays untouched — that source is not ours to control.
  if (
    context.pageType === "incoming"
    && observationInput.dueDate !== undefined
    && !normalized.observation.dueDate
  ) {
    throw badRequest("Nhiệm vụ bắt buộc phải có hạn xử lý.");
  }
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
  if (context.pageType !== "incoming") {
    const hasScoreChange = managementInput
      && typeof managementInput === "object"
      && !Array.isArray(managementInput)
      && Object.prototype.hasOwnProperty.call(managementInput, "manualScore");
    if (hasScoreChange) {
      const proposedPoint = management["management.manualScore"];
      const managerApproved = actor.role.code !== "SPECIALIST";
      management["management.product.proposedPoint"] = proposedPoint;
      management["management.product.scoreStatus"] = proposedPoint == null
        ? "PENDING"
        : managerApproved
        ? "APPROVED"
        : "PENDING";
      management["management.product.scoreSource"] = "MANUAL";
      management["management.product.approvedBy"] = managerApproved && proposedPoint != null
        ? actor.id
        : null;
      management["management.product.approvedAt"] = managerApproved && proposedPoint != null
        ? new Date()
        : null;
      if (!managerApproved) management["management.manualScore"] = null;
    }
    const hasAssignmentChange = managementInput
      && typeof managementInput === "object"
      && !Array.isArray(managementInput)
      && Object.prototype.hasOwnProperty.call(managementInput, "assignment");
    if (hasAssignmentChange) {
      management["management.product.performerStatus"] = management[
        "management.assignment.userId"
      ] ? "RESOLVED" : "UNRESOLVED";
    } else if (context.management?.assignment?.userId) {
      management["management.product.performerStatus"] = "RESOLVED";
    }
    if (Object.prototype.hasOwnProperty.call(observationInput, "relatedIncomingSoKyHieu")) {
      management["management.product.classification"] = relatedIncomingSoKyHieu
        ? "PENDING_RELATION"
        : "STANDALONE_PRODUCT";
      management["management.product.lastReconciledAt"] = new Date();
      management["management.product.lastError"] = "";
    }
  }
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
  const scoreOnlyEdit = context.pageType === "incoming"
    && Object.keys(input).length === 1
    && Object.keys((managementInput ?? {}) as Input).join() === "manualScore";
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
    // The list sorts by updatedAt, so bumping it on a score alone would pull the
    // row away while a leader is scoring down the page. management.updatedAt
    // still records the edit.
    { new: true, runValidators: true, ...(scoreOnlyEdit ? { timestamps: false } : {}) },
  ).lean();
  if (updated && assignmentEdit.assignmentMode === "MANUAL") {
    await closeNotRequiredAfterReassignment(actor, context);
  }
  let resultLink: any = null;
  // Only build the link when the task actually changed. Re-submitting an
  // unchanged link throws "đã được liên kết", which used to roll back the whole
  // edit — so a product that was already submitted could not be corrected at
  // all, not even its point or note.
  const previousRelatedSymbol = normalizeOfficeDocumentSymbol(
    context.management?.overrides?.relatedIncomingSoKyHieu
      ?? context.observation?.relatedIncomingSoKyHieu
      ?? "",
  );
  const linkAlreadyMatches = Boolean(relatedIncomingSoKyHieu)
    && normalizeOfficeDocumentSymbol(relatedIncomingSoKyHieu) === previousRelatedSymbol
    && Boolean(await DocumentResultLinkModel.exists({
      outgoingDocument: id,
      status: { $ne: "RETURNED" },
    }));
  if (
    updated
    && context.pageType !== "incoming"
    && relatedIncomingSoKyHieu
    && !linkAlreadyMatches
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
      // Only the score: the rest of tracking is computed for the list, and the
      // client merges this over the row it already holds. A product is left out
      // because its point can be inherited, which only the list pass can see.
      ...(context.pageType === "incoming"
        ? {
            tracking: {
              score: effectiveOfficeDocumentPoint(updated),
              rawScore: rawOfficeDocumentPoint(updated),
              awaitingScore: isOfficeDocumentAwaitingScore(updated),
              manualScore: updated?.management?.manualScore ?? null,
            },
          }
        : {}),
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
      || !(await actorCanOpenOfficeDocument(context, actor))
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
  // Deleting would lose the review trail, and the next extension sync would bring
  // the document back with no state at all.
  if (["PENDING", "CONFIRMED"].includes(officeDocumentNotRequiredStatus(context))) {
    throw conflict("Văn bản đang trong quy trình việc không cần làm nên không thể xóa.");
  }
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
