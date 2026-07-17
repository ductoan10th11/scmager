import AuditLogModel from '../models/audit-log.model';

const POPULATE_AUDIT = [
  { path: 'actor', select: '_id username fullName email' },
  { path: 'organization', select: '_id name code' },
  { path: 'department', select: '_id name code' },
];

export const auditLogRepository = {
  findMany(filter: Record<string, unknown>, skip: number, limit: number, sort = '-createdAt') {
    const sortObj = sort.startsWith('-')
      ? { [sort.slice(1)]: -1 as const }
      : { [sort]: 1 as const };
    return AuditLogModel.find(filter)
      .sort(sortObj)
      .skip(skip)
      .limit(limit)
      .populate(POPULATE_AUDIT);
  },

  count(filter: Record<string, unknown>) {
    return AuditLogModel.countDocuments(filter);
  },
};
