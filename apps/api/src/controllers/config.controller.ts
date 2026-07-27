import type { NextFunction, Request, Response } from 'express';
import { getConfig, getExtensionVersion, getExtensionVersionForAdmin, setConfig, setExtensionVersion } from '../services/config.service';

const actor = (req: Request) => (req as any).currentUser;

export const publicExtensionVersion = async (_req: Request, res: Response, next: NextFunction) => {
  try { res.json(await getExtensionVersion()); } catch (error) { next(error); }
};

export const getAdminExtensionVersion = async (req: Request, res: Response, next: NextFunction) => {
  try { res.json(await getExtensionVersionForAdmin(actor(req))); } catch (error) { next(error); }
};

export const updateAdminExtensionVersion = async (req: Request, res: Response, next: NextFunction) => {
  try { res.json(await setExtensionVersion(actor(req), req.body)); } catch (error) { next(error); }
};

export const getAdminConfig = async (req: Request, res: Response, next: NextFunction) => {
  try { res.json(await getConfig(actor(req), req.params.key)); } catch (error) { next(error); }
};

export const updateAdminConfig = async (req: Request, res: Response, next: NextFunction) => {
  try { res.json(await setConfig(actor(req), req.params.key, req.body)); } catch (error) { next(error); }
};
