import type { NextFunction, Request, Response } from "express";
import {
  completeOfficeDocumentManuallyService,
  undoOfficeDocumentManualCompletionService,
} from "../services/office-document-manual-completion.service";

const actor = (req: Request) => (req as any).currentUser;

export const completeOfficeDocumentManually = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(200).json(await completeOfficeDocumentManuallyService(actor(req), req.params.id, req.body));
  } catch (error) {
    next(error);
  }
};

export const undoOfficeDocumentManualCompletion = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(200).json(await undoOfficeDocumentManualCompletionService(actor(req), req.params.id));
  } catch (error) {
    next(error);
  }
};
