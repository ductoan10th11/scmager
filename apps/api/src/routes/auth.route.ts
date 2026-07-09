import { Router } from 'express';
import { login, logout, me } from '../controllers/auth.controller';
import { requireAuth } from '../middlewares/auth.middleware';

const router = Router();

router.route('/me')
  .get(requireAuth, me)
  .post(login)
  .delete(logout);

export default router;
