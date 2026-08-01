import mongoose from 'mongoose';
import { connectDB } from '../configs/mongo';
import { migrateKpiImportWorksToIncomingDocuments } from '../services/performance-import.service';

const main = async () => {
  await connectDB();
  try {
    console.log(JSON.stringify(await migrateKpiImportWorksToIncomingDocuments()));
  } finally {
    await mongoose.disconnect();
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
