import { userRepository } from '../repositories/user.repository';
import { forbidden, unauthorized } from '../utils/http-error';
import { verifyPassword } from '../utils/password';
import { signJwt } from '../utils/jwt';
import { AuthUser } from '../types/auth';

export type LoginPayload = {
  login?: unknown;
  username?: unknown;
  email?: unknown;
  password?: unknown;
  remember?: unknown;
};

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const FOURTEEN_DAYS_MS = 14 * ONE_DAY_MS;

const normalizeText = (value: unknown) => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
};

const getRole = (user: any) => {
  if (!user?.role?._id || !user.role.code || typeof user.role.level !== 'number') return null;
  return {
    _id: String(user.role._id),
    code: user.role.code,
    name: user.role.name,
    level: user.role.level,
  };
};

const toSafeUser = (user: any) => {
  if (!user) return null;
  return {
    _id: String(user._id),
    username: user.username,
    fullName: user.fullName,
    position: user.position ?? null,
    email: user.email,
    phone: user.phone,
    avatarUrl: user.avatarUrl,
    role: getRole(user),
    organization: user.organization ?? null,
    department: user.department ?? null,
    manager: user.manager ?? null,
    status: user.status,
    notificationSettings: user.notificationSettings,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
};

export const authService = {
  async login(payload: LoginPayload) {
    const login = normalizeText(payload.login)
      || normalizeText(payload.username)
      || normalizeText(payload.email);
    const password = normalizeText(payload.password);

    if (!login || !password) {
      throw unauthorized('Invalid username/email or password.');
    }

    const user = await userRepository.findByLoginWithPassword(login.toLowerCase());
    if (!user || !(user as any).passwordHash) {
      throw unauthorized('Invalid username/email or password.');
    }

    const isValidPassword = verifyPassword(password, (user as any).passwordHash);
    if (!isValidPassword) {
      throw unauthorized('Invalid username/email or password.');
    }

    if ((user as any).status !== 'ACTIVE') {
      throw forbidden('User is inactive.');
    }
    if (!getRole(user)) {
      throw forbidden('User role is invalid.');
    }

    const maxAgeMs = payload.remember ? FOURTEEN_DAYS_MS : ONE_DAY_MS;
    const exp = Math.floor((Date.now() + maxAgeMs) / 1000);
    const token = signJwt({
      id: String((user as any)._id),
      email: (user as any).email,
      exp,
    });

    return {
      token,
      maxAgeMs,
      data: {
        user: toSafeUser(user),
        expiresAt: new Date(exp * 1000).toISOString(),
      },
    };
  },

  async me(currentUser: AuthUser, currentUserDocument?: any) {
    const user = currentUserDocument || {
      _id: currentUser.id,
      username: currentUser.username,
      fullName: currentUser.fullName,
      position: currentUser.position ?? null,
      email: currentUser.email,
      role: {
        _id: currentUser.role.id,
        code: currentUser.role.code,
        name: currentUser.role.name,
        level: currentUser.role.level,
      },
      status: currentUser.status,
    };

    return {
      data: {
        authenticated: true,
        user: toSafeUser(user),
      },
    };
  },
};
