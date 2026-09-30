import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import app from '../app';
import { AuditLogModel } from '../models/audit-log.model';
import DepartmentModel from '../models/department.model';
import OrganizationModel from '../models/organization.model';
import UserModel from '../models/user.model';
import { organizationRepository } from '../repositories/organization.repository';
import { departmentRepository } from '../repositories/department.repository';
import { userRepository } from '../repositories/user.repository';
import { AUTH_COOKIE_NAME } from '../utils/cookie';
import { signJwt } from '../utils/jwt';

const platformAdminId = '507f1f77bcf86cd799439001';
const tenantAdminId = '507f1f77bcf86cd799439002';
const specialistId = '507f1f77bcf86cd799439003';
const org1Id = '507f1f77bcf86cd799439011';
const org2Id = '507f1f77bcf86cd799439012';
const deptId = '507f1f77bcf86cd799439021';

const mockPlatformAdmin = {
  _id: platformAdminId,
  email: 'sysadmin@example.test',
  username: 'sysadmin',
  fullName: 'Hệ thống Quản trị',
  role: { _id: 'role-admin', code: 'ADMIN', name: 'Quản trị hệ thống', level: 0 },
  organization: null,
  department: null,
  status: 'ACTIVE',
};

const mockTenantAdmin = {
  _id: tenantAdminId,
  email: 'tenantadmin@example.test',
  username: 'tenantadmin',
  fullName: 'Quản trị Đơn vị',
  role: { _id: 'role-office-chief', code: 'OFFICE_CHIEF', name: 'Chánh văn phòng', level: 1 },
  organization: { _id: org1Id, name: 'UBND Huyện' },
  department: null,
  status: 'ACTIVE',
};

const mockSpecialist = {
  _id: specialistId,
  email: 'specialist@example.test',
  username: 'specialist',
  fullName: 'Chuyên viên B',
  role: { _id: 'role-specialist', code: 'SPECIALIST', name: 'Chuyên viên', level: 4 },
  organization: { _id: org1Id, name: 'UBND Huyện' },
  department: { _id: deptId, name: 'Phòng Nội vụ' },
  status: 'ACTIVE',
};

test('Story 1.2 - AC1: Non-admin or Tenant Admin cannot create platform organization (403)', async () => {
  const originalFindAuthById = userRepository.findAuthById;
  userRepository.findAuthById = (async (id: string) => {
    if (id === tenantAdminId) return mockTenantAdmin;
    return null;
  }) as any;

  const token = signJwt({ id: tenantAdminId, email: 'tenantadmin@example.test', exp: Math.floor(Date.now() / 1000) + 3600 });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');

  try {
    const res = await fetch(`http://127.0.0.1:${address.port}/api/organizations`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: `${AUTH_COOKIE_NAME}=${token}`,
      },
      body: JSON.stringify({
        name: 'Chi cục Mới',
        code: 'CCM',
        type: 'DISTRICT_DEPARTMENT',
      }),
    });
    assert.equal(res.status, 403);
    const body = await res.json() as any;
    assert.equal(body.error?.code, 'FORBIDDEN');
  } finally {
    userRepository.findAuthById = originalFindAuthById;
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
});

test('Story 1.2 - AC1: Platform Admin can create organization and audit log is written', async () => {
  const originalFindAuthById = userRepository.findAuthById;
  const originalOrgCreate = organizationRepository.create;
  const originalOrgFindById = organizationRepository.findById;
  const originalAuditCreate = AuditLogModel.create;

  let auditCreated = false;
  AuditLogModel.create = (async (data: any) => {
    assert.equal(data.action, 'ORGANIZATION_CREATED');
    auditCreated = true;
    return data;
  }) as any;

  userRepository.findAuthById = (async (id: string) => {
    if (id === platformAdminId) return mockPlatformAdmin;
    return null;
  }) as any;

  organizationRepository.create = (async (payload: any) => ({
    _id: org1Id,
    ...payload,
    save: async () => {},
  })) as any;

  organizationRepository.findById = (async () => ({
    _id: org1Id,
    name: 'Sở Thông tin và Truyền thông',
    code: 'STTTT',
    type: 'DEPARTMENT',
    parent: null,
    address: 'Số 1 Phố N',
    isActive: true,
  })) as any;

  const token = signJwt({ id: platformAdminId, email: 'sysadmin@example.test', exp: Math.floor(Date.now() / 1000) + 3600 });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');

  try {
    const res = await fetch(`http://127.0.0.1:${address.port}/api/organizations`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: `${AUTH_COOKIE_NAME}=${token}`,
      },
      body: JSON.stringify({
        name: 'Sở Thông tin và Truyền thông',
        code: 'STTTT',
        type: 'DEPARTMENT',
      }),
    });
    assert.equal(res.status, 201);
    const body = await res.json() as any;
    assert.equal(body.data?.code, 'STTTT');
    assert.equal(auditCreated, true);
  } finally {
    userRepository.findAuthById = originalFindAuthById;
    organizationRepository.create = originalOrgCreate;
    organizationRepository.findById = originalOrgFindById;
    AuditLogModel.create = originalAuditCreate;
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
});

test('Story 1.2 - AC2: User cannot view another organization (403)', async () => {
  const originalFindAuthById = userRepository.findAuthById;
  userRepository.findAuthById = (async (id: string) => {
    if (id === specialistId) return mockSpecialist;
    return null;
  }) as any;

  const token = signJwt({ id: specialistId, email: 'specialist@example.test', exp: Math.floor(Date.now() / 1000) + 3600 });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');

  try {
    // Attempt to view org2Id while belonging to org1Id
    const res = await fetch(`http://127.0.0.1:${address.port}/api/organizations/${org2Id}`, {
      headers: {
        cookie: `${AUTH_COOKIE_NAME}=${token}`,
      },
    });
    assert.equal(res.status, 403);
    const body = await res.json() as any;
    assert.equal(body.error?.code, 'FORBIDDEN');
  } finally {
    userRepository.findAuthById = originalFindAuthById;
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
});

test('Story 1.2 - AC3: Non-manager (role level > 1) cannot create department (403)', async () => {
  const originalFindAuthById = userRepository.findAuthById;
  userRepository.findAuthById = (async (id: string) => {
    if (id === specialistId) return mockSpecialist;
    return null;
  }) as any;

  const token = signJwt({ id: specialistId, email: 'specialist@example.test', exp: Math.floor(Date.now() / 1000) + 3600 });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');

  try {
    const res = await fetch(`http://127.0.0.1:${address.port}/api/departments`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: `${AUTH_COOKIE_NAME}=${token}`,
      },
      body: JSON.stringify({
        name: 'Bộ phận một cửa',
        code: 'BPMC',
        organization: org1Id,
      }),
    });
    assert.equal(res.status, 403);
    const body = await res.json() as any;
    assert.equal(body.error?.code, 'FORBIDDEN');
  } finally {
    userRepository.findAuthById = originalFindAuthById;
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
});

test('Story 1.2 - AC4: Deleting department with active members returns 409 (orphan prevention)', async () => {
  const originalFindAuthById = userRepository.findAuthById;
  const originalDeptFindRawById = departmentRepository.findRawById;
  const originalUserExists = UserModel.exists;
  const originalDeptExists = DepartmentModel.exists;

  userRepository.findAuthById = (async (id: string) => {
    if (id === tenantAdminId) return mockTenantAdmin;
    return null;
  }) as any;

  departmentRepository.findRawById = (async (id: string) => ({
    _id: id,
    organization: org1Id,
    name: 'Phòng Nội vụ',
    isActive: true,
  })) as any;

  UserModel.exists = (async () => ({ _id: specialistId })) as any;
  DepartmentModel.exists = (async () => null) as any;

  const token = signJwt({ id: tenantAdminId, email: 'tenantadmin@example.test', exp: Math.floor(Date.now() / 1000) + 3600 });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');

  try {
    const res = await fetch(`http://127.0.0.1:${address.port}/api/departments/${deptId}`, {
      method: 'DELETE',
      headers: {
        cookie: `${AUTH_COOKIE_NAME}=${token}`,
      },
    });
    assert.equal(res.status, 409);
    const body = await res.json() as any;
    assert.equal(body.error?.code, 'CONFLICT');
    assert.match(body.error?.message, /active members/i);
  } finally {
    userRepository.findAuthById = originalFindAuthById;
    departmentRepository.findRawById = originalDeptFindRawById;
    UserModel.exists = originalUserExists;
    DepartmentModel.exists = originalDeptExists;
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
});
