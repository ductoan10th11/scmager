import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.middleware';
import { downloadPerformanceWorkbook, importPerformanceWorkbookFile, performanceOverview } from '../controllers/performance.controller';
import { kpiImportUpload } from '../utils/kpi-import-upload';

const router = Router();

router.use(requireAuth);

router.get('/overview', performanceOverview);
router.get('/download', downloadPerformanceWorkbook);
router.post('/import', kpiImportUpload.single('file'), importPerformanceWorkbookFile);

export default router;
