import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.middleware';
import {
  listTasks, getTaskById, downloadTaskAttachment, downloadTaskSourceAttachment, createDepartmentMeeting, createTask, updateTask,
  assignTask, startTask, submitReview, reviewTask, cancelTask,
} from '../controllers/task.controller';

const router = Router();

router.use(requireAuth);

router.route('/').get(listTasks).post(createTask);
router.post('/meetings', createDepartmentMeeting);
router.route('/:id').get(getTaskById).patch(updateTask);
router.get('/:id/attachments/:attachmentId/download', downloadTaskAttachment);
router.get('/:id/source-attachments/:attachmentId/download', downloadTaskSourceAttachment);
router.post('/:id/assign', assignTask);
router.post('/:id/start', startTask);
router.post('/:id/submit-review', submitReview);
router.post('/:id/review', reviewTask);
router.post('/:id/cancel', cancelTask);

export default router;
