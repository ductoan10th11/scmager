import type { NextFunction, Request, Response } from 'express';
import {
  approveDocumentResultLinkService,
  createDocumentResultLinkService,
  forwardDocumentResultLinkService,
  listDocumentResultLinksService,
  resolveDocumentResultLinkService,
  returnDocumentResultLinkService,
} from '../services/document-result-link.service';

const actor = (req: Request) => (req as any).currentUser;

export const listDocumentResultLinks = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    res.status(200).json(
      await listDocumentResultLinksService(
        actor(req),
        req.query as Record<string, unknown>,
      ),
    );
  } catch (error) {
    next(error);
  }
};

export const resolveDocumentResultLink = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    res.status(200).json(
      await resolveDocumentResultLinkService(
        actor(req),
        req.query as Record<string, unknown>,
      ),
    );
  } catch (error) {
    next(error);
  }
};

export const createDocumentResultLink = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    res.status(201).json(
      await createDocumentResultLinkService(actor(req), req.body),
    );
  } catch (error) {
    next(error);
  }
};

export const approveDocumentResultLink = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    res.status(200).json(
      await approveDocumentResultLinkService(
        actor(req),
        String(req.params.id),
        req.body,
      ),
    );
  } catch (error) {
    next(error);
  }
};

export const returnDocumentResultLink = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    res.status(200).json(
      await returnDocumentResultLinkService(
        actor(req),
        String(req.params.id),
        req.body,
      ),
    );
  } catch (error) {
    next(error);
  }
};

export const forwardDocumentResultLink = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    res.status(200).json(
      await forwardDocumentResultLinkService(
        actor(req),
        String(req.params.id),
        req.body,
      ),
    );
  } catch (error) {
    next(error);
  }
};
