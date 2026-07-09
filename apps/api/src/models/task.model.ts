import { Schema, model, models } from 'mongoose';
import { DOCUMENT_SOURCES, PRIORITIES, TASK_STATUSES, TASK_TYPES } from './enums';

const taskAssignmentHistorySchema = new Schema(
  {
    assignedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    assignedTo: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    assignedDepartment: { type: Schema.Types.ObjectId, ref: 'Department', default: null },
    note: { type: String, trim: true },
    assignedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const reviewSchema = new Schema(
  {
    submittedAt: { type: Date },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date },
    result: { type: String, enum: ['PENDING', 'APPROVED', 'RETURNED'], default: 'PENDING' },
    score: { type: Number, min: 0, max: 100 },
    note: { type: String, trim: true },
  },
  { _id: false },
);

const scheduleSegmentSchema = new Schema(
  {
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
  },
  { _id: false },
);

const taskSchema = new Schema(
  {
    organization: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    department: { type: Schema.Types.ObjectId, ref: 'Department', default: null, index: true },
    sourceDocument: { type: Schema.Types.ObjectId, ref: 'IncomingDocument', default: null, index: true },
    parentTask: { type: Schema.Types.ObjectId, ref: 'Task', default: null, index: true },
    type: { type: String, enum: [...TASK_TYPES], required: true, index: true },
    source: { type: String, enum: [...DOCUMENT_SOURCES], default: 'MANUAL', index: true },
    title: { type: String, required: true, trim: true, index: 'text' },
    description: { type: String, trim: true },
    status: { type: String, enum: [...TASK_STATUSES], default: 'TODO', index: true },
    priority: { type: String, enum: [...PRIORITIES], default: 'MEDIUM', index: true },
    assignedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    assignedTo: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    assignedDepartment: { type: Schema.Types.ObjectId, ref: 'Department', default: null, index: true },
    assignedAt: { type: Date, default: Date.now, index: true },
    acceptedAt: { type: Date },
    scheduleSegments: { type: [scheduleSegmentSchema], default: [] },
    scheduledStartAt: { type: Date, index: true },
    scheduledEndAt: { type: Date },
    startAt: { type: Date, index: true },
    endAt: { type: Date },
    dueAt: { type: Date, index: true },
    estimatedMinutes: { type: Number, min: 0, default: 0 },
    actualMinutes: { type: Number, min: 0, default: 0 },
    location: { type: String, trim: true },
    isAllDay: { type: Boolean, default: false },
    completedAt: { type: Date },
    tags: { type: [String], default: [], index: true },
    attachments: [{ type: Schema.Types.ObjectId, ref: 'FileAttachment' }],
    assignmentHistory: { type: [taskAssignmentHistorySchema], default: [] },
    review: { type: reviewSchema, default: () => ({}) },
    ai: {
      suggested: { type: Boolean, default: false },
      confidence: { type: Number, min: 0, max: 1 },
      rationale: { type: String, trim: true },
    },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

taskSchema.index({ organization: 1, status: 1, dueAt: 1 });
taskSchema.index({ department: 1, assignedTo: 1, status: 1 });
taskSchema.index({ assignedTo: 1, scheduledStartAt: 1, scheduledEndAt: 1 });
taskSchema.index({ type: 1, startAt: 1 });

export const TaskModel = models.Task || model('Task', taskSchema);
export default TaskModel;
