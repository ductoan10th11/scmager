import { NextFunction, Request, Response } from 'express';
import { organizationService } from '../services/organization.service';

export const listOrganizations = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await organizationService.listOrganizations((req as any).currentUser, req.query);
    res.status(200).json(result);
  } catch (err) { next(err); }
};

export const getOrganizationById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await organizationService.getOrganizationById((req as any).currentUser, req.params.id);
    res.status(200).json(result);
  } catch (err) { next(err); }
};

export const createOrganization = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await organizationService.createOrganization((req as any).currentUser, req.body);
    res.status(201).json(result);
  } catch (err) { next(err); }
};

export const updateOrganization = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await organizationService.updateOrganization((req as any).currentUser, req.params.id, req.body);
    res.status(200).json(result);
  } catch (err) { next(err); }
};

export const deleteOrganization = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await organizationService.deleteOrganization((req as any).currentUser, req.params.id);
    res.status(204).send();
  } catch (err) { next(err); }
};
