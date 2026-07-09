import { Types } from 'mongoose';
import TaskModel from '../models/task.model';
import { conflict } from '../utils/http-error';

export type ScheduleSegment = {
  startAt: Date;
  endAt: Date;
};

const TZ_OFFSET_MINUTES = Number(process.env.WORK_TIMEZONE_OFFSET_MINUTES ?? 420);
const STEP_MINUTES = 15;
const STEP_MS = STEP_MINUTES * 60000;
const ACTIVE_FILTER = { $nin: ['DONE', 'CANCELLED'] };
const WORK_PERIODS = [
  [8 * 60, 12 * 60],
  [13 * 60, 17 * 60],
] as const;

const shiftedParts = (date: Date) => {
  const shifted = new Date(date.getTime() + TZ_OFFSET_MINUTES * 60000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    weekDay: shifted.getUTCDay(),
  };
};

const businessDateAt = (
  parts: { year: number; month: number; day: number },
  minutes: number,
) => new Date(
  Date.UTC(parts.year, parts.month, parts.day, 0, minutes)
    - TZ_OFFSET_MINUTES * 60000,
);

const addBusinessDays = (
  parts: { year: number; month: number; day: number },
  days: number,
) => {
  const date = new Date(Date.UTC(parts.year, parts.month, parts.day + days));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth(),
    day: date.getUTCDate(),
    weekDay: date.getUTCDay(),
  };
};

const ceilToStep = (date: Date) => new Date(Math.ceil(date.getTime() / STEP_MS) * STEP_MS);
const minutesBetween = (startAt: Date, endAt: Date) =>
  Math.max(Math.round((endAt.getTime() - startAt.getTime()) / 60000), 0);

const normalizeSegments = (task: any): ScheduleSegment[] => {
  if (Array.isArray(task.scheduleSegments) && task.scheduleSegments.length > 0) {
    return task.scheduleSegments
      .map((segment: any) => ({
        startAt: new Date(segment.startAt),
        endAt: new Date(segment.endAt),
      }))
      .filter((segment: ScheduleSegment) => (
        !Number.isNaN(segment.startAt.getTime())
        && !Number.isNaN(segment.endAt.getTime())
        && segment.endAt > segment.startAt
      ));
  }
  if (task.scheduledStartAt && task.scheduledEndAt) {
    return [{
      startAt: new Date(task.scheduledStartAt),
      endAt: new Date(task.scheduledEndAt),
    }];
  }
  return [];
};

const mergeIntervals = (segments: ScheduleSegment[]) => {
  const sorted = [...segments].sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  const merged: ScheduleSegment[] = [];
  for (const segment of sorted) {
    const last = merged[merged.length - 1];
    if (!last || segment.startAt > last.endAt) {
      merged.push({ ...segment });
    } else if (segment.endAt > last.endAt) {
      last.endAt = segment.endAt;
    }
  }
  return merged;
};

const freeGaps = (
  rangeStart: Date,
  rangeEnd: Date,
  occupied: ScheduleSegment[],
) => {
  const gaps: ScheduleSegment[] = [];
  let cursor = rangeStart;
  for (const segment of mergeIntervals(occupied)) {
    if (segment.endAt <= cursor || segment.startAt >= rangeEnd) continue;
    const clippedStart = segment.startAt < rangeStart ? rangeStart : segment.startAt;
    const clippedEnd = segment.endAt > rangeEnd ? rangeEnd : segment.endAt;
    if (clippedStart > cursor) gaps.push({ startAt: cursor, endAt: clippedStart });
    if (clippedEnd > cursor) cursor = clippedEnd;
  }
  if (cursor < rangeEnd) gaps.push({ startAt: cursor, endAt: rangeEnd });
  return gaps;
};

const taskSegmentsForUsers = async (
  userIds: string[],
  excludeTaskIds: string[] = [],
) => {
  const tasks = await TaskModel.find({
    assignedTo: { $in: userIds.map((id) => new Types.ObjectId(id)) },
    status: ACTIVE_FILTER,
    ...(excludeTaskIds.length
      ? { _id: { $nin: excludeTaskIds.map((id) => new Types.ObjectId(id)) } }
      : {}),
  }).select('_id assignedTo scheduleSegments scheduledStartAt scheduledEndAt estimatedMinutes type');

  const result = new Map<string, ScheduleSegment[]>();
  for (const userId of userIds) result.set(userId, []);
  for (const task of tasks) {
    const userId = String((task as any).assignedTo);
    result.get(userId)?.push(...normalizeSegments(task));
  }
  return result;
};

export const scheduleEnvelope = (segments: ScheduleSegment[]) => {
  if (!segments.length) return { scheduledStartAt: undefined, scheduledEndAt: undefined };
  const sorted = [...segments].sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  return {
    scheduledStartAt: sorted[0].startAt,
    scheduledEndAt: sorted[sorted.length - 1].endAt,
  };
};

export const allocateSequentialSchedule = async ({
  userId,
  estimatedMinutes,
  dueAt,
  earliestAt = new Date(),
  extraOccupied = [],
  excludeTaskIds = [],
}: {
  userId: string;
  estimatedMinutes: number;
  dueAt?: Date;
  earliestAt?: Date;
  extraOccupied?: ScheduleSegment[];
  excludeTaskIds?: string[];
}) => {
  if (estimatedMinutes < STEP_MINUTES) {
    throw conflict(`Task duration must be at least ${STEP_MINUTES} minutes.`);
  }

  const occupiedByUser = await taskSegmentsForUsers([userId], excludeTaskIds);
  const occupied = [...(occupiedByUser.get(userId) ?? []), ...extraOccupied];
  const deadlineParts = dueAt ? shiftedParts(dueAt) : null;
  const startParts = shiftedParts(earliestAt);
  const result: ScheduleSegment[] = [];
  let remaining = Math.ceil(estimatedMinutes / STEP_MINUTES) * STEP_MINUTES;

  for (let offset = 0; offset < 366 && remaining > 0; offset += 1) {
    const day = addBusinessDays(startParts, offset);
    if ([0, 6].includes(day.weekDay)) continue;
    if (deadlineParts) {
      const dayStamp = Date.UTC(day.year, day.month, day.day);
      const deadlineStamp = Date.UTC(deadlineParts.year, deadlineParts.month, deadlineParts.day);
      if (dayStamp > deadlineStamp) break;
    }

    for (const [periodStartMinutes, periodEndMinutes] of WORK_PERIODS) {
      let periodStart = businessDateAt(day, periodStartMinutes);
      const periodEnd = businessDateAt(day, periodEndMinutes);
      if (offset === 0 && earliestAt > periodStart) periodStart = ceilToStep(earliestAt);
      if (periodStart >= periodEnd) continue;

      for (const gap of freeGaps(periodStart, periodEnd, occupied)) {
        const available = Math.floor(minutesBetween(gap.startAt, gap.endAt) / STEP_MINUTES)
          * STEP_MINUTES;
        if (available < STEP_MINUTES) continue;
        const assignedMinutes = Math.min(available, remaining);
        const segment = {
          startAt: gap.startAt,
          endAt: new Date(gap.startAt.getTime() + assignedMinutes * 60000),
        };
        result.push(segment);
        occupied.push(segment);
        remaining -= assignedMinutes;
        if (remaining === 0) break;
      }
      if (remaining === 0) break;
    }
  }

  if (remaining > 0) {
    throw conflict('Không còn đủ thời gian làm việc trước deadline để xếp nhiệm vụ.');
  }
  return result;
};

const isRangeFree = (
  startAt: Date,
  endAt: Date,
  occupied: ScheduleSegment[],
) => !occupied.some((segment) => segment.startAt < endAt && segment.endAt > startAt);

export const assertBusinessSlot = (startAt: Date, endAt: Date) => {
  const startParts = shiftedParts(startAt);
  const endParts = shiftedParts(endAt);
  const shiftedStart = new Date(startAt.getTime() + TZ_OFFSET_MINUTES * 60000);
  const shiftedEnd = new Date(endAt.getTime() + TZ_OFFSET_MINUTES * 60000);
  const sameDay = (
    startParts.year === endParts.year
    && startParts.month === endParts.month
    && startParts.day === endParts.day
  );
  const startMinutes = shiftedStart.getUTCHours() * 60 + shiftedStart.getUTCMinutes();
  const endMinutes = shiftedEnd.getUTCHours() * 60 + shiftedEnd.getUTCMinutes();
  const insideWorkPeriod = WORK_PERIODS.some(([periodStart, periodEnd]) => (
    startMinutes >= periodStart && endMinutes <= periodEnd
  ));
  if (
    !sameDay
    || [0, 6].includes(startParts.weekDay)
    || !insideWorkPeriod
    || startAt < new Date()
  ) {
    throw conflict('Cuộc họp phải nằm trong giờ làm việc tương lai (08:00-12:00, 13:00-17:00).');
  }
};

export const findNearestCommonSlot = async ({
  userIds,
  durationMinutes,
  earliestAt = new Date(),
}: {
  userIds: string[];
  durationMinutes: number;
  earliestAt?: Date;
}) => {
  const occupiedByUser = await taskSegmentsForUsers(userIds);
  const startParts = shiftedParts(earliestAt);
  const duration = Math.ceil(durationMinutes / STEP_MINUTES) * STEP_MINUTES;

  for (let offset = 0; offset < 60; offset += 1) {
    const day = addBusinessDays(startParts, offset);
    if ([0, 6].includes(day.weekDay)) continue;
    for (const [periodStartMinutes, periodEndMinutes] of WORK_PERIODS) {
      let cursor = businessDateAt(day, periodStartMinutes);
      const periodEnd = businessDateAt(day, periodEndMinutes);
      if (offset === 0 && earliestAt > cursor) cursor = ceilToStep(earliestAt);
      while (cursor.getTime() + duration * 60000 <= periodEnd.getTime()) {
        const endAt = new Date(cursor.getTime() + duration * 60000);
        const freeForAll = userIds.every((userId) => (
          isRangeFree(cursor, endAt, occupiedByUser.get(userId) ?? [])
        ));
        if (freeForAll) return { startAt: cursor, endAt };
        cursor = new Date(cursor.getTime() + STEP_MS);
      }
    }
  }
  throw conflict('Không tìm thấy khung giờ trống chung trong 60 ngày tới.');
};

export const insertMeetingAndReschedule = async ({
  userIds,
  meetingStartAt,
  meetingEndAt,
}: {
  userIds: string[];
  meetingStartAt: Date;
  meetingEndAt: Date;
}) => {
  if (meetingEndAt <= meetingStartAt) throw conflict('Thời gian họp không hợp lệ.');
  const tasks = await TaskModel.find({
    assignedTo: { $in: userIds.map((id) => new Types.ObjectId(id)) },
    status: ACTIVE_FILTER,
    type: { $ne: 'INVITATION' },
  }).sort({ scheduledStartAt: 1 });

  const meetingSegment = { startAt: meetingStartAt, endAt: meetingEndAt };
  for (const task of tasks) {
    const existing = normalizeSegments(task);
    if (!existing.some((segment) => (
      segment.startAt < meetingEndAt && segment.endAt > meetingStartAt
    ))) continue;

    const kept: ScheduleSegment[] = [];
    for (const segment of existing) {
      if (segment.endAt <= meetingStartAt || segment.startAt >= meetingEndAt) {
        kept.push(segment);
        continue;
      }
      if (segment.startAt < meetingStartAt) {
        kept.push({ startAt: segment.startAt, endAt: meetingStartAt });
      }
      if (segment.endAt > meetingEndAt) {
        kept.push({ startAt: meetingEndAt, endAt: segment.endAt });
      }
    }

    const keptMinutes = kept.reduce(
      (sum, segment) => sum + minutesBetween(segment.startAt, segment.endAt),
      0,
    );
    const remainingMinutes = Math.max(Number((task as any).estimatedMinutes) - keptMinutes, 0);
    const replacement = remainingMinutes >= STEP_MINUTES
      ? await allocateSequentialSchedule({
          userId: String((task as any).assignedTo),
          estimatedMinutes: remainingMinutes,
          dueAt: (task as any).dueAt ? new Date((task as any).dueAt) : undefined,
          earliestAt: meetingEndAt,
          extraOccupied: [meetingSegment, ...kept],
          excludeTaskIds: [String((task as any)._id)],
        })
      : [];
    const nextSegments = [...kept, ...replacement]
      .sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
    const envelope = scheduleEnvelope(nextSegments);
    (task as any).scheduleSegments = nextSegments;
    (task as any).scheduledStartAt = envelope.scheduledStartAt;
    (task as any).scheduledEndAt = envelope.scheduledEndAt;
    await task.save();
  }
};

export const normalizeTaskSegments = normalizeSegments;
