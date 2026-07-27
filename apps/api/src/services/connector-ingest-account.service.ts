import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { getRuntimeConfig } from "../configs/runtime-config";

export type IngestAccount = { username: string; password: string };

const version = "v1";

// This is a stable encryption key derived from the deployment's existing
// JWT_SECRET. It is never persisted or returned from this module.
const encryptionKey = () =>
  createHash("sha256")
    .update("ework:connector-ingest-account:")
    .update(getRuntimeConfig().jwtSecret)
    .digest();

export const encryptIngestAccount = (account: IngestAccount): string => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(account), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [version, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
};

export const decryptIngestAccount = (value: string): IngestAccount => {
  try {
    const [storedVersion, ivValue, tagValue, ciphertextValue, extra] = value.split(".");
    if (
      storedVersion !== version ||
      !ivValue ||
      !tagValue ||
      !ciphertextValue ||
      extra !== undefined
    ) {
      throw new Error("invalid payload");
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey(),
      Buffer.from(ivValue, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    const decoded = Buffer.concat([
      decipher.update(Buffer.from(ciphertextValue, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    const account = JSON.parse(decoded) as Partial<IngestAccount>;
    if (
      typeof account.username !== "string" ||
      typeof account.password !== "string" ||
      !account.username ||
      !account.password
    ) {
      throw new Error("invalid account");
    }
    return { username: account.username, password: account.password };
  } catch {
    throw new Error("CONNECTOR_INGEST_ACCOUNT_INVALID");
  }
};
