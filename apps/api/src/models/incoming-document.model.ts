import { Schema, model, models } from 'mongoose';
import { DOCUMENT_SOURCES, DOCUMENT_STATUSES, PRIORITIES } from './enums';

const routingHistorySchema = new Schema(
  {
    fromDepartment: { type: Schema.Types.ObjectId, ref: 'Department', default: null },
    toDepartment: { type: Schema.Types.ObjectId, ref: 'Department', default: null },
    fromUser: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    toUser: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    action: { type: String, enum: ['RECEIVE', 'ASSIGN_DEPARTMENT', 'ASSIGN_USER', 'RETURN', 'COMPLETE', 'ARCHIVE'], required: true },
    note: { type: String, trim: true },
    actedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const incomingDocumentSchema = new Schema(
  {
    organization: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    documentNumber: { type: String, required: true, trim: true },
    externalSystem: { type: String, trim: true, default: 'VNPT' },
    externalId: { type: String, trim: true, index: true },
    title: { type: String, required: true, trim: true, index: 'text' },
    summary: { type: String, trim: true },
    sender: { type: String, trim: true },
    category: { type: String, trim: true },
    priority: { type: String, enum: [...PRIORITIES], default: 'MEDIUM', index: true },
    source: { type: String, enum: [...DOCUMENT_SOURCES], default: 'MANUAL', index: true },
    status: { type: String, enum: [...DOCUMENT_STATUSES], default: 'DRAFT', index: true },
    receivedAt: { type: Date, default: Date.now, index: true },
    issuedAt: { type: Date },
    dueAt: { type: Date, index: true },
    receivedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    currentDepartment: { type: Schema.Types.ObjectId, ref: 'Department', default: null, index: true },
    currentAssignee: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    currentAssignees: [{ type: Schema.Types.ObjectId, ref: 'User', index: true }],
    assignedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    assignedAt: { type: Date },
    slaDueAt: { type: Date, index: true },
    completedAt: { type: Date },
    attachments: [{ type: Schema.Types.ObjectId, ref: 'FileAttachment' }],
    relatedTasks: [{ type: Schema.Types.ObjectId, ref: 'Task' }],
    routingHistory: { type: [routingHistorySchema], default: [] },
    aiExtraction: {
      status: { type: String, enum: ['NOT_REQUESTED', 'QUEUED', 'PROCESSING', 'SUCCEEDED', 'FAILED'], default: 'NOT_REQUESTED' },
      extractedText: { type: String, select: false },
      suggestedTitle: { type: String, trim: true },
      suggestedSummary: { type: String, trim: true },
      errorMessage: { type: String, trim: true },
      processedAt: { type: Date },
    },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

incomingDocumentSchema.index({ organization: 1, documentNumber: 1 }, { unique: true });
incomingDocumentSchema.index({ organization: 1, status: 1, dueAt: 1 });
incomingDocumentSchema.index({ currentDepartment: 1, status: 1, slaDueAt: 1 });

export const IncomingDocumentModel = models.IncomingDocument || model('IncomingDocument', incomingDocumentSchema);
export default IncomingDocumentModel;
