import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { connectDB } from '../configs/mongo';
import DocumentModel from '../models/document.model';
import { getLatestTrackLogPoint } from '../services/langson-dwr.service';

dotenv.config();

const run = async () => {
  await connectDB();
  const documents = await DocumentModel.find({}).select('_id trackLogs point pointSource');
  const now = new Date();
  const operations = documents.map((document) => {
    const extracted = getLatestTrackLogPoint((document as any).trackLogs ?? []);
    return {
      updateOne: {
        filter: { _id: document._id },
        update: {
          $set: {
            point: extracted?.point ?? 0,
            pointSource: extracted
              ? { trackLogId: extracted.trackLogId, comment: extracted.comment, extractedAt: now }
              : { trackLogId: null, comment: null, extractedAt: null },
          },
        },
      },
    };
  });

  if (operations.length) await DocumentModel.bulkWrite(operations);
  const withPoint = documents.filter((document) => getLatestTrackLogPoint((document as any).trackLogs ?? [])).length;
  console.log(`Document point backfill complete: ${documents.length} scanned, ${withPoint} with point.`);
  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error('Document point backfill failed:', error);
  await mongoose.disconnect();
  process.exit(1);
});
