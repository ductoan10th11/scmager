import { isValidObjectId } from 'mongoose';
import { notificationRepository } from '../repositories/notification.repository';
import { DepartmentModel, RoleModel, UserModel, WorkDeclarationModel } from '../models';
import { AuthUser } from '../types/auth';
import { badRequest, forbidden, notFound } from '../utils/http-error';
import { emitUserNotification, emitUserNotificationChanged } from '../realtime/ingest.socket';

const parsePagination = (query: Record<string, unknown>) => {
  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
  return { page, limit, skip: (page - 1) * limit };
};

const assertObjectId = (value: unknown, field: string) => {
  if (!value || typeof value !== 'string' || !isValidObjectId(value)) {
    throw badRequest(`${field} must be a valid ObjectId.`);
  }
  return value;
};

const startOfToday = () => {
  const value = new Date();
  value.setHours(0, 0, 0, 0);
  return value;
};

const reconcileWorkDeclarationNotifications = async (recipient: string) => {
  const pending = await notificationRepository.findUnreadWorkDeclarationActions(recipient);
  if (!pending.length) return;
  const declarationIds = [...new Set(pending.map((item: any) => String(item.relatedId)))];
  const declarations = await WorkDeclarationModel.find({ _id: { $in: declarationIds } })
    .select('_id status approval.currentApprover')
    .lean();
  const currentById = new Map(declarations.map((item: any) => [String(item._id), item]));
  const staleIds = pending.filter((notification: any) => {
    const declaration: any = currentById.get(String(notification.relatedId));
    return !declaration
      || declaration.status !== 'PENDING_APPROVAL'
      || String(declaration.approval?.currentApprover ?? '') !== recipient;
  }).map((item: any) => String(item._id));
  if (!staleIds.length) return;
  await notificationRepository.markManyRead(staleIds);
  emitUserNotificationChanged(recipient);
};

export const createNotification = async ({
  recipient,
  actor = null,
  type,
  title,
  message,
  body,
  entityModel,
  entityId,
  relatedModel,
  relatedId,
  metadata = {},
}: {
  recipient: string;
  actor?: string | null;
  type: string;
  title: string;
  message?: string;
  body?: string;
  entityModel?: string;
  entityId?: string;
  relatedModel?: string;
  relatedId?: string;
  metadata?: Record<string, unknown>;
}) => {
  if (!recipient || !type || !title) return null;
  const model = relatedModel ?? entityModel;
  const id = relatedId ?? entityId;
  if (!model || !id || !isValidObjectId(String(id)) || !isValidObjectId(String(recipient))) return null;

  const dedupeKey = metadata?.dedupeKey;
  if (dedupeKey) {
    const existing = await notificationRepository.findOne({
      recipient,
      type,
      'metadata.dedupeKey': dedupeKey,
      createdAt: { $gte: startOfToday() },
    });
    if (existing) return existing;
  }

  const notification = await notificationRepository.create({
    recipient,
    actor,
    type,
    title,
    body: message ?? body,
    relatedModel: model,
    relatedId: id,
    metadata,
    deliveredAt: new Date(),
  });
  emitUserNotification(String(recipient), {
    id: String((notification as any)._id),
    type,
    title,
  });
  return notification;
};

export const notifyUser = async (
  recipient: string | null | undefined,
  payload: Omit<Parameters<typeof createNotification>[0], 'recipient'>,
) => {
  if (!recipient) return null;
  return createNotification({ ...payload, recipient: String(recipient) });
};

export const notifyDepartmentLeaders = async (
  departmentId: string | null | undefined,
  payload: Omit<Parameters<typeof createNotification>[0], 'recipient'>,
) => {
  if (!departmentId || !isValidObjectId(String(departmentId))) return [];
  const department = await DepartmentModel.findById(departmentId).select('leader');
  const recipients = new Set<string>();
  if (department?.leader) recipients.add(String(department.leader));

  const role = await RoleModel.findOne({ code: 'DEPARTMENT_LEADER' }).select('_id');
  if (role) {
    const users = await UserModel.find({
      role: (role as any)._id,
      department: departmentId,
      status: 'ACTIVE',
    }).select('_id');
    users.forEach((user: any) => recipients.add(String(user._id)));
  }

  return Promise.all([...recipients].map((recipient) => createNotification({
    ...payload,
    recipient,
  })));
};

export const notifyRoleUsers = async (
  roleCode: string,
  organizationId: string | null | undefined,
  payload: Omit<Parameters<typeof createNotification>[0], 'recipient'>,
) => {
  const role = await RoleModel.findOne({ code: roleCode }).select('_id');
  if (!role) return [];

  const filter: Record<string, unknown> = {
    role: (role as any)._id,
    status: 'ACTIVE',
  };
  if (organizationId && isValidObjectId(String(organizationId))) {
    filter.organization = organizationId;
  }

  const users = await UserModel.find(filter).select('_id');
  return Promise.all(users.map((user: any) => createNotification({
    ...payload,
    recipient: String(user._id),
  })));
};

export const listNotificationsService = async (
  actor: AuthUser,
  query: Record<string, unknown>,
) => {
  await reconcileWorkDeclarationNotifications(actor.id);
  const { page, limit, skip } = parsePagination(query);
  const filter: Record<string, unknown> = { recipient: actor.id };
  if (query.unread === 'true' || query.status === 'unread') filter.readAt = null;

  const [items, total] = await Promise.all([
    notificationRepository.findMany(filter, skip, limit),
    notificationRepository.count(filter),
  ]);

  return {
    data: items,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
};

export const getUnreadCountService = async (actor: AuthUser) => {
  await reconcileWorkDeclarationNotifications(actor.id);
  const count = await notificationRepository.count({ recipient: actor.id, readAt: null });
  return { data: { count } };
};

export const markNotificationReadService = async (actor: AuthUser, id: unknown) => {
  const notificationId = assertObjectId(id, 'id');
  const notification = await notificationRepository.markRead(notificationId, actor.id);
  if (!notification) throw notFound('Notification not found.');
  if (String((notification as any).recipient?._id ?? (notification as any).recipient) !== actor.id) {
    throw forbidden('Access denied.');
  }
  emitUserNotificationChanged(actor.id);
  return { data: notification };
};

export const markAllNotificationsReadService = async (actor: AuthUser) => {
  await notificationRepository.markAllRead(actor.id);
  emitUserNotificationChanged(actor.id);
  return { data: { success: true } };
};

export const markWorkDeclarationNotificationsRead = async (
  recipient: string,
  declarationId: string,
) => {
  await notificationRepository.markRelatedRead(recipient, declarationId, [
    'WORK_DECLARATION_SUBMITTED',
    'WORK_DECLARATION_FORWARDED',
  ]);
  emitUserNotificationChanged(recipient);
};

export const markAllWorkDeclarationNotificationsRead = async (declarationId: string) => {
  const types = ['WORK_DECLARATION_SUBMITTED', 'WORK_DECLARATION_FORWARDED'];
  const recipients = await notificationRepository.unreadRelatedRecipients(declarationId, types);
  await Promise.all(recipients.map((recipient: any) => (
    notificationRepository.markRelatedRead(String(recipient), declarationId, types)
  )));
  recipients.forEach((recipient: any) => emitUserNotificationChanged(String(recipient)));
};
