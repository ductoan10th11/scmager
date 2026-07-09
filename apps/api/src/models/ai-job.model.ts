import { Schema, model, models } from 'mongoose';
import { AI_JOB_TYPES, JOB_STATUSES } from './enums';

const aiJobSchema = new Schema(
  {
    type: { type: String, enum: [...AI_JOB_TYPES], required: true, index: true },
    status: { type: String, enum: [...JOB_STATUSES], default: 'QUEUED', index: true },
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    targetModel: { type: String, enum: ['IncomingDocument', 'Task', 'FileAttachment'], required: true },
    targetId: { type: Schema.Types.ObjectId, required: true, index: true },
    input: { type: Schema.Types.Mixed, default: {}, select: false },
    output: { type: Schema.Types.Mixed, default: {} },
    errorMessage: { type: String, trim: true },
    startedAt: { type: Date },
    finishedAt: { type: Date },
  },
  { timestamps: true },
);

aiJobSchema.index({ status: 1, createdAt: 1 });
aiJobSchema.index({ targetModel: 1, targetId: 1 });

export const AiJobModel = models.AiJob || model('AiJob', aiJobSchema);
export default AiJobModel;
