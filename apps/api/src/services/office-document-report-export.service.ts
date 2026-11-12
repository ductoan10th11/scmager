import ExcelJS from "exceljs";
import type { AuthUser } from "../types/auth";
import { fetchOverdueOfficeDocumentRows } from "./office-document-report.service";
import { fetchLateAssignmentRows } from "./late-assignment-report.service";

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

const formatVietnamDateTime = (value: string | null) => {
  if (!value) return "";
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
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

export const buildLateAssignmentReportWorkbook = async (
  actor: AuthUser,
  query: Record<string, unknown>,
) => {
  const rows = await fetchLateAssignmentRows(actor, query);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Giao việc muộn");
  sheet.columns = [
    { header: "STT", key: "stt", width: 6 },
    { header: "Số ký hiệu", key: "soKyHieu", width: 22 },
    { header: "Trích yếu", key: "subject", width: 55 },
    { header: "Phòng ban", key: "departmentName", width: 25 },
    { header: "Trưởng phòng phụ trách", key: "leaderName", width: 25 },
    { header: "Thời gian đến", key: "receivedAt", width: 18 },
    { header: "Số giờ chậm giao", key: "holdingHours", width: 18 },
    { header: "Số ngày chậm", key: "holdingDays", width: 16 },
    { header: "Hạn xử lý văn bản", key: "dueAt", width: 18 },
    { header: "Tình trạng hạn", key: "deadlineStatus", width: 20 },
  ];
  sheet.getRow(1).font = { bold: true };

  rows.forEach((row, index) => {
    sheet.addRow({
      stt: index + 1,
      soKyHieu: row.soKyHieu,
      subject: row.subject,
      departmentName: row.departmentName,
      leaderName: row.leaderName,
      receivedAt: formatVietnamDateTime(row.receivedAt),
      holdingHours: row.holdingHours,
      holdingDays: row.holdingDays,
      dueAt: formatVietnamDate(row.dueAt),
      deadlineStatus: row.isOverdue ? "Đã quá hạn xử lý" : "Còn hạn xử lý",
    });
  });

  const content = await workbook.xlsx.writeBuffer();
  const dateStamp = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());
  return { content: Buffer.from(content), fileName: `bao-cao-giao-viec-muon-${dateStamp}.xlsx` };
};
