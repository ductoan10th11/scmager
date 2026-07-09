import { isValidObjectId } from 'mongoose';
import { timesheetRepository } from '../repositories/timesheet.repository';
import { AuditLogModel } from '../models';
import { AuthUser } from '../types/auth';
import { badRequest, conflict, forbidden, notFound } from '../utils/http-error';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const assertDate = (value: unknown): string => {
  if (!value || typeof value !== 'string' || !DATE_RE.test(value)) {
    throw badRequest('date must be a valid YYYY-MM-DD string.');
  }
  return value;
};

const assertObjectId = (value: unknown, field: string) => {
  if (!value || typeof value !== 'string' || !isValidObjectId(value)) {
    throw badRequest(`${field} must be a valid ObjectId.`);
  }
  return value;
};

const isSpecialist  = (a: AuthUser) => a.role.code === 'SPECIALIST';
const isDeptLeader  = (a: AuthUser) => a.role.code === 'DEPARTMENT_LEADER';

const CAPACITY = 480; // minutes (8h default)

// ─── GET /my ─────────────────────────────────────────────────────────────────

export const getMyTimesheetService = async (actor: AuthUser, query: Record<string, unknown>) => {
  if (!isSpecialist(actor)) throw forbidden('Only specialists can view their own timesheet.');
  const date = assertDate(query.date);

  const ts = await timesheetRepository.findOne({ user: actor.id, date });
  return { data: ts ?? null };
};

// ─── GET /department ─────────────────────────────────────────────────────────

export const getDepartmentTimesheetsService = async (actor: AuthUser, query: Record<string, unknown>) => {
  if (!isDeptLeader(actor)) throw forbidden('Only department leaders can view department timesheets.');
  if (!actor.department) throw forbidden('No department assigned.');

  const filter: Record<string, unknown> = { department: actor.department };
  if (query.date) filter.date = assertDate(query.date);
  if (query.status) filter.status = query.status;

  const page  = Math.max(Number(query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
  const skip  = (page - 1) * limit;

  const [items, total] = await Promise.all([
    timesheetRepository.findMany(filter, skip, limit),
    timesheetRepository.count(filter),
  ]);

  return { data: items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
};

// ─── POST / (upsert by date) ──────────────────────────────────────────────────

export const upsertTimesheetService = async (actor: AuthUser, body: Record<string, unknown>) => {
  if (!isSpecialist(actor)) throw forbidden('Only specialists can create timesheets.');
  if (!actor.organization) throw forbidden('No organization assigned.');

  const date = assertDate(body.date);

  // Upsert: nếu đã có thì trả về bản hiện tại
  const existing = await timesheetRepository.findOne({ user: actor.id, date });
  if (existing) return { data: existing, created: false };

  const ts = await timesheetRepository.create({
    user: actor.id,
    organization: actor.organization,
    department: actor.department ?? undefined,
    date,
    status: 'DRAFT',
    capacityMinutes: CAPACITY,
    totalEstimatedMinutes: 0,
    entries: [],
  });

  const created = await timesheetRepository.findById(String((ts as any)._id));
  return { data: created, created: true };
};

// ─── POST /:id/entries ────────────────────────────────────────────────────────

export const addEntryService = async (actor: AuthUser, id: unknown, body: Record<string, unknown>) => {
  if (!isSpecialist(actor)) throw forbidden('Only specialists can add entries.');

  const tsId = assertObjectId(id, 'id');
  const ts = await timesheetRepository.findRawById(tsId);
  if (!ts) throw notFound('Timesheet not found.');
  if (String((ts as any).user) !== actor.id) throw forbidden('This is not your timesheet.');
  if ((ts as any).status !== 'DRAFT') throw conflict('Cannot edit a submitted or approved timesheet.');

  const estimatedMinutes = Number(body.estimatedMinutes);
  if (!Number.isInteger(estimatedMinutes) || estimatedMinutes < 15) {
    throw badRequest('estimatedMinutes must be an integer >= 15.');
  }

  const newTotal = (ts as any).totalEstimatedMinutes + estimatedMinutes;
  if (newTotal > (ts as any).capacityMinutes) {
    throw badRequest(
      `Adding ${estimatedMinutes}m would exceed daily capacity of ${(ts as any).capacityMinutes}m. ` +
      `Currently used: ${(ts as any).totalEstimatedMinutes}m.`,
    );
  }

  const entry = {
    task: body.taskId && isValidObjectId(String(body.taskId)) ? body.taskId : undefined,
    title: String(body.title ?? '').trim() || 'Công việc',
    note: body.note ? String(body.note).trim() : undefined,
    estimatedMinutes,
    status: 'PLANNED',
  };

  (ts as any).entries.push(entry);
  (ts as any).totalEstimatedMinutes = newTotal;
  await timesheetRepository.save(ts);

  await AuditLogModel.create({
    actor: actor.id,
    action: 'TIMESHEET_ENTRY_ADDED',
    entityModel: 'Timesheet',
    entityId: (ts as any)._id,
    organization: (ts as any).organization,
    department: (ts as any).department,
    metadata: { estimatedMinutes, title: entry.title },
  });

  const updated = await timesheetRepository.findById(tsId);
  return { data: updated };
};

// ─── DELETE /:id/entries/:entryId ─────────────────────────────────────────────

export const deleteEntryService = async (actor: AuthUser, id: unknown, entryId: unknown) => {
  if (!isSpecialist(actor)) throw forbidden('Only specialists can delete entries.');

  const tsId = assertObjectId(id, 'id');
  const ts = await timesheetRepository.findRawById(tsId);
  if (!ts) throw notFound('Timesheet not found.');
  if (String((ts as any).user) !== actor.id) throw forbidden('This is not your timesheet.');
  if ((ts as any).status !== 'DRAFT') throw conflict('Cannot edit a submitted or approved timesheet.');

  const entryIdStr = String(entryId);
  const entryIndex = (ts as any).entries.findIndex((e: any) => String(e._id) === entryIdStr);
  if (entryIndex === -1) throw notFound('Entry not found.');

  const removedMinutes = (ts as any).entries[entryIndex].estimatedMinutes;
  (ts as any).entries.splice(entryIndex, 1);
  (ts as any).totalEstimatedMinutes = Math.max((ts as any).totalEstimatedMinutes - removedMinutes, 0);
  await timesheetRepository.save(ts);

  const updated = await timesheetRepository.findById(tsId);
  return { data: updated };
};

// ─── POST /:id/submit ─────────────────────────────────────────────────────────

export const submitTimesheetService = async (actor: AuthUser, id: unknown) => {
  if (!isSpecialist(actor)) throw forbidden('Only specialists can submit timesheets.');

  const tsId = assertObjectId(id, 'id');
  const ts = await timesheetRepository.findRawById(tsId);
  if (!ts) throw notFound('Timesheet not found.');
  if (String((ts as any).user) !== actor.id) throw forbidden('This is not your timesheet.');
  if ((ts as any).status !== 'DRAFT') throw conflict('Timesheet is already submitted or approved.');
  if ((ts as any).entries.length === 0) throw badRequest('Cannot submit an empty timesheet.');

  (ts as any).status = 'SUBMITTED';
  (ts as any).submittedAt = new Date();
  await timesheetRepository.save(ts);

  await AuditLogModel.create({
    actor: actor.id,
    action: 'TIMESHEET_SUBMITTED',
    entityModel: 'Timesheet',
    entityId: (ts as any)._id,
    organization: (ts as any).organization,
    department: (ts as any).department,
    metadata: { date: (ts as any).date, totalEstimatedMinutes: (ts as any).totalEstimatedMinutes },
  });

  return { data: await timesheetRepository.findById(tsId) };
};

// ─── POST /:id/review ─────────────────────────────────────────────────────────

export const reviewTimesheetService = async (actor: AuthUser, id: unknown, body: Record<string, unknown>) => {
  if (!isDeptLeader(actor)) throw forbidden('Only department leaders can review timesheets.');

  const tsId = assertObjectId(id, 'id');
  const ts = await timesheetRepository.findRawById(tsId);
  if (!ts) throw notFound('Timesheet not found.');

  // Chỉ duyệt timesheet của phòng mình
  if (actor.department && String((ts as any).department) !== actor.department) {
    throw forbidden('This timesheet is not from your department.');
  }
  if ((ts as any).status !== 'SUBMITTED') {
    throw conflict('Can only review SUBMITTED timesheets.');
  }

  const result = String(body.result ?? '');
  if (!['APPROVED', 'RETURNED'].includes(result)) {
    throw badRequest('result must be APPROVED or RETURNED.');
  }

  (ts as any).status = result === 'APPROVED' ? 'APPROVED' : 'RETURNED';
  (ts as any).reviewedBy = actor.id;
  (ts as any).reviewedAt = new Date();
  (ts as any).reviewNote = body.note ? String(body.note).trim() : undefined;
  await timesheetRepository.save(ts);

  await AuditLogModel.create({
    actor: actor.id,
    action: 'TIMESHEET_REVIEWED',
    entityModel: 'Timesheet',
    entityId: (ts as any)._id,
    organization: (ts as any).organization,
    department: (ts as any).department,
    metadata: { result },
  });

  return { data: await timesheetRepository.findById(tsId) };
};
