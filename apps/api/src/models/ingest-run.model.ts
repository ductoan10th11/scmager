import { Schema, model, models } from "mongoose";

const ingestRunSchema = new Schema(
  {
    jobId: {
      type: Schema.Types.ObjectId,
      ref: "IngestJob",
      required: true,
      index: true,
    },
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
    fenceToken: { type: Number, required: true },
    credentialEpoch: { type: Number, required: true },
    mappingVersion: { type: Number, required: true },
    governancePolicyEpoch: { type: Number, required: true },
    state: {
      type: String,
      enum: ["CLAIMED", "SUCCEEDED", "FAILED", "STALE", "BLOCKED"],
      default: "CLAIMED",
      index: true,
    },
    startedAt: { type: Date, required: true },
    finishedAt: { type: Date, default: null },
    reasonCode: { type: String, default: "", maxlength: 100 },
  },
  { timestamps: true },
);
ingestRunSchema.index({ connectorId: 1, createdAt: -1 });
export const IngestRunModel =
  models.IngestRun || model("IngestRun", ingestRunSchema);
export default IngestRunModel;
