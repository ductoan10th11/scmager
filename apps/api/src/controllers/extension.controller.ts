import { NextFunction, Request, Response } from 'express';
import { extensionOverviewService } from '../services/extension.service';
import {
  lookupExtensionIncomingDocumentPointService,
  receiveExtensionIncomingDocumentsService,
  receiveExtensionOutgoingDocumentService,
} from '../services/extension-document-intake.service';

const cu = (req: Request) => (req as any).currentUser;

export const extensionOverview = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(200).json(await extensionOverviewService(cu(req), req.query as Record<string, unknown>));
  } catch (err) {
    next(err);
  }
};

export const receiveExtensionIncomingDocuments = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await receiveExtensionIncomingDocumentsService(cu(req), req.body);
    res.status(result.data.created ? 201 : 200).json(result);
  } catch (err) {
    next(err);
  }
};

export const lookupExtensionIncomingDocumentPoint = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(200).json(await lookupExtensionIncomingDocumentPointService(req.query as Record<string, unknown>));
  } catch (err) {
    next(err);
  }
};

export const receiveExtensionOutgoingDocument = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await receiveExtensionOutgoingDocumentService(cu(req), req.body);
    res.status(result.data.created ? 201 : 200).json(result);
  } catch (err) {
    next(err);
  }
};
