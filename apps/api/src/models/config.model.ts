import { Schema, model, models } from 'mongoose';

const configSchema = new Schema(
  {
    key: { type: String, required: true, trim: true },
    value: { type: Schema.Types.Mixed, required: true },
  },
  { timestamps: true },
);

configSchema.index({ key: 1 }, { unique: true });

export const ConfigModel = models.Config || model('Config', configSchema);
export default ConfigModel;
