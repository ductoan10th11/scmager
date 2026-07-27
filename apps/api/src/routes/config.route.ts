import { Router } from 'express';
import { getAdminConfig, getAdminExtensionVersion, updateAdminConfig, updateAdminExtensionVersion } from '../controllers/config.controller';
import { requireAuth } from '../middlewares/auth.middleware';

const router = Router();
router.use(requireAuth);
router.get('/extension-version', getAdminExtensionVersion);
router.put('/extension-version', updateAdminExtensionVersion);
router.route('/:key').get(getAdminConfig).put(updateAdminConfig);

export default router;
