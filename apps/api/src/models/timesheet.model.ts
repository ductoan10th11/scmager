import { Schema, model, models } from 'mongoose';
import { TIME_ENTRY_STATUSES, TIMESHEET_STATUSES } from './enums';

const timeEntrySchema = new Schema(
  {
    task: { type: Schema.Types.ObjectId, ref: 'Task', default: null, index: true },
    title: { type: String, required: true, trim: true },
    note: { type: String, trim: true },
    startAt: { type: Date },
    endAt: { type: Date },
    estimatedMinutes: { type: Number, min: 0, required: true },
    actualMinutes: { type: Number, min: 0, default: 0 },
    status: { type: String, enum: [...TIME_ENTRY_STATUSES], default: 'PLANNED' },
  },
  { _id: true },
);

const timesheetSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    organization: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    department: { type: Schema.Types.ObjectId, ref: 'Department', default: null, index: true },
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/, index: true },
    capacityMinutes: { type: Number, default: 480, min: 0 },
    totalEstimatedMinutes: {
      type: Number,
      default: 0,
      min: 0,
      validate: {
        validator(this: { capacityMinutes: number }, value: number) {
          return value <= this.capacityMinutes;
        },
        message: 'Total estimated minutes cannot exceed daily capacity.',
      },
    },
    totalActualMinutes: { type: Number, default: 0, min: 0 },
    entries: { type: [timeEntrySchema], default: [] },
    status: { type: String, enum: [...TIMESHEET_STATUSES], default: 'DRAFT', index: true },
    submittedAt: { type: Date },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date },
    reviewNote: { type: String, trim: true },
  },
  { timestamps: true },
);

timesheetSchema.index({ user: 1, date: 1 }, { unique: true });
timesheetSchema.index({ department: 1, date: 1, status: 1 });

export const TimesheetModel = models.Timesheet || model('Timesheet', timesheetSchema);
export default TimesheetModel;
