import ExcelJS from 'exceljs';
import { access } from 'node:fs/promises';
import path from 'node:path';

const FIRST_DATA_ROW = 8;
const SAMPLE_ROWS = 2;

const templateCandidates = () => [
  path.resolve(__dirname, '../templates/pki-template.xlsx'),
  path.resolve(__dirname, '../../src/templates/pki-template.xlsx'),
  path.resolve(process.cwd(), 'apps/api/src/templates/pki-template.xlsx'),
  path.resolve(process.cwd(), 'src/templates/pki-template.xlsx'),
];

const templatePath = async () => {
  for (const candidate of templateCandidates()) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // try the next location
    }
  }
  throw new Error('Không tìm thấy tệp mẫu PL4.');
};

const vietnamDate = (offsetDays: number) => {
  const date = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh' }).format(date);
};

/**
 * The blank PL4 workbook people fill in before importing. It is the very file
 * the importer validates against — same headers, same merged cells — with two
 * filled-in rows showing the expected shape, so a user can copy the pattern
 * instead of guessing which column holds what.
 */
export const buildPerformanceImportTemplate = async () => {
  const template = new ExcelJS.Workbook();
  await template.xlsx.readFile(await templatePath());
  // Copy into a fresh workbook: reading and re-saving the template keeps its
  // original sheet numbering (sheet4.xml), and the importer's safety check
  // requires the single worksheet to be sheet1.xml.
  const workbook = new ExcelJS.Workbook();
  const source = template.worksheets[0];
  const sheet = workbook.addWorksheet('PL4');
  sheet.model = structuredClone(source.model);
  Object.values((source as any)._merges)
    .map((range: any) => range.range as string)
    .forEach((range) => sheet.mergeCells(range));
  sheet.name = 'PL4';

  sheet.getCell('A1').value = 'Bảng kết quả thực hiện nhiệm vụ (mẫu nhập hàng loạt)';
  // The importer reads the owner from this cell; the name must match a single
  // active account, so it is left as an obvious placeholder to replace.
  sheet.getCell('B3').value = 'Họ và tên: <NHẬP HỌ TÊN CÁN BỘ>';

  const samples = [
    {
      content: '1234/UBND-KT\nV/v triển khai kế hoạch sản xuất vụ mùa',
      deadline: vietnamDate(7),
      product: 'Văn bản đến',
      point: 2,
      assigned: 1,
      completedQuantity: 1,
      completedAt: vietnamDate(3),
      reworkCount: 0,
    },
    {
      content: '5678/SNNMT-TT\nBáo cáo tình hình sinh vật gây hại',
      deadline: vietnamDate(14),
      product: 'Văn bản đến',
      point: 1.5,
      assigned: 1,
      completedQuantity: 0,
      completedAt: '',
      reworkCount: 1,
    },
  ];

  samples.forEach((sample, index) => {
    const row = sheet.getRow(FIRST_DATA_ROW + index);
    row.getCell(1).value = index + 1;
    row.getCell(2).value = sample.content;
    row.getCell(3).value = sample.deadline;
    row.getCell(4).value = sample.product;
    row.getCell(5).value = sample.point;
    row.getCell(6).value = sample.assigned;
    row.getCell(8).value = sample.completedQuantity;
    row.getCell(10).value = sample.completedAt;
    row.getCell(13).value = sample.reworkCount;
    row.commit();
  });

  // The template ships 16 data rows. The importer treats every row above
  // "Tổng cộng" as data and rejects blank ones, so the unused rows are removed
  // rather than emptied. Footer merges are released first and re-applied at
  // their new position, otherwise they would stretch across the deleted rows.
  const TEMPLATE_DATA_ROWS = 16;
  const TEMPLATE_FOOTER_ROW = 24;
  const removed = TEMPLATE_DATA_ROWS - SAMPLE_ROWS;
  const rowOf = (range: string) => Number(range.split(':')[0].replace(/\D/gu, ''));
  const shift = (range: string) => range
    .split(':')
    .map((part) => part.replace(/([A-Z]+)(\d+)/u, (_, col, row) => `${col}${Number(row) - removed}`))
    .join(':');
  const footerMerges = Object.values((sheet as any)._merges)
    .map((range: any) => range.range as string)
    .filter((range) => rowOf(range) >= TEMPLATE_FOOTER_ROW);
  footerMerges.forEach((range) => sheet.unMergeCells(range));
  sheet.spliceRows(FIRST_DATA_ROW + SAMPLE_ROWS, removed);
  footerMerges.forEach((range) => sheet.mergeCells(shift(range)));

  const content = await workbook.xlsx.writeBuffer();
  return { content: Buffer.from(content), fileName: 'mau-nhap-hang-loat-PL4.xlsx' };
};
