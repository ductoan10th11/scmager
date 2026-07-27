import "dotenv/config";
import { createServer } from "http";
import app from "./src/app";
import { connectDB } from "./src/configs/mongo";
import { seedDefaultAdmin } from "./src/seed/default-admin";
import { initializeIngestSocket } from "./src/realtime/ingest.socket";
import { ingestCronService } from "./src/services/ingest-cron.service";
import { assertRuntimeConfig } from "./src/configs/runtime-config";

const PORT = process.env.PORT || 8004;

const bootstrap = async () => {
  const config = assertRuntimeConfig();
  if (config.role !== "api")
    throw new Error("APP_ROLE must be api for the API process.");
  await connectDB();
  await seedDefaultAdmin();
  const server = createServer(app);
  initializeIngestSocket(server);

  if (process.env.EXTENSION_STATUS_INGEST_AUTOSTART === "true") {
    ingestCronService.startSystem();
  }

  server.listen(PORT, () => {
    console.log(`🚀 Server is running on port ${PORT}`);
  });
};

bootstrap().catch((error) => {
  console.error("❌ Server bootstrap failed:", error);
  process.exit(1);
});
