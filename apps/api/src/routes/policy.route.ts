import { Router } from 'express'
import { getPrivacyPolicy } from '../controllers/policy.controller'

const router = Router()

router.get('/privacy', getPrivacyPolicy)

export default router
