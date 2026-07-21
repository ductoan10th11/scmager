import { Router, Response, Request } from 'express'
import fs from 'fs'
import path from 'path'
import mongoose from 'mongoose'
import userRoutes from './user.route'
import authRoutes from './auth.route'
import organizationRoutes from './organization.route'
import departmentRoutes from './department.route'
import documentRoutes from './document.route'
import ingestCronRoutes from './ingest-cron.route'
import timesheetRoutes from './timesheet.route'
import notificationRoutes from './notification.route'
import auditLogRoutes from './audit-log.route'
import dashboardRoutes from './dashboard.route'
import extensionRoutes from './extension.route'
import workDeclarationRoutes from './work-declaration.route'
import taskCompatibilityRoutes from './task-compatibility.route'
import reportRoutes from './report.route'
import assignmentAiRoutes from './assignment-ai.route'
import performanceRoutes from './performance.route'
import policyRoutes from './policy.route'

const router = Router()

router.route('/ping')
  .get((req: Request, res: Response) => {
    const uploadDirectory = path.resolve(process.cwd(), process.env.UPLOAD_DIR ?? 'uploads')
    let uploadWritable = false
    try {
      fs.accessSync(uploadDirectory, fs.constants.R_OK | fs.constants.W_OK)
      uploadWritable = true
    } catch {
      uploadWritable = false
    }
    const mongoConnected = mongoose.connection.readyState === 1
    const healthy = mongoConnected && uploadWritable
    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'ok' : 'degraded',
      checks: {
        api: true,
        mongo: mongoConnected,
        uploadDirectory: uploadWritable,
      },
      timestamp: new Date().toISOString(),
    })
  })

router.use('/auth', authRoutes)
router.use('/users', userRoutes)
router.use('/organizations/:organizationId/departments', departmentRoutes)
router.use('/organizations', organizationRoutes)
router.use('/departments', departmentRoutes)
router.use('/ingest-documents', documentRoutes)
router.use('/work-declarations', workDeclarationRoutes)
router.use('/tasks', taskCompatibilityRoutes)
router.use('/ingest-cron', ingestCronRoutes)
router.use('/timesheets', timesheetRoutes)
router.use('/notifications', notificationRoutes)
router.use('/audit-logs', auditLogRoutes)
router.use('/dashboard', dashboardRoutes)
router.use('/extension', extensionRoutes)
router.use('/reports', reportRoutes)
router.use('/assignment-ai', assignmentAiRoutes)
router.use('/performance', performanceRoutes)
router.use('/policy', policyRoutes)
export default router
