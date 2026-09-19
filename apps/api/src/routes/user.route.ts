import { Router } from 'express';
import {
  changePassword,
  createUser,
  deleteUser,
  getUserById,
  listUsers,
  updateUser,
} from '../controllers/user.controller';
import { requireAuth } from '../middlewares/auth.middleware';

const router = Router();

router.use(requireAuth);

router.put('/:id/password', changePassword);

router.route('/')
  .get(listUsers)
  .post(createUser);

router.route('/:id')
  .get(getUserById)
  .put(updateUser)
  .patch(updateUser)
  .delete(deleteUser);

export default router;
