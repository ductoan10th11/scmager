import NotificationModel from '../models/notification.model';

const POPULATE_NOTIFICATION = [
  { path: 'actor', select: '_id username fullName email' },
  { path: 'recipient', select: '_id username fullName email' },
];

export const notificationRepository = {
  findMany(filter: Record<string, unknown>, skip: number, limit: number, sort = '-createdAt') {
    const sortObj = sort.startsWith('-')
      ? { [sort.slice(1)]: -1 as const }
      : { [sort]: 1 as const };
    return NotificationModel.find(filter)
      .sort(sortObj)
      .skip(skip)
      .limit(limit)
      .populate(POPULATE_NOTIFICATION);
  },

  count(filter: Record<string, unknown>) {
    return NotificationModel.countDocuments(filter);
  },

  findById(id: string) {
    return NotificationModel.findById(id).populate(POPULATE_NOTIFICATION);
  },

  findOne(filter: Record<string, unknown>) {
    return NotificationModel.findOne(filter);
  },

  create(data: Record<string, unknown>) {
    return NotificationModel.create(data);
  },

  markRead(id: string, recipient: string) {
    return NotificationModel.findOneAndUpdate(
      { _id: id, recipient },
      { $set: { readAt: new Date() } },
      { new: true },
    ).populate(POPULATE_NOTIFICATION);
  },

  markAllRead(recipient: string) {
    return NotificationModel.updateMany(
      { recipient, readAt: null },
      { $set: { readAt: new Date() } },
    );
  },

  markRelatedRead(recipient: string, relatedId: string, types: string[] = []) {
    const filter: Record<string, unknown> = {
      recipient,
      relatedModel: 'WorkDeclaration',
      relatedId,
      readAt: null,
    };
    if (types.length) filter.type = { $in: types };
    return NotificationModel.updateMany(filter, { $set: { readAt: new Date() } });
  },

  findUnreadWorkDeclarationActions(recipient: string) {
    return NotificationModel.find({
      recipient,
      relatedModel: 'WorkDeclaration',
      type: { $in: ['WORK_DECLARATION_SUBMITTED', 'WORK_DECLARATION_FORWARDED'] },
      readAt: null,
    }).select('_id relatedId').limit(500).lean();
  },

  markManyRead(ids: string[]) {
    if (!ids.length) return Promise.resolve({ modifiedCount: 0 });
    return NotificationModel.updateMany(
      { _id: { $in: ids }, readAt: null },
      { $set: { readAt: new Date() } },
    );
  },

  unreadRelatedRecipients(relatedId: string, types: string[]) {
    return NotificationModel.distinct('recipient', {
      relatedModel: 'WorkDeclaration',
      relatedId,
      type: { $in: types },
      readAt: null,
    });
  },
};
