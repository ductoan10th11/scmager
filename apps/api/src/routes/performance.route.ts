import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.middleware';
import { downloadPerformanceImportTemplate, downloadPerformanceWorkbook, importPerformanceWorkbookFile, performanceOverview, previewPerformanceWorkbookFile } from '../controllers/performance.controller';
import { listLeadershipAssessments, upsertLeadershipAssessment } from '../controllers/leadership-assessment.controller';
import { kpiImportUpload } from '../utils/kpi-import-upload';

const router = Router();

router.use(requireAuth);

router.get('/overview', performanceOverview);
router.get('/download', downloadPerformanceWorkbook);
router.get('/import-template', downloadPerformanceImportTemplate);
router.post('/import/preview', kpiImportUpload.single('file'), previewPerformanceWorkbookFile);
router.post('/import', kpiImportUpload.single('file'), importPerformanceWorkbookFile);
router.route('/leadership-assessments')
  .get(listLeadershipAssessments)
  .post(upsertLeadershipAssessment);

export default router;
