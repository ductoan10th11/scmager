import { isValidObjectId } from 'mongoose';
import { ORGANIZATION_TYPES } from '../models/enums';
import { organizationRepository } from '../repositories/organization.repository';
import { AuthUser } from '../types/auth';
import { badRequest, conflict, forbidden, notFound } from '../utils/http-error';
import { AuditLogModel } from '../models/audit-log.model';
import DepartmentModel from '../models/department.model';
import UserModel from '../models/user.model';

type OrganizationType = (typeof ORGANIZATION_TYPES)[number];

export type ListOrganizationsQuery = {
  page?: unknown;
  limit?: unknown;
  search?: unknown;
  type?: unknown;
  parent?: unknown;
  isActive?: unknown;
};

export type CreateOrganizationPayload = {
  name?: unknown;
  code?: unknown;
  type?: unknown;
  parent?: unknown;
  address?: unknown;
  isActive?: unknown;
};

export type UpdateOrganizationPayload = Partial<CreateOrganizationPayload>;

const parsePagination = (query: ListOrganizationsQuery) => {
  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
  return { page, limit, skip: (page - 1) * limit };
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

const assertObjectId = (value: unknown, field: string) => {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !isValidObjectId(value)) {
    throw badRequest(`${field} must be a valid ObjectId.`);
  }
  return value;
};

const assertOrganizationType = (type: unknown) => {
  if (type === undefined || type === null || type === '') return undefined;
  if (typeof type !== 'string' || !ORGANIZATION_TYPES.includes(type as OrganizationType)) {
    throw badRequest('type is invalid.');
  }
  return type as OrganizationType;
};

const assertBoolean = (value: unknown, field: string) => {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw badRequest(`${field} must be a boolean.`);
};

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const isDuplicateKeyError = (error: unknown) => (
  typeof error === 'object'
  && error !== null
  && 'code' in error
  && (error as { code?: number }).code === 11000
);

const ensureCanManageOrganizations = (actor: AuthUser) => {
  // Organization topology is a platform boundary. Tenant administrators may
  // manage users/departments inside their tenant but cannot alter its identity.
  if (actor.role.code === 'ADMIN' && !actor.organization) return;
  throw forbidden('You cannot manage organizations.');
};

const writeOrganizationAudit = async (actor: AuthUser, action: string, organization: any, metadata: Record<string, unknown> = {}) => {
  await AuditLogModel.create({
    actor: actor.id,
    action,
    entityModel: 'Organization',
    entityId: organization._id,
    organization: organization._id,
    metadata,
  });
};

const toSafeOrganization = (organization: any) => {
  if (!organization) return null;
  const raw = typeof organization.toObject === 'function' ? organization.toObject() : organization;

  return {
    _id: String(raw._id),
    name: raw.name,
    code: raw.code,
    type: raw.type,
    parent: raw.parent
      ? {
        _id: String(raw.parent._id),
        name: raw.parent.name,
        code: raw.parent.code,
        type: raw.parent.type,
        isActive: raw.parent.isActive,
      }
      : null,
    address: raw.address,
    isActive: raw.isActive,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
};

const resolveParent = async (parent: unknown, targetId?: string) => {
  const parentId = assertObjectId(parent, 'parent');
  if (!parentId) return null;
  if (targetId && parentId === targetId) throw conflict('Organization cannot be its own parent.');

  const parentOrganization = await organizationRepository.findRawById(parentId);
  if (!parentOrganization) throw badRequest('parent does not exist.');

  return parentId;
};

export const organizationService = {
  async listOrganizations(actor: AuthUser, query: ListOrganizationsQuery) {
    const { page, limit, skip } = parsePagination(query);
    const type = assertOrganizationType(query.type);
    const parent = assertObjectId(query.parent, 'parent');
    const isActive = assertBoolean(query.isActive, 'isActive');
    const search = normalizeText(query.search, 'search');

    const filter: Record<string, unknown> = {};

    // Non-admin: scope to own org only
    if (actor.role.level > 0) {
      if (!actor.organization) return { data: [], meta: { page, limit, total: 0, totalPages: 0 } };
      filter._id = actor.organization;
    } else {
      if (type) filter.type = type;
      if (parent) filter.parent = parent;
      if (isActive !== undefined) filter.isActive = isActive;
      if (search) {
        const regex = new RegExp(escapeRegex(search), 'i');
        filter.$or = [{ name: regex }, { code: regex }, { address: regex }];
      }
    }

    const [items, total] = await Promise.all([
      organizationRepository.findMany(filter, skip, limit),
      organizationRepository.count(filter),
    ]);

    return {
      data: items.map(toSafeOrganization).filter(Boolean),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  },

  async getOrganizationById(actor: AuthUser, id: unknown) {
    const organizationId = assertObjectId(id, 'id');
    // Non-admin can only view their own org
    if (actor.role.level > 0 && actor.organization !== organizationId) {
      throw forbidden('You can only view your own organization.');
    }
    const organization = await organizationRepository.findById(organizationId as string);
    if (!organization) throw notFound('Organization not found.');
    return { data: toSafeOrganization(organization) };
  },

  async createOrganization(actor: AuthUser, payload: CreateOrganizationPayload) {
    ensureCanManageOrganizations(actor);

    const name = normalizeText(payload.name, 'name', true);
    const code = normalizeText(payload.code, 'code', true)?.toUpperCase();
    const type = assertOrganizationType(payload.type);
    if (!type) throw badRequest('type is required.');

    try {
      const organization = await organizationRepository.create({
        name,
        code,
        type,
        parent: await resolveParent(payload.parent),
        address: normalizeText(payload.address, 'address'),
        isActive: assertBoolean(payload.isActive, 'isActive') ?? true,
      });
      await writeOrganizationAudit(actor, 'ORGANIZATION_CREATED', organization, { type });
      const created = await organizationRepository.findById(String((organization as any)._id));
      return { data: toSafeOrganization(created) };
    } catch (error) {
      if (isDuplicateKeyError(error)) throw conflict('Organization code already exists under this parent.');
      throw error;
    }
  },

  async updateOrganization(actor: AuthUser, id: unknown, payload: UpdateOrganizationPayload) {
    const organizationId = assertObjectId(id, 'id');
    ensureCanManageOrganizations(actor);

    const organization = await organizationRepository.findRawById(organizationId as string);
    if (!organization) throw notFound('Organization not found.');

    const name = normalizeText(payload.name, 'name');
    if (name) (organization as any).name = name;

    const code = normalizeText(payload.code, 'code');
    if (code) (organization as any).code = code.toUpperCase();

    const type = assertOrganizationType(payload.type);
    if (type) (organization as any).type = type;

    if (payload.parent !== undefined) {
      (organization as any).parent = await resolveParent(payload.parent, organizationId as string);
    }

    if (payload.address !== undefined) {
      (organization as any).address = normalizeText(payload.address, 'address');
    }

    const isActive = assertBoolean(payload.isActive, 'isActive');
    if (isActive !== undefined) (organization as any).isActive = isActive;

    if (isActive === false && (organization as any).isActive === false) {
      const [activeDepartments, activeUsers] = await Promise.all([
        DepartmentModel.exists({ organization: organizationId, isActive: true }),
        UserModel.exists({ organization: organizationId, status: 'ACTIVE' }),
      ]);
      if (activeDepartments || activeUsers) {
        throw conflict('Deactivate child departments and active users before deactivating an organization.');
      }
    }

    try {
      await organizationRepository.save(organization);
    } catch (error) {
      if (isDuplicateKeyError(error)) throw conflict('Organization code already exists under this parent.');
      throw error;
    }
    await writeOrganizationAudit(actor, 'ORGANIZATION_UPDATED', organization, { fields: Object.keys(payload) });

    const updated = await organizationRepository.findById(String((organization as any)._id));
    return { data: toSafeOrganization(updated) };
  },

  async deleteOrganization(actor: AuthUser, id: unknown) {
    ensureCanManageOrganizations(actor);

    const organizationId = assertObjectId(id, 'id');
    const organization = await organizationRepository.findRawById(organizationId as string);
    if (!organization) throw notFound('Organization not found.');

    const [activeDepartments, activeUsers] = await Promise.all([
      DepartmentModel.exists({ organization: organizationId, isActive: true }),
      UserModel.exists({ organization: organizationId, status: 'ACTIVE' }),
    ]);
    if (activeDepartments || activeUsers) {
      throw conflict('Deactivate child departments and active users before deactivating an organization.');
    }
    (organization as any).isActive = false;
    await organizationRepository.save(organization);
    await writeOrganizationAudit(actor, 'ORGANIZATION_DEACTIVATED', organization);
  },
};
