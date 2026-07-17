import { isValidObjectId } from 'mongoose';
import { documentRepository } from '../repositories/document.repository';
import type { AuthUser } from '../types/auth';
import { badRequest, forbidden, notFound } from '../utils/http-error';
import { documentWorkflowFiltersFor } from './document-workflow.service';
import { AuditLogModel } from '../models/audit-log.model';
import DocumentModel from '../models/document.model';

const ensureCanViewIngestDocuments = (actor: AuthUser) => {
  if (actor.status !== 'ACTIVE') {
    throw forbidden('Active authentication is required to view ingest documents.');
  }
};

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const parsePagination = (query: Record<string, unknown>) => {
  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(query.limit) || 25, 1), 100);
  return { page, limit, skip: (page - 1) * limit };
};

const buildFilter = (query: Record<string, unknown>) => {
  const filter: Record<string, unknown> = { deadline: { $ne: null } };

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
      { soDen: regex },
      { soKyHieu: regex },
      { trichYeu: regex },
      { donViBanHanh: regex },
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
  };
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
