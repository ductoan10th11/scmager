import { Router, Response, Request } from 'express'

const router = Router()

router.route('/ping')
  .get((req: Request, res: Response) => {
    res.status(200).json({ message: 'pong' })
  })

export default router