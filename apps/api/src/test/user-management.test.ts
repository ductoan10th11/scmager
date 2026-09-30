import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import app from '../app';
import { AuditLogModel } from '../models/audit-log.model';
import UserModel from '../models/user.model';
import { roleRepository } from '../repositories/role.repository';
import { userRepository } from '../repositories/user.repository';
import { AUTH_COOKIE_NAME } from '../utils/cookie';
import { signJwt } from '../utils/jwt';

const sysAdminId = '507f1f77bcf86cd799439001';
const chiefId = '507f1f77bcf86cd799439002';
const specialistId = '507f1f77bcf86cd799439003';
const targetUserId = '507f1f77bcf86cd799439004';
const orgId = '507f1f77bcf86cd799439011';

const mockSysAdmin = {
  _id: sysAdminId,
  email: 'sysadmin@example.test',
  username: 'sysadmin',
  fullName: 'Hệ thống Quản trị',
  role: { _id: 'role-admin', code: 'ADMIN', name: 'Quản trị hệ thống', level: 0 },
  organization: null,
  department: null,
  status: 'ACTIVE',
  isSystemAdmin: true,
};

const mockChief = {
  _id: chiefId,
  email: 'chief@example.test',
  username: 'chief',
  fullName: 'Chánh Văn Phòng',
  role: { _id: 'role-chief', code: 'OFFICE_CHIEF', name: 'Chánh văn phòng', level: 1 },
  organization: { _id: orgId, name: 'UBND Huyện' },
  department: null,
  status: 'ACTIVE',
};

const mockSpecialist = {
  _id: specialistId,
  email: 'specialist@example.test',
  username: 'specialist',
  fullName: 'Chuyên viên B',
  role: { _id: 'role-specialist', code: 'SPECIALIST', name: 'Chuyên viên', level: 4 },
  organization: { _id: orgId, name: 'UBND Huyện' },
  department: null,
  status: 'ACTIVE',
};

const mockTargetUser = {
  _id: targetUserId,
  email: 'target@example.test',
  username: 'target',
  fullName: 'Cán bộ C',
  role: { _id: 'role-specialist', code: 'SPECIALIST', name: 'Chuyên viên', level: 4 },
  organization: orgId,
  department: null,
  status: 'ACTIVE',
};

test('Story 1.3 - AC1: User cannot assign ADMIN role to another user (409 Conflict)', async () => {
  const originalFindAuthById = userRepository.findAuthById;
  const originalRoleFindByCode = roleRepository.findByCode;
  const originalAuditCreate = AuditLogModel.create;

  AuditLogModel.create = (async (data: any) => data) as any;
  userRepository.findAuthById = (async (id: string) => {
    if (id === chiefId) return mockChief;
    return null;
  }) as any;

  roleRepository.findByCode = (async (code: string) => {
    if (code === 'ADMIN') {
      return { _id: 'role-admin', code: 'ADMIN', name: 'Quản trị hệ thống', level: 0 };
    }
    return null;
  }) as any;

  const token = signJwt({ id: chiefId, email: 'chief@example.test', exp: Math.floor(Date.now() / 1000) + 3600 });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');

  try {
    const res = await fetch(`http://127.0.0.1:${address.port}/api/users`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: `${AUTH_COOKIE_NAME}=${token}`,
      },
      body: JSON.stringify({
        username: 'newadmin',
        email: 'newadmin@example.test',
        fullName: 'New Admin',
        password: 'Password123!',
        roleCode: 'ADMIN',
      }),
    });
    assert.equal(res.status, 409);
    const body = await res.json() as any;
    assert.equal(body.error?.code, 'CONFLICT');
    assert.match(body.error?.message, /Only the default system admin can use ADMIN role/i);
  } finally {
    userRepository.findAuthById = originalFindAuthById;
    roleRepository.findByCode = originalRoleFindByCode;
    AuditLogModel.create = originalAuditCreate;
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
});

test('Story 1.3 - AC1: Specialist cannot assign equal or higher role level (403 Forbidden)', async () => {
  const originalFindAuthById = userRepository.findAuthById;
  const originalRoleFindByCode = roleRepository.findByCode;
  const originalAuditCreate = AuditLogModel.create;

  AuditLogModel.create = (async (data: any) => data) as any;
  userRepository.findAuthById = (async (id: string) => {
    if (id === specialistId) return mockSpecialist;
    return null;
  }) as any;

  roleRepository.findByCode = (async (code: string) => {
    if (code === 'DEPARTMENT_LEADER') {
      return { _id: 'role-dept-leader', code: 'DEPARTMENT_LEADER', name: 'Lãnh đạo phòng', level: 3 };
    }
    return null;
  }) as any;

  const token = signJwt({ id: specialistId, email: 'specialist@example.test', exp: Math.floor(Date.now() / 1000) + 3600 });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');

  try {
    const res = await fetch(`http://127.0.0.1:${address.port}/api/users`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: `${AUTH_COOKIE_NAME}=${token}`,
      },
      body: JSON.stringify({
        username: 'someuser',
        email: 'someuser@example.test',
        fullName: 'Some User',
        password: 'Password123!',
        roleCode: 'DEPARTMENT_LEADER',
      }),
    });
    // Specialist (level 4) trying to assign Department Leader (level 3)
    assert.equal(res.status, 403);
    const body = await res.json() as any;
    assert.equal(body.error?.code, 'FORBIDDEN');
    assert.match(body.error?.message, /equal or higher level/i);
  } finally {
    userRepository.findAuthById = originalFindAuthById;
    roleRepository.findByCode = originalRoleFindByCode;
    AuditLogModel.create = originalAuditCreate;
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
});

test('Story 1.3 - AC2: System Admin account cannot be deleted (409 Conflict)', async () => {
  const originalFindAuthById = userRepository.findAuthById;
  const originalFindByIdWithPassword = userRepository.findByIdWithPassword;

  userRepository.findAuthById = (async (id: string) => {
    if (id === chiefId) return mockChief;
    return null;
  }) as any;

  userRepository.findByIdWithPassword = (async (id: string) => {
    if (id === sysAdminId) return mockSysAdmin;
    return null;
  }) as any;

  const token = signJwt({ id: chiefId, email: 'chief@example.test', exp: Math.floor(Date.now() / 1000) + 3600 });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');

  try {
    const res = await fetch(`http://127.0.0.1:${address.port}/api/users/${sysAdminId}`, {
      method: 'DELETE',
      headers: {
        cookie: `${AUTH_COOKIE_NAME}=${token}`,
      },
    });
    assert.equal(res.status, 409);
    const body = await res.json() as any;
    assert.equal(body.error?.code, 'CONFLICT');
    assert.match(body.error?.message, /System admin cannot be deleted/i);
  } finally {
    userRepository.findAuthById = originalFindAuthById;
    userRepository.findByIdWithPassword = originalFindByIdWithPassword;
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
});

test('Story 1.3 - AC3: Actor cannot delete their own account (409 Conflict)', async () => {
  const originalFindAuthById = userRepository.findAuthById;
  const originalFindByIdWithPassword = userRepository.findByIdWithPassword;

  userRepository.findAuthById = (async (id: string) => {
    if (id === chiefId) return mockChief;
    return null;
  }) as any;

  userRepository.findByIdWithPassword = (async (id: string) => {
    if (id === chiefId) return mockChief;
    return null;
  }) as any;

  const token = signJwt({ id: chiefId, email: 'chief@example.test', exp: Math.floor(Date.now() / 1000) + 3600 });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');

  try {
    const res = await fetch(`http://127.0.0.1:${address.port}/api/users/${chiefId}`, {
      method: 'DELETE',
      headers: {
        cookie: `${AUTH_COOKIE_NAME}=${token}`,
      },
    });
    assert.equal(res.status, 409);
    const body = await res.json() as any;
    assert.equal(body.error?.code, 'CONFLICT');
    assert.match(body.error?.message, /cannot delete your own account/i);
  } finally {
    userRepository.findAuthById = originalFindAuthById;
    userRepository.findByIdWithPassword = originalFindByIdWithPassword;
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
});

test('Story 1.3 - AC4: Self-update payload allows only fullName and password, rejects unauthorized fields (403 Forbidden)', async () => {
  const originalFindAuthById = userRepository.findAuthById;
  const originalFindByIdWithPassword = userRepository.findByIdWithPassword;

  userRepository.findAuthById = (async (id: string) => {
    if (id === specialistId) return mockSpecialist;
    return null;
  }) as any;

  userRepository.findByIdWithPassword = (async (id: string) => {
    if (id === specialistId) return mockSpecialist;
    return null;
  }) as any;

  const token = signJwt({ id: specialistId, email: 'specialist@example.test', exp: Math.floor(Date.now() / 1000) + 3600 });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');

  try {
    // Attempt self-update trying to change role or status
    const res = await fetch(`http://127.0.0.1:${address.port}/api/users/${specialistId}`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        cookie: `${AUTH_COOKIE_NAME}=${token}`,
      },
      body: JSON.stringify({
        fullName: 'Nguyễn Văn B (Mới)',
        roleCode: 'ADMIN',
      }),
    });
    assert.equal(res.status, 403);
    const body = await res.json() as any;
    assert.equal(body.error?.code, 'FORBIDDEN');
    assert.match(body.error?.message, /only update your own fullName and password/i);
  } finally {
    userRepository.findAuthById = originalFindAuthById;
    userRepository.findByIdWithPassword = originalFindByIdWithPassword;
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
});
