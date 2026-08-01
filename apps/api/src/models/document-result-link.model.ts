import { Schema, model, models } from 'mongoose';

export const DOCUMENT_RESULT_LINK_STATUSES = [
  'PENDING_APPROVAL',
  'APPROVED',
  'RETURNED',
  'SUPERSEDED',
] as const;

export const DOCUMENT_RESULT_LINK_APPROVAL_ACTIONS = [
  'SUBMITTED',
  'FORWARDED',
  'APPROVED',
  'RETURNED',
  'SUPERSEDED',
] as const;

const approvalHistorySchema = new Schema(
  {
    action: {
      type: String,
      enum: [...DOCUMENT_RESULT_LINK_APPROVAL_ACTIONS],
      required: true,
    },
    actor: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    fromApprover: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    toApprover: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    note: { type: String, trim: true, default: null },
    actedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const approvalSchema = new Schema(
  {
    currentApprover: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    openToHigher: { type: Boolean, default: false },
    submittedAt: { type: Date, default: Date.now },
    approvedAt: { type: Date, default: null },
    returnedAt: { type: Date, default: null },
    history: { type: [approvalHistorySchema], default: [] },
  },
  { _id: false },
);

const documentResultLinkSchema = new Schema(
  {
    organization: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
    },
    incomingDocument: {
      type: Schema.Types.ObjectId,
      ref: 'OfficeDocumentContext',
      required: true,
    },
    outgoingDocument: {
      type: Schema.Types.ObjectId,
      ref: 'OfficeDocumentContext',
      required: true,
    },
    status: {
      type: String,
      enum: [...DOCUMENT_RESULT_LINK_STATUSES],
      default: 'PENDING_APPROVAL',
      required: true,
    },
    submittedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    performedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    approval: { type: approvalSchema, default: () => ({}) },
    submittedAt: { type: Date, default: Date.now, required: true },
    approvedAt: { type: Date, default: null },
    revision: { type: Number, default: 1, required: true, min: 1 },
  },
  { timestamps: true },
);

documentResultLinkSchema.index(
  { organization: 1, incomingDocument: 1, outgoingDocument: 1 },
  { unique: true },
);
documentResultLinkSchema.index(
  { organization: 1, outgoingDocument: 1 },
  { unique: true },
);
documentResultLinkSchema.index({
  organization: 1,
  incomingDocument: 1,
  status: 1,
  submittedAt: -1,
});
documentResultLinkSchema.index({
  organization: 1,
  outgoingDocument: 1,
  status: 1,
  submittedAt: -1,
});
documentResultLinkSchema.index({
  organization: 1,
  status: 1,
  submittedAt: -1,
});
documentResultLinkSchema.index(
  { 'approval.currentApprover': 1, submittedAt: -1 },
  { partialFilterExpression: { status: 'PENDING_APPROVAL' } },
);
documentResultLinkSchema.index(
  { organization: 1, 'approval.openToHigher': 1, submittedAt: -1 },
  {
    partialFilterExpression: {
      status: 'PENDING_APPROVAL',
      'approval.openToHigher': true,
    },
  },
);

export const DocumentResultLinkModel = models.DocumentResultLink
  || model('DocumentResultLink', documentResultLinkSchema);

export default DocumentResultLinkModel;
