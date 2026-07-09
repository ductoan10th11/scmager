import { isValidObjectId } from 'mongoose';
import TaskModel from '../models/task.model';

const POPULATE_TASK = [
  { path: 'assignedBy', select: '_id username fullName' },
  { path: 'assignedTo', select: '_id username fullName email' },
  { path: 'assignedDepartment', select: '_id name code' },
  { path: 'department', select: '_id name code' },
  {
    path: 'sourceDocument',
    select: '_id documentNumber title summary sender category priority status dueAt issuedAt attachments',
    populate: { path: 'attachments', select: '_id fileName contentType sizeBytes category metadata objectKey' },
  },
  { path: 'attachments', select: '_id fileName contentType sizeBytes category metadata objectKey' },
];

export const taskRepository = {
  findMany(filter: Record<string, unknown>, skip: number, limit: number, sort: string) {
    const sortObj = sort.startsWith('-')
      ? { [sort.slice(1)]: -1 as const }
      : { [sort]: 1 as const };
    return TaskModel.find(filter).sort(sortObj).skip(skip).limit(limit).populate(POPULATE_TASK);
  },

  count(filter: Record<string, unknown>) {
    return TaskModel.countDocuments(filter);
  },

  findById(id: string) {
    if (!isValidObjectId(id)) return Promise.resolve(null);
    return TaskModel.findById(id).populate(POPULATE_TASK);
  },

  findRawById(id: string) {
    if (!isValidObjectId(id)) return Promise.resolve(null);
    return TaskModel.findById(id);
  },

  create(data: Record<string, unknown>) {
    return TaskModel.create(data);
  },

  save(doc: any) {
    return doc.save();
  },
};
