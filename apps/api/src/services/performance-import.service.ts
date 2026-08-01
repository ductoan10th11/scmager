import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import { isValidObjectId } from 'mongoose';
import { OfficeDocumentContextModel, UserModel, WorkDeclarationModel } from '../models';
import type { AuthUser } from '../types/auth';
import { badRequest, forbidden } from '../utils/http-error';
import { assertSafeKpiWorkbookBuffer } from '../utils/kpi-import-upload';

const FIRST_DATA_ROW = 8;
const REQUIRED_HEADERS: Array<[string, string]> = [
  ['A4', 'STT'], ['B4', 'Nội dung nhiệm vụ'], ['C5', 'Ngày hết hạn'],
  ['D5', 'Sản phẩm công việc'], ['E5', 'Hệ số quy đổi'], ['F5', 'Số lượng giao'],
  ['H6', 'Số lượng hoàn thành thực tế'], ['J6', 'Ngày hoàn thành'],
  ['M6', 'Số lần yêu cầu làm lại'],
];
const REQUIRED_HEADER_MERGES = [
  'A4:A6', 'B4:B6', 'C4:G4', 'H4:N4', 'C5:C6', 'D5:D6',
  'E5:E6', 'F5:F6', 'G5:G6', 'H5:I5', 'J5:L5', 'M5:N5',
];
const LEGACY_NOTE_MERGE = 'O4:O5';
const MAX_IMPORT_ROWS = 500;
const IMPORT_ROLES = new Set(['ADMIN', 'OFFICE_CHIEF', 'COMMUNE_LEADER', 'DEPARTMENT_LEADER', 'SPECIALIST']);

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

const hasFormula = (value: unknown) => Boolean(
  value && typeof value === 'object' && 'formula' in value,
);

const isUnsafeSpreadsheetText = (value: string) => /^[=+\-@]/u.test(value.trim());

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

const asNumber = (value: unknown, row: number, column: string, errors: string[]): number | null => {
  if (hasFormula(value)) {
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
  assertSafeKpiWorkbookBuffer(buffer);
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as any);
  } catch {
    throw badRequest('Tệp không phải Excel .xlsx hợp lệ.');
  }
  if (workbook.worksheets.length !== 1) {
    throw badRequest('File phải có đúng một sheet dữ liệu.');
  }
  const sheet = workbook.worksheets[0];
  const errors: string[] = [];
  if (sheet.state !== 'visible' || ![14, 15].includes(sheet.columnCount)) {
    errors.push('Sheet PL4 phải hiển thị và có đúng 14 cột, hoặc 15 cột với ghi chú chuẩn.');
  }
  const merges = new Set(Array.from((sheet.model as any).merges ?? []));
  for (const merge of REQUIRED_HEADER_MERGES) {
    if (!merges.has(merge)) errors.push(`Sai cấu trúc gộp ô ${merge} của mẫu PL4.`);
  }
  if (sheet.columnCount === 15 && (!merges.has(LEGACY_NOTE_MERGE) || asText(sheet.getCell('O4').value) !== 'Ghi chú')) {
    errors.push('Cột O chỉ được phép là cột "Ghi chú" đúng cấu trúc của mẫu PL4 cũ.');
  }
  for (const [cell, expected] of REQUIRED_HEADERS) {
    if (hasFormula(sheet.getCell(cell).value)) errors.push(`Ô ${cell} không được chứa công thức.`);
    if (asText(sheet.getCell(cell).value) !== expected) errors.push(`Sai mẫu tại ô ${cell}; cần "${expected}".`);
  }
  if (hasFormula(sheet.getCell('B3').value)) errors.push('Ô B3 không được chứa công thức.');
  const fullName = asText(sheet.getCell('B3').value).replace(/^Họ và tên\s*:\s*/iu, '').trim();
  if (!fullName || isUnsafeSpreadsheetText(fullName) || asText(sheet.getCell('B3').value) !== `Họ và tên: ${fullName}`) {
    errors.push('Ô B3 phải có đúng dạng "Họ và tên: <tên nhân sự>".');
  }
  let totalRow = 0;
  for (let row = FIRST_DATA_ROW; row <= sheet.rowCount; row += 1) {
    if (asText(sheet.getCell(`A${row}`).value) === 'Tổng cộng') { totalRow = row; break; }
  }
  if (!totalRow) errors.push('Không tìm thấy dòng "Tổng cộng" của mẫu PL4.');
  const rows: ImportRow[] = [];
  if (totalRow) {
    if (totalRow - FIRST_DATA_ROW > MAX_IMPORT_ROWS) errors.push(`Mẫu PL4 chỉ nhận tối đa ${MAX_IMPORT_ROWS} dòng nhiệm vụ.`);
    for (let row = FIRST_DATA_ROW; row < totalRow; row += 1) {
      const cells = Object.fromEntries(
        ['A', 'B', 'C', 'D', 'E', 'F', 'H', 'J', 'M'].map((column) => [column, sheet.getCell(`${column}${row}`).value]),
      ) as Record<string, unknown>;
      for (const column of ['A', 'B', 'C', 'D', 'E', 'F', 'J', 'M']) {
        if (hasFormula(cells[column])) errors.push(`Dòng ${row}, cột ${column}: không được dùng công thức cho dữ liệu nhập.`);
      }
      const order = asNumber(cells.A, row, 'A', errors);
      const content = asText(cells.B);
      const deadlineCell = asDate(cells.C);
      const product = asText(cells.D);
      const point = asNumber(cells.E, row, 'E', errors);
      const assignedQuantity = asNumber(cells.F, row, 'F', errors);
      const completedRaw = cells.H;
      const completedFormula = hasFormula(completedRaw)
        ? String((completedRaw as any).formula).replace(/\s/g, '')
        : '';
      const completedQuantity = completedFormula === `F${row}`
        ? assignedQuantity
        : asNumber(completedRaw, row, 'H', errors);
      const completedAt = asDate(cells.J);
      const reworkCount = asNumber(cells.M, row, 'M', errors);

      if (!Number.isSafeInteger(order) || order !== row - FIRST_DATA_ROW + 1) errors.push(`Dòng ${row}, cột A: STT phải liên tục từ 1.`);
      if (!content) errors.push(`Dòng ${row}, cột B: nội dung nhiệm vụ là bắt buộc.`);
      if (isUnsafeSpreadsheetText(content) || isUnsafeSpreadsheetText(product)) errors.push(`Dòng ${row}: nội dung không được bắt đầu bằng ký tự công thức Excel.`);
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
  if (!IMPORT_ROLES.has(actor.role.code)) throw forbidden('Vai trò hiện tại không được nhập bảng KPI.');
  if (actor.role.code !== 'ADMIN' && (!actor.organization || String(target.organization ?? '') !== actor.organization)) throw forbidden('Nhân sự không thuộc tổ chức của bạn.');
  if (actor.role.code === 'SPECIALIST') {
    if (String(target._id) !== actor.id) throw forbidden('Chuyên viên chỉ được nhập bảng KPI của chính mình.');
    return;
  }
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

const objectId = (value: unknown) => String((value as any)?._id ?? value ?? '');
const vietnamDate = (key: string) => {
  const [year, month, day] = key.split('-');
  return `${day}/${month}/${year}`;
};

const importedDocumentId = (importKey: string) => `kpi-import-${importKey}`;

const importedDocumentReference = (row: ImportRow) => {
  const candidate = row.content.match(/^\s*(\d{1,5}\/[A-Za-z0-9Đđ._-]{1,32})(?:\s|$)/u)?.[1];
  return candidate || `PL4-${row.order}/${row.deadlineKey.slice(0, 4)}`;
};

type ImportedIncomingDocument = {
  target: any;
  row: ImportRow;
  importKey: string;
  point: number;
  importedBy: unknown;
  now: Date;
};

const upsertImportedIncomingDocument = async ({
  target, row, importKey, point, importedBy, now,
}: ImportedIncomingDocument) => {
  const completed = row.completedQuantity >= row.assignedQuantity;
  const department = target.department ?? null;
  const departmentId = objectId(department) || null;
  const departmentName = typeof department === 'object' ? String(department?.name ?? '') : '';
  const dueDate = vietnamDate(row.deadlineKey);
  const documentId = importedDocumentId(importKey);
  const update = await OfficeDocumentContextModel.updateOne(
    {
      sourceHost: 'manual.ework.local',
      pageType: 'incoming',
      externalDocumentId: documentId,
    },
    {
      $set: {
        organizationId: target.organization,
        tenantResolution: 'MANUAL',
        origin: 'MANUAL_INGEST',
        sourceHost: 'manual.ework.local',
        pageType: 'incoming',
        externalDocumentId: documentId,
        sourceUrl: `https://manual.ework.local/kpi-import/${importKey}`,
        observation: {
          available: true,
          modalOpen: true,
          title: 'Văn bản đến',
          subject: row.content,
          soKyHieu: importedDocumentReference(row),
          receivedDate: dueDate,
          dueDate,
          documentForm: row.product,
          priority: 'Thường',
          createdDate: '',
          draftingUnit: '',
          draftingUnitId: '',
          draftingUser: '',
          draftingUserId: '',
          senderUser: '',
          senderUserId: '',
          senderDepartment: '',
          sender: { userId: '', fullName: '', department: '' },
          relatedIncomingSoKyHieu: '',
          comment: `Nhập từ bảng KPI PL4. ${row.product}`,
          point,
          reworkCount: row.reworkCount,
          note: row.product,
          recipients: [{
            userId: String(target.username ?? ''),
            department: departmentName,
            fullName: target.fullName,
            role: 'main',
            entityType: 'person',
          }],
          timeline: [],
        },
        observedAt: now,
        statusSync: {
          status: completed ? 'COMPLETED' : 'PENDING_RESPONSE',
          completed,
          completedRule: completed ? 'KPI_IMPORT' : '',
          completedAt: completed ? row.completedAt ?? now : null,
          trackLogs: [],
          processing: null,
          lastSyncedAt: now,
          lastAttemptAt: now,
          nextRetryAt: null,
          attempts: 0,
          lastError: '',
        },
        management: {
          overrides: {},
          assignment: {
            departmentId,
            departmentName,
            userId: target._id,
            fullName: target.fullName,
          },
          kpiImport: {
            importKey,
            point,
            product: row.product,
            assignedQuantity: row.assignedQuantity,
            completedQuantity: row.completedQuantity,
            completedAt: row.completedAt,
            reworkCount: row.reworkCount,
            importedBy,
            importedAt: now,
          },
          manualScore: point,
          note: `Nhập từ bảng KPI PL4. ${row.product}`,
          updatedBy: importedBy,
          updatedAt: now,
        },
      },
    },
    { upsert: true },
  );
  return update.upsertedCount > 0 ? 'created' : 'updated';
};

export const importPerformanceWorkbook = async (actor: AuthUser, file: Express.Multer.File | undefined) => {
  if (!file?.buffer?.length) throw badRequest('Chọn một file PL4 .xlsx để nhập.');
  const parsed = await parseWorkbook(file.buffer);
  const targets = await UserModel.find({ fullName: parsed.fullName, status: 'ACTIVE' })
    .select('_id username fullName organization department')
    .populate('department', '_id name')
    .limit(2)
    .lean();
  if (targets.length !== 1 || !isValidObjectId(targets[0]._id)) throw badRequest(`Không tìm thấy đúng một nhân sự hoạt động tên "${parsed.fullName}".`);
  const [target] = targets;
  await requireImportPermission(actor, target);

  const organizationId = String(target.organization ?? '');
  if (!organizationId) throw badRequest('Nhân sự trong file chưa thuộc tổ chức.');
  const contexts = await OfficeDocumentContextModel.find({ organizationId, pageType: 'incoming' })
    .select('_id observation management')
    .limit(5_000)
    .lean();
  const now = new Date();
  let updatedDocuments = 0;
  let createdDocuments = 0;

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
            'management.assignment.departmentId': objectId(target.department) || null,
            'management.assignment.departmentName': typeof target.department === 'object' ? String((target.department as any)?.name ?? '') : '',
            'management.manualScore': row.point * row.assignedQuantity,
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

    const result = await upsertImportedIncomingDocument({
      target,
      row,
      importKey,
      point: row.point * row.assignedQuantity,
      importedBy: actor.id,
      now,
    });
    if (result === 'created') createdDocuments += 1;
    else updatedDocuments += 1;
  }

  return { data: { user: { id: String(target._id), fullName: target.fullName }, importedRows: parsed.rows.length, createdDocuments, updatedDocuments } };
};

/** Moves the early KPI-import fallback records into incoming office documents. */
export const migrateKpiImportWorksToIncomingDocuments = async () => {
  const works = await WorkDeclarationModel.find({ workSource: 'KPI_IMPORT' })
    .select('_id createdBy assignedBy title description workEndAt declaredPoint status completion kpiImport')
    .lean();
  if (!works.length) return { scanned: 0, createdDocuments: 0, updatedDocuments: 0, removedWorks: 0, skipped: 0 };

  const users = await UserModel.find({
    _id: { $in: works.map((work: any) => work.createdBy).filter(Boolean) },
    status: 'ACTIVE',
  })
    .select('_id username fullName organization department')
    .populate('department', '_id name')
    .lean();
  const usersById = new Map(users.map((user: any) => [objectId(user._id), user]));
  const now = new Date();
  const summary = { scanned: works.length, createdDocuments: 0, updatedDocuments: 0, removedWorks: 0, skipped: 0 };

  for (const work of works as any[]) {
    const target = usersById.get(objectId(work.createdBy));
    const importKey = String(work.kpiImport?.importKey ?? '');
    const deadline = work.workEndAt ? new Date(work.workEndAt) : null;
    if (!target?.organization || !importKey || !deadline || Number.isNaN(deadline.getTime())) {
      summary.skipped += 1;
      continue;
    }
    const assignedQuantity = Math.max(1, Number(work.kpiImport?.assignedQuantity ?? 1));
    const completed = work.status === 'COMPLETED';
    const completedQuantity = completed
      ? assignedQuantity
      : Math.max(0, Math.min(assignedQuantity, Number(work.kpiImport?.completedQuantity ?? 0)));
    const completedAtRaw = work.kpiImport?.completedAt ?? work.completion?.confirmedAt ?? null;
    const completedAt = completedAtRaw ? new Date(completedAtRaw) : null;
    const row: ImportRow = {
      row: 0,
      order: 1,
      content: String(work.title ?? '').trim() || 'Nhiệm vụ nhập KPI PL4',
      deadline,
      deadlineKey: dateKey(deadline),
      product: String(work.kpiImport?.product ?? work.description ?? '').trim() || 'Công việc',
      point: Number(work.declaredPoint ?? 0),
      assignedQuantity,
      completedQuantity,
      completedAt: completedAt && !Number.isNaN(completedAt.getTime()) ? completedAt : null,
      reworkCount: Math.max(0, Number(work.kpiImport?.reworkCount ?? 0)),
    };
    const result = await upsertImportedIncomingDocument({
      target,
      row,
      importKey,
      point: Math.max(0, Number(work.declaredPoint ?? 0)),
      importedBy: work.kpiImport?.importedBy ?? work.assignedBy ?? target._id,
      now,
    });
    if (result === 'created') summary.createdDocuments += 1;
    else summary.updatedDocuments += 1;
    const removed = await WorkDeclarationModel.deleteOne({ _id: work._id, workSource: 'KPI_IMPORT' });
    summary.removedWorks += removed.deletedCount;
  }
  return summary;
};

export const parsePerformanceWorkbook = parseWorkbook;
