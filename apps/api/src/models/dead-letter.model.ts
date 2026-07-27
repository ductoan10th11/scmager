import { Schema, model, models } from "mongoose";
const deadLetterSchema = new Schema(
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
    jobId: {
      type: Schema.Types.ObjectId,
      ref: "IngestJob",
      required: true,
      index: true,
    },
    reasonCode: { type: String, required: true, maxlength: 100 },
    attempts: { type: Number, required: true, min: 1 },
    fenceToken: { type: Number, required: true, min: 1 },
    credentialEpoch: { type: Number, required: true, min: 1 },
    mappingVersion: { type: Number, required: true, min: 1 },
    governancePolicyEpoch: { type: Number, required: true, min: 1 },
  },
  { timestamps: true },
);
deadLetterSchema.index(
  { connectorId: 1, jobId: 1, fenceToken: 1, credentialEpoch: 1, mappingVersion: 1, governancePolicyEpoch: 1 },
  { unique: true },
);
export const DeadLetterModel =
  models.DeadLetter || model("DeadLetter", deadLetterSchema);
export default DeadLetterModel;
