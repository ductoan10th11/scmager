import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.middleware';
import {
  approveWorkDeclaration,
  cancelWorkDeclaration,
  createWorkDeclaration,
  forwardWorkDeclaration,
  getWorkDeclaration,
  listAssignmentParticipants,
  listWorkDeclarations,
  returnWorkDeclaration,
  rescheduleWorkDeclaration,
  submitWorkDeclaration,
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
router.post('/:id/return', returnWorkDeclaration);
router.post('/:id/forward', forwardWorkDeclaration);
router.post('/:id/cancel', cancelWorkDeclaration);

export default router;
