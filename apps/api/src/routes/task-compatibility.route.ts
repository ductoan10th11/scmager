import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.middleware';
import { listCompatibilityTasks } from '../controllers/task-compatibility.controller';

const router = Router();
router.use(requireAuth);
router.get('/', listCompatibilityTasks);

export default router;
