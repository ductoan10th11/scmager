import { isValidObjectId } from "mongoose";
import { randomUUID } from "node:crypto";
import AuditLogModel from "../models/audit-log.model";
import ConnectorModel from "../models/connector.model";
import OrganizationModel from "../models/organization.model";
import IngestJobModel from "../models/ingest-job.model";
import IngestRunModel from "../models/ingest-run.model";
import DeadLetterModel from "../models/dead-letter.model";
import type { AuthUser } from "../types/auth";
import { badRequest, conflict, forbidden, notFound } from "../utils/http-error";
import {
  encryptIngestAccount,
  type IngestAccount,
} from "./connector-ingest-account.service";

const isPlatformAdmin = (actor: AuthUser) =>
  actor.role.code === "ADMIN" && !actor.organization;
const isTenantAdmin = (actor: AuthUser, organizationId: string) =>
  actor.role.code === "ADMIN" && actor.organization === organizationId;

const assertOrgId = (organizationId: string) => {
  if (!isValidObjectId(organizationId))
    throw badRequest("organizationId must be a valid ObjectId.");
};

const writeAudit = async (
  actor: AuthUser,
  connector: { _id: unknown; organizationId: unknown },
  action: string,
  reasonCode?: string,
): Promise<void> => {
  await AuditLogModel.create({
    actor: actor.id,
    action,
    entityModel: "Connector",
    entityId: connector._id,
    organization: connector.organizationId,
    connectorId: connector._id,
    metadata: reasonCode ? { reasonCode } : {},
  });
};

const bmtParts = (date: Date) => {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  });
  const values = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
  };
};

export const isScheduledWindow = (date = new Date()): boolean => {
  const { hour } = bmtParts(date);
  return hour >= 8 && hour < 19;
};

export const nextScheduledRunAt = (now = new Date()): Date => {
  // Durable jobs use an absolute instant. Random jitter is deliberately bounded
  // and only selected after confirming the HCM business-hour window.
  const jitterMinutes = 1 + Math.floor(Math.random() * 14);
  const candidate = new Date(now.getTime() + jitterMinutes * 60_000);
  if (isScheduledWindow(candidate)) return candidate;
  const local = bmtParts(now);
  // Vietnam has no DST. 08:00 Asia/Ho_Chi_Minh is 01:00 UTC; schedule the
  // next window rather than repeatedly reclaiming an overnight job.
  const nextDay = local.hour >= 19 || local.hour === 18 ? 1 : 0;
  return new Date(
    Date.UTC(
      local.year,
      local.month - 1,
      local.day + nextDay,
      1,
      jitterMinutes,
    ),
  );
};

const responseData = (connector: Record<string, any>) => {
  const {
    secretRef: _secretRef,
    ingestAccountCiphertext: _ingestAccountCiphertext,
    ...safe
  } = connector;
  return safe;
};

const assertConnectorAdmin = (actor: AuthUser): void => {
  if (!isPlatformAdmin(actor) && !(actor.role.code === "ADMIN" && actor.organization))
    throw forbidden("Connector administration requires an administrator role.");
};

const assertPlatformProvisioner = (actor: AuthUser): void => {
  if (!isPlatformAdmin(actor)) {
    throw forbidden("Only Platform Admin can change or remove a Connector.");
  }
};

const normalizeName = (value: unknown): string => {
  const name = String(value ?? "").trim();
  if (!name) throw badRequest("Tên Connector là bắt buộc.");
  if (name.length > 120 || /[\u0000-\u001F\u007F]/.test(name))
    throw badRequest("Tên Connector chứa ký tự không được hỗ trợ.");
  return name;
};

const normalizeSecretRef = (value: unknown): string => {
  const secretRef = String(value ?? "").trim();
  if (!secretRef) throw badRequest("Secret reference là bắt buộc.");
  if (secretRef.length > 256 || /[\u0000-\u001F\u007F]/.test(secretRef))
    throw badRequest("Secret reference chứa ký tự không được hỗ trợ.");
  return secretRef;
};

const normalizeIngestAccount = (value: unknown): IngestAccount => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw badRequest("Tài khoản ingest phải gồm username và password.");
  }
  const { username: rawUsername, password: rawPassword } = value as Record<string, unknown>;
  const username = typeof rawUsername === "string" ? rawUsername.trim() : "";
  const password = typeof rawPassword === "string" ? rawPassword : "";
  if (!username || !password) {
    throw badRequest("Tài khoản ingest cần username và password.");
  }
  if (
    username.length > 256 ||
    password.length > 1024 ||
    /[\u0000-\u001F\u007F]/.test(username) ||
    /[\u0000\u007F]/.test(password)
  ) {
    throw badRequest("Tài khoản ingest chứa ký tự không được hỗ trợ.");
  }
  return { username, password };
};

export const validateConnectorUpdateInput = (input: Record<string, unknown>) => {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw badRequest("Connector update payload must be an object.");
  }
  if (Object.hasOwn(input, "organizationId") || Object.hasOwn(input, "sourceSystem")) {
      throw badRequest("Không thể đổi tổ chức hoặc hệ thống nguồn của Connector.");
  }
  const hasName = Object.hasOwn(input, "name");
  if (Object.hasOwn(input, "secretRef")) {
    throw badRequest("Không thể đổi secret reference. Hãy cập nhật tài khoản ingest.");
  }
  const hasIngestAccount = Object.hasOwn(input, "ingestAccount");
  if (!hasName && !hasIngestAccount) {
    throw badRequest("Hãy nhập tên Connector hoặc tài khoản ingest để cập nhật.");
  }
  return {
    ...(hasName ? { name: normalizeName(input.name) } : {}),
    ...(hasIngestAccount ? { ingestAccount: normalizeIngestAccount(input.ingestAccount) } : {}),
  };
};

const findScopedConnector = async (actor: AuthUser, connectorId: string) => {
  if (!isValidObjectId(connectorId)) throw badRequest("connectorId must be a valid ObjectId.");
  const connector = await ConnectorModel.findById(connectorId).lean();
  if (!connector) throw notFound("Connector not found.");
  if (!isPlatformAdmin(actor) && !isTenantAdmin(actor, String(connector.organizationId))) {
    throw forbidden("Connector access denied.");
  }
  return connector;
};

export const connectorService = {
  async create(actor: AuthUser, input: Record<string, unknown>) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw badRequest("Dữ liệu tạo Connector phải là một đối tượng.");
    }
    const organizationId = String(input.organizationId ?? "");
    assertOrgId(organizationId);
    if (!isPlatformAdmin(actor))
      throw forbidden("Only Platform Admin can provision a Connector.");
    if (!(await OrganizationModel.exists({ _id: organizationId, isActive: true }))) {
      throw badRequest("Tổ chức không tồn tại hoặc đã ngừng hoạt động.");
    }
    const name = normalizeName(input.name);
    const hasIngestAccount = Object.hasOwn(input, "ingestAccount");
    const hasSecretRef = Object.hasOwn(input, "secretRef");
    if (!hasIngestAccount && !hasSecretRef) {
      throw badRequest("Hãy nhập tài khoản ingest cho Connector.");
    }
    const ingestAccount = hasIngestAccount
      ? normalizeIngestAccount(input.ingestAccount)
      : undefined;
    const secretRef = hasSecretRef ? normalizeSecretRef(input.secretRef) : undefined;
    const sourceSystem = String(input.sourceSystem ?? "LANGSON_DWR").trim();
    if (sourceSystem !== "LANGSON_DWR")
      throw badRequest("Unsupported Connector source system.");
    const connector = await ConnectorModel.create({
      organizationId,
      name,
      ...(secretRef ? { secretRef } : {}),
      ...(ingestAccount
        ? { ingestAccountCiphertext: encryptIngestAccount(ingestAccount) }
        : {}),
      sourceSystem,
    });
    await writeAudit(actor, connector, "CONNECTOR_CREATED");
    return { data: responseData(connector.toJSON()) };
  },

  async update(actor: AuthUser, connectorId: string, input: Record<string, unknown>) {
    assertPlatformProvisioner(actor);
    if (!isValidObjectId(connectorId)) throw badRequest("connectorId must be a valid ObjectId.");
    const changes = validateConnectorUpdateInput(input);
    const connector = await ConnectorModel.findById(connectorId).select("+secretRef +ingestAccountCiphertext");
    if (!connector) throw notFound("Connector not found.");

    const credentialsChanged = changes.ingestAccount !== undefined;
    const update: Record<string, unknown> = {
      ...(changes.name !== undefined ? { name: changes.name } : {}),
      ...(changes.ingestAccount !== undefined
        ? { ingestAccountCiphertext: encryptIngestAccount(changes.ingestAccount) }
        : {}),
    };
    if (credentialsChanged) {
      Object.assign(update, {
        state: "DISABLED",
        leaseUntil: null,
        nextRunAt: null,
        "session.status": "REAUTH_REQUIRED",
      });
    }
    try {
      const updated = await ConnectorModel.findOneAndUpdate(
        {
          _id: connector._id,
          organizationId: connector.organizationId,
          credentialEpoch: connector.credentialEpoch,
        },
        {
          $set: update,
          ...(credentialsChanged
            ? { $inc: { credentialEpoch: 1, scheduleGeneration: 1, activeFenceToken: 1 } }
            : {}),
        },
        { new: true, runValidators: true },
      ).select("+secretRef");
      if (!updated) throw conflict("Connector changed while the update was in progress.");
      if (credentialsChanged) {
        // Old queued jobs must not be re-claimed after a new credential epoch.
        await IngestJobModel.updateMany(
          {
            connectorId: connector._id,
            organizationId: connector.organizationId,
            credentialEpoch: connector.credentialEpoch,
            state: "QUEUED",
          },
          { $set: { state: "FAILED", claimExpiresAt: null } },
        );
      }
      await writeAudit(actor, updated, credentialsChanged ? "CONNECTOR_INGEST_ACCOUNT_CHANGED" : "CONNECTOR_UPDATED");
      return { data: responseData(updated.toJSON()) };
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        throw conflict("Tên Connector đã tồn tại trong tổ chức này.", { field: "name" });
      }
      throw error;
    }
  },

  async remove(actor: AuthUser, connectorId: string) {
    assertPlatformProvisioner(actor);
    if (!isValidObjectId(connectorId)) throw badRequest("connectorId must be a valid ObjectId.");
    const connector = await ConnectorModel.findById(connectorId).select("+secretRef");
    if (!connector) throw notFound("Connector not found.");
    if (!["DRAFT", "DISABLED"].includes(connector.state)) {
      throw forbidden("Hãy tắt Connector trước khi xóa.");
    }
    const locked = await ConnectorModel.findOneAndUpdate(
      {
        _id: connector._id,
        organizationId: connector.organizationId,
        state: connector.state,
        credentialEpoch: connector.credentialEpoch,
      },
      {
        $set: { state: "DELETING", leaseUntil: null, nextRunAt: null },
        $inc: { credentialEpoch: 1, scheduleGeneration: 1, activeFenceToken: 1 },
      },
      { new: true },
    );
    if (!locked) throw conflict("Connector đã thay đổi trong lúc xóa; hãy thử lại.");
    const scope = { connectorId: connector._id, organizationId: connector.organizationId };
    if (await IngestJobModel.exists({ ...scope, state: "CLAIMED" })) {
      await ConnectorModel.updateOne({ _id: locked._id, state: "DELETING" }, { $set: { state: connector.state } });
      throw forbidden("Đợi job ingest đang chạy hoàn tất rồi thử xóa lại.");
    }
    try {
      await Promise.all([
        IngestJobModel.deleteMany(scope),
        IngestRunModel.deleteMany(scope),
        DeadLetterModel.deleteMany(scope),
      ]);
      // Deliberately retain audit events and tenant source documents.
      await writeAudit(actor, connector, "CONNECTOR_DELETED");
      const removed = await ConnectorModel.findOneAndDelete({
        _id: locked._id,
        organizationId: locked.organizationId,
        state: "DELETING",
        credentialEpoch: locked.credentialEpoch,
      });
      if (!removed) throw conflict("Connector đã thay đổi trong lúc xóa; hãy thử lại.");
      return { data: { id: String(connector._id), deleted: true } };
    } catch (error) {
      await ConnectorModel.updateOne(
        { _id: locked._id, organizationId: locked.organizationId, state: "DELETING", credentialEpoch: locked.credentialEpoch },
        { $set: { state: connector.state } },
      );
      throw error;
    }
  },

  async list(actor: AuthUser) {
    assertConnectorAdmin(actor);
    const filter = isPlatformAdmin(actor)
      ? {}
      : actor.organization
        ? { organizationId: actor.organization }
        : { _id: null };
    return {
      data: await ConnectorModel.find(filter).select("-secretRef").lean(),
    };
  },

  async getOperationalStatus(actor: AuthUser, connectorId: string) {
    assertConnectorAdmin(actor);
    const connector = await findScopedConnector(actor, connectorId);
    const scope = { connectorId: connector._id, organizationId: connector.organizationId };
    const [queued, claimed, failed, deadLetter, latestRun] = await Promise.all([
      IngestJobModel.countDocuments({ ...scope, state: "QUEUED" }),
      IngestJobModel.countDocuments({ ...scope, state: "CLAIMED" }),
      IngestJobModel.countDocuments({ ...scope, state: "FAILED" }),
      DeadLetterModel.countDocuments(scope),
      IngestRunModel.findOne(scope).sort({ createdAt: -1 }).select("state startedAt finishedAt reasonCode").lean(),
    ]);
    return {
      data: {
        connector: responseData(connector as Record<string, any>),
        jobs: { queued, claimed, failed, deadLetter },
        latestRun: latestRun ? {
          state: latestRun.state,
          startedAt: latestRun.startedAt,
          finishedAt: latestRun.finishedAt,
          reasonCode: latestRun.reasonCode || null,
        } : null,
      },
    };
  },

  async retryDeadLetter(actor: AuthUser, connectorId: string, deadLetterId: string) {
    assertConnectorAdmin(actor);
    if (!isValidObjectId(deadLetterId)) throw badRequest("deadLetterId must be a valid ObjectId.");
    const connector = await findScopedConnector(actor, connectorId);
    if (connector.state !== "ACTIVE") throw forbidden("Connector is not active.");
    const letter = await DeadLetterModel.findOne({
      _id: deadLetterId,
      connectorId: connector._id,
      organizationId: connector.organizationId,
    });
    if (!letter) throw notFound("Dead-letter entry not found.");
    const retry = await IngestJobModel.findOneAndUpdate(
      {
        _id: letter.jobId,
        connectorId: connector._id,
        organizationId: connector.organizationId,
        state: "DEAD_LETTER",
        credentialEpoch: letter.credentialEpoch,
        mappingVersion: letter.mappingVersion,
        governancePolicyEpoch: letter.governancePolicyEpoch,
      },
      { $set: { state: "QUEUED", nextAttemptAt: new Date(), claimExpiresAt: null } },
      { new: true },
    );
    if (!retry) throw forbidden("Dead-letter job is stale and cannot be retried.");
    await letter.deleteOne();
    await writeAudit(actor, connector, "CONNECTOR_DEAD_LETTER_RETRY_REQUESTED");
    return { data: { id: String(retry._id), state: retry.state } };
  },

  async activate(actor: AuthUser, connectorId: string) {
    if (!isValidObjectId(connectorId))
      throw badRequest("connectorId must be a valid ObjectId.");
    const connector =
      await ConnectorModel.findById(connectorId).select("+secretRef");
    if (!connector) throw notFound("Connector not found.");
    const organizationId = String(connector.organizationId);
    if (!isPlatformAdmin(actor) && !isTenantAdmin(actor, organizationId))
      throw forbidden("Connector access denied.");
    const activation = await ConnectorModel.updateOne(
      {
        _id: connector._id,
        organizationId,
        state: { $in: ["DRAFT", "BLOCKED", "DISABLED"] },
        credentialEpoch: connector.credentialEpoch,
        mappingVersion: connector.mappingVersion,
        governancePolicyEpoch: connector.governancePolicyEpoch,
      },
      {
        $set: { state: "ACTIVE", nextRunAt: nextScheduledRunAt() },
        $inc: { scheduleGeneration: 1 },
      },
    );
    if (!activation.modifiedCount)
      throw forbidden("Connector changed while activation was in progress.");
    await writeAudit(actor, connector, "CONNECTOR_ACTIVATED");
    const updated = await ConnectorModel.findById(connector._id).lean();
    return { data: responseData(updated as Record<string, any>) };
  },

  async disable(actor: AuthUser, connectorId: string) {
    const connector = await ConnectorModel.findById(connectorId);
    if (!connector) throw notFound("Connector not found.");
    const organizationId = String(connector.organizationId);
    if (!isPlatformAdmin(actor) && !isTenantAdmin(actor, organizationId))
      throw forbidden("Connector access denied.");
    connector.state = "DISABLED";
    connector.credentialEpoch += 1;
    connector.scheduleGeneration += 1;
    connector.leaseUntil = null;
    connector.nextRunAt = null;
    await connector.save();
    await IngestJobModel.updateMany(
      { connectorId: connector._id, organizationId: connector.organizationId, state: "QUEUED" },
      { $set: { state: "FAILED", claimExpiresAt: null } },
    );
    await writeAudit(actor, connector, "CONNECTOR_DISABLED");
    return { data: responseData(connector.toJSON()) };
  },

  async requestManualRun(actor: AuthUser, connectorId: string) {
    const connector = await ConnectorModel.findById(connectorId).lean();
    if (!connector) throw notFound("Connector not found.");
    const organizationId = String(connector.organizationId);
    if (!isPlatformAdmin(actor) && !isTenantAdmin(actor, organizationId))
      throw forbidden("Connector access denied.");
    if (connector.state !== "ACTIVE")
      throw forbidden("Connector is not active.");
    const scheduledFor = new Date();
    const idempotencyKey = `manual:${randomUUID()}`;
    const job = await IngestJobModel.findOneAndUpdate(
      {
        connectorId,
        organizationId,
        credentialEpoch: connector.credentialEpoch,
        mappingVersion: connector.mappingVersion,
        governancePolicyEpoch: connector.governancePolicyEpoch,
        idempotencyKey,
      },
      {
        $setOnInsert: {
          connectorId,
          organizationId,
          runType: "MANUAL",
          state: "QUEUED",
          scheduledFor,
          nextAttemptAt: scheduledFor,
          credentialEpoch: connector.credentialEpoch,
          mappingVersion: connector.mappingVersion,
          governancePolicyEpoch: connector.governancePolicyEpoch,
          idempotencyKey,
        },
      },
      { new: true, upsert: true },
    );
    await writeAudit(actor, connector, "CONNECTOR_MANUAL_RUN_REQUESTED");
    return { data: { id: String(job._id), state: job.state } };
  },

  async enqueueScheduled(now = new Date()): Promise<number> {
    if (!isScheduledWindow(now)) return 0;
    const due = await ConnectorModel.find({
      state: "ACTIVE",
      nextRunAt: { $lte: now },
    }).lean();
    for (const connector of due) {
      const connectorId = String(connector._id);
      const organizationId = String(connector.organizationId);
      const scheduledFor = new Date(connector.nextRunAt ?? now);
      const idempotencyKey = `scheduled:${connectorId}:${connector.scheduleGeneration}:${scheduledFor.getTime()}`;
      await IngestJobModel.updateOne(
        { connectorId, idempotencyKey },
        {
          $setOnInsert: {
            connectorId,
            organizationId,
            idempotencyKey,
            runType: "SCHEDULED",
            state: "QUEUED",
            scheduledFor,
            nextAttemptAt: scheduledFor,
            credentialEpoch: connector.credentialEpoch,
            mappingVersion: connector.mappingVersion,
            governancePolicyEpoch: connector.governancePolicyEpoch,
          },
        },
        { upsert: true },
      );
      await ConnectorModel.updateOne(
        {
          _id: connector._id,
          organizationId: connector.organizationId,
          state: "ACTIVE",
          scheduleGeneration: connector.scheduleGeneration,
          credentialEpoch: connector.credentialEpoch,
          mappingVersion: connector.mappingVersion,
          governancePolicyEpoch: connector.governancePolicyEpoch,
        },
        { $set: { nextRunAt: nextScheduledRunAt(now) } },
      );
    }
    return due.length;
  },
};
