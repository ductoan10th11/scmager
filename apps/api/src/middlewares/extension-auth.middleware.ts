import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { unauthorized } from '../utils/http-error';

const EWORK_EXT_SECRET_KEY = process.env.EWORK_EXT_SECRET_KEY || 'ework-ext-secret-2026-v1';
const MAX_SIGNATURE_AGE_MS = 5 * 60 * 1000;
const usedNonces = new Map<string, number>();

const cleanupNonces = (now: number) => {
  for (const [nonce, expiresAt] of usedNonces) {
    if (expiresAt <= now) usedNonces.delete(nonce);
  }
};

export const verifyExtensionSignature = (req: Request, _res: Response, next: NextFunction) => {
  const timestamp = (req.headers['x-ework-timestamp'] as string) || '';
  const nonce = (req.headers['x-ework-nonce'] as string) || '';
  const extensionId = (req.headers['x-ework-extension-id'] as string) || '';
  const signature = (req.headers['x-ework-signature'] as string) || '';

  if (!timestamp || !nonce || !extensionId || !signature) {
    next(unauthorized('Missing required extension signature headers.'));
    return;
  }

  const now = Date.now();
  const diff = Math.abs(now - parseInt(timestamp, 10));
  if (isNaN(diff) || diff > MAX_SIGNATURE_AGE_MS) {
    next(unauthorized('Extension request timestamp is out of range or invalid.'));
    return;
  }

  cleanupNonces(now);
  if (usedNonces.has(nonce)) {
    next(unauthorized('Extension request nonce has already been used.'));
    return;
  }

  const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  const dataToSign = `${timestamp}.${nonce}.${rawBody}`;
  const expectedSignature = crypto
    .createHmac('sha256', EWORK_EXT_SECRET_KEY)
    .update(dataToSign)
    .digest('hex');

  const signatureBuffer = Buffer.from(signature, 'hex');
  const expectedBuffer = Buffer.from(expectedSignature, 'hex');
  if (signatureBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
    next(unauthorized('Invalid extension signature.'));
    return;
  }

  usedNonces.set(nonce, now + MAX_SIGNATURE_AGE_MS);
  next();
};
