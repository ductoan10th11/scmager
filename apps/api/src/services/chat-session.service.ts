import { ChatContentModel, ChatSessionModel } from '../models';

export type ChatRole = 'USER' | 'ASSISTANT';

const HISTORY_VIEW_LIMIT = 200;
const HISTORY_MEMORY_LIMIT = 30;

const idOf = (value: any) => String(value?._id ?? value ?? '');

export const getOrCreatePrimaryChatSession = async (userId: string) => {
  try {
    return await ChatSessionModel.findOneAndUpdate(
      { user: userId, isPrimary: true },
      {
        $setOnInsert: { user: userId, isPrimary: true, title: null },
      },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
    );
  } catch (error: any) {
    // Concurrent first requests can race on the partial unique index.
    if (error?.code !== 11000) throw error;
    const session = await ChatSessionModel.findOne({ user: userId, isPrimary: true });
    if (!session) throw error;
    return session;
  }
};

export const appendChatContent = async (
  sessionId: string,
  role: ChatRole,
  content: string,
  metadata: Record<string, unknown> = {},
) => {
  const normalizedContent = String(content ?? '').normalize('NFC').trim().slice(0, 8000);
  if (!normalizedContent) return null;

  const session = await ChatSessionModel.findOneAndUpdate(
    { _id: sessionId },
    { $inc: { messageCount: 1 }, $set: { lastMessageAt: new Date() } },
    { returnDocument: 'after' },
  );
  if (!session) throw new Error('Chat session was not found.');

  return ChatContentModel.create({
    session: session._id,
    sequence: session.messageCount,
    role,
    content: normalizedContent,
    metadata,
  });
};

const serializeContent = (content: any) => ({
  _id: idOf(content),
  role: content.role === 'USER' ? 'user' : 'assistant',
  content: content.content,
  metadata: content.metadata ?? {},
  createdAt: content.createdAt,
});

export const getChatSessionHistory = async (userId: string, limit = HISTORY_VIEW_LIMIT) => {
  const session = await getOrCreatePrimaryChatSession(userId);
  const safeLimit = Math.min(Math.max(Number(limit) || HISTORY_VIEW_LIMIT, 1), HISTORY_VIEW_LIMIT);
  const contents = await ChatContentModel.find({ session: session._id })
    .sort({ sequence: -1 })
    .limit(safeLimit)
    .lean();

  return {
    session: {
      _id: idOf(session),
      title: session.title ?? null,
      messageCount: session.messageCount,
      lastMessageAt: session.lastMessageAt,
    },
    contents: contents.reverse().map(serializeContent),
  };
};

export const getChatMemory = async (sessionId: string) => {
  const contents = await ChatContentModel.find({ session: sessionId })
    .sort({ sequence: -1 })
    .limit(HISTORY_MEMORY_LIMIT)
    .select('role content')
    .lean();
  return contents.reverse().map((content: any) => ({
    role: content.role === 'USER' ? 'user' as const : 'assistant' as const,
    content: content.content,
  }));
};

export const getLatestTaskDraft = async (sessionId: string) => {
  const contents = await ChatContentModel.find({
    session: sessionId,
    role: 'ASSISTANT',
    'metadata.intent': 'TASK',
  })
    .sort({ sequence: -1 })
    .limit(HISTORY_MEMORY_LIMIT)
    .select('metadata')
    .lean();
  const active = contents.find((content: any) => (
    content.metadata?.proposal?.status === 'PENDING'
    || content.metadata?.draft?.complete === false
  ));
  return (active as any)?.metadata?.draft ?? {};
};

export const replacePendingTaskProposals = async (sessionId: string) => {
  await ChatContentModel.updateMany(
    {
      session: sessionId,
      'metadata.kind': 'TASK_PROPOSAL',
      'metadata.proposal.status': 'PENDING',
    },
    { $set: { 'metadata.proposal.status': 'REPLACED' } },
  );
};

export const updateTaskProposal = async (
  sessionId: string,
  token: string,
  status: 'CONFIRMED' | 'CANCELLED',
  extra: Record<string, unknown> = {},
) => {
  if (!token) return;
  await ChatContentModel.updateOne(
    {
      session: sessionId,
      'metadata.kind': 'TASK_PROPOSAL',
      'metadata.proposal.confirmationToken': token,
    },
    {
      $set: {
        'metadata.proposal.status': status,
        ...Object.fromEntries(Object.entries(extra).map(([key, value]) => [`metadata.proposal.${key}`, value])),
      },
    },
  );
};

export const cancelPendingTaskProposals = async (sessionId: string, token?: string) => {
  const filter: Record<string, unknown> = {
    session: sessionId,
    'metadata.kind': 'TASK_PROPOSAL',
    'metadata.proposal.status': 'PENDING',
  };
  if (token) filter['metadata.proposal.confirmationToken'] = token;
  await ChatContentModel.updateMany(filter, { $set: { 'metadata.proposal.status': 'CANCELLED' } });
};
