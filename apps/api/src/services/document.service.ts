import { isValidObjectId, Types } from 'mongoose';
import { documentRepository } from '../repositories/document.repository';
import type { AuthUser } from '../types/auth';
import { badRequest, conflict, forbidden, notFound } from '../utils/http-error';
import { documentWorkflowFiltersFor } from './document-workflow.service';
import { AuditLogModel } from '../models/audit-log.model';
import DocumentModel from '../models/document.model';
import OutgoingDocumentModel from '../models/outgoing-document.model';

const ensureCanViewIngestDocuments = (actor: AuthUser) => {
  if (actor.status !== 'ACTIVE') {
    throw forbidden('Active authentication is required to view ingest documents.');
  }
};

const tenantFilterFor = (actor: AuthUser): Record<string, unknown> => {
  // Only the platform administrator is intentionally cross-tenant. Every
  // tenant role, including office/commune leaders, is constrained at query time.
  if (actor.role.code === 'ADMIN' && !actor.organization) return {};
  return actor.organization ? { organizationId: actor.organization } : { _id: null };
};

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const currentMonth = () => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  return `${year}-${month}`;
};

const monthDateFilter = (query: Record<string, unknown>) => {
  const month = String(query.month ?? currentMonth()).trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw badRequest('month must use YYYY-MM format.');
  }
  const [year, number] = month.split('-');
  return { month, regex: new RegExp(`/${number}/${year}$`) };
};

const parsePagination = (query: Record<string, unknown>) => {
  const parse = (value: unknown, fallback: number, field: string) => {
    if (value === undefined || value === '') return fallback;
    if (typeof value !== 'string' && typeof value !== 'number') throw badRequest(`${field} must be a positive integer.`);
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 1) throw badRequest(`${field} must be a positive integer.`);
    return parsed;
  };
  const page = parse(query.page, 1, 'page');
  const limit = Math.min(parse(query.limit, 25, 'limit'), 100);
  return { page, limit, skip: (page - 1) * limit };
};

const assertListQuery = (query: Record<string, unknown>, allowed: readonly string[]) => {
  for (const [key, value] of Object.entries(query)) {
    if (!allowed.includes(key)) throw badRequest(`Unsupported query parameter: ${key}.`);
    if (Array.isArray(value)) throw badRequest(`${key} must be provided once.`);
  }
  if (query.scope !== undefined && !['mine', 'current'].includes(String(query.scope))) {
    throw badRequest('scope must be mine or current.');
  }
  if (query.sort !== undefined && !['oldest', 'newest'].includes(String(query.sort))) {
    throw badRequest('sort must be oldest or newest.');
  }
  if (query.completed !== undefined && !['true', 'false'].includes(String(query.completed))) {
    throw badRequest('completed must be true or false.');
  }
};

const castWorkflowFilter = (filter: Record<string, unknown>) => {
  const next = { ...filter };
  for (const key of ['processing.assignees.userId', 'processing.currentAssignee.userId']) {
    const value: any = next[key];
    if (value?.$in) next[key] = { $in: value.$in.map((id: any) => new Types.ObjectId(String(id))) };
    else if (value) next[key] = new Types.ObjectId(String(value));
  }
  return next;
};

const buildFilter = (query: Record<string, unknown>) => {
  const { regex } = monthDateFilter(query);
  const filter: Record<string, unknown> = { deadline: { $ne: null }, ngayDen: regex };

  if (query.completed === 'true') filter['ingest.completed'] = true;
  if (query.completed === 'false') filter['ingest.completed'] = { $ne: true };

  if (query.doKhan) filter.doKhan = String(query.doKhan);
  if (query.doMat) filter.doMat = String(query.doMat);

  const search = String(query.search ?? '').trim();
  if (search) {
    if (search.length > 120) throw badRequest('search must be 120 characters or fewer.');
    const regex = new RegExp(escapeRegex(search), 'i');
    filter.$or = [
      { documentId: regex },
      { soKyHieu: regex },
      { trichYeu: regex },
      { nguoiXuLy: regex },
    ];
  }

  return filter;
};

export const listIngestDocumentsService = async (
  actor: AuthUser,
  query: Record<string, unknown>,
) => {
  ensureCanViewIngestDocuments(actor);
  assertListQuery(query, ['page', 'limit', 'month', 'completed', 'doKhan', 'doMat', 'search', 'scope', 'sort']);
  const { page, limit, skip } = parsePagination(query);
  const { month } = monthDateFilter(query);
  const filter = buildFilter(query);
  Object.assign(filter, tenantFilterFor(actor));
  const personalScope = query.scope === 'mine' || query.scope === 'current';
  if (personalScope) {
    const workflowScope = await documentWorkflowFiltersFor(actor, { includeDepartment: false });
    Object.assign(filter, query.scope === 'current' ? workflowScope.current : workflowScope.participant);
  } else if (actor.role.code === 'SPECIALIST') {
    const workflowScope = await documentWorkflowFiltersFor(actor, { includeDepartment: false });
    Object.assign(filter, workflowScope.participant);
  } else if (actor.role.code === 'DEPARTMENT_LEADER') {
    const workflowScope = await documentWorkflowFiltersFor(actor);
    Object.assign(filter, workflowScope.participant);
  }
  const sort = query.sort === 'oldest'
    ? { updatedAt: 1 as const }
    : { updatedAt: -1 as const };

  const [items, total] = await Promise.all([
    documentRepository.list({ filter, skip, limit, sort }),
    documentRepository.count(filter),
  ]);

  return {
    data: items,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
    month,
  };
};

export const listOutgoingDocumentsService = async (
  actor: AuthUser,
  query: Record<string, unknown>,
) => {
  ensureCanViewIngestDocuments(actor);
  assertListQuery(query, ['page', 'limit', 'month', 'search', 'sort']);
  const { page, limit, skip } = parsePagination(query);
  const { month, regex: monthRegex } = monthDateFilter(query);
  const sourceFilter: Record<string, unknown> = { deadline: { $ne: null } };
  Object.assign(sourceFilter, tenantFilterFor(actor));

  if (actor.role.code === 'SPECIALIST') {
    Object.assign(sourceFilter, (await documentWorkflowFiltersFor(actor, { includeDepartment: false })).participant);
  } else if (actor.role.code === 'DEPARTMENT_LEADER') {
    Object.assign(sourceFilter, (await documentWorkflowFiltersFor(actor)).participant);
  }

  const search = String(query.search ?? '').trim();
  if (search.length > 120) throw badRequest('search must be 120 characters or fewer.');
  const sourceIds = (await DocumentModel.find(castWorkflowFilter(sourceFilter)).select('_id').lean())
    .map((document) => document._id);
  if (!sourceIds.length) {
    return { data: [], pagination: { page, limit, total: 0, totalPages: 0 }, month };
  }
  const searchMatch = search
    ? {
      $or: [
        { documentId: new RegExp(escapeRegex(search), 'i') },
        { soKyHieu: new RegExp(escapeRegex(search), 'i') },
        { trichYeu: new RegExp(escapeRegex(search), 'i') },
        { nguoiSoan: new RegExp(escapeRegex(search), 'i') },
        { nguoiKy: new RegExp(escapeRegex(search), 'i') },
      ],
    }
    : {};
  const direction = query.sort === 'oldest' ? 1 : -1;
  const filter = {
    ...tenantFilterFor(actor),
    sourceDocuments: { $in: sourceIds },
    $and: [
      { ngayBanHanh: monthRegex },
      ...(Object.keys(searchMatch).length ? [searchMatch] : []),
    ],
  };
  const [items, total] = await Promise.all([
    OutgoingDocumentModel.find(filter)
      .sort({ updatedAt: direction })
      .skip(skip)
      .limit(limit)
      .populate({ path: 'sourceDocuments', select: 'documentId soKyHieu trichYeu ngayDen' })
      .lean(),
    OutgoingDocumentModel.countDocuments(filter),
  ]);

  return {
    data: items,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    month,
  };
};

export const getOutgoingDocumentService = async (actor: AuthUser, id: string) => {
  ensureCanViewIngestDocuments(actor);
  const identity = isValidObjectId(id) ? { _id: id } : { documentId: id };
  const document = await OutgoingDocumentModel.findOne({
    ...identity,
    ...tenantFilterFor(actor),
  }).populate({ path: 'sourceDocuments', select: 'documentId soKyHieu trichYeu ngayDen' }).lean();
  if (!document) throw notFound('Outgoing ingest document not found.');

  if (!['ADMIN', 'OFFICE_CHIEF', 'COMMUNE_LEADER'].includes(actor.role.code)) {
    const scope = await documentWorkflowFiltersFor(actor);
    const canView = await DocumentModel.exists({
      _id: { $in: (document as any).sourceDocuments.map((item: any) => item._id ?? item) },
      ...scope.participant,
    });
    if (!canView) throw forbidden('Access denied.');
  }
  return { data: document };
};

export const getIngestDocumentService = async (actor: AuthUser, id: string) => {
  ensureCanViewIngestDocuments(actor);
  const identity = isValidObjectId(id) ? { _id: id } : { documentId: id };
  const document = await DocumentModel.findOne({
    ...identity,
    ...tenantFilterFor(actor),
  }).lean();

  if (!document) throw notFound('Ingest document not found.');
  if (!['ADMIN', 'OFFICE_CHIEF', 'COMMUNE_LEADER'].includes(actor.role.code)) {
    const scope = await documentWorkflowFiltersFor(actor);
    const canView = await DocumentModel.exists({ _id: (document as any)._id, ...scope.participant });
    if (!canView) throw forbidden('Access denied.');
  }
  return { data: document };
};

export const updateIngestDocumentProcessingService = async (
  actor: AuthUser,
  id: string,
  body: Record<string, unknown>,
) => {
  ensureCanViewIngestDocuments(actor);
  if (!isValidObjectId(id)) throw badRequest('id must be a valid ObjectId.');
  if (body.action !== 'complete') throw badRequest('action must be complete.');
  const expectedRevision = Number(body.revision);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw badRequest('revision must be a non-negative integer.');
  }

  const document = await documentRepository.findRawById(id);
  if (!document) throw notFound('Ingest document not found.');
  const tenantFilter = tenantFilterFor(actor);
  if (Object.keys(tenantFilter).length && String((document as any).organizationId) !== actor.organization)
    throw forbidden('Access denied.');
  if ((document as any).processing?.status === 'COMPLETED') {
    throw badRequest('Document is already completed by the source workflow.');
  }
  if (Number((document as any).revision ?? 0) !== expectedRevision) {
    throw conflict('Document has changed. Refresh before completing it.');
  }

  if (!['ADMIN', 'OFFICE_CHIEF', 'COMMUNE_LEADER'].includes(actor.role.code)) {
    const scope = await documentWorkflowFiltersFor(actor);
    const canProcess = await (document.constructor as any).exists({ _id: id, ...scope.participant });
    if (!canProcess) throw forbidden('You are not assigned to this document.');
  }

  const note = body.note === undefined || body.note === null ? null : String(body.note).trim();
  if (note && note.length > 500) throw badRequest('note must be 500 characters or fewer.');
  const now = new Date();
  const assignees = ((document as any).processing?.assignees ?? []).map((assignee: any) => {
    if (String(assignee.userId ?? '') !== actor.id) return assignee;
    assignee.status = 'PROCESSED';
    assignee.processedAt = now.toISOString();
    return assignee;
  });

  const updated = await DocumentModel.findOneAndUpdate(
    { _id: id, ...tenantFilter, revision: expectedRevision, 'processing.status': { $ne: 'COMPLETED' } },
    {
      $set: {
        'processing.status': 'MANUALLY_PROCESSED',
        'processing.currentAssignee': null,
        'processing.assignees': assignees,
        'processing.manual': {
          processedBy: actor.id,
          username: actor.username,
          fullName: actor.fullName,
          position: actor.position ?? null,
          note,
          processedAt: now,
        },
      },
      $inc: { revision: 1 },
    },
    { new: true },
  );
  if (!updated) throw conflict('Document has changed. Refresh before completing it.');
  await AuditLogModel.create({
    actor: actor.id,
    action: 'DOCUMENT_MANUALLY_PROCESSED',
    entityModel: 'Document',
    entityId: updated._id,
    organization: actor.organization,
    department: actor.department,
    metadata: { note, previousRevision: expectedRevision, revision: expectedRevision + 1 },
  });

  return getIngestDocumentService(actor, id);
};
