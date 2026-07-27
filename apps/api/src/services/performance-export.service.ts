import ExcelJS from 'exceljs';
import { access } from 'node:fs/promises';
import { isValidObjectId } from 'mongoose';
import path from 'node:path';
import type { AuthUser } from '../types/auth';
import { badRequest, forbidden } from '../utils/http-error';
import { performanceOverviewService } from './performance.service';

const FIRST_DATA_ROW = 8;
const TEMPLATE_DATA_ROWS = 16;
const TEMPLATE_FOOTER_ROW = FIRST_DATA_ROW + TEMPLATE_DATA_ROWS;
const DATA_ROW_HEIGHT = 36;
const vietnamDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Ho_Chi_Minh',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const templatePaths = [
  path.resolve(process.cwd(), 'apps/api/src/templates/pki-template.xlsx'),
  path.resolve(process.cwd(), 'src/templates/pki-template.xlsx'),
  path.resolve(__dirname, '../templates/pki-template.xlsx'),
];

const templatePath = async () => {
  for (const candidate of templatePaths) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next execution layout (source, bind mount, or production build).
    }
  }
  throw new Error('PKI Excel template is unavailable.');
};

const safeSheetName = (value: string, used: Set<string>) => {
  const seed = (value || 'Nhân sự').replace(/[\\/*?:\[\]]/g, ' ').trim().slice(0, 28) || 'Nhân sự';
  let name = seed;
  let suffix = 2;
  while (used.has(name)) {
    name = `${seed.slice(0, 28 - String(suffix).length)} ${suffix}`;
    suffix += 1;
  }
  used.add(name);
  return name;
};

const safeFilePart = (value: string) => (value || 'nhan-su')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-zA-Z0-9]+/g, '-')
  .replace(/(^-|-$)/g, '')
  .toLowerCase() || 'nhan-su';

const toVietnamDateCell = (value: unknown) => {
  if (!value) return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(vietnamDateFormatter
    .formatToParts(date)
    .filter((part) => part.type !== 'literal')
    .map((part) => [part.type, part.value]));
  return new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
};

const parseRangeDate = (value: unknown, field: 'startDate' | 'endDate') => {
  const raw = String(value ?? '').trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw badRequest(`${field} must use YYYY-MM-DD.`);
  const [, year, month, day] = match;
  const date = new Date(`${year}-${month}-${day}T${field === 'endDate' ? '23:59:59.999' : '00:00:00.000'}+07:00`);
  const dateParts = Object.fromEntries(vietnamDateFormatter
    .formatToParts(date)
    .filter((part) => part.type !== 'literal')
    .map((part) => [part.type, part.value]));
  if (Number.isNaN(date.getTime()) || dateParts.year !== year || dateParts.month !== month || dateParts.day !== day) {
    throw badRequest(`${field} is not a valid date.`);
  }
  return { raw, date };
};

const vietnamDateLabel = (value: string) => {
  const [, month, day] = value.match(/^(\d{4})-(\d{2})-(\d{2})$/) ?? [];
  const year = value.slice(0, 4);
  return `${day}/${month}/${year}`;
};

const rowStart = (range: string) => Number(range.match(/\d+/)?.[0] ?? 0);
const shiftRange = (range: string, by: number) => range.replace(/(\D+)(\d+)/g, (_, column, row) => `${column}${Number(row) + by}`);

const cloneSheet = (targetBook: ExcelJS.Workbook, templateSheet: ExcelJS.Worksheet, name: string) => {
  const sheet = targetBook.addWorksheet(name);
  sheet.model = structuredClone(templateSheet.model);
  Object.values((templateSheet as any)._merges)
    .map((range: any) => range.range as string)
    .forEach((range) => sheet.mergeCells(range));
  sheet.name = name;
  return sheet;
};

const clearRow = (sheet: ExcelJS.Worksheet, rowNumber: number) => {
  for (let column = 1; column <= 14; column += 1) sheet.getRow(rowNumber).getCell(column).value = null;
};

const copyRowStyle = (sheet: ExcelJS.Worksheet, from: number, to: number) => {
  const source = sheet.getRow(from);
  const target = sheet.getRow(to);
  target.height = source.height;
  for (let column = 1; column <= 14; column += 1) {
    target.getCell(column).style = structuredClone(source.getCell(column).style);
  }
};

const applyTableBorders = (sheet: ExcelJS.Worksheet, fromRow: number, toRow: number) => {
  const border = {
    top: { style: 'thin' as const, color: { argb: 'FF000000' } },
    left: { style: 'thin' as const, color: { argb: 'FF000000' } },
    bottom: { style: 'thin' as const, color: { argb: 'FF000000' } },
    right: { style: 'thin' as const, color: { argb: 'FF000000' } },
  };
  for (let row = fromRow; row <= toRow; row += 1) {
    for (let column = 1; column <= 14; column += 1) sheet.getRow(row).getCell(column).border = border;
  }
};

const prepareRows = (sheet: ExcelJS.Worksheet, requiredRows: number) => {
  const footerOffset = requiredRows - TEMPLATE_DATA_ROWS;
  if (!footerOffset) return { lastDataRow: TEMPLATE_FOOTER_ROW - 1, footerOffset };

  const footerMerges = Object.values((sheet as any)._merges)
    .map((range: any) => range.range as string)
    .filter((range) => rowStart(range) >= TEMPLATE_FOOTER_ROW);
  footerMerges.forEach((range) => sheet.unMergeCells(range));
  if (footerOffset > 0) {
    sheet.insertRows(TEMPLATE_FOOTER_ROW, Array.from({ length: footerOffset }, () => []), 'i');
    for (let row = TEMPLATE_FOOTER_ROW; row < TEMPLATE_FOOTER_ROW + footerOffset; row += 1) copyRowStyle(sheet, TEMPLATE_FOOTER_ROW - 1, row);
  } else {
    sheet.spliceRows(FIRST_DATA_ROW + requiredRows, -footerOffset);
  }
  footerMerges.forEach((range) => sheet.mergeCells(shiftRange(range, footerOffset)));
  return { lastDataRow: FIRST_DATA_ROW + requiredRows - 1, footerOffset };
};

const fillFirstPl4Table = (sheet: ExcelJS.Worksheet, person: any, documents: any[], dateRange: { startDate: string; endDate: string }) => {
  const { lastDataRow, footerOffset } = prepareRows(sheet, documents.length);
  const totalRow = TEMPLATE_FOOTER_ROW + footerOffset;
  const rateRow = totalRow + 1;
  const noteRow = totalRow + 2;
  const summaryHeaderRow = 28 + footerOffset;
  const summaryValueStartRow = 30 + footerOffset;
  sheet.getCell('A1').value = `Bảng kết quả thực hiện nhiệm vụ từ ngày ${vietnamDateLabel(dateRange.startDate)} đến ngày ${vietnamDateLabel(dateRange.endDate)}`;
  sheet.getCell('B3').value = `Họ và tên: ${person.fullName}`;
  sheet.getCell('B3').font = { ...sheet.getCell('B3').font, name: 'Arial' };

  for (let row = FIRST_DATA_ROW; row <= lastDataRow; row += 1) clearRow(sheet, row);
  documents.forEach((document, index) => {
    const rowNumber = FIRST_DATA_ROW + index;
    const coefficient = Math.max(0, Number(document.point ?? 0) || 0);
    sheet.getRow(rowNumber).values = [
      index + 1,
      `${document.soKyHieu || document.documentId || 'Văn bản'}${document.trichYeu ? `\n${document.trichYeu}` : ''}`,
      toVietnamDateCell(document.deadline),
      document.product || 'Văn bản đến',
      coefficient,
      1,
      { formula: `E${rowNumber}*F${rowNumber}` },
      document.completed ? { formula: `F${rowNumber}` } : 0,
      { formula: `E${rowNumber}*H${rowNumber}` },
      toVietnamDateCell(document.submittedAt || document.completedAt),
      document.completed ? Math.max(0, Number(document.lateWorkingDays ?? 0)) : null,
      { formula: `MAX(0,I${rowNumber}-K${rowNumber}*25%*I${rowNumber})` },
      Math.max(0, Number(document.reworkCount ?? 0)),
      { formula: `MAX(0,I${rowNumber}-(K${rowNumber}*25%*I${rowNumber}+M${rowNumber}*25%*I${rowNumber}))` },
    ];
    sheet.getCell(`C${rowNumber}`).numFmt = 'dd/mm/yyyy';
    sheet.getCell(`J${rowNumber}`).numFmt = 'dd/mm/yyyy';
    // Template rows are deliberately tall for manual entry. Keep generated rows dense and consistent.
    sheet.getRow(rowNumber).height = DATA_ROW_HEIGHT;
    sheet.getCell(`B${rowNumber}`).alignment = {
      ...sheet.getCell(`B${rowNumber}`).alignment,
      vertical: 'middle',
      wrapText: true,
    };
  });

  for (const column of ['G', 'I', 'L', 'N']) {
    sheet.getCell(`${column}${totalRow}`).value = documents.length
      ? { formula: `SUM(${column}${FIRST_DATA_ROW}:${column}${lastDataRow})` }
      : 0;
  }
  sheet.getCell(`I${rateRow}`).value = documents.length ? { formula: `IFERROR(I${totalRow}/G${totalRow},0)` } : 0;
  sheet.getCell(`L${rateRow}`).value = documents.length ? { formula: `IFERROR(L${totalRow}/G${totalRow},0)` } : 0;
  sheet.getCell(`N${rateRow}`).value = documents.length ? { formula: `IFERROR(N${totalRow}/G${totalRow},0)` } : 0;
  for (const column of ['I', 'L', 'N']) sheet.getCell(`${column}${rateRow}`).numFmt = '0.00%';
  sheet.getCell(`A${noteRow}`).value = 'Lưu ý: Hệ số quy đổi là điểm giao của văn bản; mỗi văn bản là 01 sản phẩm và số lượng giao là 01. Số ngày chậm tiến độ là ngày làm việc theo chính sách eWork. Cột 12 và 14 tính theo công thức PL4.';

  // Preserve the lower assessment table from the example while avoiding fake leadership criteria.
  sheet.getCell(`I${summaryValueStartRow}`).value = { formula: `I${rateRow}` };
  sheet.getCell(`I${summaryValueStartRow + 1}`).value = { formula: `N${rateRow}` };
  sheet.getCell(`I${summaryValueStartRow + 2}`).value = { formula: `L${rateRow}` };
  sheet.getCell(`K${summaryValueStartRow}`).value = { formula: `AVERAGE(I${summaryValueStartRow}:I${summaryValueStartRow + 2})` };
  for (let row = summaryValueStartRow; row <= summaryValueStartRow + 2; row += 1) {
    sheet.getCell(`I${row}`).numFmt = '0.00%';
  }
  sheet.getCell(`K${summaryValueStartRow}`).numFmt = '0.00%';
  for (let row = summaryValueStartRow + 3; row <= summaryValueStartRow + 5; row += 1) sheet.getCell(`I${row}`).value = null;
  sheet.getCell(`M${summaryValueStartRow}`).value = null;
  sheet.getCell(`A${summaryHeaderRow}`).value = 'TT';
  sheet.getColumn(10).width = 12;
  applyTableBorders(sheet, FIRST_DATA_ROW, rateRow);
  sheet.autoFilter = { from: 'A7', to: `N${Math.max(FIRST_DATA_ROW - 1, lastDataRow)}` };
};

export const buildPerformanceWorkbook = async (actor: AuthUser, query: Record<string, unknown> = {}) => {
  const userId = String(query.userId ?? '').trim();
  if (!userId) throw badRequest('userId is required.');
  if (!isValidObjectId(userId)) throw badRequest('userId must be a valid MongoDB ObjectId.');
  const start = parseRangeDate(query.startDate, 'startDate');
  const end = parseRangeDate(query.endDate, 'endDate');
  if (start.date > end.date) throw badRequest('startDate must be before or equal to endDate.');

  const overview = await performanceOverviewService(actor, {}, {
    documentLimit: Number.MAX_SAFE_INTEGER,
    sourceLimit: null,
    deadlineRange: { start: start.date, end: end.date },
  });
  const { assignees, documents } = overview.data as any;
  const assignee = assignees.find((row: any) => row.user.id === userId);
  if (!assignee) throw forbidden('You cannot export KPI for this user.');

  const template = new ExcelJS.Workbook();
  await template.xlsx.readFile(await templatePath());
  const workbook = new ExcelJS.Workbook();
  const usedNames = new Set<string>();
  const sheet = cloneSheet(workbook, template.worksheets[0], safeSheetName(assignee.user.fullName, usedNames));
  const assigneeDocuments = documents.filter((document: any) => document.owner?.id === assignee.user.id);
  fillFirstPl4Table(sheet, assignee.user, assigneeDocuments, { startDate: start.raw, endDate: end.raw });

  const content = await workbook.xlsx.writeBuffer();
  return {
    fileName: `bang-ket-qua-thuc-hien-nhiem-vu-${safeFilePart(assignee.user.fullName)}-${start.raw}-${end.raw}.xlsx`,
    content: Buffer.from(content),
  };
};
