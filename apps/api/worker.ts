import "dotenv/config";
import { connectDB } from "./src/configs/mongo";
import { assertRuntimeConfig } from "./src/configs/runtime-config";
import { ingestWorkerService } from "./src/services/ingest-worker.service";
import { notificationPublisherService } from "./src/services/notification.service";

const configuredPollMs = Number(process.env.WORKER_POLL_MS ?? 15_000);
const pollMs = Number.isFinite(configuredPollMs)
  ? Math.max(5_000, configuredPollMs)
  : 15_000;

const bootstrap = async (): Promise<void> => {
  const config = assertRuntimeConfig();
  if (config.role !== "worker")
    throw new Error("APP_ROLE must be worker for the worker process.");
  await connectDB();
  let ticking = false;
  const tick = async () => {
    if (ticking) return;
    ticking = true;
    try {
      await Promise.all([ingestWorkerService.tick(), notificationPublisherService.tick()]);
    } catch (error) {
      console.error(
        "Ingest worker tick failed:",
        error instanceof Error ? error.message : "unknown error",
      );
    } finally {
      ticking = false;
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), pollMs);
  const shutdown = () => {
    clearInterval(timer);
    process.exit(0);
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
};

bootstrap().catch((error) => {
  console.error(
    "Worker bootstrap failed:",
    error instanceof Error ? error.message : "unknown error",
  );
  process.exit(1);
});
