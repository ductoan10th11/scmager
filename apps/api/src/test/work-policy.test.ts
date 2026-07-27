import assert from 'node:assert/strict';
import test from 'node:test';
import WorkDeclarationModel from '../models/work-declaration.model';
import {
  overlapMinutes,
  vietnamDateKey,
  vietnamDayBounds,
  vietnamDaysTouched,
} from '../services/work-policy.service';

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
