import { Schema, model, models } from 'mongoose';

/**
 * Tenant-owned work rules.  Absence intentionally resolves to the restrictive
 * defaults in the workflow service; it must never turn on self approval.
 */
const workPolicySchema = new Schema(
  {
    organization: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      unique: true,
      index: true,
    },
    timeZone: { type: String, enum: ['Asia/Ho_Chi_Minh'], default: 'Asia/Ho_Chi_Minh' },
    dailyCapacityMinutes: { type: Number, min: 1, max: 1440, default: 480 },
    blockOverCapacity: { type: Boolean, default: true },
    allowSelfApproval: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export const WorkPolicyModel = models.WorkPolicy || model('WorkPolicy', workPolicySchema);
export default WorkPolicyModel;
