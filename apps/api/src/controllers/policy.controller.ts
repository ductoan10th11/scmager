import { Request, Response, NextFunction } from 'express'
import { getPrivacyPolicyService } from '../services/policy.service'

export const getPrivacyPolicy = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await getPrivacyPolicyService()
    res.status(200).json(result)
  } catch (err) {
    next(err)
  }
}
