import { Router } from 'express';
import {
  approveDocumentResultLink,
  createDocumentResultLink,
  forwardDocumentResultLink,
  listDocumentResultLinks,
  resolveDocumentResultLink,
  returnDocumentResultLink,
} from '../controllers/document-result-link.controller';
import { requireAuth } from '../middlewares/auth.middleware';

const router = Router();
router.use(requireAuth);

router.route('/').get(listDocumentResultLinks).post(createDocumentResultLink);
router.get('/resolve', resolveDocumentResultLink);
router.post('/:id/approve', approveDocumentResultLink);
router.post('/:id/return', returnDocumentResultLink);
router.post('/:id/forward', forwardDocumentResultLink);

export default router;
