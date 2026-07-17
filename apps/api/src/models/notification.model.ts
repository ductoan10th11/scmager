import { Schema, model, models } from 'mongoose';
import { NOTIFICATION_TYPES } from './enums';

const notificationSchema = new Schema(
  {
    recipient: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    actor: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    type: { type: String, enum: [...NOTIFICATION_TYPES], required: true, index: true },
    title: { type: String, required: true, trim: true },
    body: { type: String, trim: true },
    channels: { type: [String], enum: ['IN_APP', 'EMAIL', 'PUSH'], default: ['IN_APP'] },
    relatedModel: { type: String, enum: ['IncomingDocument', 'Task', 'Timesheet', 'WorkDeclaration'], required: true },
    relatedId: { type: Schema.Types.ObjectId, required: true, index: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
    readAt: { type: Date, default: null, index: true },
    deliveredAt: { type: Date },
  },
  { timestamps: true },
);

notificationSchema.index({ recipient: 1, readAt: 1, createdAt: -1 });
notificationSchema.index({ recipient: 1, type: 1, 'metadata.dedupeKey': 1, createdAt: -1 });

export const NotificationModel = models.Notification || model('Notification', notificationSchema);
export default NotificationModel;
