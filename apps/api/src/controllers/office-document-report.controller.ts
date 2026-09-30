import { NextFunction, Request, Response } from 'express';
import { overdueOfficeDocumentReportService } from '../services/office-document-report.service';
import { lateAssignmentReportService } from '../services/late-assignment-report.service';
import {
  buildOverdueOfficeDocumentReportWorkbook,
  buildLateAssignmentReportWorkbook,
} from '../services/office-document-report-export.service';

const currentUser = (req: Request) => (req as any).currentUser;

export const getOverdueOfficeDocumentReport = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(200).json(await overdueOfficeDocumentReportService(currentUser(req), req.query as Record<string, unknown>));
  } catch (error) {
    next(error);
  }
};

export const downloadOverdueOfficeDocumentReportWorkbook = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const workbook = await buildOverdueOfficeDocumentReportWorkbook(currentUser(req), req.query as Record<string, unknown>);
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

export const getLateAssignmentReport = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(200).json(await lateAssignmentReportService(currentUser(req), req.query as Record<string, unknown>));
  } catch (error) {
    next(error);
  }
};

export const downloadLateAssignmentReportWorkbook = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const workbook = await buildLateAssignmentReportWorkbook(currentUser(req), req.query as Record<string, unknown>);
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
