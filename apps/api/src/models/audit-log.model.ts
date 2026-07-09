import { Schema, model, models } from 'mongoose';

const auditLogSchema = new Schema(
  {
    actor: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    action: { type: String, required: true, trim: true, index: true },
    entityModel: { type: String, required: true, trim: true, index: true },
    entityId: { type: Schema.Types.ObjectId, required: true, index: true },
    organization: { type: Schema.Types.ObjectId, ref: 'Organization', default: null, index: true },
    department: { type: Schema.Types.ObjectId, ref: 'Department', default: null, index: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
    ipAddress: { type: String, trim: true },
    userAgent: { type: String, trim: true },
  },
  { timestamps: true },
);

auditLogSchema.index({ entityModel: 1, entityId: 1, createdAt: -1 });
auditLogSchema.index({ organization: 1, createdAt: -1 });

export const AuditLogModel = models.AuditLog || model('AuditLog', auditLogSchema);
export default AuditLogModel;
