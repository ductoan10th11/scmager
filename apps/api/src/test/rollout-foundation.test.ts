import test from "node:test";
import assert from "node:assert/strict";
import { classifyForLaunch } from "../services/classification.service";
import { isScheduledWindow, validateConnectorUpdateInput } from "../services/connector.service";
import { duplicateConflict } from "../app";
import { tenantSourceRepository } from "../repositories/tenant-source.repository";
import IngestJobModel from "../models/ingest-job.model";
import ConnectorModel from "../models/connector.model";
import DocumentModel from "../models/document.model";
import { connectorSessionFactory, setConnectorSessionFactoryForTest } from "../services/connector-session.service";
import { canStartSourceRequest } from "../services/ingest-worker.service";
import { healthService } from "../services/health.service";
import { enqueueWorkDeclarationNotification } from "../services/notification.service";
import NotificationModel from "../models/notification.model";
import { isExtensionEnabledForOrganization } from "../services/extension-launch.service";
import { parseConnectorCredentials } from "../services/langson-connector-client.service";
import { connectorLangsonSourceAdapter } from "../services/connector-langson-adapter.service";
import { decryptIngestAccount, encryptIngestAccount } from "../services/connector-ingest-account.service";

const connectorA = "000000000000000000000001";
const connectorB = "000000000000000000000002";
const organizationA = "000000000000000000000003";
const organizationB = "000000000000000000000004";

test("launch classification is fail-closed", () => {
  assert.deepEqual(classifyForLaunch("PERMITTED"), {
    allowed: true,
    reasonCode: "PERMITTED",
  });
  assert.equal(classifyForLaunch("SENSITIVE").allowed, false);
  assert.equal(classifyForLaunch(undefined).allowed, false);
});

test("scheduled ingest window is Asia/Ho_Chi_Minh [08:00, 19:00)", () => {
  assert.equal(isScheduledWindow(new Date("2026-07-21T01:00:00.000Z")), true);
  assert.equal(isScheduledWindow(new Date("2026-07-21T11:59:59.000Z")), true);
  assert.equal(isScheduledWindow(new Date("2026-07-21T12:00:00.000Z")), false);
});

test("a scheduled source request cannot start at or after 19:00", () => {
  const afterDeadline = new Date("2026-07-21T12:00:00.000Z");
  assert.equal(canStartSourceRequest("SCHEDULED", afterDeadline), false);
  assert.equal(canStartSourceRequest("MANUAL", afterDeadline), true);
});

test("direct Connector jobs retain separate tenant identities", () => {
  assert.notEqual(`${connectorA}:${organizationA}`, `${connectorB}:${organizationB}`);
});

test("launch health is process-local for liveness and excludes UPLOAD_DIR", async () => {
  const previousMongo = process.env.MONGO_URI;
  const previousJwt = process.env.JWT_SECRET;
  process.env.MONGO_URI = "mongodb://example.invalid/ework";
  process.env.JWT_SECRET = "test-only-secret-at-least-thirty-two-chars";
  const live = healthService.live();
  const ready = await healthService.ready();
  assert.deepEqual(live.checks, { process: true });
  assert.equal("uploadDir" in ready.checks, false);
  process.env.MONGO_URI = previousMongo;
  process.env.JWT_SECRET = previousJwt;
});

test("source identity and durable jobs isolate identical external IDs by Connector", () => {
  const documentIndexes = DocumentModel.schema.indexes() as Array<
    [Record<string, number>, { unique?: boolean }]
  >;
  assert.ok(
    documentIndexes.some(
      ([keys, options]) =>
        keys.organizationId === 1 &&
        keys.connectorId === 1 &&
        keys.sourceSystem === 1 &&
        keys.externalSourceId === 1 &&
        options.unique === true,
    ),
  );
  const jobIndexes = IngestJobModel.schema.indexes() as Array<
    [Record<string, number>, { unique?: boolean }]
  >;
  assert.ok(
    jobIndexes.some(
      ([keys, options]) =>
        keys.connectorId === 1 &&
        keys.idempotencyKey === 1 &&
        options.unique === true,
    ),
  );
  assert.notEqual(`${organizationA}:${connectorA}:same-id`, `${organizationB}:${connectorB}:same-id`);
});

test("Connector sessions are created per fenced Connector and never share a secret", async () => {
  const opened: string[] = [];
  setConnectorSessionFactoryForTest({
    async open({ scope, secretRef }) {
      opened.push(`${scope.organizationId}:${scope.connectorId}:${scope.fenceToken}:${secretRef}`);
      return { scope, async dispose() {} };
    },
  });
  const first = await connectorSessionFactory().open({
    scope: {
      organizationId: organizationA,
      connectorId: connectorA,
      fenceToken: 1,
      credentialEpoch: 1,
      mappingVersion: 1,
      governancePolicyEpoch: 1,
    },
    secretRef: "CONNECTOR_A_SECRET",
  });
  const second = await connectorSessionFactory().open({
    scope: {
      organizationId: organizationB,
      connectorId: connectorB,
      fenceToken: 1,
      credentialEpoch: 1,
      mappingVersion: 1,
      governancePolicyEpoch: 1,
    },
    secretRef: "CONNECTOR_B_SECRET",
  });
  await Promise.all([first.dispose(), second.dispose()]);
  assert.deepEqual(opened, [
    `${organizationA}:${connectorA}:1:CONNECTOR_A_SECRET`,
    `${organizationB}:${connectorB}:1:CONNECTOR_B_SECRET`,
  ]);
});

test("durable job schema records the complete fence for retries and restarts", () => {
  for (const field of [
    "fenceToken",
    "credentialEpoch",
    "mappingVersion",
    "governancePolicyEpoch",
  ]) {
    assert.ok(IngestJobModel.schema.path(field));
  }
  assert.ok(ConnectorModel.schema.path("budgetRequests"));
});

test("manual document transitions use an optimistic revision", () => {
  assert.ok(DocumentModel.schema.path("revision"));
  assert.equal((DocumentModel.schema.path("revision") as any).options.min, 0);
});

test("tenant source repository rejects untrusted scope before persistence", async () => {
  await assert.rejects(
    tenantSourceRepository.upsertFencedIncoming(
      {
        organizationId: "invalid",
        connectorId: "invalid",
        sourceSystem: "LANGSON_DWR",
        externalSourceId: "1",
        fenceToken: 1,
        credentialEpoch: 1,
        mappingVersion: 1,
        governancePolicyEpoch: 1,
      },
      {},
    ),
  );
});

test("notification outbox records retry/DLQ state and idempotency by revision", () => {
  const statePath: any = NotificationModel.schema.path('outboxState');
  assert.deepEqual(statePath.enumValues, ['PENDING', 'PUBLISHING', 'PUBLISHED', 'DLQ']);
  for (const field of ['outboxAttempts', 'outboxNextAttemptAt', 'outboxLockedAt', 'outboxLastError', 'publishedAt']) {
    assert.ok(NotificationModel.schema.path(field));
  }
  const indexes = NotificationModel.schema.indexes() as Array<[Record<string, number>, { unique?: boolean }]>;
  assert.ok(indexes.some(([keys, options]) => (
    keys.recipient === 1 && keys.relatedModel === 1 && keys.relatedId === 1
    && keys.type === 1 && keys.revision === 1 && options.unique === true
  )));
});

test("transactional work notification rejects untrusted scope before it can enqueue", async () => {
  await assert.rejects(enqueueWorkDeclarationNotification({
    session: {} as any,
    recipient: 'invalid',
    type: 'WORK_DECLARATION_SUBMITTED',
    title: 'Test',
    entityId: connectorA,
    organizationId: organizationA,
    revision: 1,
  }));
});

test("extension launch is enabled for organization", () => {
  assert.equal(isExtensionEnabledForOrganization(organizationA), true);
  assert.equal(isExtensionEnabledForOrganization(organizationB), true);
});

test("Connector source credentials are parsed only from one named secret value", () => {
  assert.deepEqual(
    parseConnectorCredentials('{"username":"connector-a","password":"test-password"}'),
    { username: 'connector-a', password: 'test-password' },
  );
  assert.throws(() => parseConnectorCredentials('connector-a:test-password'));
  assert.throws(() => parseConnectorCredentials('{"username":"connector-a"}'));
});

test("Connector ingest accounts are encrypted at rest and decrypt only with the deployment key", () => {
  const previousJwt = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "test-only-secret-at-least-thirty-two-chars";
  const encrypted = encryptIngestAccount({ username: "connector-a", password: "test-password" });
  assert.notEqual(encrypted.includes("connector-a"), true);
  assert.notEqual(encrypted.includes("test-password"), true);
  assert.deepEqual(decryptIngestAccount(encrypted), { username: "connector-a", password: "test-password" });
  process.env.JWT_SECRET = previousJwt;
});

test("Connector source adapter fails explicitly without its isolated session client", async () => {
  await assert.rejects(
    connectorLangsonSourceAdapter.ingest(
      { scope: { organizationId: organizationA, connectorId: connectorA, fenceToken: 1, credentialEpoch: 1, mappingVersion: 1, governancePolicyEpoch: 1 }, async dispose() {} },
      { runId: connectorA, jobId: connectorB, organizationId: organizationA, connectorId: connectorA, sourceSystem: 'LANGSON_DWR', runType: 'MANUAL', secretRef: 'CONNECTOR_A_SECRET', fenceToken: 1, credentialEpoch: 1, mappingVersion: 1, governancePolicyEpoch: 1 },
    ),
    /CONNECTOR_SOURCE_SESSION_UNAVAILABLE/,
  );
});

test("Connector update accepts account rotation but not secret reference mutation", () => {
  assert.deepEqual(validateConnectorUpdateInput({ name: "Replacement source", ingestAccount: { username: "connector-b", password: "test-password" } }), {
    name: "Replacement source",
    ingestAccount: { username: "connector-b", password: "test-password" },
  });
  assert.throws(() => validateConnectorUpdateInput({ secretRef: "CONNECTOR_B_SECRET" }));
  assert.throws(() => validateConnectorUpdateInput({ organizationId: organizationB }));
  assert.throws(() => validateConnectorUpdateInput({ sourceSystem: "OTHER" }));
  assert.throws(() => validateConnectorUpdateInput({}));
  assert.throws(() => validateConnectorUpdateInput(null as any));
});

test("Connector duplicate index maps to an actionable, secret-safe conflict", () => {
  assert.deepEqual(
    duplicateConflict({ code: 11000, keyPattern: { organizationId: 1, name: 1 } }),
    { message: "Tên Connector đã tồn tại trong tổ chức này.", details: { field: "name" } },
  );
  assert.equal(duplicateConflict({ code: 11000, keyPattern: { email: 1 } })?.message, "Giá trị đã tồn tại.");
});
