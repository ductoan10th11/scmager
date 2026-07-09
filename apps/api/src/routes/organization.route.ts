import { Router } from 'express';
import {
  createOrganization,
  deleteOrganization,
  getOrganizationById,
  listOrganizations,
  updateOrganization,
} from '../controllers/organization.controller';
import { requireAuth } from '../middlewares/auth.middleware';

const router = Router();

router.use(requireAuth);

router.route('/')
  .get(listOrganizations)
  .post(createOrganization);

router.route('/:id')
  .get(getOrganizationById)
  .put(updateOrganization)
  .patch(updateOrganization)
  .delete(deleteOrganization);

export default router;
