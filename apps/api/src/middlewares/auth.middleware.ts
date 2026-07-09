import { isValidObjectId } from 'mongoose';
import { NextFunction, Request, Response } from 'express';
import { AUTH_COOKIE_NAME, parseCookies } from '../utils/cookie';
import { verifyJwt } from '../utils/jwt';
import { unauthorized } from '../utils/http-error';
import { userRepository } from '../repositories/user.repository';
import { AuthUser } from '../types/auth';

const toAuthUser = (user: any): AuthUser | null => {
  const role = user?.role;
  if (!role) return null;

  const org = user?.organization;
  const dept = user?.department;
  return {
    id: String(user._id),
    email: user.email,
    username: user.username,
    fullName: user.fullName,
    role: {
      id: String(role._id),
      code: role.code,
      name: role.name,
      level: role.level,
    },
    organization: org ? String(org._id ?? org) : null,
    department: dept ? String(dept._id ?? dept) : null,
    status: user.status,
  };
};

export const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = parseCookies(req.headers.cookie)[AUTH_COOKIE_NAME];
    if (!token) {
      next(unauthorized('Authentication cookie is missing.'));
      return;
    }

    const payload = verifyJwt(token);
    if (!payload) {
      next(unauthorized('Authentication session is invalid or expired.'));
      return;
    }
    if (!isValidObjectId(payload.id)) {
      next(unauthorized('Authentication session is invalid or expired.'));
      return;
    }

    const user = await userRepository.findAuthById(payload.id);
    if (!user || user.status !== 'ACTIVE') {
      next(unauthorized('Authentication user is inactive or no longer exists.'));
      return;
    }

    const authUser = toAuthUser(user);
    if (!authUser) {
      next(unauthorized('Authentication user role is invalid.'));
      return;
    }

    (req as any).currentUser = authUser;
    (req as any).currentUserDocument = user;
    next();
  } catch (err) {
    // DB timeout, network error, etc. – do not leak details
    next(unauthorized('Authentication failed due to a server error.'));
  }
};
