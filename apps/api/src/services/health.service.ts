import mongoose from "mongoose";
import { getRuntimeConfig } from "../configs/runtime-config";
import { secretProvider } from "../secrets/secret-provider";

export type HealthResponse = {
  status: "ok" | "degraded";
  checks: Record<string, boolean>;
  role: string;
  timestamp: string;
};

export const healthService = {
  live(): HealthResponse {
    return {
      status: "ok",
      checks: { process: true },
      role: getRuntimeConfig().role,
      timestamp: new Date().toISOString(),
    };
  },

  async ready(): Promise<HealthResponse> {
    const config = getRuntimeConfig();
    const secret = await secretProvider()
      .health()
      .catch(() => ({ ready: false, provider: "unavailable" }));
    const checks: Record<string, boolean> = {
      mongo: mongoose.connection.readyState === 1,
      secretProvider: secret.ready,
    };
    // Mongo is the durable job backend for both roles in P3. Attachments are
    // deliberately not a launch dependency and are not checked here.
    checks.jobBackend = checks.mongo;
    const status = Object.values(checks).every(Boolean) ? "ok" : "degraded";
    return {
      status,
      checks,
      role: config.role,
      timestamp: new Date().toISOString(),
    };
  },
};
