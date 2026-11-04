import { Schema, model, models } from "mongoose";

const recipientSchema = new Schema(
  {
    userId: { type: String, trim: true, default: "" },
    department: { type: String, trim: true, default: "" },
    fullName: { type: String, trim: true, default: "" },
    role: {
      type: String,
      enum: ["main", "collaborator", "view", "co_send", "co_process"],
      required: true,
    },
    entityType: { type: String, enum: ["person", "unit"], required: true },
  },
  { _id: false },
);

const senderSchema = new Schema(
  {
    userId: { type: String, trim: true, default: "" },
    fullName: { type: String, trim: true, default: "" },
    department: { type: String, trim: true, default: "" },
  },
  { _id: false },
);

const observationSchema = new Schema(
  {
    available: { type: Boolean, required: true },
    modalOpen: { type: Boolean, required: true },
    title: { type: String, trim: true, default: "" },
    subject: { type: String, trim: true, default: "" },
    soKyHieu: { type: String, trim: true, default: "" },
    receivedDate: { type: String, trim: true, default: "" },
    dueDate: { type: String, trim: true, default: "" },
    documentForm: { type: String, trim: true, default: "" },
    priority: { type: String, trim: true, default: "" },
    createdDate: { type: String, trim: true, default: "" },
    draftingUnit: { type: String, trim: true, default: "" },
    draftingUnitId: { type: String, trim: true, default: "" },
    draftingUser: { type: String, trim: true, default: "" },
    draftingUserId: { type: String, trim: true, default: "" },
    senderUser: { type: String, trim: true, default: "" },
    senderUserId: { type: String, trim: true, default: "" },
    senderDepartment: { type: String, trim: true, default: "" },
    sender: { type: senderSchema, default: () => ({}) },
    relatedIncomingSoKyHieu: { type: String, trim: true, default: "" },
    comment: { type: String, trim: true, default: "" },
    point: { type: Number, default: null },
    reworkCount: { type: Number, min: 0, default: 0 },
    note: { type: String, trim: true, default: "" },
    recipients: { type: [recipientSchema], default: [] },
    timeline: { type: [Schema.Types.Mixed], default: [] },
  },
  { _id: false },
);

const statusSyncSchema = new Schema(
  {
    status: {
      type: String,
      enum: [
        "PENDING_RESPONSE",
        "RESPONSE_CREATED",
        "IN_PROGRESS",
        "COMPLETED",
      ],
      default: "PENDING_RESPONSE",
      index: true,
    },
    completed: { type: Boolean, default: false, index: true },
    completedRule: { type: String, trim: true, default: "" },
    completedAt: { type: Date, default: null },
    trackLogs: { type: [Schema.Types.Mixed], default: [] },
    processing: { type: Schema.Types.Mixed, default: null },
    lastSyncedAt: { type: Date, default: null },
    lastAttemptAt: { type: Date, default: null },
    nextRetryAt: { type: Date, default: null, index: true },
    attempts: { type: Number, min: 0, default: 0 },
    lastError: { type: String, trim: true, default: "" },
  },
  { _id: false },
);

const managementAssignmentSchema = new Schema(
  {
    departmentId: {
      type: Schema.Types.ObjectId,
      ref: "Department",
      default: null,
      index: true,
    },
    departmentName: { type: String, trim: true, default: "" },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    fullName: { type: String, trim: true, default: "" },
  },
  { _id: false },
);

const kpiImportSchema = new Schema(
  {
    importKey: { type: String, trim: true, default: '' },
    point: { type: Number, min: 0, default: null },
    product: { type: String, trim: true, default: '' },
    assignedQuantity: { type: Number, min: 0, default: 1 },
    completedQuantity: { type: Number, min: 0, default: 0 },
    completedAt: { type: Date, default: null },
    reworkCount: { type: Number, min: 0, default: 0 },
    importedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    importedAt: { type: Date, default: null },
  },
  { _id: false },
);

const businessCompletionSchema = new Schema(
  {
    completed: { type: Boolean, default: false, index: true },
    evidenceType: {
      type: String,
      enum: ["DOCUMENT_RESULT", "WORK_DECLARATION"],
      default: null,
    },
    evidenceId: { type: Schema.Types.ObjectId, default: null },
    submittedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    submittedAt: { type: Date, default: null },
    approvedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    approvedAt: { type: Date, default: null },
    point: { type: Number, min: 0, default: null },
    reworkCount: { type: Number, min: 0, default: 0 },
  },
  { _id: false },
);

const productReconciliationHistorySchema = new Schema(
  {
    classification: { type: String, trim: true, default: "" },
    performerStatus: { type: String, trim: true, default: "" },
    scoreStatus: { type: String, trim: true, default: "" },
    reason: { type: String, trim: true, default: "" },
    recordedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const productReconciliationSchema = new Schema(
  {
    classification: {
      type: String,
      enum: ["LINKED_RESULT", "PENDING_RELATION", "STANDALONE_PRODUCT"],
      default: "STANDALONE_PRODUCT",
      index: true,
    },
    performerStatus: {
      type: String,
      enum: ["RESOLVED", "UNRESOLVED"],
      default: "UNRESOLVED",
      index: true,
    },
    scoreStatus: {
      type: String,
      enum: ["PENDING", "APPROVED", "NOT_APPLICABLE"],
      default: "PENDING",
      index: true,
    },
    scoreSource: {
      type: String,
      enum: ["NONE", "EOFFICE", "MANUAL", "SOURCE_TASK"],
      default: "NONE",
    },
    proposedPoint: { type: Number, min: 0, max: 1_000_000, default: null },
    sourcePointTrackLogId: { type: String, trim: true, default: "" },
    sourceFingerprint: { type: String, trim: true, default: "" },
    relatedIncomingExternalIds: { type: [String], default: [] },
    approvedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    approvedAt: { type: Date, default: null },
    attempts: { type: Number, min: 0, default: 0 },
    nextRetryAt: { type: Date, default: null },
    history: { type: [productReconciliationHistorySchema], default: [] },
    lastReconciledAt: { type: Date, default: null },
    lastError: { type: String, trim: true, default: "" },
  },
  { _id: false },
);

/**
 * A specialist disputing the point or the rework count recorded against a
 * document. Only a leader decides it; the decision and its reason are also
 * appended to management.note so anyone reading the document sees them.
 */
const scoreComplaintSchema = new Schema(
  {
    status: {
      type: String,
      enum: ["NONE", "PENDING", "APPROVED", "REJECTED", "CANCELLED"],
      default: "NONE",
      index: true,
    },
    requestedPoint: { type: Number, min: 0, default: null },
    requestedReworkCount: { type: Number, min: 0, default: null },
    approvedPoint: { type: Number, min: 0, default: null },
    approvedReworkCount: { type: Number, min: 0, default: null },
    reason: { type: String, trim: true, default: "" },
    decisionNote: { type: String, trim: true, default: "" },
    requestedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    requestedAt: { type: Date, default: null },
    decidedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    decidedAt: { type: Date, default: null },
    history: {
      type: [
        new Schema(
          {
            action: {
              type: String,
              enum: ["REQUESTED", "APPROVED", "REJECTED", "CANCELLED"],
              required: true,
            },
            actor: { type: Schema.Types.ObjectId, ref: "User", default: null },
            requestedPoint: { type: Number, min: 0, default: null },
            requestedReworkCount: { type: Number, min: 0, default: null },
            approvedPoint: { type: Number, min: 0, default: null },
            approvedReworkCount: { type: Number, min: 0, default: null },
            note: { type: String, trim: true, default: "" },
            actedAt: { type: Date, default: Date.now },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
  },
  { _id: false },
);

/**
 * A specialist saying a document was assigned by mistake and needs no work. It
 * is a soft exclusion: the document and this trail always stay, because a hard
 * delete would be undone by the next extension sync. KPI reads the status through
 * office-document-not-required-state.service; only the extension's observation
 * and statusSync are rewritten on sync, so this survives it.
 */
const notRequiredSchema = new Schema(
  {
    status: {
      type: String,
      enum: ["NONE", "PENDING", "CONFIRMED", "REJECTED", "CANCELLED"],
      default: "NONE",
    },
    reason: { type: String, trim: true, default: "" },
    requestedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    // The KPI export names the requester, who may be out of the viewer's scope.
    requestedByName: { type: String, trim: true, default: "" },
    requestedAt: { type: Date, default: null },
    decisionNote: { type: String, trim: true, default: "" },
    decidedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    decidedAt: { type: Date, default: null },
    history: {
      type: [
        new Schema(
          {
            action: {
              type: String,
              enum: ["REQUESTED", "CONFIRMED", "REJECTED", "CANCELLED", "RESTORED"],
              required: true,
            },
            actor: { type: Schema.Types.ObjectId, ref: "User", default: null },
            actorName: { type: String, trim: true, default: "" },
            note: { type: String, trim: true, default: "" },
            actedAt: { type: Date, default: Date.now },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
  },
  { _id: false },
);

const managementSchema = new Schema(
  {
    overrides: { type: Schema.Types.Mixed, default: () => ({}) },
    scoreComplaint: { type: scoreComplaintSchema, default: () => ({}) },
    notRequired: { type: notRequiredSchema, default: () => ({}) },
    assignment: { type: managementAssignmentSchema, default: () => ({}) },
    // Whether a manager chose the assignee (MANUAL) or it follows the workflow
    // (AUTO). updatedBy cannot answer this: it is set by any edit. Null marks a
    // row written before this field existed; see isAssignmentManual.
    assignmentMode: { type: String, enum: ["AUTO", "MANUAL"], default: null },
    kpiImport: { type: kpiImportSchema, default: () => ({}) },
    businessCompletion: {
      type: businessCompletionSchema,
      default: () => ({ completed: false }),
    },
    product: {
      type: productReconciliationSchema,
      default: () => ({}),
    },
    manualScore: { type: Number, min: 0, max: 1_000_000, default: null },
    // Who last changed the score by hand. A PL4 import must not overwrite it, and
    // the value alone cannot say so: scores are written through to kpiImport.point.
    scoreEditedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    scoreEditedAt: { type: Date, default: null },
    note: { type: String, trim: true, default: "" },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    updatedAt: { type: Date, default: null },
  },
  { _id: false },
);

const officeDocumentContextSchema = new Schema(
  {
    // Extension requests are signed but do not carry an authenticated user.
    // Resolve and persist the tenant once from the observed eOffice people.
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      default: null,
      index: true,
    },
    tenantResolution: {
      type: String,
      enum: ["SENDER", "RECIPIENT", "DRAFTING_USER", "DEPARTMENT", "AMBIGUOUS", "UNRESOLVED", "MANUAL"],
      default: "UNRESOLVED",
      index: true,
    },
    origin: {
      type: String,
      enum: ["EXTENSION", "MANUAL", "MANUAL_INGEST"],
      default: "EXTENSION",
      index: true,
    },
    sourceHost: { type: String, required: true, trim: true, lowercase: true },
    normalizedSoKyHieu: { type: String, trim: true, default: "", index: true },
    pageType: {
      type: String,
      enum: ["incoming", "outgoing", "outgoing_c2"],
      required: true,
    },
    externalDocumentId: { type: String, required: true, trim: true },
    sourceUrl: { type: String, required: true, trim: true },
    observation: { type: observationSchema, required: true },
    observedAt: { type: Date, required: true },
    // This is populated only by the status-only ingest worker. Extension
    // observations remain the source for all document identity/detail fields.
    statusSync: { type: statusSyncSchema, default: () => ({}) },
    management: { type: managementSchema, default: () => ({}) },
  },
  { timestamps: true },
);

officeDocumentContextSchema.index(
  { sourceHost: 1, pageType: 1, externalDocumentId: 1 },
  { unique: true },
);
officeDocumentContextSchema.index({ pageType: 1, updatedAt: -1 });
officeDocumentContextSchema.index({ organizationId: 1, pageType: 1, updatedAt: -1 });
officeDocumentContextSchema.index({
  organizationId: 1,
  pageType: 1,
  normalizedSoKyHieu: 1,
});
officeDocumentContextSchema.index({
  pageType: 1,
  "statusSync.completed": 1,
  "statusSync.nextRetryAt": 1,
  observedAt: 1,
});
officeDocumentContextSchema.index({
  "management.assignment.departmentId": 1,
  "management.assignment.userId": 1,
});
officeDocumentContextSchema.index({
  organizationId: 1,
  pageType: 1,
  "management.product.classification": 1,
  "management.product.performerStatus": 1,
  "management.product.scoreStatus": 1,
});
officeDocumentContextSchema.index({
  "observation.subject": "text",
  "observation.soKyHieu": "text",
  externalDocumentId: "text",
});

export const OfficeDocumentContextModel =
  models.OfficeDocumentContext ||
  model("OfficeDocumentContext", officeDocumentContextSchema);
export default OfficeDocumentContextModel;
