import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import app from '../app';
import { userRepository } from '../repositories/user.repository';
import { AUTH_COOKIE_NAME } from '../utils/cookie';
import { signJwt } from '../utils/jwt';
import { hashPassword } from '../utils/password';

const userId = '507f1f77bcf86cd799439001';
const orgId = '507f1f77bcf86cd799439011';

const mockUser = {
  _id: userId,
  email: 'officer@example.test',
  username: 'officer',
  fullName: 'Nguyễn Văn A',
  passwordHash: hashPassword('OldPass123!'),
  role: { _id: 'role-specialist', code: 'SPECIALIST', name: 'Chuyên viên', level: 4 },
  organization: orgId,
  department: null,
  status: 'ACTIVE',
  save: async () => {},
};

test('Story 1.4 - AC1: GET /api/policy/privacy is accessible publicly without auth', async () => {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');

  try {
    const res = await fetch(`http://127.0.0.1:${address.port}/api/policy/privacy`);
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.ok(body.data);
    assert.ok(body.data.title);
    assert.ok(body.data.effectiveDate);
    assert.ok(body.data.content);
    assert.match(body.data.content, /Privacy Policy/i);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
});

test('Story 1.4 - AC2: Self change password requires accurate current password (400 on wrong password)', async () => {
  const originalFindAuthById = userRepository.findAuthById;
  const originalFindByIdWithPassword = userRepository.findByIdWithPassword;

  userRepository.findAuthById = (async (id: string) => {
    if (id === userId) return mockUser;
    return null;
  }) as any;

  userRepository.findByIdWithPassword = (async (id: string) => {
    if (id === userId) return { ...mockUser };
    return null;
  }) as any;

  const token = signJwt({ id: userId, email: 'officer@example.test', exp: Math.floor(Date.now() / 1000) + 3600 });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');

  try {
    const res = await fetch(`http://127.0.0.1:${address.port}/api/users/${userId}/password`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        cookie: `${AUTH_COOKIE_NAME}=${token}`,
      },
      body: JSON.stringify({
        currentPassword: 'WrongPassword!',
        newPassword: 'NewPassword123!',
        confirmPassword: 'NewPassword123!',
      }),
    });
    assert.equal(res.status, 400);
    const body = await res.json() as any;
    assert.equal(body.error?.code, 'VALIDATION_ERROR');
    assert.match(body.error?.message, /Mật khẩu hiện tại không chính xác/i);
  } finally {
    userRepository.findAuthById = originalFindAuthById;
    userRepository.findByIdWithPassword = originalFindByIdWithPassword;
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
});

test('Story 1.4 - AC2: Password change validates minimum length and password matching (400)', async () => {
  const originalFindAuthById = userRepository.findAuthById;
  const originalFindByIdWithPassword = userRepository.findByIdWithPassword;

  userRepository.findAuthById = (async (id: string) => {
    if (id === userId) return mockUser;
    return null;
  }) as any;

  userRepository.findByIdWithPassword = (async (id: string) => {
    if (id === userId) return { ...mockUser };
    return null;
  }) as any;

  const token = signJwt({ id: userId, email: 'officer@example.test', exp: Math.floor(Date.now() / 1000) + 3600 });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');

  try {
    // Too short
    const resShort = await fetch(`http://127.0.0.1:${address.port}/api/users/${userId}/password`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        cookie: `${AUTH_COOKIE_NAME}=${token}`,
      },
      body: JSON.stringify({
        currentPassword: 'OldPass123!',
        newPassword: '123',
        confirmPassword: '123',
      }),
    });
    assert.equal(resShort.status, 400);
    const bodyShort = await resShort.json() as any;
    assert.match(bodyShort.error?.message, /ít nhất 6 ký tự/i);

    // Mismatched confirmation
    const resMismatch = await fetch(`http://127.0.0.1:${address.port}/api/users/${userId}/password`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        cookie: `${AUTH_COOKIE_NAME}=${token}`,
      },
      body: JSON.stringify({
        currentPassword: 'OldPass123!',
        newPassword: 'NewPassword123!',
        confirmPassword: 'DifferentPassword!',
      }),
    });
    assert.equal(resMismatch.status, 400);
    const bodyMismatch = await resMismatch.json() as any;
    assert.match(bodyMismatch.error?.message, /không khớp/i);
  } finally {
    userRepository.findAuthById = originalFindAuthById;
    userRepository.findByIdWithPassword = originalFindByIdWithPassword;
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
});
