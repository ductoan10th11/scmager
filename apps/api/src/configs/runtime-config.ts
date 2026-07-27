import { badRequest } from "../utils/http-error";

export type RuntimeRole = "api" | "worker";

export type RuntimeConfig = {
  nodeEnv: string;
  role: RuntimeRole;
  mongoUri: string;
  jwtSecret: string;
  secretProvider: "env";
  secretProviderReady: boolean;
};

const required = (name: string, value = process.env[name]): string => {
  if (!value?.trim()) throw new Error(`${name} is required.`);
  return value;
};

export const getRuntimeConfig = (): RuntimeConfig => {
  const nodeEnv = process.env.NODE_ENV ?? "development";
  const role = process.env.APP_ROLE === "worker" ? "worker" : "api";
  const mongoUri = required("MONGO_URI");
  const jwtSecret = required("JWT_SECRET");
  const secretProvider = process.env.SECRET_PROVIDER ?? "env";

  if (secretProvider !== "env") throw new Error("Unsupported SECRET_PROVIDER.");
  if (nodeEnv === "production" && jwtSecret.length < 32) {
    throw new Error("JWT_SECRET must be at least 32 characters in production.");
  }

  return {
    nodeEnv,
    role,
    mongoUri,
    jwtSecret,
    secretProvider: "env",
    secretProviderReady: true,
  };
};

export const assertRuntimeConfig = (): RuntimeConfig => getRuntimeConfig();

export const requireObjectId = (value: unknown, field: string): string => {
  if (typeof value !== "string" || !value.trim())
    throw badRequest(`${field} is required.`);
  return value;
};
