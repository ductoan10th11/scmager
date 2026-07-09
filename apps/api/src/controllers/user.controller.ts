import { NextFunction, Request, Response } from 'express';
import { userService } from '../services/user.service';

export const listUsers = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await userService.listUsers((req as any).currentUser, req.query);
    res.status(200).json(result);
  } catch (err) { next(err); }
};

export const getUserById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await userService.getUserById((req as any).currentUser, req.params.id);
    res.status(200).json(result);
  } catch (err) { next(err); }
};

export const createUser = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await userService.createUser((req as any).currentUser, req.body);
    res.status(201).json(result);
  } catch (err) { next(err); }
};

export const updateUser = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await userService.updateUser((req as any).currentUser, req.params.id, req.body);
    res.status(200).json(result);
  } catch (err) { next(err); }
};

export const deleteUser = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await userService.deleteUser((req as any).currentUser, req.params.id);
    res.status(204).send();
  } catch (err) { next(err); }
};
