import { isValidObjectId } from 'mongoose';
import { DocumentModel, UserModel, WorkDeclarationModel } from '../models';
import { AuthUser } from '../types/auth';
import { badRequest, forbidden } from '../utils/http-error';
import { documentWorkflowFiltersFor } from './document-workflow.service';

const isAdmin = (actor: AuthUser) => actor.role.code === 'ADMIN';
const isDepartmentLeader = (actor: AuthUser) => actor.role.code === 'DEPARTMENT_LEADER';

const ensureCanViewReports = (actor: AuthUser) => {
  if (actor.role.level > 3) throw forbidden('Only leaders can view reports.');
};

const parsePagination = (query: Record<string, unknown>) => {
  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 500);
  return { page, limit, skip: (page - 1) * limit };
};

const parseDate = (value: unknown, field: string) => {
  if (!value) return undefined;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) throw badRequest(`${field} must be a valid date.`);
  if (field.endsWith('To') && /^\d{4}-\d{2}-\d{2}$/.test(String(value))) date.setHours(23, 59, 59, 999);
  return date;
};

const applyRange = (filter: Record<string, unknown>, field: string, from?: Date, to?: Date) => {
  if (from && to && from > to) throw badRequest(`${field} range is invalid.`);
  const range: Record<string, Date> = {};
  if (from) range.$gte = from;
  if (to) range.$lte = to;
  if (Object.keys(range).length) filter[field] = range;
};

const objectId = (value: unknown, field: string) => {
  if (!value) return undefined;
  if (typeof value !== 'string' || !isValidObjectId(value)) throw badRequest(`${field} must be a valid ObjectId.`);
  return value;
};

const departmentUserIds = async (departmentId: string, actor: AuthUser) => {
  if (isDepartmentLeader(actor) && actor.department !== departmentId) throw forbidden('Access denied.');
  const filter: Record<string, unknown> = { department: departmentId, status: 'ACTIVE' };
  if (!isAdmin(actor)) filter.organization = actor.organization;
  return UserModel.find(filter).distinct('_id');
};

const documentFilter = async (actor: AuthUser, query: Record<string, unknown>) => {
  const filter: Record<string, unknown> = { deadline: { $ne: null } };
  if (isDepartmentLeader(actor)) Object.assign(filter, (await documentWorkflowFiltersFor(actor)).participant);

  const departmentId = objectId(query.departmentId, 'departmentId');
  const assigneeId = objectId(query.assigneeId, 'assigneeId');
  if (departmentId) filter['processing.assignees.userId'] = { $in: await departmentUserIds(departmentId, actor) };
  if (assigneeId) filter['processing.assignees.userId'] = assigneeId;
  if (query.status) filter['processing.status'] = String(query.status);
  if (query.priority) filter.doKhan = String(query.priority);
  if (query.search) {
    const escaped = String(query.search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [{ soDen: new RegExp(escaped, 'i') }, { soKyHieu: new RegExp(escaped, 'i') }, { trichYeu: new RegExp(escaped, 'i') }];
  }
  applyRange(filter, 'createdAt', parseDate(query.dateFrom, 'dateFrom'), parseDate(query.dateTo, 'dateTo'));
  applyRange(filter, 'deadline', parseDate(query.dueFrom, 'dueFrom'), parseDate(query.dueTo, 'dueTo'));
  applyRange(filter, 'processing.manual.processedAt', parseDate(query.completedFrom, 'completedFrom'), parseDate(query.completedTo, 'completedTo'));
  return filter;
};

const declarationFilter = (actor: AuthUser, query: Record<string, unknown>) => {
  const filter: Record<string, unknown> = {};
  if (!isAdmin(actor)) {
    if (!actor.organization) throw forbidden('User has no organization assigned.');
    filter.organization = actor.organization;
  }
  const departmentId = objectId(query.departmentId, 'departmentId');
  const creatorId = objectId(query.assigneeId, 'assigneeId');
  if (isDepartmentLeader(actor)) {
    if (!actor.department) throw forbidden('Department leader has no department assigned.');
    if (departmentId && departmentId !== actor.department) throw forbidden('Access denied.');
    filter.department = actor.department;
  } else if (departmentId) filter.department = departmentId;
  if (creatorId) filter.createdBy = creatorId;
  if (query.status) filter.status = String(query.status);
  applyRange(filter, 'createdAt', parseDate(query.dateFrom, 'dateFrom'), parseDate(query.dateTo, 'dateTo'));
  applyRange(filter, 'workEndAt', parseDate(query.dueFrom, 'dueFrom'), parseDate(query.dueTo, 'dueTo'));
  applyRange(filter, 'approval.approvedAt', parseDate(query.completedFrom, 'completedFrom'), parseDate(query.completedTo, 'completedTo'));
  return filter;
};

const csvCell = (value: unknown) => {
  const raw = value === undefined || value === null ? '' : String(value);
  const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
};
const toCsv = (headers: string[], rows: unknown[][]) => [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');

export const documentsReportService = async (actor: AuthUser, query: Record<string, unknown>) => {
  ensureCanViewReports(actor);
  const { page, limit, skip } = parsePagination(query);
  const filter = await documentFilter(actor, query);
  const [data, total] = await Promise.all([
    DocumentModel.find(filter).sort({ deadline: 1, updatedAt: -1 }).skip(skip).limit(limit).lean(),
    DocumentModel.countDocuments(filter),
  ]);
  return { data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
};

export const tasksReportService = async (actor: AuthUser, query: Record<string, unknown>) => {
  ensureCanViewReports(actor);
  const { page, limit, skip } = parsePagination(query);
  const filter = declarationFilter(actor, query);
  const [data, total] = await Promise.all([
    WorkDeclarationModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit)
      .populate('createdBy', '_id username fullName position').populate('department', '_id name code')
      .populate('sourceDocument', '_id soDen soKyHieu trichYeu').lean(),
    WorkDeclarationModel.countDocuments(filter),
  ]);
  return { data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
};

export const departmentProgressReportService = async (actor: AuthUser, departmentId: unknown) => {
  ensureCanViewReports(actor);
  const id = objectId(departmentId, 'departmentId') as string;
  const [docFilter, workFilter] = await Promise.all([
    documentFilter(actor, { departmentId: id }),
    Promise.resolve(declarationFilter(actor, { departmentId: id })),
  ]);
  const now = new Date();
  const [documents, tasks, doneTasks, overdueTasks] = await Promise.all([
    DocumentModel.countDocuments(docFilter),
    WorkDeclarationModel.countDocuments({ ...workFilter, status: { $ne: 'CANCELLED' } }),
    WorkDeclarationModel.countDocuments({ ...workFilter, status: 'APPROVED' }),
    WorkDeclarationModel.countDocuments({ ...workFilter, workEndAt: { $lt: now }, status: { $nin: ['APPROVED', 'CANCELLED'] } }),
  ]);
  return { data: { departmentId: id, documents, tasks, doneTasks, overdueTasks } };
};

export const documentsCsvService = async (actor: AuthUser, query: Record<string, unknown>) => {
  ensureCanViewReports(actor);
  const items = await DocumentModel.find(await documentFilter(actor, query)).sort({ deadline: 1 }).lean();
  const rows = items.map((doc: any) => [doc.soDen, doc.soKyHieu, doc.trichYeu, doc.donViBanHanh, doc.processing?.status, doc.doKhan, doc.deadline?.toISOString?.(), doc.point]);
  return `\uFEFF${toCsv(['Số đến', 'Số ký hiệu', 'Trích yếu', 'Đơn vị ban hành', 'Trạng thái', 'Độ khẩn', 'Hạn xử lý', 'Điểm'], rows)}`;
};

export const tasksCsvService = async (actor: AuthUser, query: Record<string, unknown>) => {
  ensureCanViewReports(actor);
  const items = await WorkDeclarationModel.find(declarationFilter(actor, query)).sort({ createdAt: -1 })
    .populate('createdBy', 'fullName').populate('department', 'name').populate('sourceDocument', 'soDen soKyHieu').lean();
  const rows = items.map((item: any) => [item.title, item.status, item.declaredPoint, item.createdBy?.fullName, item.department?.name, item.sourceDocument?.soKyHieu || item.sourceDocument?.soDen, item.workStartAt?.toISOString?.(), item.workEndAt?.toISOString?.()]);
  return `\uFEFF${toCsv(['Công việc', 'Trạng thái', 'Điểm', 'Người khai báo', 'Phòng ban', 'Văn bản nguồn', 'Bắt đầu', 'Kết thúc'], rows)}`;
};
