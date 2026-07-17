import 'dotenv/config';
import { createServer } from 'http';
import app from './src/app';
import { connectDB } from './src/configs/mongo';
import { seedDefaultAdmin } from './src/seed/default-admin';
import { initializeIngestSocket } from './src/realtime/ingest.socket';

const PORT = process.env.PORT || 8004;

const bootstrap = async () => {
  await connectDB();
  await seedDefaultAdmin();
  const server = createServer(app);
  initializeIngestSocket(server);

  server.listen(PORT, () => {
    console.log(`🚀 Server is running on port ${PORT}`);
  });
};

bootstrap().catch((error) => {
  console.error('❌ Server bootstrap failed:', error);
  process.exit(1);
});
