import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import app from '../app';
import { userRepository } from '../repositories/user.repository';
import { AUTH_COOKIE_NAME } from '../utils/cookie';
import { signJwt } from '../utils/jwt';

const mockUserId = '507f1f77bcf86cd799439011';
const mockActiveUser = {
  _id: mockUserId,
  email: 'officer@example.test',
  username: 'officer',
  fullName: 'Nguyễn Văn A',
  position: 'Chuyên viên',
  role: {
    _id: '507f1f77bcf86cd799439012',
    code: 'SPECIALIST',
    name: 'Chuyên viên',
    level: 3,
  },
  organization: {
    _id: '507f1f77bcf86cd799439013',
    name: 'Ủy ban Nhân dân',
  },
  department: {
    _id: '507f1f77bcf86cd799439014',
    name: 'Phòng Nội vụ',
  },
  status: 'ACTIVE',
};

test('Story 1.1 - AC1: Missing cookie returns 401 standard envelope', async () => {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');

  try {
    const res = await fetch(`http://127.0.0.1:${address.port}/api/auth/me`);
    assert.equal(res.status, 401);
    const body = await res.json() as any;
    assert.equal(body.error?.code, 'UNAUTHORIZED');
    assert.ok(body.error?.message);
    assert.equal(body.password, undefined);
    assert.equal(body.token, undefined);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
});

test('Story 1.1 - AC1: Invalid or expired JWT returns 401', async () => {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');

  try {
    const res = await fetch(`http://127.0.0.1:${address.port}/api/auth/me`, {
      headers: {
        cookie: `${AUTH_COOKIE_NAME}=invalid.jwt.token`,
      },
    });
    assert.equal(res.status, 401);
    const body = await res.json() as any;
    assert.equal(body.error?.code, 'UNAUTHORIZED');
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
});

test('Story 1.1 - AC1: Inactive user account returns 401 even with valid JWT', async () => {
  const originalFindAuthById = userRepository.findAuthById;
  userRepository.findAuthById = (async () => ({
    ...mockActiveUser,
    status: 'INACTIVE',
  })) as any;

  const validToken = signJwt({
    id: mockUserId,
    email: 'officer@example.test',
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');

  try {
    const res = await fetch(`http://127.0.0.1:${address.port}/api/auth/me`, {
      headers: {
        cookie: `${AUTH_COOKIE_NAME}=${validToken}`,
      },
    });
    assert.equal(res.status, 401);
    const body = await res.json() as any;
    assert.equal(body.error?.code, 'UNAUTHORIZED');
    assert.match(body.error?.message, /inactive/i);
  } finally {
    userRepository.findAuthById = originalFindAuthById;
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
});

test('Story 1.1 - AC2 & AC5: Valid session returns user profile without credentials', async () => {
  const originalFindAuthById = userRepository.findAuthById;
  userRepository.findAuthById = (async () => mockActiveUser) as any;

  const validToken = signJwt({
    id: mockUserId,
    email: 'officer@example.test',
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');

  try {
    const res = await fetch(`http://127.0.0.1:${address.port}/api/auth/me`, {
      headers: {
        cookie: `${AUTH_COOKIE_NAME}=${validToken}`,
      },
    });
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.ok(body.data?.user);
    const u = body.data.user;
    assert.equal(u.username, 'officer');
    assert.equal(u.role?.code, 'SPECIALIST');
    assert.equal(u.role?.level, 3);
    assert.equal(u.organization?._id, '507f1f77bcf86cd799439013');
    assert.equal(u.department?._id, '507f1f77bcf86cd799439014');
    // AC 5: Never leak sensitive fields
    assert.equal(u.passwordHash, undefined);
    assert.equal(u.password, undefined);
    assert.equal(u.token, undefined);
  } finally {
    userRepository.findAuthById = originalFindAuthById;
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
});

test('Story 1.1 - AC4: Logout clears session cookie', async () => {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');

  try {
    const res = await fetch(`http://127.0.0.1:${address.port}/api/auth/me`, {
      method: 'DELETE',
    });
    assert.equal(res.status, 204);
    const setCookie = res.headers.get('set-cookie');
    assert.ok(setCookie, 'Expected set-cookie header on logout');
    assert.match(setCookie, new RegExp(`${AUTH_COOKIE_NAME}=;`));
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
});
