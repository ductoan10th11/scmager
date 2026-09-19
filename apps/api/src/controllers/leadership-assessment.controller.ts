import { NextFunction, Request, Response } from 'express';
import {
  listLeadershipAssessmentsService,
  upsertLeadershipAssessmentService,
} from '../services/leadership-assessment.service';

const currentUser = (req: Request) => (req as any).currentUser;

export const listLeadershipAssessments = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(200).json(await listLeadershipAssessmentsService(currentUser(req), req.query as Record<string, unknown>));
  } catch (error) {
    next(error);
  }
};

export const upsertLeadershipAssessment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(200).json(await upsertLeadershipAssessmentService(currentUser(req), req.body));
  } catch (error) {
    next(error);
  }
};
