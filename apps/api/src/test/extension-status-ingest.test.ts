import assert from 'node:assert/strict';
import test from 'node:test';
import OfficeDocumentContextModel from '../models/office-document-context.model';
import { runExtensionStatusOnlyIngest } from '../services/extension-status-ingest.service';

test('status-only ingest selects unfinished extension incoming contexts and updates only their status projection', async () => {
  const originalFind = OfficeDocumentContextModel.find;
  const originalUpdateOne = OfficeDocumentContextModel.updateOne;
  const filters: any[] = [];
  const updates: any[] = [];
  const chain = {
    sort: () => chain,
    limit: () => chain,
    lean: async () => [{
      _id: '507f1f77bcf86cd799439011',
      pageType: 'incoming',
      externalDocumentId: 'EXT-123',
      observation: { soKyHieu: '01/TEST' },
      statusSync: { attempts: 0 },
    }],
  };

  OfficeDocumentContextModel.find = ((filter: unknown) => {
    filters.push(filter);
    return chain;
  }) as unknown as typeof OfficeDocumentContextModel.find;
  OfficeDocumentContextModel.updateOne = (async (filter: unknown, update: unknown) => {
    updates.push({ filter, update });
    return { modifiedCount: 1 };
  }) as unknown as typeof OfficeDocumentContextModel.updateOne;
  try {
    const result = await runExtensionStatusOnlyIngest({}, {
      getCsrfToken: async () => 'csrf',
      getTrackLog: async () => [{
        id: '9',
        sender: { username: 'vanthu-xathientan', fullName: 'Văn thư xã Thiện Tân' },
        receiver: { username: 'tvhung-04', fullName: 'Trần Văn Hưng' },
        action: 'Đã tạo phúc đáp', content: '', comment: 'Điểm: 3.2. Đồng xử lý: Người không hiển thị. Thao tác: Đã tạo phúc đáp',
        receivedAt: null, processingAt: null, completedAt: '23/07/2026 09:00',
      }],
      resolveDocumentWorkflow: async () => ({ status: 'COMPLETED', currentAssignee: null, assignees: [] }),
      disposeSession: async () => {},
    });
    assert.deepEqual(result, { selected: 1, synced: 1, completed: 1, failed: 0, sessionHealed: 0, errors: [] });
    assert.equal(filters.length, 1);
    assert.equal(filters[0].pageType, 'incoming');
    assert.deepEqual(filters[0].origin, { $ne: 'MANUAL' });
    assert.deepEqual(filters[0]['statusSync.completed'], { $ne: true });
    assert.equal(updates.length, 1);
    assert.deepEqual(updates[0].filter, { _id: '507f1f77bcf86cd799439011', 'statusSync.completed': { $ne: true } });
    assert.equal(updates[0].update.$set['statusSync.status'], 'COMPLETED');
    assert.equal(updates[0].update.$set['statusSync.completed'], true);
    assert.equal(updates[0].update.$set['statusSync.trackLogs'].length, 1);
    assert.equal(updates[0].update.$set['observation.timeline'][0]['Người gửi'], 'Văn thư xã Thiện Tân (vanthu-xathientan)');
    assert.equal(updates[0].update.$set['observation.timeline'][0]['Người nhận'], 'Trần Văn Hưng (tvhung-04)');
    assert.equal(updates[0].update.$set['observation.timeline'][0]['Nội dung'], 'Điểm: 3.2. Thao tác: Đã tạo phúc đáp');
    assert.equal(updates[0].update.$set['observation.point'], 3.2);
  } finally {
    OfficeDocumentContextModel.find = originalFind;
    OfficeDocumentContextModel.updateOne = originalUpdateOne;
  }
});

test('a final clerk-created response is completed even before the outgoing document has a number', async () => {
  const originalFind = OfficeDocumentContextModel.find;
  const originalUpdateOne = OfficeDocumentContextModel.updateOne;
  const updates: any[] = [];
  const chain = {
    sort: () => chain,
    limit: () => chain,
    lean: async () => [{
      _id: '507f1f77bcf86cd799439012',
      sourceHost: 'vanphongdientu.langson.gov.vn',
      pageType: 'incoming',
      externalDocumentId: 'EXT-124',
      observation: { soKyHieu: '02/TEST' },
      statusSync: { attempts: 0 },
    }],
  };

  OfficeDocumentContextModel.find = (() => chain) as unknown as typeof OfficeDocumentContextModel.find;
  OfficeDocumentContextModel.updateOne = (async (_filter: unknown, update: unknown) => {
    updates.push(update);
    return { modifiedCount: 1 };
  }) as unknown as typeof OfficeDocumentContextModel.updateOne;
  try {
    const result = await runExtensionStatusOnlyIngest({}, {
      getCsrfToken: async () => 'csrf',
      getTrackLog: async () => [{
        id: '10',
        sender: { username: 'vanthu-xathientan', fullName: 'Văn thư xã Thiện Tân' },
        receiver: { username: '', fullName: '' },
        action: 'Đã tạo phúc đáp', content: '', comment: '',
        receivedAt: null, processingAt: null, completedAt: '23/07/2026 09:00',
      }],
      resolveDocumentWorkflow: async () => ({ status: 'COMPLETED', currentAssignee: null, assignees: [] }),
      disposeSession: async () => {},
    });

    assert.deepEqual(result, { selected: 1, synced: 1, completed: 1, failed: 0, sessionHealed: 0, errors: [] });
    assert.equal(updates[0].$set['statusSync.status'], 'COMPLETED');
    assert.equal(updates[0].$set['statusSync.completed'], true);
    assert.equal(updates[0].$set['statusSync.completedRule'], 'LATEST_TRACKLOG_VANTHU_TAO_PHUC_DAP');
  } finally {
    OfficeDocumentContextModel.find = originalFind;
    OfficeDocumentContextModel.updateOne = originalUpdateOne;
  }
});
