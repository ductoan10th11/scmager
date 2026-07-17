import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.middleware';
import { performanceOverview } from '../controllers/performance.controller';

const router = Router();

router.use(requireAuth);

router.get('/overview', performanceOverview);

export default router;
