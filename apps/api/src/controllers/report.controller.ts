import { NextFunction, Request, Response } from 'express';
import {
  departmentProgressReportService,
  documentsCsvService,
  documentsReportService,
  tasksCsvService,
  tasksReportService,
} from '../services/report.service';

const cu = (req: Request) => (req as any).currentUser;

export const documentsReport = async (req: Request, res: Response, next: NextFunction) => {
  try { res.json(await documentsReportService(cu(req), req.query as Record<string, unknown>)); }
  catch (err) { next(err); }
};

export const tasksReport = async (req: Request, res: Response, next: NextFunction) => {
  try { res.json(await tasksReportService(cu(req), req.query as Record<string, unknown>)); }
  catch (err) { next(err); }
};

export const departmentProgressReport = async (req: Request, res: Response, next: NextFunction) => {
  try { res.json(await departmentProgressReportService(cu(req), req.params.departmentId)); }
  catch (err) { next(err); }
};

export const documentsCsv = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const csv = await documentsCsvService(cu(req), req.query as Record<string, unknown>);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="documents.csv"');
    res.send(csv);
  } catch (err) { next(err); }
};

export const tasksCsv = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const csv = await tasksCsvService(cu(req), req.query as Record<string, unknown>);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="tasks.csv"');
    res.send(csv);
  } catch (err) { next(err); }
};
