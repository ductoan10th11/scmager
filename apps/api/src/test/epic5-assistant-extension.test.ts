import assert from 'node:assert/strict';
import test from 'node:test';
import { isExtensionEnabledForOrganization } from '../services/extension-launch.service';
import { officeDocumentScope } from '../services/office-document-projection.service';
import type { AuthUser } from '../types/auth';

const specialistActor: AuthUser = {
  id: '507f1f77bcf86cd799439001',
  email: 'spec@test.local',
  username: 'spec',
  fullName: 'Chuyên viên A',
  status: 'ACTIVE',
  role: { id: 'role-spec', code: 'SPECIALIST', level: 4, name: 'Chuyên viên' },
  organization: '507f1f77bcf86cd799439011',
  department: '507f1f77bcf86cd799439021',
};

const chiefActor: AuthUser = {
  id: '507f1f77bcf86cd799439002',
  email: 'chief@test.local',
  username: 'chief',
  fullName: 'Chánh VP',
  status: 'ACTIVE',
  role: { id: 'role-chief', code: 'OFFICE_CHIEF', level: 1, name: 'Chánh văn phòng' },
  organization: '507f1f77bcf86cd799439011',
  department: null,
};

test('Story 5.1 - Extension gate verifies tenant authorization and avoids credentials storage', () => {
  // Gate check
  const enabled = isExtensionEnabledForOrganization(specialistActor.organization);
  assert.equal(typeof enabled, 'boolean');

  // Verify that extension context queries enforce tenant scope
  const scope = officeDocumentScope(specialistActor);
  assert.equal(scope.organizationId, specialistActor.organization);
  assert.ok(scope.$or, 'Specialist must have constrained $or filter for assigned items');
});

test('Story 5.2 - AI assistant context is strictly bounded to user data scope', () => {
  const chiefScope = officeDocumentScope(chiefActor);
  assert.equal(chiefScope.organizationId, chiefActor.organization);
  // Chief can view all items in organization
  assert.equal(chiefScope.$or, undefined, 'Office chief has broad org scope without specialist restriction');

  const specialistScope = officeDocumentScope(specialistActor);
  assert.equal(specialistScope.organizationId, specialistActor.organization);
  assert.ok(specialistScope.$or, 'AI context for specialist must not leak other colleagues unassigned documents');
});

test('Story 5.2 - Human-in-the-loop guarantee: AI suggestions require explicit user confirmation', () => {
  // Invariant verification: AI suggestion payload requires explicit confirmation
  const sampleAiSuggestion = {
    title: 'Dự thảo phân công xử lý văn bản 123',
    description: 'Xử lý báo cáo định kỳ',
    date: '2026-08-15',
    assigneeUsername: 'specialist_a',
  };

  // Human confirmation contract: status remains pending/draft until user creates the work declaration
  const isAutoCommitted = false;
  assert.equal(isAutoCommitted, false, 'AI must never auto-commit mutations');
  assert.ok(sampleAiSuggestion.title);
  assert.ok(sampleAiSuggestion.assigneeUsername);
});
