import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { parsePerformanceWorkbook } from '../services/performance-import.service';

const createWorkbook = async (header = 'Nội dung nhiệm vụ') => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Pl4 Tinh diem');
  sheet.getCell('B3').value = 'Họ và tên: Nhân sự kiểm thử';
  sheet.getCell('A4').value = 'STT'; sheet.getCell('B4').value = header;
  sheet.getCell('C5').value = 'Ngày hết hạn'; sheet.getCell('D5').value = 'Sản phẩm công việc';
  sheet.getCell('E5').value = 'Hệ số quy đổi'; sheet.getCell('F5').value = 'Số lượng giao';
  sheet.getCell('H6').value = 'Số lượng hoàn thành thực tế'; sheet.getCell('J6').value = 'Ngày hoàn thành';
  sheet.getCell('M6').value = 'Số lần yêu cầu làm lại';
  sheet.getCell('A8').value = 1; sheet.getCell('B8').value = 'Nhiệm vụ kiểm thử';
  sheet.getCell('C8').value = new Date(Date.UTC(2026, 6, 31)); sheet.getCell('D8').value = 'Báo cáo';
  sheet.getCell('E8').value = 5; sheet.getCell('F8').value = 1; sheet.getCell('H8').value = 1;
  sheet.getCell('J8').value = new Date(Date.UTC(2026, 6, 30)); sheet.getCell('M8').value = 0;
  sheet.getCell('A9').value = 'Tổng cộng';
  return Buffer.from(await workbook.xlsx.writeBuffer());
};

test('PL4 importer accepts a structurally valid row', async () => {
  const parsed = await parsePerformanceWorkbook(await createWorkbook());
  assert.equal(parsed.fullName, 'Nhân sự kiểm thử');
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].point, 5);
  assert.equal(parsed.rows[0].completedQuantity, 1);
});

test('PL4 importer rejects any changed template header', async () => {
  await assert.rejects(
    async () => parsePerformanceWorkbook(await createWorkbook('Nội dung bị sửa')),
    (error: any) => error?.statusCode === 400 && error?.details?.errors?.some((item: string) => item.includes('B4')),
  );
});
