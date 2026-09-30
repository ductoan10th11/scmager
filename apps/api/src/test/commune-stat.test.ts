import assert from 'node:assert/strict';
import test from 'node:test';
import CommuneMetricModel from '../models/commune-metric.model';
import CommuneReportModel from '../models/commune-report.model';
import { communeStatService } from '../services/commune-stat.service';
import { communeMetricRepository } from '../repositories/commune-metric.repository';
import { communeReportRepository } from '../repositories/commune-report.repository';

test('CommuneMetric model validates required fields and sets uppercase code', () => {
  const metric = new CommuneMetricModel({
    code: 'thu_ngan_sach',
    name: 'Thu ngân sách địa bàn',
    category: 'UBND',
    unit: 'tỷ',
    actualValue: 12.6,
    targetValue: 13.0,
    period: 'Tháng 9/2026',
    year: 2026,
  });

  assert.equal(metric.code, 'THU_NGAN_SACH');
  assert.equal(metric.category, 'UBND');
  assert.equal(metric.actualValue, 12.6);
  assert.equal(metric.isConfirmed, true);
});

test('CommuneReport model validates required fields', () => {
  const report = new CommuneReportModel({
    code: '45/BC-UBND',
    title: 'Báo cáo tình hình KTXH 9 tháng đầu năm 2026',
    category: 'UBND',
    period: 'Tháng 9/2026',
    year: 2026,
    fileName: 'Bao_cao_KTXH.docx',
  });

  assert.equal(report.code, '45/BC-UBND');
  assert.equal(report.status, 'COMPLETED');
  assert.equal(report.extractedCount, 0);
});

test('communeStatService.extractReportData generates candidate metrics for category', async () => {
  const ubndResult = await communeStatService.extractReportData(
    { originalname: 'Bao_cao_UBND.docx', size: 1024 * 1024 },
    { category: 'UBND', period: 'Tháng 9/2026', year: 2026 }
  );

  assert.equal(ubndResult.success, true);
  assert.ok(ubndResult.extractedMetrics.length >= 4);
  assert.ok(ubndResult.extractedMetrics.some((m) => m.code === 'THU_NGAN_SACH'));

  const dangUyResult = await communeStatService.extractReportData(
    { originalname: 'Bao_cao_Dang.pdf', size: 1024 * 1024 },
    { category: 'DANG_UY', period: 'Quý III/2026', year: 2026 }
  );

  assert.equal(dangUyResult.success, true);
  assert.ok(dangUyResult.extractedMetrics.some((m) => m.code === 'TO_CHUC_DANG'));
});

test('communeStatService.getIocOverview groups metrics by category correctly', async () => {
  const origFindMetrics = communeMetricRepository.find;
  const origFindReports = communeReportRepository.find;

  try {
    (communeMetricRepository as any).find = async () => [
      {
        code: 'DAN_SO',
        name: 'Dân số',
        category: 'CHUNG',
        unit: 'người',
        actualValue: 18642,
        targetValue: 18700,
        completionRate: 99.7,
        isConfirmed: true,
      },
      {
        code: 'TO_CHUC_DANG',
        name: 'Chi bộ trực thuộc',
        category: 'DANG_UY',
        unit: 'chi bộ',
        actualValue: 16,
        targetValue: 16,
        completionRate: 100,
        isConfirmed: true,
      },
      {
        code: 'THU_NGAN_SACH',
        name: 'Thu ngân sách',
        category: 'UBND',
        unit: 'tỷ',
        actualValue: 12.6,
        targetValue: 13.0,
        completionRate: 96.9,
        isConfirmed: true,
      },
    ];

    (communeReportRepository as any).find = async () => [
      {
        code: '45/BC-UBND',
        title: 'Báo cáo KTXH',
      },
    ];

    const overview = await communeStatService.getIocOverview({ year: 2026 });
    assert.equal(overview.communeName, 'Xã Thiện Tân');
    assert.equal(overview.totalMetrics, 3);
    assert.equal(overview.confirmedCount, 3);
    assert.equal(overview.byCategory.CHUNG.length, 1);
    assert.equal(overview.byCategory.DANG_UY.length, 1);
    assert.equal(overview.byCategory.UBND.length, 1);
    assert.equal(overview.recentReports.length, 1);
  } finally {
    communeMetricRepository.find = origFindMetrics;
    communeReportRepository.find = origFindReports;
  }
});
