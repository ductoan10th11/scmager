export type SecretHealth = { ready: boolean; provider: string };

/**
 * Secret values are intentionally resolved only at the process boundary. The
 * application persists a reference, never credentials, cookies, or sessions.
 */
export interface SecretProvider {
  get(ref: string): Promise<string>;
  health(): Promise<SecretHealth>;
}

// A secret reference is an opaque provider key, not an environment-variable
// naming convention. Its exact syntax belongs to the configured secret store.
const validReference = (ref: string) =>
  ref.length > 0 && ref.length <= 256 && !/[\u0000-\u001F\u007F]/.test(ref);

class EnvironmentSecretProvider implements SecretProvider {
  async get(ref: string): Promise<string> {
    if (!validReference(ref)) throw new Error("CONNECTOR_SECRET_REFERENCE_INVALID");
    const value = process.env[ref];
    if (!value) throw new Error("CONNECTOR_SECRET_UNAVAILABLE");
    return value;
  }

  async health(): Promise<SecretHealth> {
    return { ready: true, provider: "env" };
  }
}

let provider: SecretProvider = new EnvironmentSecretProvider();

export const secretProvider = (): SecretProvider => provider;

// Test-only dependency injection; production code must use the configured adapter.
export const setSecretProviderForTest = (next: SecretProvider): void => {
  if (process.env.NODE_ENV === "production")
    throw new Error("Secret provider cannot be replaced.");
  provider = next;
};
