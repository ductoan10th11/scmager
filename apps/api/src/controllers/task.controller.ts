import { NextFunction, Request, Response } from 'express';
import {
  listTasksService,
  getTaskByIdService,
  getTaskAttachmentDownloadService,
  getTaskSourceAttachmentDownloadService,
  createDepartmentMeetingService,
  createTaskService,
  updateTaskService,
  assignTaskService,
  startTaskService,
  submitReviewService,
  reviewTaskService,
  cancelTaskService,
} from '../services/task.service';

const cu = (req: Request) => (req as any).currentUser;

const sendAttachmentFile = (req: Request, res: Response, file: {
  filePath: string;
  fileName: string;
  contentType?: string;
}) => {
  if (req.query.disposition === 'inline') {
    const safeFileName = file.fileName.replace(/"/g, '');
    res.setHeader('Content-Type', file.contentType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${safeFileName}"`);
    res.sendFile(file.filePath);
    return;
  }

  res.download(file.filePath, file.fileName);
};

export const listTasks = async (req: Request, res: Response, next: NextFunction) => {
  try { res.json(await listTasksService(cu(req), req.query as Record<string, unknown>)); }
  catch (err) { next(err); }
};

export const getTaskById = async (req: Request, res: Response, next: NextFunction) => {
  try { res.json(await getTaskByIdService(cu(req), req.params.id)); }
  catch (err) { next(err); }
};

export const downloadTaskAttachment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const file = await getTaskAttachmentDownloadService(
      cu(req),
      req.params.id,
      req.params.attachmentId,
    );
    sendAttachmentFile(req, res, file);
  } catch (err) {
    next(err);
  }
};

export const downloadTaskSourceAttachment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const file = await getTaskSourceAttachmentDownloadService(
      cu(req),
      req.params.id,
      req.params.attachmentId,
    );
    sendAttachmentFile(req, res, file);
  } catch (err) {
    next(err);
  }
};

export const createDepartmentMeeting = async (req: Request, res: Response, next: NextFunction) => {
  try { res.status(201).json(await createDepartmentMeetingService(cu(req), req.body)); }
  catch (err) { next(err); }
};

export const createTask = async (req: Request, res: Response, next: NextFunction) => {
  try { res.status(201).json(await createTaskService(cu(req), req.body)); }
  catch (err) { next(err); }
};

export const updateTask = async (req: Request, res: Response, next: NextFunction) => {
  try { res.json(await updateTaskService(cu(req), req.params.id, req.body)); }
  catch (err) { next(err); }
};

export const assignTask = async (req: Request, res: Response, next: NextFunction) => {
  try { res.json(await assignTaskService(cu(req), req.params.id, req.body)); }
  catch (err) { next(err); }
};

export const startTask = async (req: Request, res: Response, next: NextFunction) => {
  try { res.json(await startTaskService(cu(req), req.params.id)); }
  catch (err) { next(err); }
};

export const submitReview = async (req: Request, res: Response, next: NextFunction) => {
  try { res.json(await submitReviewService(cu(req), req.params.id, req.body)); }
  catch (err) { next(err); }
};

export const reviewTask = async (req: Request, res: Response, next: NextFunction) => {
  try { res.json(await reviewTaskService(cu(req), req.params.id, req.body)); }
  catch (err) { next(err); }
};

export const cancelTask = async (req: Request, res: Response, next: NextFunction) => {
  try { res.json(await cancelTaskService(cu(req), req.params.id)); }
  catch (err) { next(err); }
};
