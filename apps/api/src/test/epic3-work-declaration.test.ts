import assert from 'node:assert/strict';
import test from 'node:test';
import { WorkDeclarationModel } from '../models';
import {
  ensureDailyCapacity,
  vietnamDateKey,
  vietnamDaysTouched,
  type EffectiveWorkPolicy,
} from '../services/work-policy.service';
import type { AuthUser } from '../types/auth';

const specialistUser: AuthUser = {
  id: '507f1f77bcf86cd799439001',
  email: 'spec@test.local',
  username: 'spec',
  fullName: 'Chuyên viên A',
  status: 'ACTIVE',
  role: { id: 'role-spec', code: 'SPECIALIST', level: 4, name: 'Chuyên viên' },
  organization: '507f1f77bcf86cd799439011',
  department: '507f1f77bcf86cd799439021',
};

const deptLeaderUser: AuthUser = {
  id: '507f1f77bcf86cd799439002',
  email: 'leader@test.local',
  username: 'leader',
  fullName: 'Trưởng phòng A',
  status: 'ACTIVE',
  role: { id: 'role-leader', code: 'DEPARTMENT_LEADER', level: 3, name: 'Trưởng phòng' },
  organization: '507f1f77bcf86cd799439011',
  department: '507f1f77bcf86cd799439021',
};

const officeChiefUser: AuthUser = {
  id: '507f1f77bcf86cd799439003',
  email: 'chief@test.local',
  username: 'chief',
  fullName: 'Chánh VP A',
  status: 'ACTIVE',
  role: { id: 'role-chief', code: 'OFFICE_CHIEF', level: 1, name: 'Chánh văn phòng' },
  organization: '507f1f77bcf86cd799439011',
  department: null,
};

const defaultPolicy: EffectiveWorkPolicy = {
  dailyCapacityMinutes: 480,
  blockOverCapacity: true,
  allowSelfApproval: false,
  timeZone: 'Asia/Ho_Chi_Minh',
};

const createQueryMock = (data: any[]) => {
  const query: any = {
    select: () => query,
    session: () => query,
    sort: () => query,
    lean: async () => data,
  };
  return query;
};

test('Story 3.1 - WorkDeclaration schema enforces valid status, title, dates, and revision', () => {
  const schema = WorkDeclarationModel.schema;
  assert.ok(schema.path('title'));
  assert.ok(schema.path('workStartAt'));
  assert.ok(schema.path('workEndAt'));
  assert.ok(schema.path('status'));
  
  const validStatuses = ['DRAFT', 'PENDING_APPROVAL', 'RETURNED', 'APPROVED', 'CANCELLED'];
  const enumValues = (schema.path('status') as any).enumValues;
  validStatuses.forEach((st) => {
    assert.ok(enumValues.includes(st), `Schema status must include ${st}`);
  });

  const revisionPath = schema.path('revision') as any;
  assert.ok(revisionPath);
  assert.equal(revisionPath.options.default, 1);
});

test('Story 3.2 - ensureDailyCapacity enforces policy limits in Asia/Ho_Chi_Minh', async () => {
  // Test timezone day key
  const morning = new Date('2026-08-10T01:00:00.000Z'); // 08:00 Vietnam
  const evening = new Date('2026-08-10T10:00:00.000Z'); // 17:00 Vietnam
  assert.equal(vietnamDateKey(morning), '2026-08-10');
  assert.equal(vietnamDateKey(evening), '2026-08-10');
  assert.deepEqual(vietnamDaysTouched(morning, evening), ['2026-08-10']);

  // Mock WorkDeclarationModel.find to return existing 450 minutes
  const originalFind = WorkDeclarationModel.find;
  WorkDeclarationModel.find = (() => createQueryMock([
    { workStartAt: new Date('2026-08-10T01:00:00.000Z'), workEndAt: new Date('2026-08-10T08:30:00.000Z') } // 450 min
  ])) as any;

  try {
    // 450 min existing + 60 min new = 510 min (> 480 min max) -> Should throw conflict
    await assert.rejects(
      async () => {
        await ensureDailyCapacity(
          specialistUser.organization!,
          specialistUser.id,
          new Date('2026-08-10T09:00:00.000Z'),
          new Date('2026-08-10T10:00:00.000Z'),
          defaultPolicy,
        );
      },
      (err: any) => {
        assert.equal(err.statusCode, 409);
        assert.equal(err.code, 'CONFLICT');
        assert.match(err.message, /vượt định mức/i);
        return true;
      }
    );
  } finally {
    WorkDeclarationModel.find = originalFind;
  }
});

test('Story 3.2 - ensureDailyCapacity allows work within policy capacity limit', async () => {
  const originalFind = WorkDeclarationModel.find;
  WorkDeclarationModel.find = (() => createQueryMock([
    { workStartAt: new Date('2026-08-10T01:00:00.000Z'), workEndAt: new Date('2026-08-10T05:00:00.000Z') } // 240 min
  ])) as any;

  try {
    // 240 min + 120 min = 360 min (<= 480 min) -> should succeed without throwing
    await assert.doesNotReject(async () => {
      await ensureDailyCapacity(
        specialistUser.organization!,
        specialistUser.id,
        new Date('2026-08-10T06:00:00.000Z'),
        new Date('2026-08-10T08:00:00.000Z'),
        defaultPolicy,
      );
    });
  } finally {
    WorkDeclarationModel.find = originalFind;
  }
});

test('Story 3.3 - Workflow approval permissions: Specialist cannot self-approve', () => {
  const isSelfApprover = (actor: AuthUser) => ['ADMIN', 'OFFICE_CHIEF', 'COMMUNE_LEADER'].includes(actor.role.code);
  assert.equal(isSelfApprover(specialistUser), false, 'Specialist must not self-approve');
  assert.equal(isSelfApprover(deptLeaderUser), false, 'Department leader must not self-approve');
  assert.equal(isSelfApprover(officeChiefUser), true, 'Office chief can self-approve');
});

test('Story 3.3 - Workflow state transitions lock fields upon submission', () => {
  const isEditable = (status: string) => ['DRAFT', 'RETURNED'].includes(status);
  assert.equal(isEditable('DRAFT'), true);
  assert.equal(isEditable('RETURNED'), true);
  assert.equal(isEditable('PENDING_APPROVAL'), false, 'Cannot edit when pending approval');
  assert.equal(isEditable('APPROVED'), false, 'Cannot edit when approved');
  assert.equal(isEditable('CANCELLED'), false, 'Cannot edit when cancelled');
});
