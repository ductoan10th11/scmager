import { NextFunction, Request, Response } from 'express';
import {
  getMyTimesheetService,
  getDepartmentTimesheetsService,
  upsertTimesheetService,
  addEntryService,
  deleteEntryService,
  submitTimesheetService,
  reviewTimesheetService,
} from '../services/timesheet.service';

const cu = (req: Request) => (req as any).currentUser;

export const getMyTimesheet = async (req: Request, res: Response, next: NextFunction) => {
  try { res.json(await getMyTimesheetService(cu(req), req.query as Record<string, unknown>)); }
  catch (err) { next(err); }
};

export const getDepartmentTimesheets = async (req: Request, res: Response, next: NextFunction) => {
  try { res.json(await getDepartmentTimesheetsService(cu(req), req.query as Record<string, unknown>)); }
  catch (err) { next(err); }
};

export const upsertTimesheet = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await upsertTimesheetService(cu(req), req.body);
    const { created, ...payload } = result as any;
    res.status(created ? 201 : 200).json(payload);
  } catch (err) { next(err); }
};

export const addEntry = async (req: Request, res: Response, next: NextFunction) => {
  try { res.json(await addEntryService(cu(req), req.params.id, req.body)); }
  catch (err) { next(err); }
};

export const deleteEntry = async (req: Request, res: Response, next: NextFunction) => {
  try { res.json(await deleteEntryService(cu(req), req.params.id, req.params.entryId)); }
  catch (err) { next(err); }
};

export const submitTimesheet = async (req: Request, res: Response, next: NextFunction) => {
  try { res.json(await submitTimesheetService(cu(req), req.params.id)); }
  catch (err) { next(err); }
};

export const reviewTimesheet = async (req: Request, res: Response, next: NextFunction) => {
  try { res.json(await reviewTimesheetService(cu(req), req.params.id, req.body)); }
  catch (err) { next(err); }
};
