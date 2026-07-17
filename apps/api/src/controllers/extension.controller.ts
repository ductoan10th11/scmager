import { NextFunction, Request, Response } from 'express';
import { extensionOverviewService } from '../services/extension.service';

const cu = (req: Request) => (req as any).currentUser;

export const extensionOverview = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(200).json(await extensionOverviewService(cu(req), req.query as Record<string, unknown>));
  } catch (err) {
    next(err);
  }
};
