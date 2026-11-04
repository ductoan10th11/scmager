import type { NextFunction, Request, Response } from "express";
import {
  cancelOfficeDocumentNotRequiredService,
  decideOfficeDocumentNotRequiredService,
  requestOfficeDocumentNotRequiredService,
  restoreOfficeDocumentNotRequiredService,
} from "../services/office-document-not-required.service";

const actor = (req: Request) => (req as any).currentUser;

export const requestOfficeDocumentNotRequired = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(200).json(await requestOfficeDocumentNotRequiredService(actor(req), req.params.id, req.body));
  } catch (error) {
    next(error);
  }
};

export const cancelOfficeDocumentNotRequired = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(200).json(await cancelOfficeDocumentNotRequiredService(actor(req), req.params.id));
  } catch (error) {
    next(error);
  }
};

export const decideOfficeDocumentNotRequired = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(200).json(await decideOfficeDocumentNotRequiredService(actor(req), req.params.id, req.body));
  } catch (error) {
    next(error);
  }
};

export const restoreOfficeDocumentNotRequired = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(200).json(await restoreOfficeDocumentNotRequiredService(actor(req), req.params.id, req.body));
  } catch (error) {
    next(error);
  }
};
