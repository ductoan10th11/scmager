import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.middleware';
import { downloadOverdueOfficeDocumentReportWorkbook, getOverdueOfficeDocumentReport } from '../controllers/office-document-report.controller';

const router = Router();

router.use(requireAuth);

router.get('/overdue', getOverdueOfficeDocumentReport);
router.get('/overdue/export', downloadOverdueOfficeDocumentReportWorkbook);

export default router;
