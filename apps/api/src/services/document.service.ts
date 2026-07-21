import { isValidObjectId, Types } from 'mongoose';
import { documentRepository } from '../repositories/document.repository';
import type { AuthUser } from '../types/auth';
import { badRequest, forbidden, notFound } from '../utils/http-error';
import { documentWorkflowFiltersFor } from './document-workflow.service';
import { AuditLogModel } from '../models/audit-log.model';
import DocumentModel from '../models/document.model';
import OutgoingDocumentModel from '../models/outgoing-document.model';

const ensureCanViewIngestDocuments = (actor: AuthUser) => {
  if (actor.status !== 'ACTIVE') {
    throw forbidden('Active authentication is required to view ingest documents.');
  }
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
  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(query.limit) || 25, 1), 100);
  return { page, limit, skip: (page - 1) * limit };
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
  const { page, limit, skip } = parsePagination(query);
  const { month } = monthDateFilter(query);
  const filter = buildFilter(query);
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
  const { page, limit, skip } = parsePagination(query);
  const { month, regex: monthRegex } = monthDateFilter(query);
  const sourceFilter: Record<string, unknown> = { deadline: { $ne: null } };

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
  const document = isValidObjectId(id)
    ? await OutgoingDocumentModel.findById(id).populate({ path: 'sourceDocuments', select: 'documentId soKyHieu trichYeu ngayDen' }).lean()
    : await OutgoingDocumentModel.findOne({ documentId: id }).populate({ path: 'sourceDocuments', select: 'documentId soKyHieu trichYeu ngayDen' }).lean();
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
  const document = isValidObjectId(id)
    ? await documentRepository.findById(id)
    : await documentRepository.findByDocumentId(id);

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

  const document = await documentRepository.findRawById(id);
  if (!document) throw notFound('Ingest document not found.');
  if ((document as any).processing?.status === 'COMPLETED') {
    throw badRequest('Document is already completed by the source workflow.');
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

  (document as any).set('processing.status', 'MANUALLY_PROCESSED');
  (document as any).set('processing.currentAssignee', null);
  (document as any).set('processing.assignees', assignees);
  (document as any).set('processing.manual', {
    processedBy: actor.id,
    username: actor.username,
    fullName: actor.fullName,
    position: actor.position ?? null,
    note,
    processedAt: now,
  });
  await documentRepository.save(document);
  await AuditLogModel.create({
    actor: actor.id,
    action: 'DOCUMENT_MANUALLY_PROCESSED',
    entityModel: 'Document',
    entityId: (document as any)._id,
    organization: actor.organization,
    department: actor.department,
    metadata: { note },
  });

  return getIngestDocumentService(actor, id);
};
