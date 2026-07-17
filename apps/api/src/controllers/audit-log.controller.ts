import { NextFunction, Request, Response } from 'express';
import {
  listAuditLogsForEntityService,
  listAuditLogsService,
} from '../services/audit-log.service';

const cu = (req: Request) => (req as any).currentUser;

export const listAuditLogs = async (req: Request, res: Response, next: NextFunction) => {
  try { res.json(await listAuditLogsService(cu(req), req.query as Record<string, unknown>)); }
  catch (err) { next(err); }
};

export const listAuditLogsForEntity = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await listAuditLogsForEntityService(
      cu(req),
      req.params.entityModel,
      req.params.entityId,
      req.query as Record<string, unknown>,
    ));
  } catch (err) { next(err); }
};
