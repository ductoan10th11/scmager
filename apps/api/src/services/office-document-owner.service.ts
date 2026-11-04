import { Types } from "mongoose";

/**
 * The one definition of who owns an incoming document. KPI, the list column,
 * the "Người làm" filter, complaints and task linking all resolve through here
 * so they can never name different people.
 *
 * Everything in this module is a pure function over a context object: it must
 * not import a model, so any service can use it without an import cycle.
 */

const idOf = (value: any) => String(value?._id ?? value ?? "");

export type OfficeDocumentOwnerSource =
  | "DOCUMENT_RESULT"
  | "WORKFLOW_PRIMARY"
  | "MANUAL"
  | "AUTO_ASSIGNMENT"
  | "NONE";

export type OfficeDocumentOwner = {
  source: OfficeDocumentOwnerSource;
  userId: string;
  fullName: string;
  departmentId: string;
  departmentName: string;
};

export type OfficeDocumentOwnerDirectoryEntry = {
  fullName?: string;
  departmentId?: string;
  departmentName?: string;
};

/** Current user records by id; they outrank the snapshots kept on a context. */
export type OfficeDocumentOwnerDirectory = ReadonlyMap<string, OfficeDocumentOwnerDirectoryEntry>;

export type OfficeDocumentCompletionSource = { source?: string | null };

export const officeDocumentCompletionSource = (context: any): string | null => {
  if (context?.statusSync?.completed === true) return "EOFFICE";
  const business = context?.management?.businessCompletion;
  return business?.completed === true ? business.evidenceType : null;
};

/**
 * True when a manager chose the assignee. `management.updatedBy` alone cannot
 * say this, because it is set by any edit, a score correction included.
 *
 * Rows written before assignmentMode existed have no mode. Treating their
 * updatedBy as manual is deliberate: previously edited documents keep the owner
 * they have today, so nothing flips on deploy, and leaders review them from
 * scripts/report-legacy-edited-owners.ts.
 */
export const isAssignmentManual = (context: any): boolean => {
  const mode = context?.management?.assignmentMode;
  if (mode === "MANUAL") return true;
  if (mode === "AUTO") return false;
  return Boolean(context?.management?.updatedBy);
};

const resolveOwner = (
  context: any,
  completion: OfficeDocumentCompletionSource,
): { userId: string; source: OfficeDocumentOwnerSource } => {
  const resultPerformerId =
    completion.source === "DOCUMENT_RESULT"
      ? idOf(context?.management?.businessCompletion?.submittedBy)
      : "";
  if (resultPerformerId) return { userId: resultPerformerId, source: "DOCUMENT_RESULT" };
  // KPI follows the first specialist the document reached: office chief and
  // department leader only dispatch it, and whoever the first specialist hands
  // it to afterwards is assisting. A manager's explicit assignment still wins.
  const manual = isAssignmentManual(context);
  const primaryId = idOf(context?.statusSync?.processing?.primaryAssignee?.userId);
  if (!manual && primaryId) return { userId: primaryId, source: "WORKFLOW_PRIMARY" };
  return {
    userId: idOf(context?.management?.assignment?.userId),
    source: manual ? "MANUAL" : "AUTO_ASSIGNMENT",
  };
};

export const effectiveOfficeDocumentOwnerId = (
  context: any,
  completion: OfficeDocumentCompletionSource = { source: officeDocumentCompletionSource(context) },
): string => resolveOwner(context, completion).userId;

/**
 * The owner with the name and department to show for them. `directory` supplies
 * the current user record; without one the context's own snapshots are used, so
 * a DOCUMENT_RESULT submitter who never appeared in the routing has no name.
 * An owner known only by name has an empty userId; source NONE means nobody owns
 * the document at all.
 */
export const effectiveOfficeDocumentOwner = (
  context: any,
  options: {
    completion?: OfficeDocumentCompletionSource;
    directory?: OfficeDocumentOwnerDirectory;
  } = {},
): OfficeDocumentOwner => {
  const { userId, source } = resolveOwner(
    context,
    options.completion ?? { source: officeDocumentCompletionSource(context) },
  );
  const assignment = context?.management?.assignment ?? {};
  if (!userId && !assignment.fullName) {
    return { source: "NONE", userId: "", fullName: "", departmentId: "", departmentName: "" };
  }
  const processing = context?.statusSync?.processing ?? {};
  const routed = userId
    ? [processing.primaryAssignee, ...(processing.assignees ?? [])].find(
        (participant: any) => idOf(participant?.userId) === userId,
      )
    : null;
  // The assignment describes the owner only when it names them. Otherwise it is
  // a leftover from routing and its department must not be attributed to them.
  const assigned = !userId || idOf(assignment.userId) === userId ? assignment : null;
  const person = options.directory?.get(userId);
  const departmentId =
    person?.departmentId || idOf(routed?.departmentId) || idOf(assigned?.departmentId);
  return {
    source,
    userId,
    fullName: person?.fullName || routed?.fullName || assigned?.fullName || "",
    departmentId,
    departmentName:
      person?.departmentName
      || (departmentId && idOf(assignment.departmentId) === departmentId
        ? assignment.departmentName ?? ""
        : ""),
  };
};

/** Both stored forms of the given ids, for querying a Mixed path. */
export const withObjectIds = (ids: string[]) => [
  ...ids,
  ...ids.filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id)),
];

/**
 * Mongo clauses matching every document one of these users could own. A query
 * cannot evaluate the precedence above, so this is a superset: narrow the result
 * with effectiveOfficeDocumentOwnerId before treating a row as owned.
 *
 * statusSync.processing is Mixed, so Mongoose does not cast into it and an
 * ObjectId stored there would not match its string form. Both are queried.
 */
export const officeDocumentOwnerCandidateClauses = (userIds: string[]) => [
  { "management.assignment.userId": { $in: userIds } },
  { "management.businessCompletion.submittedBy": { $in: userIds } },
  { "statusSync.processing.primaryAssignee.userId": { $in: withObjectIds(userIds) } },
];
