import { NextFunction, Request, Response } from 'express';
import { listCompatibilityTasksService } from '../services/task-compatibility.service';

export const listCompatibilityTasks = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(200).json(await listCompatibilityTasksService((req as any).currentUser, req.query as Record<string, unknown>));
  } catch (error) {
    next(error);
  }
};
