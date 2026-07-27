import type { FencedConnectorIdentity } from "./connector-run.types";
import { secretProvider } from "../secrets/secret-provider";
import { decryptIngestAccount } from "./connector-ingest-account.service";
import {
  openConnectorLangsonClient,
  type ConnectorLangsonClient,
} from "./langson-connector-client.service";

export type ConnectorSession = {
  scope: FencedConnectorIdentity;
  langson?: ConnectorLangsonClient;
  dispose(): Promise<void>;
};

export type ConnectorSessionFactory = {
  open(input: {
    scope: FencedConnectorIdentity;
    secretRef?: string;
    ingestAccountCiphertext?: string;
  }): Promise<ConnectorSession>;
};

/**
 * P3 deliberately has no enabled source adapter. This factory only resolves a
 * Connector's secret after its fence has been claimed and keeps any future
 * session material in the single run object. It never writes credentials,
 * cookies, or a shared profile to disk/Mongo.
 */
class EphemeralConnectorSessionFactory implements ConnectorSessionFactory {
  async open(input: {
    scope: FencedConnectorIdentity;
    secretRef?: string;
    ingestAccountCiphertext?: string;
  }): Promise<ConnectorSession> {
    const secret = input.ingestAccountCiphertext
      ? JSON.stringify(decryptIngestAccount(input.ingestAccountCiphertext))
      : input.secretRef
        ? await secretProvider().get(input.secretRef)
        : (() => { throw new Error("CONNECTOR_INGEST_ACCOUNT_UNAVAILABLE"); })();
    const langson = await openConnectorLangsonClient(secret);
    return {
      scope: input.scope,
      langson,
      async dispose() {
        await langson.dispose();
      },
    };
  }
}

let factory: ConnectorSessionFactory = new EphemeralConnectorSessionFactory();

export const connectorSessionFactory = (): ConnectorSessionFactory => factory;

// Test-only injection. The runtime-config gate prevents this from being used
// to select a production secret/session implementation.
export const setConnectorSessionFactoryForTest = (
  next: ConnectorSessionFactory,
): void => {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Connector session factory cannot be replaced.");
  }
  factory = next;
};
