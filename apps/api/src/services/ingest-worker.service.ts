import ConnectorModel from "../models/connector.model";
import DeadLetterModel from "../models/dead-letter.model";
import IngestJobModel from "../models/ingest-job.model";
import IngestRunModel from "../models/ingest-run.model";
import type { FencedConnectorIdentity } from "../repositories/tenant-source.repository";
import { connectorSessionFactory, type ConnectorSession } from "./connector-session.service";
import { connectorService, isScheduledWindow } from "./connector.service";
import { nextScheduledRunAt } from "./connector.service";
import { connectorLangsonSourceAdapter } from "./connector-langson-adapter.service";

export type FencedRun = FencedConnectorIdentity & {
  runId: string;
  jobId: string;
  secretRef?: string;
  ingestAccountCiphertext?: string;
  sourceSystem: string;
  runType: "SCHEDULED" | "MANUAL";
};

export type ConnectorSourceAdapter = {
  ingest(session: ConnectorSession, run: FencedRun): Promise<void>;
};

const leaseMs = 60_000;
const claimLeaseMs = 2 * leaseMs;
const maxAttempts = 3;

const retryAt = (attempt: number) =>
  new Date(Date.now() + Math.min(15 * 60_000, 5_000 * 2 ** attempt));

const safeFailureReason = (error: unknown): string => {
  const message = error instanceof Error ? error.message : "";
  if (message === "STALE_FENCE") return "STALE_FENCE";
  if (message === "CONNECTOR_SECRET_UNAVAILABLE") return "SECRET_NOT_CONFIGURED";
  if (message === "CONNECTOR_SECRET_REFERENCE_INVALID") return "SECRET_REFERENCE_INVALID";
  if (message === "CONNECTOR_SECRET_FORMAT_INVALID") return "SECRET_FORMAT_INVALID";
  if (message === "CONNECTOR_INGEST_ACCOUNT_UNAVAILABLE") return "INGEST_ACCOUNT_NOT_CONFIGURED";
  if (message === "CONNECTOR_INGEST_ACCOUNT_INVALID") return "INGEST_ACCOUNT_INVALID";
  if (/CONNECTOR_SOURCE_AUTH/.test(message)) return "SOURCE_AUTH_FAILED";
  if (/CONNECTOR_SOURCE_(SESSION|CSRF)/.test(message)) return "SOURCE_SESSION_FAILED";
  return "INGEST_FAILED";
};

const fencedJobFilter = (run: FencedRun) => ({
  _id: run.jobId,
  connectorId: run.connectorId,
  organizationId: run.organizationId,
  state: "CLAIMED",
  fenceToken: run.fenceToken,
  credentialEpoch: run.credentialEpoch,
  mappingVersion: run.mappingVersion,
  governancePolicyEpoch: run.governancePolicyEpoch,
});

const fencedConnectorFilter = (run: FencedConnectorIdentity) => ({
  _id: run.connectorId,
  organizationId: run.organizationId,
  state: "ACTIVE",
  activeFenceToken: run.fenceToken,
  credentialEpoch: run.credentialEpoch,
  mappingVersion: run.mappingVersion,
  governancePolicyEpoch: run.governancePolicyEpoch,
});

const deferJob = async (jobId: unknown, attempts: number) => {
  await IngestJobModel.updateOne(
    { _id: jobId, state: "QUEUED" },
    { $set: { nextAttemptAt: retryAt(attempts) } },
  );
};

const reserveConnectorBudget = async (
  connector: {
    _id: unknown;
    organizationId: unknown;
    activeFenceToken: number;
    credentialEpoch: number;
    mappingVersion: number;
    governancePolicyEpoch: number;
    budgetWindowStartedAt?: Date | null;
    rateLimit: { maxRequests: number; windowMs: number };
  },
  now: Date,
): Promise<boolean> => {
  const scope = {
    connectorId: String(connector._id),
    organizationId: String(connector.organizationId),
    fenceToken: connector.activeFenceToken,
    credentialEpoch: connector.credentialEpoch,
    mappingVersion: connector.mappingVersion,
    governancePolicyEpoch: connector.governancePolicyEpoch,
  };
  const windowStart = connector.budgetWindowStartedAt;
  const expired =
    !windowStart || now.getTime() - windowStart.getTime() >= connector.rateLimit.windowMs;
  const result = expired
    ? await ConnectorModel.updateOne(
        { ...fencedConnectorFilter(scope), budgetWindowStartedAt: windowStart ?? null },
        { $set: { budgetWindowStartedAt: now, budgetRequests: 1 } },
      )
    : await ConnectorModel.updateOne(
        {
          ...fencedConnectorFilter(scope),
          budgetWindowStartedAt: windowStart,
          budgetRequests: { $lt: connector.rateLimit.maxRequests },
        },
        { $inc: { budgetRequests: 1 } },
      );
  return result.modifiedCount === 1;
};

let sourceAdapter: ConnectorSourceAdapter = connectorLangsonSourceAdapter;

export const canStartSourceRequest = (
  runType: "SCHEDULED" | "MANUAL",
  now = new Date(),
): boolean => runType === "MANUAL" || isScheduledWindow(now);

export const setConnectorSourceAdapterForTest = (
  next: ConnectorSourceAdapter,
): void => {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Connector source adapter cannot be replaced.");
  }
  sourceAdapter = next;
};

export const ingestWorkerService = {
  async claimOne(now = new Date()): Promise<FencedRun | null> {
    await connectorService.enqueueScheduled(now);
    // A process can die after claiming a job. The claim itself is durable but
    // bounded, so another worker can safely recover it after the lease expires.
    await IngestJobModel.updateMany(
      { state: "CLAIMED", claimExpiresAt: { $lte: now } },
      { $set: { state: "QUEUED", claimExpiresAt: null, nextAttemptAt: now } },
    );
    const job = await IngestJobModel.findOne({
      state: "QUEUED",
      nextAttemptAt: { $lte: now },
    })
      .sort({ nextAttemptAt: 1 })
      .lean();
    if (!job) return null;
    if (job.runType === "SCHEDULED" && !isScheduledWindow(now)) {
      await deferJob(job._id, job.attempts);
      return null;
    }

    const connector = await ConnectorModel.findOneAndUpdate(
      {
        _id: job.connectorId,
        organizationId: job.organizationId,
        state: "ACTIVE",
        // A queued job belongs to the credential epoch it was created with.
        // Rotation must not silently rebind it to a new source account.
        credentialEpoch: job.credentialEpoch,
        mappingVersion: job.mappingVersion,
        governancePolicyEpoch: job.governancePolicyEpoch,
        $or: [{ leaseUntil: null }, { leaseUntil: { $lte: now } }],
      },
      {
        $inc: { activeFenceToken: 1 },
        $set: { leaseUntil: new Date(now.getTime() + leaseMs) },
      },
      { new: true },
    )
      .select("+secretRef +ingestAccountCiphertext")
      .lean();
    if (!connector) {
      const current = await ConnectorModel.findOne({
        _id: job.connectorId,
        organizationId: job.organizationId,
      }).select("state credentialEpoch mappingVersion governancePolicyEpoch").lean();
      if (current && (
        current.state !== "ACTIVE" ||
        current.credentialEpoch !== job.credentialEpoch ||
        current.mappingVersion !== job.mappingVersion ||
        current.governancePolicyEpoch !== job.governancePolicyEpoch
      )) {
        await IngestJobModel.updateOne(
          { _id: job._id, state: "QUEUED" },
          { $set: { state: "FAILED", claimExpiresAt: null } },
        );
        return null;
      }
      await deferJob(job._id, job.attempts);
      return null;
    }

    if (!(await reserveConnectorBudget(connector, now))) {
      await ConnectorModel.updateOne(
        fencedConnectorFilter({
          connectorId: String(connector._id),
          organizationId: String(connector.organizationId),
          fenceToken: connector.activeFenceToken,
          credentialEpoch: connector.credentialEpoch,
          mappingVersion: connector.mappingVersion,
          governancePolicyEpoch: connector.governancePolicyEpoch,
        }),
        { $set: { leaseUntil: null } },
      );
      await deferJob(job._id, job.attempts);
      return null;
    }

    const claimed = await IngestJobModel.findOneAndUpdate(
      {
        _id: job._id,
        connectorId: connector._id,
        organizationId: connector.organizationId,
        state: "QUEUED",
        nextAttemptAt: { $lte: now },
      },
      {
        $set: {
          state: "CLAIMED",
          claimExpiresAt: new Date(now.getTime() + claimLeaseMs),
          fenceToken: connector.activeFenceToken,
          credentialEpoch: connector.credentialEpoch,
          mappingVersion: connector.mappingVersion,
          governancePolicyEpoch: connector.governancePolicyEpoch,
        },
        $inc: { attempts: 1 },
      },
      { new: true },
    ).lean();
    if (!claimed) {
      await ConnectorModel.updateOne(
        fencedConnectorFilter({
          connectorId: String(connector._id),
          organizationId: String(connector.organizationId),
          fenceToken: connector.activeFenceToken,
          credentialEpoch: connector.credentialEpoch,
          mappingVersion: connector.mappingVersion,
          governancePolicyEpoch: connector.governancePolicyEpoch,
        }),
        { $set: { leaseUntil: null } },
      );
      return null;
    }
    const run = await IngestRunModel.create({
      jobId: claimed._id,
      connectorId: claimed.connectorId,
      organizationId: claimed.organizationId,
      fenceToken: connector.activeFenceToken,
      credentialEpoch: connector.credentialEpoch,
      mappingVersion: connector.mappingVersion,
      governancePolicyEpoch: connector.governancePolicyEpoch,
      startedAt: now,
    });
    return {
      runId: String(run._id),
      jobId: String(claimed._id),
      connectorId: String(claimed.connectorId),
      organizationId: String(claimed.organizationId),
      sourceSystem: connector.sourceSystem,
      runType: claimed.runType,
      ...(connector.secretRef ? { secretRef: connector.secretRef } : {}),
      ...(connector.ingestAccountCiphertext
        ? { ingestAccountCiphertext: connector.ingestAccountCiphertext }
        : {}),
      fenceToken: connector.activeFenceToken,
      credentialEpoch: connector.credentialEpoch,
      mappingVersion: connector.mappingVersion,
      governancePolicyEpoch: connector.governancePolicyEpoch,
    };
  },

  async assertFence(run: FencedRun): Promise<void> {
    const current = await ConnectorModel.exists({
      ...fencedConnectorFilter(run),
      leaseUntil: { $gt: new Date() },
    });
    if (!current) throw new Error("STALE_FENCE");
  },

  async execute(run: FencedRun): Promise<void> {
    await this.assertFence(run);
    if (!canStartSourceRequest(run.runType)) {
      throw new Error("SCHEDULE_WINDOW_CLOSED");
    }
    const session = await connectorSessionFactory().open({
      scope: run,
      secretRef: run.secretRef,
      ingestAccountCiphertext: run.ingestAccountCiphertext,
    });
    let heartbeatFailed = false;
    const heartbeat = setInterval(() => {
      const leaseUntil = new Date(Date.now() + leaseMs);
      void Promise.all([
        ConnectorModel.updateOne(
          fencedConnectorFilter(run),
          { $set: { leaseUntil } },
        ),
        IngestJobModel.updateOne(
          fencedJobFilter(run),
          { $set: { claimExpiresAt: new Date(Date.now() + claimLeaseMs) } },
        ),
      ]).then(([connectorResult, jobResult]) => {
        if (!connectorResult.modifiedCount || !jobResult.modifiedCount) heartbeatFailed = true;
      }).catch(() => {
        heartbeatFailed = true;
      });
    }, Math.floor(leaseMs / 3));
    try {
      await this.assertFence(run);
      if (!canStartSourceRequest(run.runType)) {
        throw new Error("SCHEDULE_WINDOW_CLOSED");
      }
      await sourceAdapter.ingest(session, run);
      if (heartbeatFailed) throw new Error("STALE_FENCE");
      await this.assertFence(run);
    } finally {
      clearInterval(heartbeat);
      await session.dispose();
    }
  },

  async finish(run: FencedRun, error?: unknown): Promise<void> {
    const reasonCode = error ? safeFailureReason(error) : "";
    if (!error) {
      const result = await IngestJobModel.updateOne(
        fencedJobFilter(run),
        { $set: { state: "SUCCEEDED", claimExpiresAt: null } },
      );
      if (!result.modifiedCount) throw new Error("STALE_FENCE");
      await IngestRunModel.updateOne(
        {
          _id: run.runId,
          connectorId: run.connectorId,
          organizationId: run.organizationId,
          fenceToken: run.fenceToken,
          credentialEpoch: run.credentialEpoch,
          mappingVersion: run.mappingVersion,
          governancePolicyEpoch: run.governancePolicyEpoch,
          state: "CLAIMED",
        },
        { $set: { state: "SUCCEEDED", finishedAt: new Date() } },
      );
      await ConnectorModel.updateOne(
        fencedConnectorFilter(run),
        { $set: { leaseUntil: null, "session.status": "HEALTHY" } },
      );
      return;
    }
    const job = await IngestJobModel.findOne(fencedJobFilter(run)).lean();
    const windowClosed = error instanceof Error && error.message === "SCHEDULE_WINDOW_CLOSED";
    const staleFence = reasonCode === "STALE_FENCE";
    const terminal = !staleFence && !windowClosed && (job?.attempts ?? maxAttempts) >= maxAttempts;
    const update = await IngestJobModel.updateOne(
      fencedJobFilter(run),
      {
        $set: {
          state: staleFence ? "FAILED" : terminal ? "DEAD_LETTER" : "QUEUED",
          nextAttemptAt: windowClosed ? nextScheduledRunAt() : retryAt(job?.attempts ?? 0),
          claimExpiresAt: null,
        },
      },
    );
    if (!update.modifiedCount) return;
    await IngestRunModel.updateOne(
      {
        _id: run.runId,
        connectorId: run.connectorId,
        organizationId: run.organizationId,
        fenceToken: run.fenceToken,
        credentialEpoch: run.credentialEpoch,
        mappingVersion: run.mappingVersion,
        governancePolicyEpoch: run.governancePolicyEpoch,
        state: "CLAIMED",
      },
      {
        $set: {
          state: reasonCode === "STALE_FENCE" ? "STALE" : "FAILED",
          finishedAt: new Date(),
          reasonCode,
        },
      },
    );
    if (terminal) {
      await DeadLetterModel.updateOne(
        {
          connectorId: run.connectorId,
          organizationId: run.organizationId,
          jobId: run.jobId,
          fenceToken: run.fenceToken,
          credentialEpoch: run.credentialEpoch,
          mappingVersion: run.mappingVersion,
          governancePolicyEpoch: run.governancePolicyEpoch,
        },
        {
          $setOnInsert: {
            organizationId: run.organizationId,
            connectorId: run.connectorId,
            jobId: run.jobId,
            attempts: job?.attempts ?? maxAttempts,
            reasonCode,
            fenceToken: run.fenceToken,
            credentialEpoch: run.credentialEpoch,
            mappingVersion: run.mappingVersion,
            governancePolicyEpoch: run.governancePolicyEpoch,
          },
        },
        { upsert: true },
      );
    }
    const message = error instanceof Error ? error.message : "";
    const reauthenticationNeeded = /CONNECTOR_(SECRET|SOURCE_(AUTH|SESSION|CSRF))/.test(message);
    await ConnectorModel.updateOne(
      fencedConnectorFilter(run),
      { $set: { leaseUntil: null, "session.status": reauthenticationNeeded ? "REAUTH_REQUIRED" : "HEALTHY" } },
    );
  },

  async tick(): Promise<number> {
    const run = await this.claimOne();
    if (!run) return 0;
    try {
      await this.execute(run);
      await this.finish(run);
      return 1;
    } catch (error) {
      await this.finish(run, error);
      return 0;
    }
  },
};
