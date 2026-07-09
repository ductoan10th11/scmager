import { Schema, model, models } from 'mongoose';
import { DOCUMENT_SOURCES } from './enums';

const fileAttachmentSchema = new Schema(
  {
    bucket: { type: String, required: true, trim: true },
    objectKey: { type: String, required: true, trim: true },
    fileName: { type: String, required: true, trim: true },
    contentType: { type: String, trim: true },
    sizeBytes: { type: Number, min: 0, default: 0 },
    checksum: { type: String, trim: true },
    source: { type: String, enum: [...DOCUMENT_SOURCES], default: 'MANUAL', index: true },
    category: { type: String, enum: ['DECISION', 'WORK'], index: true },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    linkedModel: { type: String, enum: ['IncomingDocument', 'Task', 'Timesheet'], required: true, index: true },
    linkedId: { type: Schema.Types.ObjectId, required: true, index: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

fileAttachmentSchema.index({ bucket: 1, objectKey: 1 }, { unique: true });
fileAttachmentSchema.index({ linkedModel: 1, linkedId: 1 });

export const FileAttachmentModel = models.FileAttachment || model('FileAttachment', fileAttachmentSchema);
export default FileAttachmentModel;
