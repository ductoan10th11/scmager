import type { ClientSession } from "mongoose";
import OfficeDocumentContextModel from "../models/office-document-context.model";
import { getLatestTrackLog } from "./langson-dwr.service";

export const normalizeOfficeDocumentSymbol = (value: unknown) => String(value ?? "")
  .normalize("NFC")
  .trim()
  .replace(/\s+/g, " ")
  .toLocaleUpperCase("vi-VN");

const parseOfficeDate = (value: unknown): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const raw = String(value).trim();
  const match = raw.match(
    /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/,
  );
  if (match) {
    const [, day, month, year, hour = "23", minute = "59"] = match;
    return new Date(`${year}-${month}-${day}T${hour}:${minute}:00+07:00`);
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export type BusinessCompletionInput = {
  incomingDocumentId: string;
  organizationId: string;
  evidenceType: "DOCUMENT_RESULT" | "WORK_DECLARATION";
  evidenceId: string;
  submittedBy: string;
  submittedAt: Date;
  approvedBy: string;
  approvedAt: Date;
  point: number | null;
  reworkCount: number;
};

export const effectiveOfficeDocumentCompletion = (context: any) => {
  const sync = context?.statusSync ?? {};
  const business = context?.management?.businessCompletion ?? {};
  const official = sync.completed === true;
  const businessCompleted = business.completed === true;
  const latestTrackLog: any = official
    ? getLatestTrackLog(sync.trackLogs ?? [])
    : null;
  const officialAt = official
    ? parseOfficeDate(
        latestTrackLog?.completedAt
          ?? latestTrackLog?.processingAt
          ?? latestTrackLog?.updatedAt
          ?? sync.completedAt,
      )
    : null;
  const businessAt = businessCompleted
    ? parseOfficeDate(business.submittedAt)
    : null;

  return {
    completed: official || businessCompleted,
    completedAt: official ? officialAt : businessAt,
    source: official
      ? "EOFFICE"
      : businessCompleted
        ? business.evidenceType
        : null,
    evidenceId: businessCompleted ? String(business.evidenceId ?? "") : null,
    approvedAt: businessCompleted ? parseOfficeDate(business.approvedAt) : null,
  };
};

// Returns null when no source has supplied a point at all, which
// effectiveOfficeDocumentPoint deliberately flattens to 0 for display and KPI
// maths. Callers that must tell "not scored yet" from "scored zero" use this.
export const rawOfficeDocumentPoint = (context: any): number | null => {
  const business = context?.management?.businessCompletion ?? {};
  const point = business.completed === true && business.point !== null
    ? business.point
    : context?.management?.manualScore
      ?? context?.management?.overrides?.point
      ?? context?.observation?.point
      ?? null;
  if (point === null || point === undefined || point === "") return null;
  const numeric = Number(point);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
};

export const effectiveOfficeDocumentPoint = (context: any) => rawOfficeDocumentPoint(context) ?? 0;

/**
 * A document is "awaiting a score" once it is finished but nobody has put a
 * point on it — the list leaders need in order to fill the gaps.
 */
export const isOfficeDocumentAwaitingScore = (context: any) =>
  effectiveOfficeDocumentCompletion(context).completed === true
  && rawOfficeDocumentPoint(context) === null;

export const effectiveOfficeProductPoint = (
  context: any,
  relatedPoint: unknown,
) => {
  if (relatedPoint === null || relatedPoint === undefined) {
    return effectiveOfficeDocumentPoint(context);
  }
  const numeric = Number(relatedPoint);
  return Number.isFinite(numeric) && numeric >= 0
    ? numeric
    : effectiveOfficeDocumentPoint(context);
};

export const effectiveOfficeDocumentReworkCount = (context: any) => {
  const business = context?.management?.businessCompletion ?? {};
  const value = business.completed === true
    ? business.reworkCount
    : context?.management?.overrides?.reworkCount
      ?? context?.observation?.reworkCount
      ?? 0;
  return Math.max(0, Number(value) || 0);
};

export const applyOfficeDocumentBusinessCompletion = async (
  input: BusinessCompletionInput,
  session: ClientSession | null = null,
) => {
  const point = input.point === null ? null : Math.max(0, Number(input.point) || 0);
  const reworkCount = Math.max(0, Math.trunc(Number(input.reworkCount) || 0));
  const update = await OfficeDocumentContextModel.findOneAndUpdate(
    {
      _id: input.incomingDocumentId,
      organizationId: input.organizationId,
      pageType: "incoming",
      "management.businessCompletion.completed": { $ne: true },
    },
    {
      $set: {
        "management.businessCompletion.completed": true,
        "management.businessCompletion.evidenceType": input.evidenceType,
        "management.businessCompletion.evidenceId": input.evidenceId,
        "management.businessCompletion.submittedBy": input.submittedBy,
        "management.businessCompletion.submittedAt": input.submittedAt,
        "management.businessCompletion.approvedBy": input.approvedBy,
        "management.businessCompletion.approvedAt": input.approvedAt,
        "management.businessCompletion.point": point,
        "management.businessCompletion.reworkCount": reworkCount,
      },
    },
    { new: true, runValidators: true, session: session ?? undefined },
  ).lean();

  if (update) return update;
  const existing = await OfficeDocumentContextModel.findOne({
    _id: input.incomingDocumentId,
    organizationId: input.organizationId,
    pageType: "incoming",
    "management.businessCompletion.completed": true,
    "management.businessCompletion.evidenceType": input.evidenceType,
    "management.businessCompletion.evidenceId": input.evidenceId,
  })
    .session(session ?? null)
    .lean();
  return existing ?? null;
};

// Free-text note shared across purposes on the document, so decisions are
// appended (timestamped) rather than overwriting whatever manager note is
// already there.
export const appendOfficeDocumentManagementNote = async (
  input: { contextId: string; organizationId: string; entry: string },
  session: ClientSession | null = null,
) => {
  const existing = await OfficeDocumentContextModel.findOne(
    { _id: input.contextId, organizationId: input.organizationId },
    { "management.note": 1 },
  )
    .session(session ?? null)
    .lean();
  if (!existing) return null;
  const stampedEntry = `[${new Date().toISOString()}] ${input.entry}`;
  const nextNote = (existing as any).management?.note
    ? `${(existing as any).management.note}\n${stampedEntry}`
    : stampedEntry;
  return OfficeDocumentContextModel.findByIdAndUpdate(
    input.contextId,
    { $set: { "management.note": nextNote } },
    { new: true, runValidators: true, session: session ?? undefined },
  ).lean();
};

// applyOfficeDocumentBusinessCompletion only writes on first completion
// (its filter requires completed !== true). A complaint decided after the
// document is already completed needs to revise the recorded point/rework
// count in place instead, without disturbing the field that wasn't disputed.
export const updateOfficeDocumentBusinessCompletionValues = async (
  input: {
    incomingDocumentId: string;
    organizationId: string;
    evidenceType: "WORK_DECLARATION";
    evidenceId: string;
    point?: number | null;
    reworkCount?: number | null;
  },
  session: ClientSession | null = null,
) => {
  const set: Record<string, unknown> = {};
  if (input.point !== undefined && input.point !== null) {
    set["management.businessCompletion.point"] = Math.max(0, Number(input.point) || 0);
  }
  if (input.reworkCount !== undefined && input.reworkCount !== null) {
    set["management.businessCompletion.reworkCount"] = Math.max(0, Math.trunc(Number(input.reworkCount) || 0));
  }
  if (Object.keys(set).length === 0) return null;
  return OfficeDocumentContextModel.findOneAndUpdate(
    {
      _id: input.incomingDocumentId,
      organizationId: input.organizationId,
      pageType: "incoming",
      "management.businessCompletion.completed": true,
      "management.businessCompletion.evidenceType": input.evidenceType,
      "management.businessCompletion.evidenceId": input.evidenceId,
    },
    { $set: set },
    { new: true, runValidators: true, session: session ?? undefined },
  ).lean();
};

export const clearOfficeDocumentBusinessCompletion = async (
  input: Pick<
    BusinessCompletionInput,
    "incomingDocumentId" | "organizationId" | "evidenceType" | "evidenceId"
  >,
  session: ClientSession | null = null,
) => OfficeDocumentContextModel.findOneAndUpdate(
  {
    _id: input.incomingDocumentId,
    organizationId: input.organizationId,
    pageType: "incoming",
    "management.businessCompletion.completed": true,
    "management.businessCompletion.evidenceType": input.evidenceType,
    "management.businessCompletion.evidenceId": input.evidenceId,
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
  { new: true, runValidators: true, session: session ?? undefined },
).lean();
