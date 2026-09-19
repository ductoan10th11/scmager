import ExcelJS from "exceljs";
import type { AuthUser } from "../types/auth";
import { fetchOverdueOfficeDocumentRows } from "./office-document-report.service";

const DEADLINE_STATUS_LABEL: Record<string, string> = {
  PENDING_OVERDUE: "Đang quá hạn",
  DONE_LATE: "Đã xử lý (trễ hạn)",
  PENDING_IN_TIME: "Chưa làm, còn hạn",
  DONE_ON_TIME: "Đã xử lý (đúng hạn)",
  NO_DEADLINE: "Không có hạn",
};

const formatVietnamDate = (value: string | null) => {
  if (!value) return "";
  return new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(value));
};

export const buildOverdueOfficeDocumentReportWorkbook = async (
  actor: AuthUser,
  query: Record<string, unknown>,
) => {
  const rows = await fetchOverdueOfficeDocumentRows(actor, query);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Theo dõi hạn xử lý");
  sheet.columns = [
    { header: "STT", key: "stt", width: 6 },
    { header: "Số ký hiệu", key: "soKyHieu", width: 22 },
    { header: "Trích yếu", key: "subject", width: 55 },
    { header: "Phòng ban", key: "departmentName", width: 22 },
    { header: "Người xử lý", key: "assigneeName", width: 22 },
    { header: "Hạn xử lý", key: "dueAt", width: 14 },
    { header: "Số ngày quá hạn", key: "overdueDays", width: 16 },
    { header: "Còn lại (ngày)", key: "daysRemaining", width: 15 },
    { header: "Trạng thái", key: "statusLabel", width: 24 },
  ];
  sheet.getRow(1).font = { bold: true };

  rows.forEach((row, index) => {
    sheet.addRow({
      stt: index + 1,
      soKyHieu: row.soKyHieu,
      subject: row.subject,
      departmentName: row.departmentName,
      assigneeName: row.assigneeName,
      dueAt: formatVietnamDate(row.dueAt),
      overdueDays: row.overdueDays || "",
      daysRemaining: row.daysRemaining || "",
      statusLabel: DEADLINE_STATUS_LABEL[row.deadlineStatus] ?? row.statusLabel ?? row.deadlineStatus,
    });
  });

  const content = await workbook.xlsx.writeBuffer();
  const dateStamp = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());
  return { content: Buffer.from(content), fileName: `bao-cao-han-xu-ly-${dateStamp}.xlsx` };
};
