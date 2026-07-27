import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.middleware';
import {
  approveWorkDeclaration,
  approveWorkDeclarationPointAdjustment,
  cancelWorkDeclaration,
  cancelWorkDeclarationPointAdjustment,
  confirmWorkDeclarationCompletion,
  createWorkDeclaration,
  forwardWorkDeclaration,
  forwardWorkDeclarationPointAdjustment,
  getWorkDeclaration,
  listAssignmentParticipants,
  listWorkDeclarations,
  returnWorkDeclaration,
  rejectWorkDeclarationPointAdjustment,
  requestWorkDeclarationPointAdjustment,
  returnWorkDeclarationCompletion,
  rescheduleWorkDeclaration,
  submitWorkDeclaration,
  submitWorkDeclarationCompletion,
  updateWorkDeclaration,
} from '../controllers/work-declaration.controller';

const router = Router();
router.use(requireAuth);

router.route('/').get(listWorkDeclarations).post(createWorkDeclaration);
router.get('/participants', listAssignmentParticipants);
router.route('/:id').get(getWorkDeclaration).patch(updateWorkDeclaration);
router.patch('/:id/schedule', rescheduleWorkDeclaration);
router.post('/:id/submit', submitWorkDeclaration);
router.post('/:id/approve', approveWorkDeclaration);
router.post('/:id/point-adjustment/request', requestWorkDeclarationPointAdjustment);
router.post('/:id/point-adjustment/approve', approveWorkDeclarationPointAdjustment);
router.post('/:id/point-adjustment/reject', rejectWorkDeclarationPointAdjustment);
router.post('/:id/point-adjustment/forward', forwardWorkDeclarationPointAdjustment);
router.post('/:id/point-adjustment/cancel', cancelWorkDeclarationPointAdjustment);
router.post('/:id/return', returnWorkDeclaration);
router.post('/:id/forward', forwardWorkDeclaration);
router.post('/:id/cancel', cancelWorkDeclaration);
router.post('/:id/completion/submit', submitWorkDeclarationCompletion);
router.post('/:id/completion/confirm', confirmWorkDeclarationCompletion);
router.post('/:id/completion/return', returnWorkDeclarationCompletion);

export default router;
