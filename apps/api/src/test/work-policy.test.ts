import assert from 'node:assert/strict';
import test from 'node:test';
import WorkDeclarationModel from '../models/work-declaration.model';
import {
  overlapMinutes,
  vietnamDateKey,
  vietnamDayBounds,
  vietnamDaysTouched,
  workingDaysLate,
} from '../services/work-policy.service';
import { calculateCreditedPoint, getDocumentPointAssignment } from '../services/kpi.service';

test('work declarations carry a durable revision', () => {
  const revision = WorkDeclarationModel.schema.path('revision') as any;
  assert.ok(revision);
  assert.equal(revision.options.default, 1);
  assert.equal(revision.options.min, 1);
});

test('Vietnam work-day boundaries stay in Asia/Ho_Chi_Minh across UTC midnight', () => {
  const start = new Date('2026-07-21T16:30:00.000Z'); // 23:30 Vietnam
  const end = new Date('2026-07-21T18:30:00.000Z'); // 01:30 Vietnam next day
  assert.equal(vietnamDateKey(start), '2026-07-21');
  assert.equal(vietnamDateKey(end), '2026-07-22');
  assert.deepEqual(vietnamDaysTouched(start, end), ['2026-07-21', '2026-07-22']);
  const firstDay = vietnamDayBounds('2026-07-21');
  assert.equal(overlapMinutes(start, end, firstDay.start, firstDay.end), 30);
});

test('an exact Vietnam midnight end does not consume the next day capacity', () => {
  const start = new Date('2026-07-21T15:00:00.000Z'); // 22:00 Vietnam
  const end = new Date('2026-07-21T17:00:00.000Z'); // 00:00 Vietnam
  assert.deepEqual(vietnamDaysTouched(start, end), ['2026-07-21']);
});

test('late working days include each business day after the deadline through submission', () => {
  const deadline = new Date('2026-07-13T09:00:00+07:00'); // Monday
  const submitted = new Date('2026-07-15T09:00:00+07:00'); // Wednesday
  assert.equal(workingDaysLate(deadline, submitted), 2);
});

test('late working days skip Saturday and Sunday', () => {
  const deadline = new Date('2026-07-10T09:00:00+07:00'); // Friday
  const submitted = new Date('2026-07-13T09:00:00+07:00'); // Monday
  assert.equal(workingDaysLate(deadline, submitted), 1);
});

test('KPI deductions accumulate and never reduce credited point below zero', () => {
  assert.equal(calculateCreditedPoint(10, 1, 2), 2.5);
  assert.equal(calculateCreditedPoint(10, 3, 1), 0);
});

test('document KPI belongs to the recipient of the point assignment, not the first router', () => {
  const assignment = getDocumentPointAssignment({
    point: 5,
    processing: {
      assignees: [
        { userId: 'office-chief', username: 'chanhvanphong-xathientan', assignedAt: '19/07/2026 20:21' },
        { userId: 'specialist', username: 'truongnq', externalUsername: 'truongnq.lsn', assignedAt: '20/07/2026 08:17' },
      ],
    },
    trackLogs: [
      { id: '1', sender: { username: 'vhtung-03.lsn' }, receiver: { username: 'truongnq.lsn' }, content: '[p:5] Giao đ/c Trường thực hiện', completedAt: '20/07/2026 08:17' },
      { id: '2', sender: { username: 'truongnq.lsn' }, content: 'Thao tác: Đã tạo phúc đáp', completedAt: '20/07/2026 11:44' },
      { id: '3', sender: { username: 'vanthu-xathientan' }, content: 'Thao tác: Đã tạo phúc đáp', completedAt: '21/07/2026 07:55' },
    ],
  });

  assert.equal(assignment?.recipient, 'specialist');
  assert.equal(assignment?.point, 5);
  assert.equal(assignment?.submittedAt?.toISOString(), '2026-07-20T04:44:00.000Z');
});

test('legacy tracklogs without ids match the point recipient by assignment time', () => {
  const assignment = getDocumentPointAssignment({
    point: 5,
    processing: {
      assignees: [
        { userId: 'clerk', username: 'vanthu-xathientan', assignedAt: null },
        { userId: 'specialist', username: 'truongnq', externalUsername: 'truongnq.lsn', assignedAt: '20/07/2026 08:17' },
      ],
    },
    trackLogs: [
      { sender: { username: 'vhtung-03.lsn' }, content: '[p:5] Giao việc', completedAt: '20/07/2026 08:17' },
      { sender: { username: 'truongnq.lsn' }, content: 'Thao tác: Đã tạo phúc đáp', completedAt: '20/07/2026 11:44' },
    ],
  });

  assert.equal(assignment?.recipient, 'specialist');
});
