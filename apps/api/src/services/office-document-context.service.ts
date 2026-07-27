import { isValidObjectId } from "mongoose";
import { randomUUID } from "node:crypto";
import OfficeDocumentContextModel from "../models/office-document-context.model";
import DepartmentModel from "../models/department.model";
import UserModel from "../models/user.model";
import type { AuthUser } from "../types/auth";
import { badRequest, forbidden, notFound } from "../utils/http-error";
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
  return {
    sourceHost,
    pageType,
    externalDocumentId: string(body.documentId, "documentId", 240, true),
    sourceUrl,
    observation: {
      available: bool(body.available, "available"),
      modalOpen: bool(body.modalOpen, "modalOpen"),
      title: string(body.title, "title", 500),
      subject: string(body.subject, "subject", 4000),
      soKyHieu: string(body.soKyHieu, "soKyHieu", 500),
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
  const filter = {
    sourceHost: normalized.sourceHost,
    pageType: normalized.pageType,
    externalDocumentId: normalized.externalDocumentId,
  };
  const observedAt = new Date();
  const update = () =>
    OfficeDocumentContextModel.findOneAndUpdate(
      filter,
      { $set: { ...normalized, observedAt } },
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

export const listOfficeDocumentContexts = async (
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
    const completedAt = parseDocumentDate(sync.completedAt);
    const completed = sync.completed === true;
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
    const status =
      context.pageType !== "incoming"
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
        ? "Đã hoàn tất"
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
    const score = context.management?.manualScore ?? observed("point") ?? null;
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
  const normalizedIdentity = (value: unknown) =>
    String(value ?? "")
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .replace(/\.lsn$/iu, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
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
        .filter(Boolean),
    ),
  ];
  const linkedIncoming = relatedIncomingSymbols.length
    ? await OfficeDocumentContextModel.find({
        pageType: "incoming",
        "observation.soKyHieu": { $in: relatedIncomingSymbols },
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
      return [`${context.sourceHost}|${symbol}`, score];
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
      tracking.score =
        incomingPoints.get(`${context.sourceHost}|${relatedSymbol}`) ?? null;
    }
    return { ...context, tracking };
  });
  const items = itemsWithTracking.filter((context: any) => {
    const tracking = context.tracking;
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

export const getOfficeDocumentContext = async (id: string) => {
  if (!isValidObjectId(id)) throw badRequest("id must be a valid ObjectId.");
  const context = await OfficeDocumentContextModel.findById(id).lean();
  if (!context) throw notFound("Office document context was not found.");
  return { data: context };
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
    pageType: identity.pageType,
    documentId: identity.documentId,
    url: identity.sourceUrl,
    ...Object.fromEntries(
      MANAGED_FIELDS.map((field) => [field, current[field]]),
    ),
    ...input,
  });

const normalizeManagement = async (actor: AuthUser, value: unknown) => {
  if (value === undefined) return {};
  const management = record(value, "management");
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
  if (management.assignment !== undefined) {
    const assignment = record(management.assignment, "management.assignment");
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
      }).lean();
      if (!department)
        throw badRequest(
          "management.assignment.departmentId does not exist or is inactive.",
        );
    }
    if (userId) {
      if (!isValidObjectId(userId))
        throw badRequest(
          "management.assignment.userId must be a valid ObjectId.",
        );
      user = await UserModel.findOne({ _id: userId, status: "ACTIVE" })
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
  requireManager(actor);
  const input = managedInput(payload, true);
  const pageType = string(input.pageType, "pageType", 20, true);
  if (!PAGE_TYPES.includes(pageType as (typeof PAGE_TYPES)[number]))
    throw badRequest("pageType is invalid.");
  const subject = string(input.subject, "subject", 4000, true);
  const documentId =
    string(input.documentId, "documentId", 240) || `MANUAL-${randomUUID()}`;
  const sourceUrl = `https://manual.ework.local/office-document-contexts/${documentId}`;
  const { management: managementInput, ...observationInput } = input;
  const normalized = observationPayload(
    { ...observationInput, subject },
    { pageType, documentId, sourceUrl },
  );
  const management = await normalizeManagement(actor, managementInput);
  const created = await OfficeDocumentContextModel.create({
    ...normalized,
    ...management,
    origin: "MANUAL",
    observedAt: new Date(),
  });
  return { data: created.toObject() };
};

export const updateManagedOfficeDocumentContext = async (
  actor: AuthUser,
  id: string,
  payload: unknown,
) => {
  requireManager(actor);
  if (!isValidObjectId(id)) throw badRequest("id must be a valid ObjectId.");
  const input = managedInput(payload);
  if (!Object.keys(input).length)
    throw badRequest("At least one managed document field is required.");
  const context = await OfficeDocumentContextModel.findById(id).lean();
  if (!context) throw notFound("Office document context was not found.");
  const { management: managementInput, ...observationInput } = input;
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
    { $set: { ...observationUpdate, ...management } },
    { new: true, runValidators: true },
  ).lean();
  return { data: updated };
};

export const deleteManagedOfficeDocumentContext = async (
  actor: AuthUser,
  id: string,
) => {
  requireManager(actor);
  if (!isValidObjectId(id)) throw badRequest("id must be a valid ObjectId.");
  const deleted = await OfficeDocumentContextModel.findByIdAndDelete(id).lean();
  if (!deleted) throw notFound("Office document context was not found.");
  return { data: { id, deleted: true } };
};
