import { Schema, model, models } from "mongoose";

const connectorMappingSchema = new Schema(
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
    version: { type: Number, required: true, min: 1 },
    state: {
      type: String,
      enum: ["DRAFT", "APPROVED", "REVOKED"],
      default: "DRAFT",
      index: true,
    },
    classification: {
      type: String,
      enum: ["PERMITTED", "SENSITIVE", "DENY"],
      required: true,
    },
    approvedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
connectorMappingSchema.index({ connectorId: 1, version: 1 }, { unique: true });
connectorMappingSchema.index({ connectorId: 1, organizationId: 1, state: 1 });
export const ConnectorMappingModel =
  models.ConnectorMapping || model("ConnectorMapping", connectorMappingSchema);
export default ConnectorMappingModel;
