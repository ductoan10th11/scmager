import { Router } from 'express';
import { chatAssignmentAi } from '../controllers/assignment-ai.controller';
import { requireAuth } from '../middlewares/auth.middleware';

const router = Router();
router.use(requireAuth);
router.post('/chat', chatAssignmentAi);

export default router;
