import { NextFunction, Request, Response } from 'express';
import {
  dashboardDeadlinesService,
  dashboardSummaryService,
  dashboardWorkloadService,
} from '../services/dashboard.service';

const cu = (req: Request) => (req as any).currentUser;

export const dashboardSummary = async (req: Request, res: Response, next: NextFunction) => {
  try { res.json(await dashboardSummaryService(cu(req))); }
  catch (err) { next(err); }
};

export const dashboardWorkload = async (req: Request, res: Response, next: NextFunction) => {
  try { res.json(await dashboardWorkloadService(cu(req))); }
  catch (err) { next(err); }
};

export const dashboardDeadlines = async (req: Request, res: Response, next: NextFunction) => {
  try { res.json(await dashboardDeadlinesService(cu(req))); }
  catch (err) { next(err); }
};
