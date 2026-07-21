import { NextFunction, Request, Response } from 'express';
import {
  getIngestDocumentService,
  getOutgoingDocumentService,
  listIngestDocumentsService,
  listOutgoingDocumentsService,
  updateIngestDocumentProcessingService,
} from '../services/document.service';

const cu = (req: Request) => (req as any).currentUser;

export const listIngestDocuments = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await listIngestDocumentsService(cu(req), req.query as Record<string, unknown>);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

export const listOutgoingDocuments = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await listOutgoingDocumentsService(cu(req), req.query as Record<string, unknown>);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

export const getOutgoingDocument = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await getOutgoingDocumentService(cu(req), String(req.params.id));
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

export const updateIngestDocumentProcessing = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await updateIngestDocumentProcessingService(cu(req), String(req.params.id), req.body ?? {});
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

export const getIngestDocument = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await getIngestDocumentService(cu(req), String(req.params.id));
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};
