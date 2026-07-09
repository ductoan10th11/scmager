import { Router } from 'express';
import {
  createDepartment,
  deleteDepartment,
  getDepartmentById,
  listDepartments,
  updateDepartment,
} from '../controllers/department.controller';
import { requireAuth } from '../middlewares/auth.middleware';

const router = Router({ mergeParams: true });

router.use(requireAuth);

router.route('/')
  .get(listDepartments)
  .post(createDepartment);

router.route('/:id')
  .get(getDepartmentById)
  .put(updateDepartment)
  .patch(updateDepartment)
  .delete(deleteDepartment);

export default router;
