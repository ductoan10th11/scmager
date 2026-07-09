import { Router, Response, Request } from 'express'
import userRoutes from './user.route'
import authRoutes from './auth.route'
import organizationRoutes from './organization.route'
import departmentRoutes from './department.route'
import incomingDocumentRoutes from './incoming-document.route'
import taskRoutes from './task.route'
import timesheetRoutes from './timesheet.route'

const router = Router()

router.route('/ping')
  .get((req: Request, res: Response) => {
    res.status(200).json({ message: 'pong' })
  })

router.use('/auth', authRoutes)
router.use('/users', userRoutes)
router.use('/organizations/:organizationId/departments', departmentRoutes)
router.use('/organizations', organizationRoutes)
router.use('/departments', departmentRoutes)
router.use('/incoming-documents', incomingDocumentRoutes)
router.use('/tasks', taskRoutes)
router.use('/timesheets', timesheetRoutes)

export default router
