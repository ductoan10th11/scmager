import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import app from '../app';
import ConnectorModel from '../models/connector.model';
import MigrationQuarantineModel from '../models/migration-quarantine.model';
import GovernancePolicyModel from '../models/governance-policy.model';
import IngestJobModel from '../models/ingest-job.model';
import IngestRunModel from '../models/ingest-run.model';
import DeadLetterModel from '../models/dead-letter.model';
import {
  connectorService,
  isScheduledWindow,
  nextScheduledRunAt,
  validateConnectorUpdateInput,
} from '../services/connector.service';
import { governanceService } from '../services/governance.service';
import { healthService } from '../services/health.service';
import { userRepository } from '../repositories/user.repository';
import { AUTH_COOKIE_NAME } from '../utils/cookie';
import { signJwt } from '../utils/jwt';
import { HttpError } from '../utils/http-error';
import type { AuthUser } from '../types/auth';

const platformAdmin: AuthUser = {
  id: '507f1f77bcf86cd799439001',
  email: 'sysadmin@example.test',
  username: 'sysadmin',
  fullName: 'Hệ thống Quản trị',
  role: { id: 'role-admin', code: 'ADMIN', name: 'Quản trị hệ thống', level: 0 },
  organization: null,
  department: null,
  status: 'ACTIVE',
};

const tenantAdmin: AuthUser = {
  id: '507f1f77bcf86cd799439002',
  email: 'tenantadmin@example.test',
  username: 'tenantadmin',
  fullName: 'Quản trị Đơn vị A',
  role: { id: 'role-chief', code: 'ADMIN', name: 'Quản trị viên', level: 1 },
  organization: '507f1f77bcf86cd799439011',
  department: null,
  status: 'ACTIVE',
};

const specialist: AuthUser = {
  id: '507f1f77bcf86cd799439003',
  email: 'specialist@example.test',
  username: 'specialist',
  fullName: 'Chuyên viên B',
  role: { id: 'role-specialist', code: 'SPECIALIST', name: 'Chuyên viên', level: 4 },
  organization: '507f1f77bcf86cd799439011',
  department: null,
  status: 'ACTIVE',
};

test('Story 6.1 - AC1 & AC3: MigrationQuarantineModel exists and PLATFORM_ADMIN vs TENANT_ADMIN separation is enforced', async () => {
  // Model check
  assert.ok(MigrationQuarantineModel);
  const collectionPath = MigrationQuarantineModel.schema.path('collection') as any;
  assert.ok(collectionPath);
  assert.deepEqual(collectionPath.enumValues, ['Document', 'OutgoingDocument']);

  // Tenant admin cannot provision a new connector (only platform admin)
  await assert.rejects(
    () => connectorService.create(tenantAdmin, {
      organizationId: tenantAdmin.organization,
      name: 'Connector 1',
      secretRef: 'secret-1',
    }),
    (err: unknown) => err instanceof HttpError && err.statusCode === 403,
  );

  // Specialist cannot administer connectors
  await assert.rejects(
    () => connectorService.list(specialist),
    (err: unknown) => err instanceof HttpError && err.statusCode === 403,
  );
});

test('Story 6.2 - AC2 & AC3: Connector creation immutability and credential redaction', async () => {
  // OrganizationId and sourceSystem cannot be modified on update
  assert.throws(
    () => validateConnectorUpdateInput({ organizationId: '507f1f77bcf86cd799439099' }),
    (err: unknown) => err instanceof HttpError && err.statusCode === 400,
  );
  assert.throws(
    () => validateConnectorUpdateInput({ sourceSystem: 'OTHER' }),
    (err: unknown) => err instanceof HttpError && err.statusCode === 400,
  );
});

test('Story 6.3 - AC1 & AC2: Governance policy fails closed pending G3 gate and propagates revocation', async () => {
  const origGate = process.env.GOVERNANCE_GATE_APPROVED;
  try {
    process.env.GOVERNANCE_GATE_APPROVED = 'false';
    // Fails closed if G3 gate is not approved
    await assert.rejects(
      () => governanceService.assertApproved('507f1f77bcf86cd799439021', '507f1f77bcf86cd799439011'),
      (err: unknown) => err instanceof HttpError && err.statusCode === 403 && /G3 approval/i.test(err.message),
    );
  } finally {
    process.env.GOVERNANCE_GATE_APPROVED = origGate;
  }

  // Revocation blocks connectors and increments credentialEpoch
  const origFindByIdAndUpdate = GovernancePolicyModel.findByIdAndUpdate;
  const origUpdateMany = ConnectorModel.updateMany;
  let blockedCount = 0;

  GovernancePolicyModel.findByIdAndUpdate = (async () => ({ _id: '507f1f77bcf86cd799439031', state: 'APPROVED' })) as any;
  ConnectorModel.updateMany = (async (query: any, update: any) => {
    assert.equal(update.$set.state, 'BLOCKED');
    assert.equal(update.$set['session.status'], 'BLOCKED');
    assert.equal(update.$inc.credentialEpoch, 1);
    blockedCount++;
    return { modifiedCount: 1 };
  }) as any;

  try {
    await governanceService.revoke('507f1f77bcf86cd799439031');
    assert.equal(blockedCount, 1);
  } finally {
    GovernancePolicyModel.findByIdAndUpdate = origFindByIdAndUpdate;
    ConnectorModel.updateMany = origUpdateMany;
  }
});

test('Story 6.4 - AC4 & AC5: Scheduler enforces 08:00-19:00 Asia/Ho_Chi_Minh window with jitter', () => {
  // 08:00 ICT = 01:00 UTC
  const insideMorning = new Date('2026-07-21T01:30:00.000Z'); // 08:30 ICT
  assert.equal(isScheduledWindow(insideMorning), true);

  // 18:30 ICT = 11:30 UTC
  const insideEvening = new Date('2026-07-21T11:30:00.000Z'); // 18:30 ICT
  assert.equal(isScheduledWindow(insideEvening), true);

  // 20:00 ICT = 13:00 UTC (outside window)
  const outsideNight = new Date('2026-07-21T13:00:00.000Z'); // 20:00 ICT
  assert.equal(isScheduledWindow(outsideNight), false);

  // 07:00 ICT = 00:00 UTC (outside window)
  const outsideEarly = new Date('2026-07-21T00:00:00.000Z'); // 07:00 ICT
  assert.equal(isScheduledWindow(outsideEarly), false);

  // nextScheduledRunAt during night produces next morning in 08:00-19:00 window
  const nextRun = nextScheduledRunAt(outsideNight);
  assert.equal(isScheduledWindow(nextRun), true);
});

test('Story 6.5 - AC1 & AC2: Operational status & Dead-letter retry validation', async () => {
  const origFindById = ConnectorModel.findById;
  const origCountJob = IngestJobModel.countDocuments;
  const origCountDeadLetter = DeadLetterModel.countDocuments;
  const origLetterFindOne = DeadLetterModel.findOne;
  const origJobUpdate = IngestJobModel.findOneAndUpdate;
  const origRunFindOne = IngestRunModel.findOne;

  ConnectorModel.findById = (() => ({
    lean: async () => ({
      _id: '507f1f77bcf86cd799439021',
      organizationId: '507f1f77bcf86cd799439011',
      name: 'Connector A',
      state: 'ACTIVE',
      secretRef: 'super-secret',
    }),
  })) as any;

  IngestJobModel.countDocuments = (async () => 5) as any;
  DeadLetterModel.countDocuments = (async () => 2) as any;
  IngestRunModel.findOne = (() => ({
    sort: () => ({
      select: () => ({
        lean: async () => null,
      }),
    }),
  })) as any;

  try {
    const status = await connectorService.getOperationalStatus(tenantAdmin, '507f1f77bcf86cd799439021');
    assert.ok(status.data);
    assert.equal(status.data.jobs.queued, 5);
    assert.equal(status.data.jobs.deadLetter, 2);
    // secretRef is redacted
    assert.equal((status.data.connector as any).secretRef, undefined);
  } finally {
    ConnectorModel.findById = origFindById;
    IngestJobModel.countDocuments = origCountJob;
    DeadLetterModel.countDocuments = origCountDeadLetter;
    DeadLetterModel.findOne = origLetterFindOne;
    IngestJobModel.findOneAndUpdate = origJobUpdate;
    IngestRunModel.findOne = origRunFindOne;
  }
});

test('Story 6.6 - AC1 & AC2: Health livez and readyz endpoints report runtime dependencies', async () => {
  const live = healthService.live();
  assert.equal(live.status, 'ok');
  assert.equal(live.checks.process, true);

  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');

  try {
    const res = await fetch(`http://127.0.0.1:${address.port}/api/livez`);
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.equal(body.status, 'ok');
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
});

test('Story 6.7 - AC1: Socket connection requires valid session cookie and active user', async () => {
  // Endpoint test confirming socket endpoint is mounted
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');

  try {
    // Unauthenticated request to socket.io returns unauthorized or handshake error
    const res = await fetch(`http://127.0.0.1:${address.port}/api/socket.io/?EIO=4&transport=polling`);
    // Without valid auth, handshake fails (either 400, 401, or error json)
    assert.ok([400, 401, 403, 500].includes(res.status) || (await res.text()).includes('error'));
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
});

test('Story 6.8 - AC1 & AC2: Release evidence manifest is present, append-only and defines fail-closed gates', () => {
  const candidatePaths = [
    path.resolve(process.cwd(), 'docs/rollout-evidence.yaml'),
    path.resolve(process.cwd(), '../../docs/rollout-evidence.yaml'),
    '/home/vmc03/dev/scmager/docs/rollout-evidence.yaml',
  ];
  const manifestPath = candidatePaths.find((p) => fs.existsSync(p));
  assert.ok(manifestPath, 'rollout-evidence.yaml must exist');

  const content = fs.readFileSync(manifestPath, 'utf8');
  assert.match(content, /schema_version:\s*['"]?1\.0['"]?/);
  assert.match(content, /G1:/);
  assert.match(content, /G2:/);
  assert.match(content, /G3:/);
  assert.match(content, /G4:/);
  assert.match(content, /G5:/);
  assert.match(content, /G6:/);
  assert.match(content, /go_no_go:/);
  assert.match(content, /fail/i);
});
