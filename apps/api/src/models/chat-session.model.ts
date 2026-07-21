import { Schema, model, models } from 'mongoose';

const chatSessionSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, trim: true, default: null },
    isPrimary: { type: Boolean, default: true, index: true },
    messageCount: { type: Number, default: 0, min: 0 },
    lastMessageAt: { type: Date, default: null, index: true },
  },
  { timestamps: true },
);

// One active conversation per person for now. Future conversations can be
// created by marking the previous session as non-primary.
chatSessionSchema.index(
  { user: 1, isPrimary: 1 },
  { unique: true, partialFilterExpression: { isPrimary: true } },
);
chatSessionSchema.index({ user: 1, lastMessageAt: -1 });

export const ChatSessionModel = models.ChatSession || model('ChatSession', chatSessionSchema);
export default ChatSessionModel;
