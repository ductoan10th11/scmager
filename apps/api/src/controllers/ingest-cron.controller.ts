import { NextFunction, Request, Response } from 'express';
import { ingestCronService } from '../services/ingest-cron.service';

const cu = (req: Request) => (req as any).currentUser;

export const ingestCronStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(200).json(ingestCronService.getStatus(cu(req)));
  } catch (err) {
    next(err);
  }
};

export const ingestCronLogs = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(200).json(ingestCronService.getLogs(cu(req), Number(req.query.limit) || 100));
  } catch (err) {
    next(err);
  }
};

export const startIngestCron = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(200).json(ingestCronService.start(cu(req)));
  } catch (err) {
    next(err);
  }
};

export const stopIngestCron = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(200).json(ingestCronService.stop(cu(req)));
  } catch (err) {
    next(err);
  }
};

export const runIngestCronNow = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(202).json(await ingestCronService.runNow(cu(req)));
  } catch (err) {
    next(err);
  }
};

export const clearIngestCronLogs = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(200).json(ingestCronService.clearLogs(cu(req)));
  } catch (err) {
    next(err);
  }
};
