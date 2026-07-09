import { NextFunction, Request, Response } from 'express';
import { authService } from '../services/auth.service';
import { AUTH_COOKIE_NAME, getAuthCookieOptions } from '../utils/cookie';

export const login = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await authService.login(req.body);
    res.cookie(AUTH_COOKIE_NAME, result.token, getAuthCookieOptions(result.maxAgeMs));
    res.status(200).json({ data: result.data });
  } catch (err) { next(err); }
};

export const logout = async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.clearCookie(AUTH_COOKIE_NAME, getAuthCookieOptions());
    res.status(204).send();
  } catch (err) { next(err); }
};

export const me = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await authService.me((req as any).currentUser, (req as any).currentUserDocument);
    res.status(200).json(result);
  } catch (err) { next(err); }
};
