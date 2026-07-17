import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { connectDB } from '../configs/mongo';
import DocumentModel from '../models/document.model';

dotenv.config();

const run = async () => {
  await connectDB();
  const result = await DocumentModel.deleteMany({ deadline: null });
  console.log(`Document deadline prune complete: ${result.deletedCount} documents removed.`);
  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error('Document deadline prune failed:', error);
  await mongoose.disconnect();
  process.exit(1);
});
