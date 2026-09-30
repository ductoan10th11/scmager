import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.middleware';
import {
  downloadLateAssignmentReportWorkbook,
  downloadOverdueOfficeDocumentReportWorkbook,
  getLateAssignmentReport,
  getOverdueOfficeDocumentReport,
} from '../controllers/office-document-report.controller';

const router = Router();

router.use(requireAuth);

router.get('/overdue', getOverdueOfficeDocumentReport);
router.get('/overdue/export', downloadOverdueOfficeDocumentReportWorkbook);
router.get('/late-assignments', getLateAssignmentReport);
router.get('/late-assignments/export', downloadLateAssignmentReportWorkbook);

export default router;
