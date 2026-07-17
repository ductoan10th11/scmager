import { isValidObjectId } from 'mongoose';
import { DepartmentModel, DocumentModel, UserModel } from '../models';
import type { AuthUser } from '../types/auth';
import { badRequest, forbidden } from '../utils/http-error';

const idOf = (value: any) => String(value?._id ?? value ?? '');

const parsePagination = (query: Record<string, unknown>) => {
  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
  return { page, limit, skip: (page - 1) * limit };
};

const canViewDepartment = (actor: AuthUser, departmentId: string) => {
  if (['ADMIN', 'OFFICE_CHIEF', 'COMMUNE_LEADER'].includes(actor.role.code)) return;
  if (actor.role.code === 'DEPARTMENT_LEADER' && actor.department === departmentId) return;
  throw forbidden('Access denied to this department task list.');
};

const documentTaskStatus = (document: any) => {
  if (document.ingest?.completed || ['COMPLETED', 'MANUALLY_PROCESSED'].includes(document.processing?.status)) return 'DONE';
  if (document.processing?.status === 'IN_PROGRESS') return 'IN_PROGRESS';
  return 'TODO';
};

export const listCompatibilityTasksService = async (actor: AuthUser, query: Record<string, unknown>) => {
  const { page, limit, skip } = parsePagination(query);
  const requestedDepartmentId = typeof query.departmentId === 'string' ? query.departmentId : null;
  if (requestedDepartmentId && !isValidObjectId(requestedDepartmentId)) {
    throw badRequest('departmentId must be a valid ObjectId.');
  }

  let userIds: string[] = [];
  let department: any = null;
  if (actor.role.code === 'SPECIALIST') {
    userIds = [actor.id];
  } else if (requestedDepartmentId) {
    canViewDepartment(actor, requestedDepartmentId);
    department = await DepartmentModel.findById(requestedDepartmentId).select('_id name code').lean();
    if (!department) throw badRequest('Department does not exist.');
    const users = await UserModel.find({ department: requestedDepartmentId, status: 'ACTIVE' }).select('_id').lean();
    userIds = users.map((user: any) => idOf(user));
  } else if (actor.role.code === 'DEPARTMENT_LEADER' && actor.department) {
    department = await DepartmentModel.findById(actor.department).select('_id name code').lean();
    const users = await UserModel.find({ department: actor.department, status: 'ACTIVE' }).select('_id').lean();
    userIds = users.map((user: any) => idOf(user));
  } else {
    throw badRequest('departmentId is required for this role.');
  }

  const filter: Record<string, unknown> = {
    deadline: { $ne: null },
    'processing.assignees.userId': { $in: userIds },
  };
  const status = typeof query.status === 'string' ? query.status : '';
  if (status === 'IN_PROGRESS') filter['processing.status'] = 'IN_PROGRESS';
  if (status === 'DONE') filter['processing.status'] = { $in: ['COMPLETED', 'MANUALLY_PROCESSED'] };
  if (query.search) filter.$or = [
    { soDen: new RegExp(String(query.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
    { soKyHieu: new RegExp(String(query.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
    { trichYeu: new RegExp(String(query.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
  ];

  const [documents, total] = await Promise.all([
    DocumentModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    DocumentModel.countDocuments(filter),
  ]);

  return {
    data: documents.map((document: any) => {
      const assignee = document.processing?.currentAssignee
        || document.processing?.assignees?.find((item: any) => userIds.includes(idOf(item.userId)))
        || null;
      return {
        _id: idOf(document),
        title: document.trichYeu || document.soKyHieu || `Văn bản số đến ${document.soDen}`,
        description: document.soKyHieu || '',
        type: 'INGEST_DOCUMENT',
        status: documentTaskStatus(document),
        dueAt: document.deadline,
        createdAt: document.createdAt,
        assignedTo: assignee ? {
          _id: idOf(assignee.userId),
          username: assignee.username,
          fullName: assignee.fullName,
          position: assignee.position ?? null,
        } : null,
        assignedDepartment: department ? { _id: idOf(department), name: department.name, code: department.code } : null,
        sourceDocument: { _id: idOf(document), documentNumber: document.soDen },
      };
    }),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
};
