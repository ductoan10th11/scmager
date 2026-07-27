import { NextFunction, Request, Response } from 'express';
import { buildPerformanceWorkbook } from '../services/performance-export.service';
import { importPerformanceWorkbook } from '../services/performance-import.service';
import { performanceOverviewService } from '../services/performance.service';

const cu = (req: Request) => (req as any).currentUser;

export const performanceOverview = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(200).json(await performanceOverviewService(cu(req), req.query as Record<string, unknown>));
  } catch (error) {
    next(error);
  }
};

export const downloadPerformanceWorkbook = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const workbook = await buildPerformanceWorkbook(cu(req), req.query as Record<string, unknown>);
    res
      .status(200)
      .setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(workbook.fileName)}`)
      .setHeader('Cache-Control', 'no-store')
      .send(workbook.content);
  } catch (error) {
    next(error);
  }
};

export const importPerformanceWorkbookFile = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(200).json(await importPerformanceWorkbook(cu(req), req.file));
  } catch (error) {
    next(error);
  }
};
