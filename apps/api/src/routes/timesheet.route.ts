import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.middleware';
import {
  getMyTimesheet,
  getDepartmentTimesheets,
  upsertTimesheet,
  addEntry,
  deleteEntry,
  submitTimesheet,
  reviewTimesheet,
} from '../controllers/timesheet.controller';

const router = Router();

router.use(requireAuth);

// ⚠️ /my và /department phải đặt TRƯỚC /:id để Express không match nhầm
router.get('/my', getMyTimesheet);
router.get('/department', getDepartmentTimesheets);

router.post('/', upsertTimesheet);
router.post('/:id/entries', addEntry);
router.delete('/:id/entries/:entryId', deleteEntry);
router.post('/:id/submit', submitTimesheet);
router.post('/:id/review', reviewTimesheet);

export default router;
