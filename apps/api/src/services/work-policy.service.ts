import { WorkDeclarationModel } from '../models';
import { conflict } from '../utils/http-error';
import { workPolicyRepository } from '../repositories/work-policy.repository';

export const WORK_TIME_ZONE = 'Asia/Ho_Chi_Minh';
const VIETNAM_OFFSET_MS = 7 * 60 * 60 * 1_000;

export type EffectiveWorkPolicy = {
  dailyCapacityMinutes: number;
  blockOverCapacity: boolean;
  allowSelfApproval: boolean;
  timeZone: typeof WORK_TIME_ZONE;
};

const DEFAULT_POLICY: EffectiveWorkPolicy = {
  dailyCapacityMinutes: 480,
  blockOverCapacity: true,
  allowSelfApproval: false,
  timeZone: WORK_TIME_ZONE,
};

export const vietnamDateKey = (value: Date): string => {
  const local = new Date(value.getTime() + VIETNAM_OFFSET_MS);
  return local.toISOString().slice(0, 10);
};

export const vietnamDayBounds = (dateKey: string): { start: Date; end: Date } => {
  const [year, month, day] = dateKey.split('-').map(Number);
  const start = new Date(Date.UTC(year, month - 1, day) - VIETNAM_OFFSET_MS);
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1_000) };
};

export const vietnamDaysTouched = (startAt: Date, endAt: Date): string[] => {
  const days: string[] = [];
  let cursor = vietnamDayBounds(vietnamDateKey(startAt)).start;
  // End is exclusive, so an item ending at exactly midnight belongs only to
  // the preceding Vietnam day.
  const lastMoment = new Date(endAt.getTime() - 1);
  const last = vietnamDayBounds(vietnamDateKey(lastMoment)).start.getTime();
  while (cursor.getTime() <= last) {
    days.push(vietnamDateKey(cursor));
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1_000);
  }
  return days;
};

export const vietnamPeriodKey = (value: Date): string => vietnamDateKey(value).slice(0, 7);

export const workingDaysLate = (deadline: Date, submittedAt: Date): number => {
  const deadlineKey = vietnamDateKey(deadline);
  const submittedKey = vietnamDateKey(submittedAt);
  if (submittedKey <= deadlineKey) return 0;

  let cursor = vietnamDayBounds(deadlineKey).start;
  const submittedStart = vietnamDayBounds(submittedKey).start.getTime();
  let days = 0;
  while (cursor.getTime() < submittedStart) {
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
    const weekday = new Date(cursor.getTime() + VIETNAM_OFFSET_MS).getUTCDay();
    if (weekday !== 0 && weekday !== 6) days += 1;
  }
  return days;
};

export const overlapMinutes = (startAt: Date, endAt: Date, rangeStart: Date, rangeEnd: Date): number => (
  Math.max(0, Math.round((Math.min(endAt.getTime(), rangeEnd.getTime()) - Math.max(startAt.getTime(), rangeStart.getTime())) / 60_000))
);

export const getEffectiveWorkPolicy = async (organization: string): Promise<EffectiveWorkPolicy> => {
  const configured: any = await workPolicyRepository.findForOrganization(organization);
  if (!configured) return { ...DEFAULT_POLICY };
  return {
    dailyCapacityMinutes: Number(configured.dailyCapacityMinutes) || DEFAULT_POLICY.dailyCapacityMinutes,
    blockOverCapacity: configured.blockOverCapacity !== false,
    allowSelfApproval: configured.allowSelfApproval === true,
    timeZone: WORK_TIME_ZONE,
  };
};

export const ensureDailyCapacity = async (
  organization: string,
  ownerId: string,
  workStartAt: Date,
  workEndAt: Date,
  policy: EffectiveWorkPolicy,
  excludeId?: string,
  session?: any,
): Promise<void> => {
  if (!policy.blockOverCapacity) return;
  for (const day of vietnamDaysTouched(workStartAt, workEndAt)) {
    const { start, end } = vietnamDayBounds(day);
    const filter: Record<string, unknown> = {
      organization,
      createdBy: ownerId,
      status: { $ne: 'CANCELLED' },
      workStartAt: { $lt: end },
      workEndAt: { $gt: start },
    };
    if (excludeId) filter._id = { $ne: excludeId };
    const existing = await WorkDeclarationModel.find(filter)
      .select('workStartAt workEndAt')
      .session(session ?? null)
      .lean();
    const used = existing.reduce((total: number, item: any) => (
      total + overlapMinutes(new Date(item.workStartAt), new Date(item.workEndAt), start, end)
    ), 0) + overlapMinutes(workStartAt, workEndAt, start, end);
    if (used > policy.dailyCapacityMinutes) {
      throw conflict('Khai báo vượt định mức công việc trong ngày theo giờ Việt Nam.', {
        date: day,
        usedMinutes: used,
        capacityMinutes: policy.dailyCapacityMinutes,
        timeZone: WORK_TIME_ZONE,
      });
    }
  }
};
