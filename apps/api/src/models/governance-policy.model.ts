import { Schema, model, models } from "mongoose";

const governancePolicySchema = new Schema(
  {
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
    classificationRules: { type: [String], default: [] },
    retentionDays: { type: Number, default: null, min: 1 },
    approval: {
      approver: { type: String, trim: true, default: "" },
      approvedAt: { type: Date, default: null },
      provenance: { type: String, trim: true, default: "" },
    },
  },
  { timestamps: true },
);

governancePolicySchema.index(
  { organizationId: 1, version: 1 },
  { unique: true },
);
export const GovernancePolicyModel =
  models.GovernancePolicy || model("GovernancePolicy", governancePolicySchema);
export default GovernancePolicyModel;
