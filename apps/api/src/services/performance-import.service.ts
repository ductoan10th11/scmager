import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import { isValidObjectId } from 'mongoose';
import { OfficeDocumentContextModel, UserModel, WorkDeclarationModel } from '../models';
import type { AuthUser } from '../types/auth';
import { badRequest, forbidden } from '../utils/http-error';

const FIRST_DATA_ROW = 8;
const REQUIRED_HEADERS: Array<[string, string]> = [
  ['A4', 'STT'], ['B4', 'Nội dung nhiệm vụ'], ['C5', 'Ngày hết hạn'],
  ['D5', 'Sản phẩm công việc'], ['E5', 'Hệ số quy đổi'], ['F5', 'Số lượng giao'],
  ['H6', 'Số lượng hoàn thành thực tế'], ['J6', 'Ngày hoàn thành'],
  ['M6', 'Số lần yêu cầu làm lại'],
];
const IMPORT_ROLES = new Set(['ADMIN', 'OFFICE_CHIEF', 'COMMUNE_LEADER', 'DEPARTMENT_LEADER']);

type ImportRow = {
  row: number;
  order: number;
  content: string;
  deadline: Date;
  deadlineKey: string;
  product: string;
  point: number;
  assignedQuantity: number;
  completedQuantity: number;
  completedAt: Date | null;
  reworkCount: number;
};

const asText = (value: unknown) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object' && value && 'result' in value) return asText((value as any).result);
  if (typeof value === 'object' && value && 'text' in value) return String((value as any).text).trim();
  return String(value).replace(/\s+/g, ' ').trim();
};

const normalized = (value: unknown) => asText(value)
  .normalize('NFD')
  .replace(/\p{Diacritic}/gu, '')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();

const dateKey = (value: Date) => {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, '0');
  const day = String(value.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const dateAt = (key: string, time: string) => new Date(`${key}T${time}+07:00`);

const asDate = (value: unknown): Date | null => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const text = asText(value);
  const vietnam = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (vietnam) return new Date(Date.UTC(Number(vietnam[3]), Number(vietnam[2]) - 1, Number(vietnam[1])));
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
  return null;
};

const asNumber = (value: unknown, row: number, column: string, errors: string[], allowFormula = false): number | null => {
  if (typeof value === 'object' && value && 'formula' in value && !(value as any).result && !allowFormula) {
    errors.push(`Dòng ${row}, cột ${column}: không được dùng công thức cho dữ liệu nhập.`);
    return null;
  }
  const raw = typeof value === 'object' && value && 'result' in value ? (value as any).result : value;
  const number = Number(raw);
  if (!Number.isFinite(number)) {
    errors.push(`Dòng ${row}, cột ${column}: phải là số hợp lệ.`);
    return null;
  }
  return number;
};

const parseWorkbook = async (buffer: Buffer) => {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as any);
  } catch {
    throw badRequest('Tệp không phải Excel .xlsx hợp lệ.');
  }
  if (workbook.worksheets.length !== 1 || workbook.worksheets[0]?.name !== 'Pl4 Tinh diem') {
    throw badRequest('File phải có đúng một sheet tên "Pl4 Tinh diem".');
  }
  const sheet = workbook.worksheets[0];
  const errors: string[] = [];
  for (const [cell, expected] of REQUIRED_HEADERS) {
    if (asText(sheet.getCell(cell).value) !== expected) errors.push(`Sai mẫu tại ô ${cell}; cần "${expected}".`);
  }
  const fullName = asText(sheet.getCell('B3').value).replace(/^Họ và tên\s*:\s*/iu, '').trim();
  if (!fullName || asText(sheet.getCell('B3').value) !== `Họ và tên: ${fullName}`) {
    errors.push('Ô B3 phải có đúng dạng "Họ và tên: <tên nhân sự>".');
  }
  let totalRow = 0;
  for (let row = FIRST_DATA_ROW; row <= sheet.rowCount; row += 1) {
    if (asText(sheet.getCell(`A${row}`).value) === 'Tổng cộng') { totalRow = row; break; }
  }
  if (!totalRow) errors.push('Không tìm thấy dòng "Tổng cộng" của mẫu PL4.');
  const rows: ImportRow[] = [];
  if (totalRow) {
    for (let row = FIRST_DATA_ROW; row < totalRow; row += 1) {
      const order = asNumber(sheet.getCell(`A${row}`).value, row, 'A', errors);
      const content = asText(sheet.getCell(`B${row}`).value);
      const deadlineCell = asDate(sheet.getCell(`C${row}`).value);
      const product = asText(sheet.getCell(`D${row}`).value);
      const point = asNumber(sheet.getCell(`E${row}`).value, row, 'E', errors);
      const assignedQuantity = asNumber(sheet.getCell(`F${row}`).value, row, 'F', errors);
      const completedRaw = sheet.getCell(`H${row}`).value;
      const completedQuantity = typeof completedRaw === 'object' && completedRaw && 'formula' in completedRaw && !(completedRaw as any).result
        && String((completedRaw as any).formula).replace(/\s/g, '') === `=F${row}`
        ? assignedQuantity
        : asNumber(completedRaw, row, 'H', errors);
      const completedAt = asDate(sheet.getCell(`J${row}`).value);
      const reworkCount = asNumber(sheet.getCell(`M${row}`).value, row, 'M', errors);

      if (!Number.isSafeInteger(order) || order !== row - FIRST_DATA_ROW + 1) errors.push(`Dòng ${row}, cột A: STT phải liên tục từ 1.`);
      if (!content) errors.push(`Dòng ${row}, cột B: nội dung nhiệm vụ là bắt buộc.`);
      if (!deadlineCell) errors.push(`Dòng ${row}, cột C: ngày hết hạn không hợp lệ.`);
      if (!product) errors.push(`Dòng ${row}, cột D: sản phẩm công việc là bắt buộc.`);
      if (point !== null && point < 0) errors.push(`Dòng ${row}, cột E: điểm không được âm.`);
      if (assignedQuantity !== null && (!Number.isFinite(assignedQuantity) || assignedQuantity <= 0)) errors.push(`Dòng ${row}, cột F: số lượng giao phải lớn hơn 0.`);
      if (completedQuantity !== null && assignedQuantity !== null && completedQuantity !== 0 && completedQuantity !== assignedQuantity) errors.push(`Dòng ${row}, cột H: chỉ nhận 0 hoặc đúng bằng số lượng giao.`);
      if (completedQuantity && !completedAt) errors.push(`Dòng ${row}, cột J: phải có ngày hoàn thành khi đã hoàn thành.`);
      if (!completedQuantity && completedAt) errors.push(`Dòng ${row}, cột J: chỉ được có ngày hoàn thành khi số lượng hoàn thành lớn hơn 0.`);
      if (reworkCount !== null && (!Number.isSafeInteger(reworkCount) || reworkCount < 0)) errors.push(`Dòng ${row}, cột M: phải là số nguyên không âm.`);
      if (order === null || !deadlineCell || point === null || assignedQuantity === null || completedQuantity === null || reworkCount === null) continue;
      rows.push({ row, order, content, deadline: dateAt(dateKey(deadlineCell), '23:59:59.999'), deadlineKey: dateKey(deadlineCell), product, point, assignedQuantity, completedQuantity, completedAt: completedAt ? dateAt(dateKey(completedAt), '17:00:00.000') : null, reworkCount });
    }
  }
  if (!rows.length && !errors.length) errors.push('File không có dòng công việc để nhập.');
  if (errors.length) throw badRequest('File PL4 không đúng mẫu.', { errors: errors.slice(0, 100) });
  return { fullName, rows };
};

const requireImportPermission = (actor: AuthUser, target: any) => {
  if (!IMPORT_ROLES.has(actor.role.code)) throw forbidden('Chỉ cấp quản lý mới được nhập bảng KPI.');
  if (actor.role.code !== 'ADMIN' && (!actor.organization || String(target.organization ?? '') !== actor.organization)) throw forbidden('Nhân sự không thuộc tổ chức của bạn.');
  if (actor.role.code === 'DEPARTMENT_LEADER' && String(target.department ?? '') !== String(actor.department ?? '')) throw forbidden('Trưởng phòng chỉ được nhập KPI cho nhân sự trong phòng ban.');
};

const importKeyFor = (userId: string, row: ImportRow) => createHash('sha256')
  .update(`${userId}|${normalized(row.content)}|${row.deadlineKey}|${normalized(row.product)}`)
  .digest('hex');

const documentForRow = (row: ImportRow, contexts: any[]) => {
  const content = normalized(row.content);
  return contexts
    .filter((context) => {
      const symbol = normalized(context.management?.overrides?.soKyHieu ?? context.observation?.soKyHieu);
      return symbol && content.startsWith(symbol);
    })
    .sort((left, right) => normalized(right.management?.overrides?.soKyHieu ?? right.observation?.soKyHieu).length - normalized(left.management?.overrides?.soKyHieu ?? left.observation?.soKyHieu).length)[0] ?? null;
};

export const importPerformanceWorkbook = async (actor: AuthUser, file: Express.Multer.File | undefined) => {
  if (!file?.buffer?.length) throw badRequest('Chọn một file PL4 .xlsx để nhập.');
  const parsed = await parseWorkbook(file.buffer);
  const target = await UserModel.findOne({ fullName: parsed.fullName, status: 'ACTIVE' })
    .select('_id fullName organization department')
    .lean();
  if (!target || !isValidObjectId(target._id)) throw badRequest(`Không tìm thấy đúng một nhân sự hoạt động tên "${parsed.fullName}".`);
  await requireImportPermission(actor, target);

  const organizationId = String(target.organization ?? '');
  if (!organizationId) throw badRequest('Nhân sự trong file chưa thuộc tổ chức.');
  const contexts = await OfficeDocumentContextModel.find({ organizationId, pageType: 'incoming' })
    .select('_id observation management')
    .limit(5_000)
    .lean();
  const now = new Date();
  let updatedDocuments = 0;
  let createdWorks = 0;
  let updatedWorks = 0;

  for (const row of parsed.rows) {
    const importKey = importKeyFor(String(target._id), row);
    const matchedDocument = documentForRow(row, contexts);
    if (matchedDocument) {
      await OfficeDocumentContextModel.updateOne(
        { _id: matchedDocument._id },
        {
          $set: {
            'management.assignment.userId': target._id,
            'management.assignment.fullName': target.fullName,
            'management.assignment.departmentId': target.department ?? null,
            'management.kpiImport': {
              importKey,
              point: row.point * row.assignedQuantity,
              product: row.product,
              assignedQuantity: row.assignedQuantity,
              completedQuantity: row.completedQuantity,
              completedAt: row.completedAt,
              reworkCount: row.reworkCount,
              importedBy: actor.id,
              importedAt: now,
            },
          },
        },
      );
      updatedDocuments += 1;
      continue;
    }

    const isCompleted = row.completedQuantity === row.assignedQuantity;
    const workStartAt = dateAt(row.deadlineKey, '08:00:00.000');
    const workEndAt = dateAt(row.deadlineKey, '17:00:00.000');
    const update = {
      organization: target.organization,
      department: target.department ?? null,
      createdBy: target._id,
      assignedBy: actor.id,
      workSource: 'KPI_IMPORT',
      title: row.content,
      description: row.product,
      workStartAt,
      workEndAt,
      durationMinutes: 540,
      declaredPoint: row.point * row.assignedQuantity,
      status: isCompleted ? 'COMPLETED' : 'APPROVED',
      approval: { currentApprover: actor.id, submittedAt: now, approvedAt: now, history: [] },
      completion: isCompleted
        ? { submittedAt: row.completedAt, confirmedAt: row.completedAt, returnedAt: null, submittedResult: 'Nhập từ bảng KPI PL4.', confirmationNote: 'Nhập từ bảng KPI PL4.' }
        : { submittedAt: null, confirmedAt: null, returnedAt: null, submittedResult: '', confirmationNote: null },
      kpiImport: { importKey, product: row.product, assignedQuantity: row.assignedQuantity, completedQuantity: row.completedQuantity, reworkCount: row.reworkCount, importedBy: actor.id, importedAt: now },
    };
    const existing = await WorkDeclarationModel.findOneAndUpdate(
      { organization: target.organization, workSource: 'KPI_IMPORT', 'kpiImport.importKey': importKey },
      { $set: update, $setOnInsert: { revision: 1 } },
      { new: true, upsert: true, rawResult: true },
    ) as any;
    if (existing?.lastErrorObject?.updatedExisting) updatedWorks += 1;
    else createdWorks += 1;
  }

  return { data: { user: { id: String(target._id), fullName: target.fullName }, importedRows: parsed.rows.length, updatedDocuments, createdWorks, updatedWorks } };
};

export const parsePerformanceWorkbook = parseWorkbook;
