import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.middleware';
import { upload } from '../utils/upload';
import {
  listDocuments,
  getDocumentById,
  createDocument,
  updateDocument,
  assignDepartment,
  assignUser,
  completeDocument,
  uploadAttachments,
  uploadDecisionAttachments,
  uploadWorkAttachments,
  deleteAttachment,
} from '../controllers/incoming-document.controller';

const router = Router();

router.use(requireAuth);

router.route('/')
  .get(listDocuments)
  .post(createDocument);

router.route('/:id')
  .get(getDocumentById)
  .patch(updateDocument);

router.post('/:id/assign-department', assignDepartment);
router.post('/:id/assign-user', assignUser);
router.post('/:id/complete', completeDocument);
router.post('/:id/attachments/decision', upload.array('files', 10), uploadDecisionAttachments);
router.post('/:id/attachments/work', upload.array('files', 10), uploadWorkAttachments);
router.post('/:id/attachments', upload.array('files', 10), uploadAttachments);
router.delete('/:id/attachments/:attId', deleteAttachment);

export default router;
