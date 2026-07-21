import { Schema, model, models } from 'mongoose';

const chatContentSchema = new Schema(
  {
    session: { type: Schema.Types.ObjectId, ref: 'ChatSession', required: true, index: true },
    sequence: { type: Number, required: true, min: 1 },
    role: { type: String, enum: ['USER', 'ASSISTANT'], required: true },
    content: { type: String, required: true, trim: true, maxlength: 8000 },
    metadata: { type: Schema.Types.Mixed, default: () => ({}) },
  },
  { timestamps: true },
);

chatContentSchema.index({ session: 1, sequence: 1 }, { unique: true });
chatContentSchema.index({ session: 1, createdAt: -1 });

export const ChatContentModel = models.ChatContent || model('ChatContent', chatContentSchema);
export default ChatContentModel;
