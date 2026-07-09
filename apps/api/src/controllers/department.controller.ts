import { NextFunction, Request, Response } from 'express';
import { departmentService } from '../services/department.service';

export const listDepartments = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await departmentService.listDepartments((req as any).currentUser, req.params, req.query);
    res.status(200).json(result);
  } catch (err) { next(err); }
};

export const getDepartmentById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await departmentService.getDepartmentById((req as any).currentUser, req.params.id);
    res.status(200).json(result);
  } catch (err) { next(err); }
};

export const createDepartment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await departmentService.createDepartment((req as any).currentUser, req.params, req.body);
    res.status(201).json(result);
  } catch (err) { next(err); }
};

export const updateDepartment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await departmentService.updateDepartment((req as any).currentUser, req.params.id, req.body);
    res.status(200).json(result);
  } catch (err) { next(err); }
};

export const deleteDepartment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await departmentService.deleteDepartment((req as any).currentUser, req.params.id);
    res.status(204).send();
  } catch (err) { next(err); }
};
