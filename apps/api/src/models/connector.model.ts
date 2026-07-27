import { Schema, model, models } from "mongoose";

export const CONNECTOR_STATES = [
  "DRAFT",
  "BLOCKED",
  "ACTIVE",
  "DISABLED",
  "DELETING",
] as const;

const connectorSchema = new Schema(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      immutable: true,
      index: true,
    },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    sourceSystem: {
      type: String,
      required: true,
      trim: true,
      default: "LANGSON_DWR",
    },
    // Legacy migration fallback. New Connectors store their per-Connector
    // account encrypted in ingestAccountCiphertext instead.
    secretRef: { type: String, trim: true, select: false, default: null },
    ingestAccountCiphertext: { type: String, select: false, default: null },
    state: {
      type: String,
      enum: CONNECTOR_STATES,
      default: "DRAFT",
      index: true,
    },
    credentialEpoch: { type: Number, default: 1, min: 1 },
    mappingVersion: { type: Number, default: 1, min: 1 },
    governancePolicyId: {
      type: Schema.Types.ObjectId,
      ref: "GovernancePolicy",
      default: null,
    },
    governancePolicyEpoch: { type: Number, default: 0, min: 0 },
    scheduleGeneration: { type: Number, default: 1, min: 1 },
    nextRunAt: { type: Date, default: null, index: true },
    activeFenceToken: { type: Number, default: 0, min: 0 },
    leaseUntil: { type: Date, default: null },
    session: {
      status: {
        type: String,
        enum: ["HEALTHY", "REAUTH_REQUIRED", "AUTHENTICATING", "BLOCKED"],
        default: "REAUTH_REQUIRED",
      },
      expiresAt: { type: Date, default: null },
      credentialEpoch: { type: Number, default: 0 },
    },
    rateLimit: {
      maxRequests: { type: Number, default: 8, min: 1 },
      windowMs: { type: Number, default: 1000, min: 1 },
    },
    budgetWindowStartedAt: { type: Date, default: null },
    budgetRequests: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
);

connectorSchema.index({ organizationId: 1, name: 1 }, { unique: true });
connectorSchema.index({ state: 1, nextRunAt: 1 });

export const ConnectorModel =
  models.Connector || model("Connector", connectorSchema);
export default ConnectorModel;
