import { Schema, model, models } from 'mongoose';
import { USER_STATUSES } from './enums';

const userSchema = new Schema(
  {
    username: { type: String, required: true, lowercase: true, trim: true, unique: true, index: true },
    fullName: { type: String, required: true, trim: true, index: true },
    position: { type: String, trim: true, default: null },
    email: { type: String, required: true, lowercase: true, trim: true, unique: true, index: true },
    phone: { type: String, trim: true },
    passwordHash: { type: String, select: false },
    avatarUrl: { type: String, trim: true },
    role: { type: Schema.Types.ObjectId, ref: 'Role', required: true, index: true },
    organization: { type: Schema.Types.ObjectId, ref: 'Organization', default: null, index: true },
    department: { type: Schema.Types.ObjectId, ref: 'Department', default: null, index: true },
    manager: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    status: { type: String, enum: [...USER_STATUSES], default: 'ACTIVE', index: true },
    lastLoginAt: { type: Date },
    twoFactorEnabled: { type: Boolean, default: false, select: false },
    isSystemAdmin: { type: Boolean, default: false, index: true },
    notificationSettings: {
      inApp: { type: Boolean, default: true },
      email: { type: Boolean, default: false },
      push: { type: Boolean, default: true },
    },
  },
  { timestamps: true },
);

userSchema.index({ organization: 1, department: 1, status: 1 });

export const UserModel = models.User || model('User', userSchema);
export default UserModel;
