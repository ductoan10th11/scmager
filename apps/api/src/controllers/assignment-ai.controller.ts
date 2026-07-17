import { NextFunction, Request, Response } from 'express';
import { streamAssignmentAiChat } from '../services/assignment-ai.service';

const writeEvent = (res: Response, event: string, data: unknown) => {
  if (res.writableEnded) return;
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
};

export const chatAssignmentAi = async (req: Request, res: Response, next: NextFunction) => {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const abortController = new AbortController();
  res.on('close', () => abortController.abort());
  try {
    await streamAssignmentAiChat((req as any).currentUser, req.body ?? {}, {
      signal: abortController.signal,
      delta: (text) => writeEvent(res, 'delta', { text }),
      draft: (draft) => writeEvent(res, 'draft', draft),
      confirmed: (result) => writeEvent(res, 'confirmed', result),
      cancelled: (result) => writeEvent(res, 'cancelled', result),
    });
    writeEvent(res, 'done', {});
    res.end();
  } catch (error: any) {
    if (!res.headersSent) {
      next(error);
      return;
    }
    writeEvent(res, 'error', {
      code: error?.code || 'AI_CHAT_ERROR',
      message: error?.statusCode && error.statusCode < 500
        ? error.message
        : 'Trợ lý AI hiện không phản hồi. Vui lòng thử lại.',
    });
    res.end();
  }
};
