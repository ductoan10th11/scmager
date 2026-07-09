import { isValidObjectId } from 'mongoose';
import TimesheetModel from '../models/timesheet.model';

const POPULATE_TS = [
  { path: 'user', select: '_id username fullName email' },
  { path: 'department', select: '_id name code' },
  { path: 'reviewedBy', select: '_id username fullName' },
  { path: 'entries.task', select: '_id title type' },
];

export const timesheetRepository = {
  findMany(filter: Record<string, unknown>, skip: number, limit: number) {
    return TimesheetModel.find(filter).sort({ date: -1 }).skip(skip).limit(limit).populate(POPULATE_TS);
  },

  count(filter: Record<string, unknown>) {
    return TimesheetModel.countDocuments(filter);
  },

  findOne(filter: Record<string, unknown>) {
    return TimesheetModel.findOne(filter).populate(POPULATE_TS);
  },

  findRawOne(filter: Record<string, unknown>) {
    return TimesheetModel.findOne(filter);
  },

  findById(id: string) {
    if (!isValidObjectId(id)) return Promise.resolve(null);
    return TimesheetModel.findById(id).populate(POPULATE_TS);
  },

  findRawById(id: string) {
    if (!isValidObjectId(id)) return Promise.resolve(null);
    return TimesheetModel.findById(id);
  },

  create(data: Record<string, unknown>) {
    return TimesheetModel.create(data);
  },

  save(doc: any) {
    return doc.save();
  },
};
