import type { NextFunction, Request, Response } from "express";
import { connectorService } from "../services/connector.service";

const actor = (req: Request) => (req as any).currentUser;

export const createConnector = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    res.status(201).json(await connectorService.create(actor(req), req.body));
  } catch (error) {
    next(error);
  }
};
export const listConnectors = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    res.json(await connectorService.list(actor(req)));
  } catch (error) {
    next(error);
  }
};

export const updateConnector = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    res.json(await connectorService.update(actor(req), String(req.params.connectorId), req.body));
  } catch (error) {
    next(error);
  }
};

export const deleteConnector = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    res.json(await connectorService.remove(actor(req), String(req.params.connectorId)));
  } catch (error) {
    next(error);
  }
};
export const activateConnector = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    res.json(
      await connectorService.activate(
        actor(req),
        String(req.params.connectorId),
      ),
    );
  } catch (error) {
    next(error);
  }
};
export const disableConnector = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    res.json(
      await connectorService.disable(
        actor(req),
        String(req.params.connectorId),
      ),
    );
  } catch (error) {
    next(error);
  }
};
export const requestConnectorRun = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    res
      .status(202)
      .json(
        await connectorService.requestManualRun(
          actor(req),
          String(req.params.connectorId),
        ),
      );
  } catch (error) {
    next(error);
  }
};

export const getConnectorOperationalStatus = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    res.json(await connectorService.getOperationalStatus(actor(req), String(req.params.connectorId)));
  } catch (error) {
    next(error);
  }
};

export const retryConnectorDeadLetter = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    res.status(202).json(await connectorService.retryDeadLetter(
      actor(req),
      String(req.params.connectorId),
      String(req.params.deadLetterId),
    ));
  } catch (error) {
    next(error);
  }
};
