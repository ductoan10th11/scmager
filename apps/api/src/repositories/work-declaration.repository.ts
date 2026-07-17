import { isValidObjectId } from 'mongoose';
import WorkDeclarationModel from '../models/work-declaration.model';

const POPULATE_WORK_DECLARATION = [
  { path: 'organization', select: '_id name code' },
  { path: 'department', select: '_id name code' },
  { path: 'createdBy', select: '_id username fullName position email role department' },
  { path: 'sourceDocument', select: '_id documentId soDen soKyHieu trichYeu deadline point processing.status' },
  { path: 'approval.currentApprover', select: '_id username fullName position email role department' },
  { path: 'approval.history.actor', select: '_id username fullName position email' },
  { path: 'approval.history.fromApprover', select: '_id username fullName position email' },
  { path: 'approval.history.toApprover', select: '_id username fullName position email' },
];

export const workDeclarationRepository = {
  findMany(filter: Record<string, unknown>, skip: number, limit: number) {
    return WorkDeclarationModel.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate(POPULATE_WORK_DECLARATION);
  },

  count(filter: Record<string, unknown>) {
    return WorkDeclarationModel.countDocuments(filter);
  },

  findById(id: string) {
    if (!isValidObjectId(id)) return Promise.resolve(null);
    return WorkDeclarationModel.findById(id).populate(POPULATE_WORK_DECLARATION);
  },

  findRawById(id: string) {
    if (!isValidObjectId(id)) return Promise.resolve(null);
    return WorkDeclarationModel.findById(id);
  },

  create(data: Record<string, unknown>) {
    return WorkDeclarationModel.create(data);
  },

  save(declaration: any) {
    return declaration.save();
  },
};
