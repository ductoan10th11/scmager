import { Router } from 'express';
import {
  getIngestDocument,
  getOutgoingDocument,
  listIngestDocuments,
  listOutgoingDocuments,
  updateIngestDocumentProcessing,
} from '../controllers/document.controller';
import { requireAuth } from '../middlewares/auth.middleware';

const router = Router();

router.use(requireAuth);

router.route('/')
  .get(listIngestDocuments);

router.route('/outgoing')
  .get(listOutgoingDocuments);

router.route('/outgoing/:id')
  .get(getOutgoingDocument);

router.route('/:id')
  .get(getIngestDocument);

router.patch('/:id/processing', updateIngestDocumentProcessing);

export default router;
