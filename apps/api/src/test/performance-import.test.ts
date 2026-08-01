import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { parsePerformanceWorkbook } from '../services/performance-import.service';

const HEADER_MERGES = [
  'A4:A6', 'B4:B6', 'C4:G4', 'H4:N4', 'C5:C6', 'D5:D6',
  'E5:E6', 'F5:F6', 'G5:G6', 'H5:I5', 'J5:L5', 'M5:N5',
];

const createWorkbook = async ({
  header = 'Nội dung nhiệm vụ',
  appendices = false,
  reworkCount = 0,
  contentFormula = false,
  extraSheet = false,
  legacyNoteColumn = false,
  sheetName = 'Pl4 Tinh diem',
}: {
  header?: string;
  appendices?: boolean;
  reworkCount?: number;
  contentFormula?: boolean;
  extraSheet?: boolean;
  legacyNoteColumn?: boolean;
  sheetName?: string;
} = {}) => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);
  HEADER_MERGES.forEach((range) => sheet.mergeCells(range));
  sheet.getCell('B3').value = 'Họ và tên: Nhân sự kiểm thử';
  sheet.getCell('A4').value = 'STT'; sheet.getCell('B4').value = header;
  sheet.getCell('C5').value = 'Ngày hết hạn'; sheet.getCell('D5').value = 'Sản phẩm công việc';
  sheet.getCell('E5').value = 'Hệ số quy đổi'; sheet.getCell('F5').value = 'Số lượng giao';
  sheet.getCell('H6').value = 'Số lượng hoàn thành thực tế'; sheet.getCell('J6').value = 'Ngày hoàn thành';
  sheet.getCell('M6').value = 'Số lần yêu cầu làm lại';
  sheet.getCell('A8').value = 1;
  sheet.getCell('B8').value = contentFormula
    ? { formula: '1+1', result: 'Nhiệm vụ kiểm thử' }
    : 'Nhiệm vụ kiểm thử';
  sheet.getCell('C8').value = new Date(Date.UTC(2026, 6, 31)); sheet.getCell('D8').value = 'Báo cáo';
  sheet.getCell('E8').value = 5; sheet.getCell('F8').value = 1; sheet.getCell('H8').value = 1;
  sheet.getCell('J8').value = new Date(Date.UTC(2026, 6, 30)); sheet.getCell('M8').value = reworkCount;
  sheet.getCell('A9').value = 'Tổng cộng';
  if (legacyNoteColumn) {
    sheet.mergeCells('O4:O5');
    sheet.getCell('O4').value = 'Ghi chú';
    sheet.getCell('O8').value = 'Không được nhập vào dữ liệu KPI';
  }
  if (appendices) {
    sheet.getCell('A10').value = 'Phụ lục nhiễu không được nhập';
    sheet.getCell('B10').value = 'Dữ liệu này phải bị bỏ qua';
  }
  if (extraSheet) workbook.addWorksheet('Phụ lục');
  return Buffer.from(await workbook.xlsx.writeBuffer());
};

test('PL4 importer accepts a structurally valid row', async () => {
  const parsed = await parsePerformanceWorkbook(await createWorkbook());
  assert.equal(parsed.fullName, 'Nhân sự kiểm thử');
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].point, 5);
  assert.equal(parsed.rows[0].completedQuantity, 1);
});

test('PL4 importer accepts the sole worksheet regardless of its name', async () => {
  const parsed = await parsePerformanceWorkbook(await createWorkbook({ sheetName: 'Bảng KPI tháng 7' }));
  assert.equal(parsed.rows.length, 1);
});

test('PL4 importer rejects any changed template header', async () => {
  await assert.rejects(
    async () => parsePerformanceWorkbook(await createWorkbook({ header: 'Nội dung bị sửa' })),
    (error: any) => error?.statusCode === 400 && error?.details?.errors?.some((item: string) => item.includes('B4')),
  );
});

test('PL4 importer ignores appendices after the first total row', async () => {
  const parsed = await parsePerformanceWorkbook(await createWorkbook({ appendices: true }));
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].content, 'Nhiệm vụ kiểm thử');
});

test('PL4 importer accepts only the official legacy note column variant', async () => {
  const parsed = await parsePerformanceWorkbook(await createWorkbook({ legacyNoteColumn: true }));
  assert.equal(parsed.rows.length, 1);
});

test('PL4 importer rejects formulas in editable task cells', async () => {
  await assert.rejects(
    async () => parsePerformanceWorkbook(await createWorkbook({ contentFormula: true })),
    (error: any) => error?.statusCode === 400 && error?.details?.errors?.some((item: string) => item.includes('cột B')),
  );
});

test('PL4 importer rejects decimal rework counts and extra worksheets', async () => {
  await assert.rejects(
    async () => parsePerformanceWorkbook(await createWorkbook({ reworkCount: 0.5 })),
    (error: any) => error?.statusCode === 400 && error?.details?.errors?.some((item: string) => item.includes('cột M')),
  );
  await assert.rejects(
    async () => parsePerformanceWorkbook(await createWorkbook({ extraSheet: true })),
    (error: any) => error?.statusCode === 400 && /không an toàn|đúng một sheet/iu.test(error?.message),
  );
});
