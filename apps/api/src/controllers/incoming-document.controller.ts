import { NextFunction, Request, Response } from 'express';
import {
  listDocumentsService,
  getDocumentByIdService,
  createDocumentService,
  updateDocumentService,
  assignDepartmentService,
  assignUserService,
  completeDocumentService,
  uploadAttachmentsService,
  deleteAttachmentService,
} from '../services/incoming-document.service';

const cu = (req: Request) => (req as any).currentUser;

export const listDocuments = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await listDocumentsService(cu(req), req.query as Record<string, unknown>);
    res.status(200).json(result);
  } catch (err) { next(err); }
};

export const getDocumentById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await getDocumentByIdService(cu(req), req.params.id);
    res.status(200).json(result);
  } catch (err) { next(err); }
};

export const createDocument = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await createDocumentService(cu(req), req.body);
    res.status(201).json(result);
  } catch (err) { next(err); }
};

export const updateDocument = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await updateDocumentService(cu(req), req.params.id, req.body);
    res.status(200).json(result);
  } catch (err) { next(err); }
};

export const assignDepartment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await assignDepartmentService(cu(req), req.params.id, req.body);
    res.status(200).json(result);
  } catch (err) { next(err); }
};

export const assignUser = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await assignUserService(cu(req), req.params.id, req.body);
    res.status(200).json(result);
  } catch (err) { next(err); }
};

export const completeDocument = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await completeDocumentService(cu(req), req.params.id);
    res.status(200).json(result);
  } catch (err) { next(err); }
};

export const uploadAttachments = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const files = (req.files as Express.Multer.File[]) ?? []
    const category = String(req.body?.category ?? req.query.category ?? 'DECISION')
    const result = await uploadAttachmentsService(cu(req), req.params.id, files, category)
    res.status(200).json(result)
  } catch (err) { next(err) }
};

export const uploadDecisionAttachments = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const files = (req.files as Express.Multer.File[]) ?? []
    const result = await uploadAttachmentsService(cu(req), req.params.id, files, 'DECISION')
    res.status(200).json(result)
  } catch (err) { next(err) }
};

export const uploadWorkAttachments = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const files = (req.files as Express.Multer.File[]) ?? []
    const result = await uploadAttachmentsService(cu(req), req.params.id, files, 'WORK')
    res.status(200).json(result)
  } catch (err) { next(err) }
};

export const deleteAttachment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await deleteAttachmentService(cu(req), req.params.id, req.params.attId);
    res.status(200).json(result);
  } catch (err) { next(err); }
};
