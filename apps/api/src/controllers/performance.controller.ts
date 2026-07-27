import { NextFunction, Request, Response } from 'express';
import { performanceOverviewService } from '../services/performance.service';

const cu = (req: Request) => (req as any).currentUser;

export const performanceOverview = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(200).json(await performanceOverviewService(cu(req), req.query as Record<string, unknown>));
  } catch (error) {
    next(error);
  }
};
