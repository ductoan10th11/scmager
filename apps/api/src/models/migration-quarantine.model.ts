import { Schema, model, models } from "mongoose";
const migrationQuarantineSchema = new Schema(
  {
    collection: {
      type: String,
      required: true,
      enum: ["Document", "OutgoingDocument"],
    },
    legacyId: { type: Schema.Types.ObjectId, required: true },
    reasonCode: { type: String, required: true, maxlength: 100 },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
migrationQuarantineSchema.index(
  { collection: 1, legacyId: 1 },
  { unique: true },
);
export const MigrationQuarantineModel =
  models.MigrationQuarantine ||
  model("MigrationQuarantine", migrationQuarantineSchema);
export default MigrationQuarantineModel;
