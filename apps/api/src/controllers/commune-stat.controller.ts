import fs from 'fs';
import path from 'path';
import { Request, Response, NextFunction } from 'express';
import { communeStatService } from '../services/commune-stat.service';

export const getCommuneOverview = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as any).currentUser;
    const orgId = user?.organization || (req.query.organizationId as string) || null;
    const result = await communeStatService.getIocOverview({
      year: req.query.year as string,
      period: req.query.period as string,
      category: req.query.category as string,
      organizationId: orgId,
    });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

export const listCommuneReports = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as any).currentUser;
    const orgId = user?.organization || (req.query.organizationId as string) || null;
    const result = await communeStatService.listReports({
      category: req.query.category as string,
      search: req.query.search as string,
      year: req.query.year as string,
      page: req.query.page as string,
      limit: req.query.limit as string,
      organizationId: orgId,
    });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

export const getCommuneReportDetail = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = String(req.params.id);
    const result = await communeStatService.getReportDetail(id);
    if (!result.report) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Không tìm thấy báo cáo.' } });
      return;
    }
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

export const extractCommuneReport = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const file = req.file;
    const body = req.body || {};
    const sanitizedFilename = file ? communeStatService.fixUtf8String(file.originalname) : undefined;
    const result = await communeStatService.extractReportData(
      file ? {
        originalname: sanitizedFilename!,
        size: file.size,
        buffer: file.buffer,
        mimetype: file.mimetype,
      } : undefined,
      body
    );
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

export const commitCommuneReport = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as any).currentUser;
    const orgId = user?.organization || req.body?.organizationId || null;
    const { report, metrics } = req.body || {};

    const result = await communeStatService.commitReportAndMetrics({
      report,
      metrics,
      currentUser: user,
      organizationId: orgId,
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
};

export const toggleCommuneMetricStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = String(req.params.id);
    const { isConfirmed } = req.body || {};
    const user = (req as any).currentUser;

    const result = await communeStatService.toggleMetricStatus(id, Boolean(isConfirmed), user);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

export const createCommuneMetric = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as any).currentUser;
    const orgId = user?.organization || req.body?.organizationId || null;
    const result = await communeStatService.createManualMetric(req.body, user, orgId);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
};

export const syncEworkMetrics = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as any).currentUser;
    const orgId = user?.organization || null;
    const year = Number(req.body?.year) || 2026;
    const period = req.body?.period || 'Tháng 9/2026';

    const result = await communeStatService.syncFromEworkSystem(year, period, orgId);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

export const downloadCommuneReport = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = String(req.params.id);
    const result = await communeStatService.getReportDetail(id);
    if (!result.report || !result.report.fileUrl) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Không tìm thấy tệp đính kèm của báo cáo.' } });
      return;
    }
    const filePath = path.resolve(__dirname, '../../', result.report.fileUrl.replace(/^\//, ''));
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: { code: 'FILE_NOT_FOUND', message: 'Tệp vật lý không tồn tại trên hệ thống.' } });
      return;
    }
    res.download(filePath, result.report.fileName || path.basename(filePath));
  } catch (err) {
    next(err);
  }
};

export const deleteCommuneReport = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = String(req.params.id);
    const result = await communeStatService.deleteReport(id);
    if (!result.success) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: result.message } });
      return;
    }
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};
