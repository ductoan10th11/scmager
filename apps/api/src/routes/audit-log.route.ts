import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.middleware';
import {
  listAuditLogs,
  listAuditLogsForEntity,
} from '../controllers/audit-log.controller';

const router = Router();

router.use(requireAuth);

router.get('/', listAuditLogs);
router.get('/entity/:entityModel/:entityId', listAuditLogsForEntity);

export default router;
