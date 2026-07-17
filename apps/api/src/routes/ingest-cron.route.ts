import { Router } from 'express';
import {
  clearIngestCronLogs,
  ingestCronLogs,
  ingestCronStatus,
  runIngestCronNow,
  startIngestCron,
  stopIngestCron,
} from '../controllers/ingest-cron.controller';
import { requireAuth } from '../middlewares/auth.middleware';

const router = Router();

router.use(requireAuth);

router.get('/status', ingestCronStatus);
router.get('/logs', ingestCronLogs);
router.post('/start', startIngestCron);
router.post('/stop', stopIngestCron);
router.post('/run-now', runIngestCronNow);
router.post('/clear-logs', clearIngestCronLogs);

export default router;
