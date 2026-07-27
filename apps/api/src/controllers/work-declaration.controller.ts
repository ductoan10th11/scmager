import { NextFunction, Request, Response } from 'express';
import {
  approveWorkDeclarationService,
  approveWorkDeclarationPointAdjustmentService,
  cancelWorkDeclarationService,
  cancelWorkDeclarationPointAdjustmentService,
  confirmWorkDeclarationCompletionService,
  createWorkDeclarationService,
  forwardWorkDeclarationService,
  forwardWorkDeclarationPointAdjustmentService,
  getWorkDeclarationService,
  listAssignmentParticipantsService,
  listWorkDeclarationsService,
  returnWorkDeclarationService,
  rejectWorkDeclarationPointAdjustmentService,
  requestWorkDeclarationPointAdjustmentService,
  returnWorkDeclarationCompletionService,
  rescheduleWorkDeclarationService,
  submitWorkDeclarationService,
  submitWorkDeclarationCompletionService,
  updateWorkDeclarationService,
} from '../services/work-declaration.service';

const currentUser = (req: Request) => (req as any).currentUser;

export const listWorkDeclarations = async (req: Request, res: Response, next: NextFunction) => {
  try { res.status(200).json(await listWorkDeclarationsService(currentUser(req), req.query as Record<string, unknown>)); } catch (error) { next(error); }
};
export const listAssignmentParticipants = async (req: Request, res: Response, next: NextFunction) => {
  try { res.status(200).json(await listAssignmentParticipantsService(currentUser(req), req.query as Record<string, unknown>)); } catch (error) { next(error); }
};
export const getWorkDeclaration = async (req: Request, res: Response, next: NextFunction) => {
  try { res.status(200).json(await getWorkDeclarationService(currentUser(req), req.params.id)); } catch (error) { next(error); }
};
export const createWorkDeclaration = async (req: Request, res: Response, next: NextFunction) => {
  try { res.status(201).json(await createWorkDeclarationService(currentUser(req), req.body)); } catch (error) { next(error); }
};
export const updateWorkDeclaration = async (req: Request, res: Response, next: NextFunction) => {
  try { res.status(200).json(await updateWorkDeclarationService(currentUser(req), req.params.id, req.body)); } catch (error) { next(error); }
};
export const rescheduleWorkDeclaration = async (req: Request, res: Response, next: NextFunction) => {
  try { res.status(200).json(await rescheduleWorkDeclarationService(currentUser(req), req.params.id, req.body)); } catch (error) { next(error); }
};
export const submitWorkDeclaration = async (req: Request, res: Response, next: NextFunction) => {
  try { res.status(200).json(await submitWorkDeclarationService(currentUser(req), req.params.id, req.body)); } catch (error) { next(error); }
};
export const approveWorkDeclaration = async (req: Request, res: Response, next: NextFunction) => {
  try { res.status(200).json(await approveWorkDeclarationService(currentUser(req), req.params.id, req.body)); } catch (error) { next(error); }
};
export const requestWorkDeclarationPointAdjustment = async (req: Request, res: Response, next: NextFunction) => {
  try { res.status(200).json(await requestWorkDeclarationPointAdjustmentService(currentUser(req), req.params.id, req.body)); } catch (error) { next(error); }
};
export const approveWorkDeclarationPointAdjustment = async (req: Request, res: Response, next: NextFunction) => {
  try { res.status(200).json(await approveWorkDeclarationPointAdjustmentService(currentUser(req), req.params.id, req.body)); } catch (error) { next(error); }
};
export const rejectWorkDeclarationPointAdjustment = async (req: Request, res: Response, next: NextFunction) => {
  try { res.status(200).json(await rejectWorkDeclarationPointAdjustmentService(currentUser(req), req.params.id, req.body)); } catch (error) { next(error); }
};
export const forwardWorkDeclarationPointAdjustment = async (req: Request, res: Response, next: NextFunction) => {
  try { res.status(200).json(await forwardWorkDeclarationPointAdjustmentService(currentUser(req), req.params.id, req.body)); } catch (error) { next(error); }
};
export const cancelWorkDeclarationPointAdjustment = async (req: Request, res: Response, next: NextFunction) => {
  try { res.status(200).json(await cancelWorkDeclarationPointAdjustmentService(currentUser(req), req.params.id, req.body)); } catch (error) { next(error); }
};
export const returnWorkDeclaration = async (req: Request, res: Response, next: NextFunction) => {
  try { res.status(200).json(await returnWorkDeclarationService(currentUser(req), req.params.id, req.body)); } catch (error) { next(error); }
};
export const forwardWorkDeclaration = async (req: Request, res: Response, next: NextFunction) => {
  try { res.status(200).json(await forwardWorkDeclarationService(currentUser(req), req.params.id, req.body)); } catch (error) { next(error); }
};
export const cancelWorkDeclaration = async (req: Request, res: Response, next: NextFunction) => {
  try { res.status(200).json(await cancelWorkDeclarationService(currentUser(req), req.params.id, req.body)); } catch (error) { next(error); }
};
export const submitWorkDeclarationCompletion = async (req: Request, res: Response, next: NextFunction) => {
  try { res.status(200).json(await submitWorkDeclarationCompletionService(currentUser(req), req.params.id, req.body)); } catch (error) { next(error); }
};
export const confirmWorkDeclarationCompletion = async (req: Request, res: Response, next: NextFunction) => {
  try { res.status(200).json(await confirmWorkDeclarationCompletionService(currentUser(req), req.params.id, req.body)); } catch (error) { next(error); }
};
export const returnWorkDeclarationCompletion = async (req: Request, res: Response, next: NextFunction) => {
  try { res.status(200).json(await returnWorkDeclarationCompletionService(currentUser(req), req.params.id, req.body)); } catch (error) { next(error); }
};
