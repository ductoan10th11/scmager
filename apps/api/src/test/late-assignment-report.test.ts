import assert from "node:assert/strict";
import test from "node:test";
import OfficeDocumentContextModel from "../models/office-document-context.model";
import DepartmentModel from "../models/department.model";
import UserModel from "../models/user.model";
import {
  lateAssignmentReportService,
} from "../services/late-assignment-report.service";
import { buildLateAssignmentReportWorkbook } from "../services/office-document-report-export.service";

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
            },
            observedAt: new Date(Date.now() - 36 * 3600 * 1000), // 36h ago
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
