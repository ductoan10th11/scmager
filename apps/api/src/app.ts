import express from 'express'
import cors from 'cors'
import apiRoutes from './routes/api.route'
import { HttpError } from './utils/http-error'

export const app = express()

app.use(cors())
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

app.get('/', (req, res) => {
  res.json({ message: 'eWork Backend API is running!' })
})

app.use('/api', apiRoutes) // nginx strips /api prefix → also mount at root
app.use('/', apiRoutes)

// 404 handler
app.use((req: express.Request, res: express.Response) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found.' } })
})

// Global error handler — must be last and have 4 args
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (res.headersSent) {
    next(err)
    return
  }

  if (err instanceof HttpError) {
    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.details !== undefined ? { details: err.details } : {}),
      },
    })
    return
  }

  if ('code' in err && (err as any).code === 11000) {
    res.status(409).json({ error: { code: 'CONFLICT', message: 'Duplicate value.' } })
    return
  }

  if (err.name === 'ValidationError' || err.name === 'CastError') {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: err.message } })
    return
  }

  console.error('Unhandled API error:', err)
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error.' } })
})

export default app
