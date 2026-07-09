import { isValidObjectId } from 'mongoose';
import { ROLE_CODES, USER_STATUSES } from '../models/enums';
import { roleRepository } from '../repositories/role.repository';
import { userRepository } from '../repositories/user.repository';
import { AuthUser } from '../types/auth';
import { badRequest, conflict, forbidden, notFound } from '../utils/http-error';
import { hashPassword } from '../utils/password';

type RoleCode = (typeof ROLE_CODES)[number];
type UserStatus = (typeof USER_STATUSES)[number];

export type ListUsersQuery = {
  page?: unknown;
  limit?: unknown;
  search?: unknown;
  status?: unknown;
  role?: unknown;
  roleCode?: unknown;
  organization?: unknown;
  department?: unknown;
  departmentId?: unknown;
};

export type CreateUserPayload = {
  username?: unknown;
  fullName?: unknown;
  email?: unknown;
  password?: unknown;
  phone?: unknown;
  avatarUrl?: unknown;
  role?: unknown;
  roleCode?: unknown;
  organization?: unknown;
  department?: unknown;
  manager?: unknown;
  status?: unknown;
  notificationSettings?: unknown;
};

export type UpdateUserPayload = Partial<CreateUserPayload>;

const DEFAULT_ROLES = [
  { code: 'ADMIN', name: 'Quản trị hệ thống', level: 0, permissions: ['*'] },
  { code: 'OFFICE_CHIEF', name: 'Chánh văn phòng', level: 1, permissions: [] },
  { code: 'COMMUNE_LEADER', name: 'Lãnh đạo UBND xã', level: 2, permissions: [] },
  { code: 'DEPARTMENT_LEADER', name: 'Lãnh đạo phòng', level: 3, permissions: [] },
  { code: 'SPECIALIST', name: 'Chuyên viên', level: 4, permissions: [] },
] as const;

const parsePagination = (query: ListUsersQuery) => {
  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
  return { page, limit, skip: (page - 1) * limit };
};

const assertObjectId = (value: unknown, field: string) => {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !isValidObjectId(value)) {
    throw badRequest(`${field} must be a valid ObjectId.`);
  }
  return value;
};

const assertRoleCode = (roleCode: unknown) => {
  if (roleCode === undefined || roleCode === null || roleCode === '') return undefined;
  if (typeof roleCode !== 'string' || !ROLE_CODES.includes(roleCode as RoleCode)) {
    throw badRequest('roleCode is invalid.');
  }
  return roleCode as RoleCode;
};

const assertStatus = (status: unknown) => {
  if (status === undefined || status === null || status === '') return undefined;
  if (typeof status !== 'string' || !USER_STATUSES.includes(status as UserStatus)) {
    throw badRequest('status is invalid.');
  }
  return status as UserStatus;
};

const normalizeText = (value: unknown, field: string, required = false) => {
  if (value === undefined || value === null) {
    if (required) throw badRequest(`${field} is required.`);
    return undefined;
  }

  if (typeof value !== 'string') throw badRequest(`${field} must be a string.`);
  const trimmed = value.trim();
  if (required && !trimmed) throw badRequest(`${field} is required.`);

  return trimmed || undefined;
};

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const resolveRole = async (
  payload: { role?: unknown; roleCode?: unknown },
  options?: { allowAdmin?: boolean },
) => {
  const roleId = assertObjectId(payload.role, 'role');
  const roleCode = assertRoleCode(payload.roleCode);

  let role = null;
  if (roleId) {
    role = await roleRepository.findById(roleId);
  } else if (roleCode) {
    role = await roleRepository.findByCode(roleCode);
  } else {
    role = await roleRepository.findByCode('SPECIALIST');
  }

  if (!role) throw badRequest('role does not exist.');
  if (String((role as any).code) === 'ADMIN' && !options?.allowAdmin) {
    throw conflict('Only the default system admin can use ADMIN role.');
  }

  return role;
};

const isDuplicateKeyError = (error: unknown) => (
  typeof error === 'object'
  && error !== null
  && 'code' in error
  && (error as { code?: number }).code === 11000
);

const getRoleLevel = (user: any) => {
  const level = user?.role?.level;
  if (typeof level !== 'number') throw forbidden('Target user role is invalid.');
  return level;
};

const isSelf = (actor: AuthUser, target: any) => actor.id === String(target._id);

const canManageUser = (actor: AuthUser, target: any) => actor.role.level < getRoleLevel(target);

const ensureCanReadUser = (actor: AuthUser, target: any) => {
  if (isSelf(actor, target) || canManageUser(actor, target)) return;
  throw forbidden('You cannot access this user.');
};

const ensureCanManageUser = (actor: AuthUser, target: any) => {
  if (canManageUser(actor, target)) return;
  throw forbidden('You cannot manage a user with equal or higher role level.');
};

const ensureCanAssignRole = (actor: AuthUser, role: any) => {
  if (String(role.code) === 'ADMIN') {
    throw conflict('Only the default system admin can use ADMIN role.');
  }
  if (actor.role.level >= Number(role.level)) {
    throw forbidden('You cannot assign a role with equal or higher level than your role.');
  }
};

const ensureOwnUpdatePayload = (payload: UpdateUserPayload) => {
  const allowed = new Set(['fullName', 'password']);
  const invalidFields = Object.keys(payload).filter((key) => !allowed.has(key));
  if (invalidFields.length > 0) {
    throw forbidden('You can only update your own fullName and password.');
  }
};

const toSafeRole = (role: any) => {
  if (!role) return null;
  return {
    _id: String(role._id),
    code: role.code,
    name: role.name,
    level: role.level,
  };
};

const toSafeUser = (user: any) => {
  if (!user) return null;
  const raw = typeof user.toObject === 'function' ? user.toObject() : user;

  return {
    _id: String(raw._id),
    username: raw.username,
    fullName: raw.fullName,
    email: raw.email,
    phone: raw.phone,
    avatarUrl: raw.avatarUrl,
    role: toSafeRole(raw.role),
    organization: raw.organization ?? null,
    department: raw.department ?? null,
    manager: raw.manager ?? null,
    status: raw.status,
    notificationSettings: raw.notificationSettings,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
};

const sanitizeUsers = (users: any[]) => users.map(toSafeUser).filter(Boolean);

export const userService = {
  async listUsers(actor: AuthUser, query: ListUsersQuery) {
    const { page, limit, skip } = parsePagination(query);
    const status = assertStatus(query.status);
    const roleId = (typeof query.role === 'string' && isValidObjectId(query.role))
      ? assertObjectId(query.role, 'role')
      : undefined;
    const roleCode = !roleId
      ? assertRoleCode(query.roleCode ?? query.role)
      : undefined;
    const organization = assertObjectId(query.organization, 'organization');
    const department = assertObjectId(query.department ?? query.departmentId, 'department');
    const search = normalizeText(query.search, 'search');

    const filter: Record<string, unknown> = {};

    if (status) filter.status = status;
    if (roleId) filter.role = roleId;
    if (roleCode) {
      const role = await roleRepository.findByCode(roleCode);
      if (!role) throw badRequest('roleCode is invalid.');
      filter.role = (role as any)._id;
    }
    if (organization) filter.organization = organization;
    if (department) filter.department = department;
    if (search) {
      const regex = new RegExp(escapeRegex(search), 'i');
      filter.$or = [{ username: regex }, { fullName: regex }, { email: regex }, { phone: regex }];
    }

    const [items, total] = await Promise.all([
      userRepository.findMany(filter, skip, limit),
      userRepository.count(filter),
    ]);
    const visibleItems = actor.role.level === 0
      ? items
      : items.filter((item: any) => isSelf(actor, item) || canManageUser(actor, item));
    const data = sanitizeUsers(visibleItems);

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  },

  async getUserById(actor: AuthUser, id: unknown) {
    const userId = assertObjectId(id, 'id');
    const user = await userRepository.findPublicById(userId as string);
    if (!user) throw notFound('User not found.');
    ensureCanReadUser(actor, user);

    return { data: toSafeUser(user) };
  },

  async createUser(actor: AuthUser, payload: CreateUserPayload) {
    const role = await resolveRole(payload);
    ensureCanAssignRole(actor, role);
    const username = normalizeText(payload.username, 'username', true)?.toLowerCase();
    const fullName = normalizeText(payload.fullName, 'fullName', true);
    const email = normalizeText(payload.email, 'email', true)?.toLowerCase();
    const password = normalizeText(payload.password, 'password', true);
    const status = assertStatus(payload.status) || 'ACTIVE';

    try {
      const user = await userRepository.create({
        username,
        fullName,
        email,
        phone: normalizeText(payload.phone, 'phone'),
        passwordHash: hashPassword(password as string),
        avatarUrl: normalizeText(payload.avatarUrl, 'avatarUrl'),
        role: (role as any)._id,
        organization: assertObjectId(payload.organization, 'organization') || null,
        department: assertObjectId(payload.department, 'department') || null,
        manager: assertObjectId(payload.manager, 'manager') || null,
        status,
        notificationSettings: payload.notificationSettings,
      });

      const created = await userRepository.findPublicById(String((user as any)._id));
      return { data: toSafeUser(created) };
    } catch (error) {
      if (isDuplicateKeyError(error)) throw conflict('username or email already exists.');
      throw error;
    }
  },

  async updateUser(actor: AuthUser, id: unknown, payload: UpdateUserPayload) {
    const userId = assertObjectId(id, 'id');
    const user = await userRepository.findByIdWithPassword(userId as string);
    if (!user) throw notFound('User not found.');
    const updatingSelf = isSelf(actor, user);

    if (updatingSelf) {
      ensureOwnUpdatePayload(payload);
    } else {
      ensureCanManageUser(actor, user);
    }

    if (payload.role !== undefined || payload.roleCode !== undefined) {
      const role = await resolveRole(payload);
      ensureCanAssignRole(actor, role);
      (user as any).role = (role as any)._id;
    }

    const username = normalizeText(payload.username, 'username');
    if (username) {
      if ((user as any).isSystemAdmin && username.toLowerCase() !== (user as any).username) {
        throw conflict('System admin username cannot be changed.');
      }
      (user as any).username = username.toLowerCase();
    }

    const fullName = normalizeText(payload.fullName, 'fullName');
    if (fullName) (user as any).fullName = fullName;

    const email = normalizeText(payload.email, 'email');
    if (email) (user as any).email = email.toLowerCase();

    const phone = normalizeText(payload.phone, 'phone');
    if (payload.phone !== undefined) (user as any).phone = phone;

    const avatarUrl = normalizeText(payload.avatarUrl, 'avatarUrl');
    if (payload.avatarUrl !== undefined) (user as any).avatarUrl = avatarUrl;

    const status = assertStatus(payload.status);
    if (status) {
      if ((user as any).isSystemAdmin && status !== 'ACTIVE') {
        throw conflict('System admin cannot be deactivated.');
      }
      (user as any).status = status;
    }

    if (payload.organization !== undefined) {
      (user as any).organization = assertObjectId(payload.organization, 'organization') || null;
    }
    if (payload.department !== undefined) {
      (user as any).department = assertObjectId(payload.department, 'department') || null;
    }
    if (payload.manager !== undefined) {
      (user as any).manager = assertObjectId(payload.manager, 'manager') || null;
    }
    if (payload.password !== undefined) {
      const password = normalizeText(payload.password, 'password', true);
      (user as any).passwordHash = hashPassword(password as string);
    }
    if (payload.notificationSettings !== undefined) {
      (user as any).notificationSettings = payload.notificationSettings;
    }

    try {
      await userRepository.save(user);
    } catch (error) {
      if (isDuplicateKeyError(error)) throw conflict('username or email already exists.');
      throw error;
    }

    const updated = await userRepository.findPublicById(String((user as any)._id));
    return { data: toSafeUser(updated) };
  },

  async deleteUser(actor: AuthUser, id: unknown) {
    const userId = assertObjectId(id, 'id');
    const user = await userRepository.findByIdWithPassword(userId as string);
    if (!user) throw notFound('User not found.');
    if ((user as any).isSystemAdmin) throw conflict('System admin cannot be deleted.');
    if (isSelf(actor, user)) throw conflict('You cannot delete your own account.');
    ensureCanManageUser(actor, user);

    await userRepository.deleteById(userId as string);
  },

  async ensureDefaultAdmin() {
    await roleRepository.upsertDefaults(DEFAULT_ROLES);

    const adminRole = await roleRepository.findByCode('ADMIN');
    if (!adminRole) {
      throw new Error('Cannot seed default admin because ADMIN role was not created.');
    }

    const username = (process.env.DEFAULT_ADMIN_USERNAME || 'admin').toLowerCase();
    const password = process.env.DEFAULT_ADMIN_PASSWORD || '0';
    const email = process.env.DEFAULT_ADMIN_EMAIL || 'admin@scmager.local';

    const existingAdmin = await userRepository.findByUsernameWithPassword(username);

    if (!existingAdmin) {
      await userRepository.create({
        username,
        fullName: 'System Admin',
        email,
        passwordHash: hashPassword(password),
        role: (adminRole as any)._id,
        status: 'ACTIVE',
        isSystemAdmin: true,
      });
      return;
    }

    (existingAdmin as any).role = (adminRole as any)._id;
    (existingAdmin as any).status = 'ACTIVE';
    (existingAdmin as any).isSystemAdmin = true;

    if (!(existingAdmin as any).passwordHash) {
      (existingAdmin as any).passwordHash = hashPassword(password);
    }

    await userRepository.save(existingAdmin);
  },
};
