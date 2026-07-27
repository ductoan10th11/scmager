import { Router } from 'express';
import {
  extensionOverview,
} from '../controllers/extension.controller';
import { requireAuth } from '../middlewares/auth.middleware';
import { forbidden } from '../utils/http-error';
import { isExtensionEnabledForOrganization } from '../services/extension-launch.service';

const router = Router();

// FR15 stays unavailable. Its Connector-fenced intake path is deliberately
// deferred until the external G2 evidence and reviewed implementation exist.
const extensionGate = (req: any, _res: any, next: any) => {
  const organizationId = String(req.currentUser?.organization ?? '');
  if (!isExtensionEnabledForOrganization(organizationId)) {
    next(forbidden('Extension is disabled pending G2 evidence and Connector-fenced activation.'));
    return;
  }
  next();
};

router.use(requireAuth);
router.use(extensionGate);

router.get('/overview', extensionOverview);

export default router;
