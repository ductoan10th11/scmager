import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.middleware';
import {
  dashboardDeadlines,
  dashboardSummary,
  dashboardWorkload,
} from '../controllers/dashboard.controller';

const router = Router();

router.use(requireAuth);

router.get('/summary', dashboardSummary);
router.get('/workload', dashboardWorkload);
router.get('/deadlines', dashboardDeadlines);

export default router;
