import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import app from '../app';
import ConfigModel from '../models/config.model';
import { getExtensionVersion, setConfig, setExtensionVersion } from '../services/config.service';
import { HttpError } from '../utils/http-error';

const admin = {
  id: '507f1f77bcf86cd799439011', email: 'admin@example.test', username: 'admin', fullName: 'Admin',
  role: { id: '507f1f77bcf86cd799439012', code: 'ADMIN', level: 1 }, organization: null, department: null, status: 'ACTIVE',
};
const user = { ...admin, role: { ...admin.role, code: 'SPECIALIST' } };

test('extension version defaults to 1.0.0 without a config record', async () => {
  const originalFindOne = ConfigModel.findOne;
  ConfigModel.findOne = (() => ({ lean: async () => null })) as unknown as typeof ConfigModel.findOne;
  try {
    assert.deepEqual(await getExtensionVersion(), { data: { version: '1.0.0' } });
  } finally {
    ConfigModel.findOne = originalFindOne;
  }
});

test('only an admin may update JSON config and extension version must be semver', async () => {
  await assert.rejects(() => setConfig(user, 'feature.rollout', { value: true }), (error: unknown) => error instanceof HttpError && error.statusCode === 403);
  await assert.rejects(() => setExtensionVersion(admin, { version: 'version-2' }), (error: unknown) => error instanceof HttpError && error.statusCode === 400);
  await assert.rejects(() => setConfig(admin, 'extension.currentVersion', { value: '01.2.3' }), (error: unknown) => error instanceof HttpError && error.statusCode === 400);

  const originalUpdate = ConfigModel.findOneAndUpdate;
  ConfigModel.findOneAndUpdate = (async () => ({ key: 'feature.rollout', value: { enabled: true } })) as unknown as typeof ConfigModel.findOneAndUpdate;
  try {
    assert.deepEqual(await setConfig(admin, 'feature.rollout', { value: { enabled: true } }), { data: { key: 'feature.rollout', value: { enabled: true } } });
  } finally {
    ConfigModel.findOneAndUpdate = originalUpdate;
  }
});

test('extension version route is public and returns only the permitted version', async () => {
  const originalFindOne = ConfigModel.findOne;
  ConfigModel.findOne = (() => ({ lean: async () => ({ value: '2.3.4' }) })) as unknown as typeof ConfigModel.findOne;
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/extension/version`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { data: { version: '2.3.4' } });
  } finally {
    ConfigModel.findOne = originalFindOne;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
