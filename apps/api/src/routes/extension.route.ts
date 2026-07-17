import { Router } from 'express';
import { extensionOverview } from '../controllers/extension.controller';
import { requireAuth } from '../middlewares/auth.middleware';

const router = Router();

router.use(requireAuth);

router.get('/overview', extensionOverview);

export default router;
