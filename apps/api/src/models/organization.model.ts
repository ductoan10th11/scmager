import { Schema, model, models } from 'mongoose';
import { ORGANIZATION_TYPES } from './enums';

const organizationSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, uppercase: true, trim: true },
    type: { type: String, enum: [...ORGANIZATION_TYPES], required: true, index: true },
    parent: { type: Schema.Types.ObjectId, ref: 'Organization', default: null, index: true },
    address: { type: String, trim: true },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true },
);

organizationSchema.index({ parent: 1, code: 1 }, { unique: true });

export const OrganizationModel = models.Organization || model('Organization', organizationSchema);
export default OrganizationModel;
