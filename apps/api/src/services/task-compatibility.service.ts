import { isValidObjectId } from 'mongoose';
import { DepartmentModel, OfficeDocumentContextModel, UserModel } from '../models';
import type { AuthUser } from '../types/auth';
import { badRequest, forbidden } from '../utils/http-error';
import { idOf, officeDocumentProjection } from './office-document-projection.service';

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

export const listCompatibilityTasksService = async (actor: AuthUser, query: Record<string, unknown>) => {
  const { page, limit, skip } = parsePagination(query);
  const requestedDepartmentId = typeof query.departmentId === 'string' ? query.departmentId : null;
  if (requestedDepartmentId && !isValidObjectId(requestedDepartmentId)) throw badRequest('departmentId must be a valid ObjectId.');
  let userIds: string[] = [];
  let department: any = null;
  if (actor.role.code === 'SPECIALIST') userIds = [actor.id];
  else if (requestedDepartmentId) {
    canViewDepartment(actor, requestedDepartmentId);
    department = await DepartmentModel.findById(requestedDepartmentId).select('_id name code').lean();
    if (!department) throw badRequest('Department does not exist.');
    userIds = (await UserModel.find({ department: requestedDepartmentId, status: 'ACTIVE' }).select('_id').lean()).map((user: any) => idOf(user));
  } else if (actor.role.code === 'DEPARTMENT_LEADER' && actor.department) {
    department = await DepartmentModel.findById(actor.department).select('_id name code').lean();
    userIds = (await UserModel.find({ department: actor.department, status: 'ACTIVE' }).select('_id').lean()).map((user: any) => idOf(user));
  } else throw badRequest('departmentId is required for this role.');

  const filter: Record<string, unknown> = { pageType: 'incoming', 'management.assignment.userId': { $in: userIds } };
  if (actor.organization) filter.organizationId = actor.organization;
  const contexts = await OfficeDocumentContextModel.find(filter)
    .select('externalDocumentId observation statusSync management observedAt updatedAt')
    .sort({ updatedAt: -1 }).lean();
  const status = typeof query.status === 'string' ? query.status : '';
  const search = typeof query.search === 'string' ? query.search.trim().toLowerCase() : '';
  const rows = contexts.map(officeDocumentProjection).filter((document) => {
    if (!document.deadline) return false;
    if (status === 'IN_PROGRESS' && document.status !== 'IN_PROGRESS') return false;
    if (status === 'DONE' && !document.completed) return false;
    return !search || `${document.soKyHieu} ${document.trichYeu}`.toLowerCase().includes(search);
  });
  return {
    data: rows.slice(skip, skip + limit).map((document) => ({
      _id: document.id, title: document.trichYeu || document.soKyHieu || 'Văn bản đến', description: document.soKyHieu || '',
      type: 'INGEST_DOCUMENT', status: document.completed ? 'DONE' : document.status === 'IN_PROGRESS' ? 'IN_PROGRESS' : 'TODO',
      dueAt: document.deadline, createdAt: document.updatedAt,
      assignedTo: document.owner.id ? { _id: document.owner.id, username: '', fullName: document.owner.fullName, position: null } : null,
      assignedDepartment: department ? { _id: idOf(department), name: department.name, code: department.code } : null,
      sourceDocument: { _id: document.id, documentNumber: document.soKyHieu },
    })),
    pagination: { page, limit, total: rows.length, totalPages: Math.ceil(rows.length / limit) },
  };
};
