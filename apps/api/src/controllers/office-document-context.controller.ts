import type { NextFunction, Request, Response } from "express";
import {
  createManagedOfficeDocumentContext as createManagedOfficeDocumentContextService,
  deleteManagedOfficeDocumentContext as deleteManagedOfficeDocumentContextService,
  getOfficeDocumentContext as getOfficeDocumentContextService,
  ingestIncomingBySymbol as ingestIncomingBySymbolService,
  listOfficeDocumentContexts,
  updateManagedOfficeDocumentContext as updateManagedOfficeDocumentContextService,
  upsertOfficeDocumentContext,
} from "../services/office-document-context.service";

export const receiveOfficeDocumentContext = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = await upsertOfficeDocumentContext(req.body);
    res.status(result.data.created ? 201 : 200).json(result);
  } catch (error) {
    next(error);
  }
};

export const listOfficeDocumentContext = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    res.json(
      await listOfficeDocumentContexts(actor(req), req.query as Record<string, unknown>),
    );
  } catch (error) {
    next(error);
  }
};

export const getOfficeDocumentContext = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    res.json(await getOfficeDocumentContextService(actor(req), String(req.params.id)));
  } catch (error) {
    next(error);
  }
};

export const ingestIncomingBySymbol = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    res
      .status(201)
      .json(await ingestIncomingBySymbolService(actor(req), req.body));
  } catch (error) {
    next(error);
  }
};

const actor = (req: Request) => (req as any).currentUser;

export const createManagedOfficeDocumentContext = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    res
      .status(201)
      .json(
        await createManagedOfficeDocumentContextService(actor(req), req.body),
      );
  } catch (error) {
    next(error);
  }
};

export const updateManagedOfficeDocumentContext = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    res.json(
      await updateManagedOfficeDocumentContextService(
        actor(req),
        String(req.params.id),
        req.body,
      ),
    );
  } catch (error) {
    next(error);
  }
};

export const deleteManagedOfficeDocumentContext = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    res.json(
      await deleteManagedOfficeDocumentContextService(
        actor(req),
        String(req.params.id),
      ),
    );
  } catch (error) {
    next(error);
  }
};
