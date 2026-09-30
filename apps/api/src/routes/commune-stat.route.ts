import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../middlewares/auth.middleware';
import {
  getCommuneOverview,
  listCommuneReports,
  getCommuneReportDetail,
  extractCommuneReport,
  commitCommuneReport,
  toggleCommuneMetricStatus,
  createCommuneMetric,
  syncEworkMetrics,
  downloadCommuneReport,
  deleteCommuneReport,
} from '../controllers/commune-stat.controller';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB limit
});

// Toàn bộ API commune-stats yêu cầu đăng nhập
router.use(requireAuth);

router.get('/overview', getCommuneOverview);
router.get('/reports', listCommuneReports);
router.get('/reports/:id', getCommuneReportDetail);
router.delete('/reports/:id', deleteCommuneReport);
router.get('/reports/:id/download', downloadCommuneReport);
router.post('/extract', upload.single('file'), extractCommuneReport);
router.post('/commit', commitCommuneReport);
router.patch('/metrics/:id/status', toggleCommuneMetricStatus);
router.post('/metrics', createCommuneMetric);
router.post('/sync-ework', syncEworkMetrics);

export default router;
