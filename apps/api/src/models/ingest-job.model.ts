import { Schema, model, models } from "mongoose";

const ingestJobSchema = new Schema(
  {
    connectorId: {
      type: Schema.Types.ObjectId,
      ref: "Connector",
      required: true,
      index: true,
    },
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    idempotencyKey: { type: String, required: true, trim: true },
    runType: { type: String, enum: ["SCHEDULED", "MANUAL"], required: true },
    state: {
      type: String,
      enum: ["QUEUED", "CLAIMED", "SUCCEEDED", "FAILED", "DEAD_LETTER"],
      default: "QUEUED",
      index: true,
    },
    scheduledFor: { type: Date, required: true, index: true },
    attempts: { type: Number, default: 0, min: 0 },
    nextAttemptAt: { type: Date, required: true, index: true },
    claimExpiresAt: { type: Date, default: null, index: true },
    fenceToken: { type: Number, default: 0 },
    // Copied at claim time. A job can only be completed, retried, or sent to
    // the DLQ by the exact Connector state that claimed it.
    credentialEpoch: { type: Number, default: 0, min: 0 },
    mappingVersion: { type: Number, default: 0, min: 0 },
    governancePolicyEpoch: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
);
ingestJobSchema.index({ connectorId: 1, idempotencyKey: 1 }, { unique: true });
ingestJobSchema.index({ state: 1, nextAttemptAt: 1, connectorId: 1 });
export const IngestJobModel =
  models.IngestJob || model("IngestJob", ingestJobSchema);
export default IngestJobModel;
