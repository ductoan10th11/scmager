import { isValidObjectId } from 'mongoose';
import IncomingDocumentModel from '../models/incoming-document.model';

const POPULATE_DOC = [
  { path: 'currentDepartment', select: '_id name code' },
  { path: 'currentAssignee', select: '_id username fullName email' },
  { path: 'currentAssignees', select: '_id username fullName email' },
  { path: 'receivedBy', select: '_id username fullName' },
  { path: 'assignedBy', select: '_id username fullName' },
  { path: 'attachments', select: '_id fileName contentType sizeBytes objectKey category metadata' },
  {
    path: 'relatedTasks',
    select: '_id title status assignedTo attachments estimatedMinutes dueAt completedAt',
    populate: [
      { path: 'assignedTo', select: '_id username fullName email' },
      { path: 'attachments', select: '_id fileName contentType sizeBytes objectKey category metadata' },
    ],
  },
];

export const incomingDocumentRepository = {
  findMany(filter: Record<string, unknown>, skip: number, limit: number, sort: string) {
    const sortObj = sort.startsWith('-')
      ? { [sort.slice(1)]: -1 as const }
      : { [sort]: 1 as const };
    return IncomingDocumentModel.find(filter)
      .sort(sortObj)
      .skip(skip)
      .limit(limit)
      .populate(POPULATE_DOC);
  },

  count(filter: Record<string, unknown>) {
    return IncomingDocumentModel.countDocuments(filter);
  },

  findById(id: string) {
    if (!isValidObjectId(id)) return Promise.resolve(null);
    return IncomingDocumentModel.findById(id).populate(POPULATE_DOC);
  },

  findRawById(id: string) {
    if (!isValidObjectId(id)) return Promise.resolve(null);
    return IncomingDocumentModel.findById(id);
  },

  create(data: Record<string, unknown>) {
    return IncomingDocumentModel.create(data);
  },

  save(doc: any) {
    return doc.save();
  },
};
