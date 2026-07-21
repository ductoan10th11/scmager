import { Router } from 'express';
import {
  extensionOverview,
  lookupExtensionIncomingDocumentPoint,
  receiveExtensionIncomingDocuments,
  receiveExtensionOutgoingDocument,
} from '../controllers/extension.controller';
import { requireAuth } from '../middlewares/auth.middleware';

const router = Router();

router.get('/incoming-documents/lookup', lookupExtensionIncomingDocumentPoint);

router.use(requireAuth);

router.get('/overview', extensionOverview);
router.post('/incoming-documents', receiveExtensionIncomingDocuments);
router.post('/outgoing-documents', receiveExtensionOutgoingDocument);

export default router;
