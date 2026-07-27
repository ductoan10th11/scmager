import { isValidObjectId } from "mongoose";
import mongoose from "mongoose";
import ConnectorModel from "../models/connector.model";
import DocumentModel from "../models/document.model";
import OutgoingDocumentModel from "../models/outgoing-document.model";
import { badRequest, conflict } from "../utils/http-error";

export type ConnectorScope = {
  organizationId: string;
  connectorId: string;
  sourceSystem: string;
  externalSourceId: string;
};

export type FencedConnectorIdentity = Pick<
  ConnectorScope,
  "organizationId" | "connectorId"
> & {
  fenceToken: number;
  credentialEpoch: number;
  mappingVersion: number;
  governancePolicyEpoch: number;
};

export type FencedConnectorScope = ConnectorScope & FencedConnectorIdentity;

const assertScope = (scope: ConnectorScope): void => {
  if (
    !isValidObjectId(scope.organizationId) ||
    !isValidObjectId(scope.connectorId)
  ) {
    throw badRequest("Trusted Connector scope is invalid.");
  }
  if (!scope.sourceSystem.trim() || !scope.externalSourceId.trim()) {
    throw badRequest("Source identity is required.");
  }
};

const filter = (scope: ConnectorScope) => ({
  organizationId: scope.organizationId,
  connectorId: scope.connectorId,
  sourceSystem: scope.sourceSystem,
  externalSourceId: scope.externalSourceId,
});

const fenceFilter = (scope: FencedConnectorIdentity) => ({
  _id: scope.connectorId,
  organizationId: scope.organizationId,
  state: "ACTIVE",
  activeFenceToken: scope.fenceToken,
  credentialEpoch: scope.credentialEpoch,
  mappingVersion: scope.mappingVersion,
  governancePolicyEpoch: scope.governancePolicyEpoch,
  leaseUntil: { $gt: new Date() },
});

const assertFencedScope = (scope: FencedConnectorScope): void => {
  assertScope(scope);
  if (
    !Number.isSafeInteger(scope.fenceToken) ||
    !Number.isSafeInteger(scope.credentialEpoch) ||
    !Number.isSafeInteger(scope.mappingVersion) ||
    !Number.isSafeInteger(scope.governancePolicyEpoch)
  ) {
    throw badRequest("Fenced Connector scope is invalid.");
  }
};

const fencedUpsert = async <T>(
  scope: FencedConnectorScope,
  write: (session: mongoose.ClientSession) => Promise<T>,
): Promise<T> => {
  assertFencedScope(scope);
  const session = await mongoose.startSession();
  try {
    let result: T | undefined;
    await session.withTransaction(async () => {
      // This conditional write makes the Connector fence part of the same
      // transaction as the source mutation. Rotation/revocation conflicts the
      // transaction instead of allowing an old worker to commit source data.
      const heartbeat = await ConnectorModel.updateOne(
        fenceFilter(scope),
        { $set: { leaseUntil: new Date(Date.now() + 60_000) } },
        { session },
      );
      if (!heartbeat.modifiedCount) throw conflict("Connector fence is stale.");
      result = await write(session);
    });
    if (!result) throw conflict("Tenant source upsert failed.");
    return result;
  } finally {
    await session.endSession();
  }
};

/** Connector-only persistence API. Callers must obtain scope from a fenced run. */
export const tenantSourceRepository = {
  async upsertFencedIncoming(
    scope: FencedConnectorScope,
    source: Record<string, unknown>,
  ) {
    return fencedUpsert(scope, async (session) => {
      const result = await DocumentModel.findOneAndUpdate(
        filter(scope),
        {
          $set: { ...source, ...filter(scope) },
          $setOnInsert: { documentId: scope.externalSourceId },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true, session },
      );
      if (!result) throw conflict("Tenant source upsert failed.");
      return result;
    });
  },

  async upsertFencedOutgoing(
    scope: FencedConnectorScope,
    source: Record<string, unknown>,
  ) {
    const sourceDocuments = Array.isArray(source.sourceDocuments)
      ? source.sourceDocuments.map(String)
      : [];
    if (!sourceDocuments.length)
      throw badRequest("Outgoing source records require an incoming source document.");
    return fencedUpsert(scope, async (session) => {
      const linked = await DocumentModel.countDocuments({
        _id: { $in: sourceDocuments },
        organizationId: scope.organizationId,
        connectorId: scope.connectorId,
      }).session(session);
      if (linked !== sourceDocuments.length)
        throw badRequest("Outgoing source links must remain inside the Connector scope.");
      const result = await OutgoingDocumentModel.findOneAndUpdate(
        filter(scope),
        {
          $set: { ...source, ...filter(scope) },
          $setOnInsert: { documentId: scope.externalSourceId },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true, session },
      );
      if (!result) throw conflict("Tenant outgoing source upsert failed.");
      return result;
    });
  },

  listIncoming(organizationId: string, connectorId: string) {
    if (!isValidObjectId(organizationId) || !isValidObjectId(connectorId))
      throw badRequest("Scope is invalid.");
    return DocumentModel.find({ organizationId, connectorId }).lean();
  },
};
