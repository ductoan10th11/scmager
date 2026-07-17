import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { connectDB } from '../configs/mongo';
import DocumentModel from '../models/document.model';
import { resolveDocumentWorkflow } from '../services/document-workflow.service';

dotenv.config();

const run = async () => {
  await connectDB();
  const documents = await DocumentModel.find({}).select('_id trackLogs ingest.completed');
  const operations = await Promise.all(documents.map(async (document: any) => ({
    updateOne: {
      filter: { _id: document._id },
      update: { $set: { processing: await resolveDocumentWorkflow(document.trackLogs ?? [], Boolean(document.ingest?.completed)) } },
    },
  })));
  if (operations.length) await DocumentModel.bulkWrite(operations);
  const active = operations.filter((operation: any) => operation.updateOne.update.$set.processing.status === 'IN_PROGRESS').length;
  console.log(`Document workflow backfill complete: ${documents.length} scanned, ${active} in progress.`);
  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error('Document workflow backfill failed:', error);
  await mongoose.disconnect();
  process.exit(1);
});
