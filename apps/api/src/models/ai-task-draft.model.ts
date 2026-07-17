import { Schema, model, models } from 'mongoose';

const aiTaskPayloadSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: '' },
    workStartAt: { type: Date, required: true },
    workEndAt: { type: Date, required: true },
    declaredPoint: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const aiTaskDraftSchema = new Schema(
  {
    token: { type: String, required: true, unique: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    organization: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    department: { type: Schema.Types.ObjectId, ref: 'Department', default: null },
    payload: { type: aiTaskPayloadSchema, required: true },
    status: {
      type: String,
      enum: ['PENDING', 'CONFIRMING', 'CONFIRMED', 'EXPIRED'],
      default: 'PENDING',
      index: true,
    },
    confirmedDeclaration: { type: Schema.Types.ObjectId, ref: 'WorkDeclaration', default: null },
    confirmedAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

aiTaskDraftSchema.index({ user: 1, status: 1, createdAt: -1 });
aiTaskDraftSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const AiTaskDraftModel = models.AiTaskDraft || model('AiTaskDraft', aiTaskDraftSchema);
export default AiTaskDraftModel;
