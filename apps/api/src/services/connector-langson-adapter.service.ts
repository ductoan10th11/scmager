import type { FencedRun } from "./ingest-worker.service";
import type { ConnectorSession } from "./connector-session.service";
import { tenantSourceRepository } from "../repositories/tenant-source.repository";
import type { ConnectorLangsonClient } from "./langson-connector-client.service";

const clientFor = (session: ConnectorSession): ConnectorLangsonClient => {
  if (!session.langson) throw new Error("CONNECTOR_SOURCE_SESSION_UNAVAILABLE");
  return session.langson;
};

/**
 * Minimal production adapter: discover only incoming list records with a
 * deadline and commit each one through the fenced tenant repository. Detail,
 * tracklog, and outgoing enrichment remain separate future adapters rather
 * than falling back to the legacy global ingest pipeline.
 */
export const connectorLangsonSourceAdapter = {
  async ingest(session: ConnectorSession, run: FencedRun): Promise<void> {
    if (run.sourceSystem !== "LANGSON_DWR") throw new Error("CONNECTOR_SOURCE_UNSUPPORTED");
    const records = await clientFor(session).listIncoming();
    for (const record of records) {
      if (!record.documentId || !record.deadline) continue;
      await tenantSourceRepository.upsertFencedIncoming(
        {
          organizationId: run.organizationId,
          connectorId: run.connectorId,
          sourceSystem: run.sourceSystem,
          externalSourceId: record.documentId,
          fenceToken: run.fenceToken,
          credentialEpoch: run.credentialEpoch,
          mappingVersion: run.mappingVersion,
          governancePolicyEpoch: run.governancePolicyEpoch,
        },
        {
          soDen: record.soDen,
          soKyHieu: record.soKyHieu,
          trichYeu: record.trichYeu,
          ngayDen: record.ngayDen,
          doKhan: record.doKhan,
          nguoiXuLy: record.nguoiXuLy,
          deadline: record.deadline,
          ingest: {
            source: "LANGSON_DWR",
            listFetchedAt: new Date(),
            completed: false,
            deadLetter: false,
          },
        },
      );
    }
  },
};
