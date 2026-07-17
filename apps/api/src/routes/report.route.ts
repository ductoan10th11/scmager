import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.middleware';
import {
  departmentProgressReport,
  documentsCsv,
  documentsReport,
  tasksCsv,
  tasksReport,
} from '../controllers/report.controller';

const router = Router();

router.use(requireAuth);

router.get('/documents', documentsReport);
router.get('/tasks', tasksReport);
router.get('/departments/:departmentId/progress', departmentProgressReport);
router.get('/documents.csv', documentsCsv);
router.get('/tasks.csv', tasksCsv);

export default router;
