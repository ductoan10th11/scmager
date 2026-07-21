import { Schema, model, models } from 'mongoose';

const personSchema = new Schema(
  {
    username: { type: String, trim: true, default: '' },
    fullName: { type: String, trim: true, default: '' },
  },
  { _id: false },
);

const trackLogSchema = new Schema(
  {
    sender: { type: personSchema, default: () => ({}) },
    content: { type: String, trim: true, default: '' },
    receivedAt: { type: String, default: null },
    processingAt: { type: String, default: null },
    completedAt: { type: String, default: null },
    updatedAt: { type: String, default: null },
  },
  { _id: false },
);

const outgoingDocumentSchema = new Schema(
  {
    documentId: { type: String, required: true, trim: true, unique: true, index: true },
    soKyHieu: { type: String, trim: true, default: '', index: true },
    trichYeu: { type: String, trim: true, default: '', index: 'text' },
    ngayBanHanh: { type: String, trim: true, default: '', index: true },
    doKhan: { type: String, trim: true, default: '' },
    nguoiSoan: { type: String, trim: true, default: '' },
    nguoiKy: { type: String, trim: true, default: '' },
    // An outgoing document is stored only through one or more incoming source
    // documents. This makes an orphan outgoing record impossible to create.
    sourceDocuments: { type: [{ type: Schema.Types.ObjectId, ref: 'Document' }], default: [], index: true },
    sourceDocumentIds: { type: [String], default: [], index: true },
    trackLogs: { type: [trackLogSchema], default: [] },
    ingest: {
      source: { type: String, default: 'LANGSON_DWR', index: true },
      fetchedAt: { type: Date, default: null },
    },
  },
  { timestamps: true },
);

outgoingDocumentSchema.index({ sourceDocuments: 1, updatedAt: -1 });
outgoingDocumentSchema.index({ ngayBanHanh: -1, updatedAt: -1 });

export const OutgoingDocumentModel = models.OutgoingDocument
  || model('OutgoingDocument', outgoingDocumentSchema);
export default OutgoingDocumentModel;
