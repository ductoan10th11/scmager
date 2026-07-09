import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { connectDB } from '../configs/mongo';
import TaskModel from '../models/task.model';
import {
  allocateSequentialSchedule,
  scheduleEnvelope,
} from '../services/task-scheduler.service';

dotenv.config();

const run = async () => {
  await connectDB();
  const tasks = await TaskModel.find({
    assignedTo: { $ne: null },
    status: { $nin: ['DONE', 'CANCELLED'] },
    estimatedMinutes: { $gte: 15 },
    $or: [
      { scheduleSegments: { $exists: false } },
      { scheduleSegments: { $size: 0 } },
    ],
  }).sort({ assignedAt: 1 });

  let updated = 0;
  let skipped = 0;
  for (const task of tasks) {
    try {
      const scheduleSegments = await allocateSequentialSchedule({
        userId: String((task as any).assignedTo),
        estimatedMinutes: Number((task as any).estimatedMinutes),
        dueAt: (task as any).dueAt ? new Date((task as any).dueAt) : undefined,
        excludeTaskIds: [String((task as any)._id)],
      });
      const envelope = scheduleEnvelope(scheduleSegments);
      (task as any).scheduleSegments = scheduleSegments;
      (task as any).scheduledStartAt = envelope.scheduledStartAt;
      (task as any).scheduledEndAt = envelope.scheduledEndAt;
      await task.save();
      updated += 1;
    } catch (error) {
      skipped += 1;
      console.warn(`Skipped task ${(task as any)._id}:`, (error as Error).message);
    }
  }

  console.log(`Task schedule backfill complete: ${updated} updated, ${skipped} skipped.`);
  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error('Task schedule backfill failed:', error);
  await mongoose.disconnect();
  process.exit(1);
});
