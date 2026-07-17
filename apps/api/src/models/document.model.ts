import { Schema, model, models } from 'mongoose';

const trackLogSchema = new Schema(
  {
    id: { type: String, trim: true },
    sender: {
      username: { type: String, trim: true, default: '' },
      fullName: { type: String, trim: true, default: '' },
    },
    receiver: {
      username: { type: String, trim: true, default: '' },
      fullName: { type: String, trim: true, default: '' },
    },
    action: { type: String, trim: true, default: '' },
    comment: { type: String, trim: true, default: '' },
    receivedAt: { type: String, default: null },
    processingAt: { type: String, default: null },
    completedAt: { type: String, default: null },
  },
  { _id: false },
);

const ingestSchema = new Schema(
  {
    source: { type: String, default: 'LANGSON_DWR', index: true },
    listFetchedAt: { type: Date, default: null },
    detailFetchedAt: { type: Date, default: null },
    trackLogFetchedAt: { type: Date, default: null },
    completed: { type: Boolean, default: false, index: true },
    completedRule: { type: String, trim: true, default: '' },
    attempts: { type: Number, min: 0, default: 0 },
    lastAttemptAt: { type: Date, default: null },
    nextRetryAt: { type: Date, default: null, index: true },
    lastError: { type: String, trim: true, default: '' },
    deadLetter: { type: Boolean, default: false, index: true },
    deadLetterAt: { type: Date, default: null },
    deadLetterReason: { type: String, trim: true, default: '' },
  },
  { _id: false },
);

const processingAssigneeSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    username: { type: String, trim: true, default: null },
    externalUsername: { type: String, trim: true, default: null },
    fullName: { type: String, trim: true, default: '' },
    externalFullName: { type: String, trim: true, default: '' },
    position: { type: String, trim: true, default: null },
    status: { type: String, enum: ['PENDING', 'PROCESSED'], default: 'PENDING' },
    assignedAt: { type: String, default: null },
    assignedTrackLogId: { type: String, default: null },
    processedAt: { type: String, default: null },
    processedTrackLogId: { type: String, default: null },
  },
  { _id: false },
);

const processingSchema = new Schema(
  {
    status: { type: String, enum: ['UNASSIGNED', 'IN_PROGRESS', 'MANUALLY_PROCESSED', 'COMPLETED'], default: 'UNASSIGNED', index: true },
    currentAssignee: { type: processingAssigneeSchema, default: null },
    assignees: { type: [processingAssigneeSchema], default: [] },
    manual: {
      processedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
      username: { type: String, trim: true, default: null },
      fullName: { type: String, trim: true, default: null },
      position: { type: String, trim: true, default: null },
      note: { type: String, trim: true, default: null },
      processedAt: { type: Date, default: null },
    },
  },
  { _id: false },
);

const documentSchema = new Schema(
  {
    documentId: { type: String, required: true, trim: true, unique: true, index: true },
    processKey: { type: String, trim: true, default: '' },

    soDen: { type: String, required: true, trim: true, index: true },
    soKyHieu: { type: String, trim: true, default: '' },
    trichYeu: { type: String, trim: true, default: '', index: 'text' },
    donViBanHanh: { type: String, trim: true, default: '' },
    hinhThuc: { type: String, trim: true, default: '' },

    ngayVanBan: { type: String, trim: true, default: '' },
    ngayDen: { type: String, trim: true, default: '' },
    doKhan: { type: String, trim: true, default: '' },
    doMat: { type: String, trim: true, default: '' },

    nguoiXuLy: { type: String, trim: true, default: '' },
    nguoiSoan: { type: String, trim: true, default: '' },
    nguoiKy: { type: String, trim: true, default: '' },
    trangThai: { type: Number, default: null },
    deadline: { type: Date, default: null },
    point: { type: Number, default: 0 },
    pointSource: {
      trackLogId: { type: String, trim: true, default: null },
      comment: { type: String, trim: true, default: null },
      extractedAt: { type: Date, default: null },
    },

    processing: { type: processingSchema, default: () => ({}) },

    trackLogs: { type: [trackLogSchema], default: [] },
    ingest: { type: ingestSchema, default: () => ({}) },
  },
  { timestamps: true },
);

documentSchema.index({ 'ingest.completed': 1, updatedAt: -1 });
documentSchema.index({ 'ingest.completed': 1, 'ingest.deadLetter': 1, 'ingest.nextRetryAt': 1, updatedAt: 1 });
documentSchema.index({ 'processing.currentAssignee.userId': 1, deadline: 1 });
documentSchema.index({ 'processing.assignees.userId': 1, updatedAt: -1 });
documentSchema.index({ 'processing.manual.processedBy': 1, 'processing.manual.processedAt': -1 });

export const DocumentModel = models.Document || model('Document', documentSchema);
export default DocumentModel;
