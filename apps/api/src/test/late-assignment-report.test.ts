import assert from "node:assert/strict";
import test from "node:test";
import OfficeDocumentContextModel from "../models/office-document-context.model";
import DepartmentModel from "../models/department.model";
import UserModel from "../models/user.model";
import {
  lateAssignmentReportService,
} from "../services/late-assignment-report.service";
import { buildLateAssignmentReportWorkbook } from "../services/office-document-report-export.service";

/** eOffice track-log time, "dd/MM/yyyy HH:mm" in Vietnam time. */
const vietnamTime = (ms: number) => {
  const d = new Date(ms + 7 * 3600 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};

test("lateAssignmentReportService blocks specialists", async () => {
  const specialistActor: any = {
    id: "user-spec-1",
    role: { code: "SPECIALIST" },
  };

  await assert.rejects(
    () => lateAssignmentReportService(specialistActor, {}),
    /Chuyên viên không có quyền truy cập báo cáo này/,
  );
});

test("lateAssignmentReportService returns expected structure with mocked documents", async () => {
  const origDeptFind = DepartmentModel.find;
  const origUserFind = UserModel.find;
  const origDocFind = OfficeDocumentContextModel.find;

  try {
    (DepartmentModel as any).find = () => ({
      populate: () => ({
        lean: async () => [
          {
            _id: "dept-1",
            name: "Phòng Kinh tế",
            leader: { _id: "leader-1", fullName: "Nguyễn Văn Trưởng" },
          },
        ],
      }),
    });

    (UserModel as any).find = () => ({
      populate: () => ({
        lean: async () => [],
      }),
    });

    (OfficeDocumentContextModel as any).find = () => ({
      select() { return this; },
      sort: () => ({
        lean: async () => [
          {
            _id: "doc-1",
            pageType: "incoming",
            externalDocumentId: "EXT-001",
            observation: {
              soKyHieu: "123/UBND",
              subject: "Báo cáo tiến độ",
              receivedDate: "2026-09-20",
              dueDate: "2026-09-25",
            },
            management: {
              assignment: {
                departmentId: "dept-1",
                departmentName: "Phòng Kinh tế",
                userId: null,
              },
            },
            statusSync: {
              completed: false,
              trackLogs: [{ id: "1", action: "Chuyển tiếp văn bản" }],
              processing: {
                currentAssignee: {
                  userId: "leader-1",
                  fullName: "Nguyễn Văn Trưởng",
                  roleCode: "DEPARTMENT_LEADER",
                  departmentId: "dept-1",
                  assignedAt: vietnamTime(Date.now() - 36 * 3600 * 1000), // 36h ago
                  processedAt: null,
                },
                assignees: [],
              },
            },
            observedAt: new Date(Date.now() - 36 * 3600 * 1000),
          },
        ],
      }),
    });

    const officeChiefActor: any = {
      id: "user-chief-1",
      role: { code: "OFFICE_CHIEF" },
      organization: "org-1",
    };

    const result = await lateAssignmentReportService(officeChiefActor, { slaHours: 24 });
    assert.ok(result);
    assert.ok(result.data);
    assert.strictEqual(result.data.items.length, 1);
    assert.strictEqual(result.data.items[0].soKyHieu, "123/UBND");
    assert.strictEqual(result.data.items[0].departmentName, "Phòng Kinh tế");
    assert.strictEqual(result.data.summary.totalLate, 1);
    assert.strictEqual(result.data.departmentSummary.length, 1);
    assert.strictEqual(result.data.leaderSummary.length, 1);

    // Test Excel generation
    const workbookResult = await buildLateAssignmentReportWorkbook(officeChiefActor, { slaHours: 24 });
    assert.ok(workbookResult);
    assert.ok(Buffer.isBuffer(workbookResult.content));
    assert.ok(workbookResult.fileName.includes("bao-cao-giao-viec-muon-"));
  } finally {
    DepartmentModel.find = origDeptFind;
    UserModel.find = origUserFind;
    OfficeDocumentContextModel.find = origDocFind;
  }
});

test("lateAssignmentReportService lists only documents a department leader still holds, by arrival time", async () => {
  const origDeptFind = DepartmentModel.find;
  const origUserFind = UserModel.find;
  const origDocFind = OfficeDocumentContextModel.find;
  const hoursAgo = (hours: number) => vietnamTime(Date.now() - hours * 3600 * 1000);
  const leader = (assignedAt: string, extra: Record<string, unknown> = {}) => ({
    userId: "leader-b",
    fullName: "Trưởng phòng B",
    roleCode: "DEPARTMENT_LEADER",
    departmentId: "dept-b",
    assignedAt,
    processedAt: null,
    ...extra,
  });
  const doc = (id: string, statusSync: Record<string, unknown>, assignment: Record<string, unknown> = {}) => ({
    _id: id,
    pageType: "incoming",
    externalDocumentId: id,
    observation: { soKyHieu: id, subject: id, receivedDate: "01/09/2026", dueDate: "30/12/2099" },
    // The expected department is A, the document actually sits with leader B.
    management: { assignment: { departmentId: "dept-a", departmentName: "Phòng A", userId: null, ...assignment } },
    statusSync: { completed: false, trackLogs: [{ id: "1" }], ...statusSync },
    observedAt: new Date(),
  });

  try {
    (DepartmentModel as any).find = () => ({
      populate: () => ({
        lean: async () => [
          { _id: "dept-a", name: "Phòng A", leader: null },
          { _id: "dept-b", name: "Phòng B", leader: null },
        ],
      }),
    });
    (UserModel as any).find = () => ({
      populate: () => ({
        lean: async () => [
          { _id: "leader-b", username: "tpb", fullName: "Trưởng phòng B", department: "dept-b", role: { code: "DEPARTMENT_LEADER" } },
        ],
      }),
    });
    (OfficeDocumentContextModel as any).find = () => ({
      select() { return this; },
      sort: () => ({
        lean: async () => [
          doc("older", { processing: { currentAssignee: leader(hoursAgo(72)), assignees: [] } }),
          doc("newer", { processing: { currentAssignee: leader(hoursAgo(30)), assignees: [] } }),
          // Never synced: who holds it is unknown, so it is counted apart, not listed.
          doc("unsynced", { trackLogs: [], processing: null }),
          // With the commune leader, not with a department leader.
          doc("commune", { processing: { currentAssignee: { ...leader(hoursAgo(50)), userId: null, roleCode: "COMMUNE_LEADER" }, assignees: [] } }),
          // The leader forwarded or returned it: nobody holds it now.
          doc("forwarded", { processing: { currentAssignee: null, assignees: [] } }),
          // The leader created the response after receiving it.
          doc("responded", { processing: { currentAssignee: leader(hoursAgo(50), { processedAt: hoursAgo(40) }), assignees: [] } }),
          // Reached a specialist earlier in the routing.
          doc("specialist", { processing: { currentAssignee: leader(hoursAgo(50)), assignees: [{ roleCode: "SPECIALIST" }] } }),
        ],
      }),
    });

    const chief: any = { id: "chief", role: { code: "OFFICE_CHIEF" }, organization: "org-1" };
    const report = await lateAssignmentReportService(chief, { filterType: "ALL_PENDING" });
    assert.deepEqual(report.data.items.map((item) => item.id), ["newer", "older"]);
    assert.equal(report.data.summary.unsyncedCount, 1);
    assert.equal(report.data.items[0].departmentId, "dept-b");
    assert.equal(report.data.items[0].departmentName, "Phòng B");
    assert.equal(report.data.items[1].holdingHours, 72);

    const ascending = await lateAssignmentReportService(chief, { filterType: "ALL_PENDING", sortOrder: "asc" });
    assert.deepEqual(ascending.data.items.map((item) => item.id), ["older", "newer"]);
  } finally {
    DepartmentModel.find = origDeptFind;
    UserModel.find = origUserFind;
    OfficeDocumentContextModel.find = origDocFind;
  }
});
