import { Schema, model, models } from "mongoose";
import { NOTIFICATION_TYPES } from "./enums";

const notificationSchema = new Schema(
  {
    recipient: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      default: null,
      index: true,
    },
    connectorId: {
      type: Schema.Types.ObjectId,
      ref: "Connector",
      default: null,
      index: true,
    },
    actor: { type: Schema.Types.ObjectId, ref: "User", default: null },
    type: {
      type: String,
      enum: [...NOTIFICATION_TYPES],
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true },
    body: { type: String, trim: true },
    channels: {
      type: [String],
      enum: ["IN_APP", "EMAIL", "PUSH"],
      default: ["IN_APP"],
    },
    relatedModel: {
      type: String,
      enum: [
        "IncomingDocument",
        "Task",
        "Timesheet",
        "WorkDeclaration",
        "DocumentResultLink",
      ],
      required: true,
    },
    relatedId: { type: Schema.Types.ObjectId, required: true, index: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
    readAt: { type: Date, default: null, index: true },
    deliveredAt: { type: Date },
    outboxState: {
      type: String,
      enum: ["PENDING", "PUBLISHING", "PUBLISHED", "DLQ"],
      default: "PENDING",
      index: true,
    },
    outboxAttempts: { type: Number, default: 0, min: 0 },
    outboxNextAttemptAt: { type: Date, default: () => new Date(), index: true },
    outboxLockedAt: { type: Date, default: null },
    outboxLastError: { type: String, default: null, maxlength: 500 },
    publishedAt: { type: Date, default: null },
    revision: { type: Number, default: 1, min: 1 },
  },
  { timestamps: true },
);

notificationSchema.index({ recipient: 1, readAt: 1, createdAt: -1 });
notificationSchema.index({
  recipient: 1,
  type: 1,
  "metadata.dedupeKey": 1,
  createdAt: -1,
});
notificationSchema.index({ outboxState: 1, outboxNextAttemptAt: 1, outboxLockedAt: 1 });
notificationSchema.index(
  { recipient: 1, relatedModel: 1, relatedId: 1, type: 1, revision: 1 },
  {
    unique: true,
    partialFilterExpression: {
      relatedModel: "WorkDeclaration",
      revision: { $exists: true },
    },
  },
);

export const NotificationModel =
  models.Notification || model("Notification", notificationSchema);
export default NotificationModel;
