import assert from 'node:assert/strict';
import test from 'node:test';
import { dashboardSummaryService } from '../services/dashboard.service';
import { listNotificationsService, markNotificationReadService } from '../services/notification.service';
import { listAuditLogsForEntityService } from '../services/audit-log.service';
import { WorkDeclarationModel, OfficeDocumentContextModel } from '../models';
import { notificationRepository } from '../repositories/notification.repository';
import type { AuthUser } from '../types/auth';

const mockAdmin: AuthUser = {
  id: '507f1f77bcf86cd799439001',
  email: 'admin@test.local',
  username: 'admin',
  fullName: 'Quản trị viên',
  status: 'ACTIVE',
  role: { id: 'role-admin', code: 'ADMIN', level: 0, name: 'Quản trị hệ thống' },
  organization: null,
  department: null,
};

const mockChief: AuthUser = {
  id: '507f1f77bcf86cd799439002',
  email: 'chief@test.local',
  username: 'chief',
  fullName: 'Chánh văn phòng',
  status: 'ACTIVE',
  role: { id: 'role-chief', code: 'OFFICE_CHIEF', level: 1, name: 'Chánh văn phòng' },
  organization: '507f1f77bcf86cd799439011',
  department: null,
};

const mockSpecialist: AuthUser = {
  id: '507f1f77bcf86cd799439003',
  email: 'specialist@test.local',
  username: 'specialist',
  fullName: 'Chuyên viên B',
  status: 'ACTIVE',
  role: { id: 'role-spec', code: 'SPECIALIST', level: 4, name: 'Chuyên viên' },
  organization: '507f1f77bcf86cd799439011',
  department: '507f1f77bcf86cd799439021',
};

const mockOtherOrgChief: AuthUser = {
  id: '507f1f77bcf86cd799439004',
  email: 'otherchief@test.local',
  username: 'otherchief',
  fullName: 'Chánh văn phòng Xã khác',
  status: 'ACTIVE',
  role: { id: 'role-otherchief', code: 'OFFICE_CHIEF', level: 1, name: 'Chánh văn phòng Xã khác' },
  organization: '507f1f77bcf86cd799439099',
  department: null,
};

test('Story 4.1 - dashboardSummaryService returns scoped statistics for tenant', async () => {
  const origCount = WorkDeclarationModel.countDocuments;
  const origContextFind = OfficeDocumentContextModel.find;

  (WorkDeclarationModel as any).countDocuments = async () => 5;
  (OfficeDocumentContextModel as any).find = () => ({
    select: () => ({
      sort: () => ({
        limit: () => ({
          lean: async () => [
            {
              _id: 'doc-1',
              externalDocumentId: 'EXT-1',
              observation: { soKyHieu: '10/TB', subject: 'Thử nghiệm' },
              statusSync: { completed: false },
              management: {},
              observedAt: new Date(),
              updatedAt: new Date(),
            }
          ],
        }),
      }),
    }),
  });

  try {
    const summary = await dashboardSummaryService(mockChief);
    assert.ok(summary);
    assert.equal(summary.data.tasks.total, 5);
    assert.equal(summary.data.documents.total, 1);
    assert.equal(summary.data.documents.pending, 1);
  } finally {
    WorkDeclarationModel.countDocuments = origCount;
    OfficeDocumentContextModel.find = origContextFind;
  }
});

test('Story 4.1 - dashboardSummaryService rejects tenantless non-admin user', async () => {
  const invalidActor: AuthUser = {
    id: 'user-no-org',
    email: 'noorg@test.local',
    username: 'noorg',
    fullName: 'Không Tổ Chức',
    status: 'ACTIVE',
    role: { id: 'role-chief', code: 'OFFICE_CHIEF', level: 1, name: 'Chánh VP' },
    organization: null,
    department: null,
  };

  await assert.rejects(
    async () => dashboardSummaryService(invalidActor),
    (err: any) => {
      assert.equal(err.statusCode, 403);
      assert.match(err.message, /no organization/i);
      return true;
    }
  );
});

test('Story 4.2 - Notifications list and mark-as-read are scoped to recipient', async () => {
  const origFind = notificationRepository.findMany;
  const origCount = notificationRepository.count;
  const origFindUnread = notificationRepository.findUnreadWorkDeclarationActions;
  const origMarkRead = notificationRepository.markRead;

  const mockNotification = {
    _id: '507f1f77bcf86cd799439050',
    recipient: mockSpecialist.id,
    title: 'Công việc mới được giao',
    message: 'Bạn có nhiệm vụ mới cần xử lý',
    readAt: null,
    entityId: '507f1f77bcf86cd799439060',
    entityModel: 'WorkDeclaration',
    createdAt: new Date(),
  };

  notificationRepository.findUnreadWorkDeclarationActions = (async () => []) as any;
  notificationRepository.findMany = (async () => [mockNotification]) as any;
  notificationRepository.count = (async () => 1) as any;
  notificationRepository.markRead = (async (id: string, recipient: string) => {
    if (id === mockNotification._id && recipient === mockSpecialist.id) {
      return { ...mockNotification, readAt: new Date() };
    }
    return null;
  }) as any;

  try {
    const res = await listNotificationsService(mockSpecialist, { unread: 'true' });
    assert.equal(res.data.length, 1);
    assert.equal(res.data[0].title, 'Công việc mới được giao');

    const marked = await markNotificationReadService(mockSpecialist, mockNotification._id);
    assert.ok(marked.data.readAt);

    // Other user cannot mark another user's notification as read (returns 404 because markRead returns null)
    await assert.rejects(
      async () => markNotificationReadService(mockOtherOrgChief, mockNotification._id),
      (err: any) => {
        assert.equal(err.statusCode, 404);
        assert.match(err.message, /not found/i);
        return true;
      }
    );
  } finally {
    notificationRepository.findMany = origFind;
    notificationRepository.count = origCount;
    notificationRepository.findUnreadWorkDeclarationActions = origFindUnread;
    notificationRepository.markRead = origMarkRead;
  }
});

test('Story 4.4 - Audit log for entity rejects unsupported entityModel and unauthorized access', async () => {
  // Unsupported model
  await assert.rejects(
    async () => listAuditLogsForEntityService(mockChief, 'UnknownEntity', '507f1f77bcf86cd799439090', {}),
    (err: any) => {
      assert.equal(err.statusCode, 400);
      assert.match(err.message, /entityModel must be/i);
      return true;
    }
  );

  // Mock OfficeDocumentContextModel.findById to test cross-tenant access rejection
  const origFindById = OfficeDocumentContextModel.findById;
  (OfficeDocumentContextModel as any).findById = () => ({
    select: async () => ({
      _id: '507f1f77bcf86cd799439090',
      organizationId: '507f1f77bcf86cd799439011', // Org 1
    }),
  });

  try {
    // Other org chief (Org 99) tries to view audit of Org 1 document -> 403 Forbidden
    await assert.rejects(
      async () => listAuditLogsForEntityService(mockOtherOrgChief, 'IncomingDocument', '507f1f77bcf86cd799439090', {}),
      (err: any) => {
        assert.equal(err.statusCode, 403);
        assert.match(err.message, /access denied/i);
        return true;
      }
    );
  } finally {
    OfficeDocumentContextModel.findById = origFindById;
  }
});
