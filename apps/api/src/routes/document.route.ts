import { Router } from 'express';
import {
  getIngestDocument,
  listIngestDocuments,
  updateIngestDocumentProcessing,
} from '../controllers/document.controller';
import { requireAuth } from '../middlewares/auth.middleware';

const router = Router();

router.use(requireAuth);

router.route('/')
  .get(listIngestDocuments);

router.route('/:id')
  .get(getIngestDocument);

router.patch('/:id/processing', updateIngestDocumentProcessing);

export default router;
