import { isValidObjectId } from 'mongoose';
import { departmentRepository } from '../repositories/department.repository';
import { organizationRepository } from '../repositories/organization.repository';
import { userRepository } from '../repositories/user.repository';
import { AuthUser } from '../types/auth';
import { badRequest, conflict, forbidden, notFound } from '../utils/http-error';

export type ListDepartmentsQuery = {
  page?: unknown;
  limit?: unknown;
  search?: unknown;
  organization?: unknown;
  parent?: unknown;
  leader?: unknown;
  isOffice?: unknown;
  isActive?: unknown;
};

export type DepartmentRouteParams = {
  organizationId?: unknown;
};

export type CreateDepartmentPayload = {
  organization?: unknown;
  parent?: unknown;
  leader?: unknown;
  name?: unknown;
  code?: unknown;
  description?: unknown;
  isOffice?: unknown;
  isActive?: unknown;
};

export type UpdateDepartmentPayload = Partial<CreateDepartmentPayload>;

const parsePagination = (query: ListDepartmentsQuery) => {
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

const assertBoolean = (value: unknown, field: string) => {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw badRequest(`${field} must be a boolean.`);
};

const normalizeSearchText = (value: unknown) => String(value ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/đ/g, 'd')
  .replace(/Đ/g, 'D')
  .toLowerCase();

const matchesDepartmentSearch = (department: any, search: string) => {
  const raw = typeof department?.toObject === 'function' ? department.toObject() : department;
  const haystack = normalizeSearchText([
    raw?.name,
    raw?.code,
    raw?.description,
    raw?.parent?.name,
    raw?.leader?.fullName,
  ].filter(Boolean).join(' '));

  return haystack.includes(normalizeSearchText(search));
};

const isDuplicateKeyError = (error: unknown) => (
  typeof error === 'object'
  && error !== null
  && 'code' in error
  && (error as { code?: number }).code === 11000
);

const objectIdOf = (value: unknown) => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && '_id' in value) {
    return String((value as { _id?: unknown })._id ?? '');
  }
  return String(value);
};

const ensureCanManageDepartments = (actor: AuthUser) => {
  if (actor.role.level <= 1) return;
  throw forbidden('You cannot manage departments.');
};

const toSafeDepartment = (department: any, memberCount = 0) => {
  if (!department) return null;
  const raw = typeof department.toObject === 'function' ? department.toObject() : department;

  return {
    _id: String(raw._id),
    parent: raw.parent
      ? {
        _id: String(raw.parent._id),
        name: raw.parent.name,
        code: raw.parent.code,
        isActive: raw.parent.isActive,
      }
      : null,
    leader: raw.leader
      ? {
        _id: String(raw.leader._id),
        username: raw.leader.username,
        fullName: raw.leader.fullName,
        position: raw.leader.position ?? null,
        email: raw.leader.email,
      }
      : null,
    name: raw.name,
    code: raw.code,
    description: raw.description,
    isOffice: raw.isOffice,
    isActive: raw.isActive,
    memberCount,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
};

const resolveOrganizationId = async (value: unknown, required = true) => {
  const organizationId = assertObjectId(value, 'organization');
  if (!organizationId) {
    if (required) throw badRequest('organization is required.');
    return undefined;
  }

  const organization = await organizationRepository.findRawById(organizationId);
  if (!organization) throw badRequest('organization does not exist.');
  return organizationId;
};

const resolveParentId = async (value: unknown, organizationId: string, targetId?: string) => {
  const parentId = assertObjectId(value, 'parent');
  if (!parentId) return null;
  if (targetId && parentId === targetId) throw conflict('Department cannot be its own parent.');

  const parent = await departmentRepository.findRawById(parentId);
  if (!parent) throw badRequest('parent does not exist.');
  if (String((parent as any).organization) !== organizationId) {
    throw badRequest('parent must belong to the same organization.');
  }

  return parentId;
};

const resolveLeaderId = async (value: unknown, organizationId: string, departmentId: string) => {
  const leaderId = assertObjectId(value, 'leader');
  if (!leaderId) return null;

  const leader = await userRepository.findPublicById(leaderId);
  if (!leader) throw badRequest('leader does not exist.');
  if (objectIdOf((leader as any).organization) !== organizationId) {
    throw badRequest('leader must belong to the same organization.');
  }
  if (objectIdOf((leader as any).department) !== departmentId) {
    throw badRequest('leader must belong to this department.');
  }
  if ((leader as any).status !== 'ACTIVE') {
    throw badRequest('leader must be active.');
  }
  return leaderId;
};

const ensureOrganizationAccess = (actor: AuthUser, organizationId: string) => {
  if (actor.role.code === 'ADMIN') return;
  if (!actor.organization || actor.organization !== organizationId) {
    throw forbidden('Access denied.');
  }
};

const organizationFrom = (params: DepartmentRouteParams, queryOrPayload: { organization?: unknown }) => (
  params.organizationId ?? queryOrPayload.organization
);

const withMemberCounts = async (departments: any[]) => {
  const counts = await userRepository.countByDepartmentIds(
    departments.map((department) => String(department._id)),
  );
  const countByDepartmentId = new Map(counts.map(({ _id, count }) => [String(_id), count]));

  return departments
    .map((department) => toSafeDepartment(department, countByDepartmentId.get(String(department._id)) ?? 0))
    .filter(Boolean);
};

export const departmentService = {
  async listDepartments(actor: AuthUser, params: DepartmentRouteParams, query: ListDepartmentsQuery) {
    const { page, limit, skip } = parsePagination(query);
    const requestedOrganization = await resolveOrganizationId(organizationFrom(params, query), false);
    if (actor.role.code !== 'ADMIN' && !actor.organization) {
      throw forbidden('User has no organization assigned.');
    }
    if (
      actor.role.code !== 'ADMIN'
      && requestedOrganization
      && requestedOrganization !== actor.organization
    ) {
      throw forbidden('Access denied.');
    }
    const organization = actor.role.code === 'ADMIN'
      ? requestedOrganization
      : actor.organization;
    const parent = assertObjectId(query.parent, 'parent');
    const leader = assertObjectId(query.leader, 'leader');
    const isOffice = assertBoolean(query.isOffice, 'isOffice');
    const isActive = assertBoolean(query.isActive, 'isActive');
    const search = normalizeText(query.search, 'search');

    const filter: Record<string, unknown> = {};
    if (organization) filter.organization = organization;
    if (parent) filter.parent = parent;
    if (leader) filter.leader = leader;
    if (isOffice !== undefined) filter.isOffice = isOffice;
    if (isActive !== undefined) filter.isActive = isActive;

    let items;
    let total;
    if (search) {
      const allItems = await departmentRepository.findAll(filter);
      const filteredItems = allItems.filter((item: any) => matchesDepartmentSearch(item, search));
      total = filteredItems.length;
      items = filteredItems.slice(skip, skip + limit);
    } else {
      [items, total] = await Promise.all([
        departmentRepository.findMany(filter, skip, limit),
        departmentRepository.count(filter),
      ]);
    }

    return {
      data: await withMemberCounts(items),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  },

  async getDepartmentById(actor: AuthUser, id: unknown) {
    const departmentId = assertObjectId(id, 'id');
    const department = await departmentRepository.findById(departmentId as string);
    if (!department) throw notFound('Department not found.');
    if (
      actor.role.code !== 'ADMIN'
      && (
        !actor.organization
        || objectIdOf((department as any).organization) !== actor.organization
      )
    ) {
      throw forbidden('Access denied.');
    }
    const [safeDepartment] = await withMemberCounts([department]);
    return { data: safeDepartment };
  },

  async createDepartment(actor: AuthUser, params: DepartmentRouteParams, payload: CreateDepartmentPayload) {
    ensureCanManageDepartments(actor);

    const organizationId = await resolveOrganizationId(organizationFrom(params, payload));
    ensureOrganizationAccess(actor, organizationId as string);
    const name = normalizeText(payload.name, 'name', true);
    const code = normalizeText(payload.code, 'code', true)?.toUpperCase();
    if (assertObjectId(payload.leader, 'leader')) {
      throw badRequest('leader can only be assigned after the department is created.');
    }

    try {
      const department = await departmentRepository.create({
        organization: organizationId,
        parent: await resolveParentId(payload.parent, organizationId as string),
        leader: null,
        name,
        code,
        description: normalizeText(payload.description, 'description'),
        isOffice: assertBoolean(payload.isOffice, 'isOffice') ?? false,
        isActive: assertBoolean(payload.isActive, 'isActive') ?? true,
      });
      const created = await departmentRepository.findById(String((department as any)._id));
      return { data: toSafeDepartment(created) };
    } catch (error) {
      if (isDuplicateKeyError(error)) throw conflict('Department code already exists in this organization.');
      throw error;
    }
  },

  async updateDepartment(actor: AuthUser, id: unknown, payload: UpdateDepartmentPayload) {
    ensureCanManageDepartments(actor);

    const departmentId = assertObjectId(id, 'id');
    const department = await departmentRepository.findRawById(departmentId as string);
    if (!department) throw notFound('Department not found.');
    ensureOrganizationAccess(actor, String((department as any).organization));

    let organizationId = String((department as any).organization);
    if (payload.organization !== undefined) {
      organizationId = await resolveOrganizationId(payload.organization) as string;
      ensureOrganizationAccess(actor, organizationId);
      (department as any).organization = organizationId;
    }

    if (payload.parent !== undefined) {
      (department as any).parent = await resolveParentId(payload.parent, organizationId, departmentId as string);
    }
    if (payload.leader !== undefined) {
      (department as any).leader = await resolveLeaderId(payload.leader, organizationId, departmentId as string);
    }

    const name = normalizeText(payload.name, 'name');
    if (name) (department as any).name = name;

    const code = normalizeText(payload.code, 'code');
    if (code) (department as any).code = code.toUpperCase();

    if (payload.description !== undefined) {
      (department as any).description = normalizeText(payload.description, 'description');
    }

    const isOffice = assertBoolean(payload.isOffice, 'isOffice');
    if (isOffice !== undefined) (department as any).isOffice = isOffice;

    const isActive = assertBoolean(payload.isActive, 'isActive');
    if (isActive !== undefined) (department as any).isActive = isActive;

    try {
      await departmentRepository.save(department);
    } catch (error) {
      if (isDuplicateKeyError(error)) throw conflict('Department code already exists in this organization.');
      throw error;
    }

    const updated = await departmentRepository.findById(String((department as any)._id));
    return { data: toSafeDepartment(updated) };
  },

  async deleteDepartment(actor: AuthUser, id: unknown) {
    ensureCanManageDepartments(actor);

    const departmentId = assertObjectId(id, 'id');
    const department = await departmentRepository.findRawById(departmentId as string);
    if (!department) throw notFound('Department not found.');
    ensureOrganizationAccess(actor, String((department as any).organization));

    (department as any).isActive = false;
    await departmentRepository.save(department);
  },
};
