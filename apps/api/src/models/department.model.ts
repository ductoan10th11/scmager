import { Schema, model, models } from 'mongoose';

const departmentSchema = new Schema(
  {
    organization: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    parent: { type: Schema.Types.ObjectId, ref: 'Department', default: null, index: true },
    leader: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, uppercase: true, trim: true },
    description: { type: String, trim: true },
    isOffice: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true },
);

departmentSchema.index({ organization: 1, code: 1 }, { unique: true });

export const DepartmentModel = models.Department || model('Department', departmentSchema);
export default DepartmentModel;
