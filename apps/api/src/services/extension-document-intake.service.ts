import { AuditLogModel } from '../models/audit-log.model';
import { documentRepository, type ExtensionIncomingDocumentItem } from '../repositories/document.repository';
import { outgoingDocumentRepository } from '../repositories/outgoing-document.repository';
import type { AuthUser } from '../types/auth';
import { badRequest, forbidden } from '../utils/http-error';

const DATE_ONLY = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const INTAKE_ROLES = new Set(['ADMIN', 'OFFICE_CHIEF', 'COMMUNE_LEADER', 'DEPARTMENT_LEADER']);

type IncomingPayload = Record<string, unknown>;

const text = (value: unknown, field: string, maxLength: number, required = false) => {
  if (value === undefined || value === null) {
    if (required) throw badRequest(`${field} is required.`);
    return '';
  }
  if (typeof value !== 'string') throw badRequest(`${field} must be a string.`);
  const normalized = value.trim();
  if (required && !normalized) throw badRequest(`${field} is required.`);
  if (normalized.length > maxLength) throw badRequest(`${field} must be ${maxLength} characters or fewer.`);
  return normalized;
};

const parseDateOnly = (value: string, field: string) => {
  const match = value.match(DATE_ONLY);
  if (!match) throw badRequest(`${field} must use DD/MM/YYYY.`);
  const [, day, month, year] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) {
    throw badRequest(`${field} is not a valid calendar date.`);
  }
  return date;
};

const parseDeadline = (value: unknown) => {
  if (typeof value !== 'string' || !value.trim()) throw badRequest('deadline is required.');
  const normalized = value.trim();
  if (DATE_ONLY.test(normalized)) return parseDateOnly(normalized, 'deadline');
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) throw badRequest('deadline must be an ISO date-time or DD/MM/YYYY.');
  return date;
};

const number = (value: unknown, field: string, fallback = 0) => {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw badRequest(`${field} must be an integer.`);
  return parsed;
};

const normalizeIncomingDocument = (payload: IncomingPayload): ExtensionIncomingDocumentItem => {
  if (!payload || Array.isArray(payload)) throw badRequest('Each document must be an object.');
  const ngayDen = text(payload.ngayDen, 'ngayDen', 10, true);
  parseDateOnly(ngayDen, 'ngayDen');

  return {
    processKey: text(payload.processKey, 'processKey', 240),
    soDen: text(payload.soDen, 'soDen', 120),
    soKyHieu: text(payload.soKyHieu, 'soKyHieu', 240, true),
    trichYeu: text(payload.trichYeu, 'trichYeu', 4000, true),
    donViBanHanh: text(payload.donViBanHanh, 'donViBanHanh', 500),
    hinhThuc: text(payload.hinhThuc, 'hinhThuc', 200),
    ngayVanBan: text(payload.ngayVanBan, 'ngayVanBan', 10),
    ngayDen,
    doKhan: text(payload.doKhan, 'doKhan', 100),
    doMat: text(payload.doMat, 'doMat', 100),
    nguoiXuLy: text(payload.nguoiXuLy, 'nguoiXuLy', 500),
    trangThai: number(payload.trangThai, 'trangThai'),
    deadline: parseDeadline(payload.deadline),
  };
};

const normalizeTrackLogs = (value: unknown) => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 100) throw badRequest('trackLogs must be an array containing at most 100 items.');
  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw badRequest(`trackLogs[${index}] must be an object.`);
    const log = entry as IncomingPayload;
    const sender = log.sender && typeof log.sender === 'object' && !Array.isArray(log.sender)
      ? log.sender as IncomingPayload
      : {};
    return {
      sender: {
        username: text(sender.username, `trackLogs[${index}].sender.username`, 120),
        fullName: text(sender.fullName, `trackLogs[${index}].sender.fullName`, 300),
      },
      content: text(log.content, `trackLogs[${index}].content`, 4000),
      receivedAt: text(log.receivedAt, `trackLogs[${index}].receivedAt`, 32) || null,
      processingAt: text(log.processingAt, `trackLogs[${index}].processingAt`, 32) || null,
      completedAt: text(log.completedAt, `trackLogs[${index}].completedAt`, 32) || null,
      updatedAt: text(log.updatedAt, `trackLogs[${index}].updatedAt`, 32) || null,
    };
  });
};

const normalizeOutgoingDocument = (payload: IncomingPayload) => {
  if (!payload || Array.isArray(payload)) throw badRequest('Request body must be an object.');
  const ngayBanHanh = text(payload.ngayBanHanh, 'ngayBanHanh', 10, true);
  parseDateOnly(ngayBanHanh, 'ngayBanHanh');
  return {
    soKyHieu: text(payload.soKyHieu, 'soKyHieu', 240, true),
    trichYeu: text(payload.trichYeu, 'trichYeu', 4000, true),
    ngayBanHanh,
    doKhan: text(payload.doKhan, 'doKhan', 100),
    nguoiSoan: text(payload.nguoiSoan, 'nguoiSoan', 300),
    nguoiKy: text(payload.nguoiKy, 'nguoiKy', 300),
    trackLogs: normalizeTrackLogs(payload.trackLogs),
  };
};

const payloadDocument = (body: unknown): IncomingPayload => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw badRequest('Request body must be an object.');
  if ('documents' in (body as IncomingPayload)) {
    throw badRequest('Submit exactly one document per request; documents is not supported.');
  }
  return body as IncomingPayload;
};

const ensureCanReceive = (actor: AuthUser) => {
  if (!INTAKE_ROLES.has(actor.role.code)) {
    throw forbidden('Your role cannot submit incoming documents from the extension.');
  }
};

export const receiveExtensionIncomingDocumentsService = async (actor: AuthUser, body: unknown) => {
  ensureCanReceive(actor);
  const now = new Date();
  const item = normalizeIncomingDocument(payloadDocument(body));
  const result = await documentRepository.upsertExtensionListItem(item, now);
  const data = {
    id: String((result.doc as any)._id),
    documentId: String((result.doc as any).documentId),
    soKyHieu: item.soKyHieu,
    created: result.inserted,
    source: 'EXTENSION' as const,
    receivedAt: now.toISOString(),
  };

  await AuditLogModel.create({
    actor: actor.id,
    action: 'EXTENSION_INCOMING_DOCUMENT_RECEIVED',
    entityModel: 'Document',
    entityId: data.id,
    organization: actor.organization,
    department: actor.department,
    metadata: {
      source: 'EXTENSION',
      documentId: data.documentId,
      soKyHieu: data.soKyHieu,
      created: data.created,
    },
  });

  return {
    data,
  };
};

export const lookupExtensionIncomingDocumentPointService = async (query: Record<string, unknown>) => {
  const soKyHieu = text(query.soKyHieu, 'soKyHieu', 240, true);
  const document = await documentRepository.findLatestBySoKyHieu(soKyHieu);
  if (!document) {
    return { data: { exists: false, soKyHieu, point: null } };
  }

  return {
    data: {
      exists: true,
      soKyHieu: String((document as any).soKyHieu),
      point: Number((document as any).point ?? 0),
    },
  };
};

export const receiveExtensionOutgoingDocumentService = async (actor: AuthUser, body: unknown) => {
  ensureCanReceive(actor);
  const now = new Date();
  const item = normalizeOutgoingDocument(payloadDocument(body));
  const result = await outgoingDocumentRepository.upsertExtensionItem(item, now);
  const data = {
    id: String((result.doc as any)._id),
    documentId: String((result.doc as any).documentId),
    soKyHieu: item.soKyHieu,
    created: result.inserted,
    source: 'EXTENSION' as const,
    receivedAt: now.toISOString(),
  };

  await AuditLogModel.create({
    actor: actor.id,
    action: 'EXTENSION_OUTGOING_DOCUMENT_RECEIVED',
    entityModel: 'OutgoingDocument',
    entityId: data.id,
    organization: actor.organization,
    department: actor.department,
    metadata: {
      source: 'EXTENSION',
      documentId: data.documentId,
      soKyHieu: data.soKyHieu,
      created: data.created,
    },
  });

  return { data };
};
