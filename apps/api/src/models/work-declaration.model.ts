import { Schema, model, models } from 'mongoose';

export const WORK_DECLARATION_STATUSES = [
  'DRAFT',
  'PENDING_APPROVAL',
  'RETURNED',
  'APPROVED',
  'CANCELLED',
] as const;

const approvalHistorySchema = new Schema(
  {
    action: {
      type: String,
      enum: ['SUBMITTED', 'FORWARDED', 'APPROVED', 'RETURNED', 'SELF_APPROVED'],
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
    currentApprover: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    submittedAt: { type: Date, default: null },
    approvedAt: { type: Date, default: null },
    returnedAt: { type: Date, default: null },
    history: { type: [approvalHistorySchema], default: [] },
  },
  { _id: false },
);

const workDeclarationSchema = new Schema(
  {
    organization: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    department: { type: Schema.Types.ObjectId, ref: 'Department', default: null, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    sourceDocument: { type: Schema.Types.ObjectId, ref: 'Document', default: null, index: true },
    title: { type: String, required: true, trim: true, index: 'text' },
    description: { type: String, trim: true, default: '' },
    workStartAt: { type: Date, required: true, index: true },
    workEndAt: { type: Date, required: true, index: true },
    durationMinutes: { type: Number, required: true, min: 1 },
    declaredPoint: { type: Number, required: true, min: 0 },
    status: { type: String, enum: [...WORK_DECLARATION_STATUSES], default: 'DRAFT', index: true },
    approval: { type: approvalSchema, default: () => ({}) },
  },
  { timestamps: true },
);

workDeclarationSchema.index({ organization: 1, status: 1, createdAt: -1 });
workDeclarationSchema.index({ department: 1, status: 1, createdAt: -1 });
workDeclarationSchema.index({ createdBy: 1, status: 1, createdAt: -1 });
workDeclarationSchema.index({ 'approval.currentApprover': 1, status: 1, createdAt: -1 });
workDeclarationSchema.index({ 'approval.history.actor': 1, 'approval.history.action': 1, status: 1, createdAt: -1 });
workDeclarationSchema.index({ sourceDocument: 1, createdBy: 1, createdAt: -1 });

export const WorkDeclarationModel = models.WorkDeclaration
  || model('WorkDeclaration', workDeclarationSchema);
export default WorkDeclarationModel;
