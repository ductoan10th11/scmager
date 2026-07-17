import { NextFunction, Request, Response } from 'express';
import {
  getUnreadCountService,
  listNotificationsService,
  markAllNotificationsReadService,
  markNotificationReadService,
} from '../services/notification.service';

const cu = (req: Request) => (req as any).currentUser;

export const listNotifications = async (req: Request, res: Response, next: NextFunction) => {
  try { res.json(await listNotificationsService(cu(req), req.query as Record<string, unknown>)); }
  catch (err) { next(err); }
};

export const getUnreadCount = async (req: Request, res: Response, next: NextFunction) => {
  try { res.json(await getUnreadCountService(cu(req))); }
  catch (err) { next(err); }
};

export const markNotificationRead = async (req: Request, res: Response, next: NextFunction) => {
  try { res.json(await markNotificationReadService(cu(req), req.params.id)); }
  catch (err) { next(err); }
};

export const markAllNotificationsRead = async (req: Request, res: Response, next: NextFunction) => {
  try { res.json(await markAllNotificationsReadService(cu(req))); }
  catch (err) { next(err); }
};
