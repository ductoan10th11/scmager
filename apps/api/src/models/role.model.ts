import { Schema, model, models } from 'mongoose';
import { ROLE_CODES } from './enums';

const roleSchema = new Schema(
  {
    code: { type: String, enum: [...ROLE_CODES], required: true, unique: true, index: true },
    name: { type: String, required: true, trim: true },
    level: { type: Number, required: true, min: 0, index: true },
    permissions: { type: [String], default: [] },
    description: { type: String, trim: true },
  },
  { timestamps: true },
);

export const RoleModel = models.Role || model('Role', roleSchema);
export default RoleModel;
