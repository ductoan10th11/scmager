import { Router } from 'express';
import { chatAssignmentAi, getAssignmentAiSession } from '../controllers/assignment-ai.controller';
import { requireAuth } from '../middlewares/auth.middleware';

const router = Router();
router.use(requireAuth);
router.get('/session', getAssignmentAiSession);
router.post('/chat', chatAssignmentAi);

export default router;
