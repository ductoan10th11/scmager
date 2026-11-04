/**
 * Whether a specialist's "this was assigned by mistake" request applies to a
 * document. Everything here is a pure function over a context object, like
 * office-document-owner.service: it must not import a model, so the KPI, the
 * reports and the completion helpers can all read it without an import cycle.
 */

export type OfficeDocumentNotRequiredStatus =
  | "NONE"
  | "PENDING"
  | "CONFIRMED"
  | "REJECTED"
  | "CANCELLED";

export const officeDocumentNotRequiredStatus = (context: any): OfficeDocumentNotRequiredStatus =>
  context?.management?.notRequired?.status ?? "NONE";

/** Waiting for a leader: shown in section II, not counted in anyone's totals. */
export const isOfficeDocumentUnderNotRequiredReview = (context: any) =>
  officeDocumentNotRequiredStatus(context) === "PENDING";

/** A leader agreed nobody had to do this: it stops counting as work altogether. */
export const isOfficeDocumentNotRequired = (context: any) =>
  officeDocumentNotRequiredStatus(context) === "CONFIRMED";

/** The same rule for a query. Rows predating the field have no status and match. */
export const officeDocumentStillRequiredClause = {
  "management.notRequired.status": { $ne: "CONFIRMED" },
};
