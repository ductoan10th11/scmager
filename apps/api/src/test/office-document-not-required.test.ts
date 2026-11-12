import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import { Types } from "mongoose";
import DepartmentModel from "../models/department.model";
import DocumentResultLinkModel from "../models/document-result-link.model";
import LeadershipAssessmentModel from "../models/leadership-assessment.model";
import OfficeDocumentContextModel from "../models/office-document-context.model";
import RoleModel from "../models/role.model";
import UserModel from "../models/user.model";
import WorkDeclarationModel from "../models/work-declaration.model";
import { notificationRepository } from "../repositories/notification.repository";
import { notifyDocumentsAwaitingScore } from "../services/awaiting-score-notice.service";
import { createDocumentResultLinkService } from "../services/document-result-link.service";
import { lateAssignmentReportService } from "../services/late-assignment-report.service";
import { isOfficeDocumentAwaitingScore } from "../services/office-document-completion.service";
import {
  deleteManagedOfficeDocumentContext,
  listOfficeDocumentContexts,
  upsertOfficeDocumentContext,
} from "../services/office-document-context.service";
import {
  cancelOfficeDocumentNotRequiredService,
  decideOfficeDocumentNotRequiredService,
  requestOfficeDocumentNotRequiredService,
  restoreOfficeDocumentNotRequiredService,
} from "../services/office-document-not-required.service";
import { officeDocumentProjection, officeDocumentScope } from "../services/office-document-projection.service";
import { overdueOfficeDocumentReportService } from "../services/office-document-report.service";
import { buildPerformanceWorkbook } from "../services/performance-export.service";
import { importPerformanceWorkbook, parsePerformanceWorkbook } from "../services/performance-import.service";
import { performanceOverviewService } from "../services/performance.service";
import { assertSourceDocumentCanBeLinked } from "../services/work-declaration.service";

const organization = "64b000000000000000000001";
const departmentA = "64b0000000000000000000a1";
const departmentB = "64b0000000000000000000b1";
const specialist = "64b000000000000000000011";
const colleague = "64b000000000000000000012";
const leaderA = "64b000000000000000000013";
const leaderB = "64b000000000000000000014";
const manager = "64b000000000000000000015";
const documentId = "64b000000000000000000020";

const actorFor = (id: string, role: string, department: string | null, fullName: string): any => ({
  id,
  username: fullName,
  fullName,
  organization,
  department,
  role: { code: role, level: 3 },
});
const owner = actorFor(specialist, "SPECIALIST", departmentA, "Chuyên viên Một");
const otherSpecialist = actorFor(colleague, "SPECIALIST", departmentA, "Chuyên viên Hai");
const ownLeader = actorFor(leaderA, "DEPARTMENT_LEADER", departmentA, "Trưởng phòng A");
const otherLeader = actorFor(leaderB, "DEPARTMENT_LEADER", departmentB, "Trưởng phòng B");
const chief = actorFor(manager, "OFFICE_CHIEF", null, "Chánh văn phòng");
const communeLeader = actorFor(manager, "COMMUNE_LEADER", null, "Chủ tịch");
const admin = actorFor(manager, "ADMIN", null, "Quản trị");

const department = (id: string, name: string, code: string) => ({ _id: id, name, code });
const users = [
  { _id: specialist, username: "cv1", fullName: "Chuyên viên Một", email: "cv1@x.vn", status: "ACTIVE", department: department(departmentA, "Phòng A", "A"), role: { code: "SPECIALIST", name: "Chuyên viên", level: 4 } },
  { _id: colleague, username: "cv2", fullName: "Chuyên viên Hai", email: "cv2@x.vn", status: "ACTIVE", department: department(departmentA, "Phòng A", "A"), role: { code: "SPECIALIST", name: "Chuyên viên", level: 4 } },
  { _id: leaderA, username: "tpa", fullName: "Trưởng phòng A", email: "tpa@x.vn", status: "ACTIVE", department: department(departmentA, "Phòng A", "A"), role: { code: "DEPARTMENT_LEADER", name: "Trưởng phòng", level: 3 } },
];

/**
 * Routed through leader B, who still holds the assignment, and worked by the
 * specialist of department A: the shape that makes the assignment the wrong
 * answer to "who owns this".
 */
const incoming = (
  management: Record<string, unknown> = {},
  overrides: Record<string, unknown> = {},
): any => ({
  _id: documentId,
  organizationId: organization,
  origin: "EXTENSION",
  pageType: "incoming",
  externalDocumentId: "6954",
  sourceUrl: "https://vanphongdientu.example.vn/main",
  observedAt: new Date("2026-07-20T00:00:00Z"),
  observation: {
    available: true,
    modalOpen: false,
    subject: "Văn bản kiểm thử",
    soKyHieu: "6954/TEST",
    dueDate: "25/07/2026",
    point: 4,
    recipients: [],
  },
  statusSync: {
    completed: false,
    processing: {
      primaryAssignee: { userId: new Types.ObjectId(specialist), fullName: "Chuyên viên Một", departmentId: null },
      assignees: [],
    },
  },
  management: {
    assignment: { userId: leaderB, fullName: "Trưởng phòng B", departmentId: departmentB, departmentName: "Phòng B" },
    assignmentMode: "AUTO",
    updatedBy: null,
    ...management,
  },
  ...overrides,
});

const pending = (extra: Record<string, unknown> = {}) => ({
  notRequired: {
    status: "PENDING",
    reason: "Giao nhầm",
    requestedBy: specialist,
    requestedByName: "Chuyên viên Một",
    requestedAt: new Date("2026-07-22T03:00:00Z"),
    decisionNote: "",
    history: [{ action: "REQUESTED", actor: specialist, note: "Giao nhầm" }],
    ...extra,
  },
});

const stub = (target: any, overrides: Record<string, unknown>) => {
  const originals = Object.fromEntries(Object.keys(overrides).map((key) => [key, target[key]]));
  Object.assign(target, overrides);
  return () => Object.assign(target, originals);
};

/** Every chained call returns the query, which resolves to the rows. */
const query = (rows: unknown) => {
  const chain: any = {
    then: (resolve: (value: unknown) => unknown) => resolve(rows),
    lean: async () => rows,
  };
  for (const method of ["select", "sort", "limit", "populate", "session"]) chain[method] = () => chain;
  return chain;
};

const valueAt = (document: any, path: string) =>
  path.split(".").reduce((node, key) => node?.[key], document);

const matches = (document: any, filter: Record<string, any>) =>
  Object.entries(filter).every(([path, condition]) => {
    const value = valueAt(document, path);
    if (path === "_id") return String(value) === String(condition);
    if (condition && typeof condition === "object") {
      if ("$nin" in condition) return !condition.$nin.includes(value);
      if ("$ne" in condition) return value !== condition.$ne;
    }
    return value === condition;
  });

const setAt = (document: any, path: string, value: unknown) => {
  const keys = path.split(".");
  let node = document;
  for (const key of keys.slice(0, -1)) node = node[key] ??= {};
  node[keys.at(-1) as string] = value;
};

/** An in-memory stand-in for the model, enough for the write path under test. */
const withDocument = async <T>(
  document: any,
  run: (store: { document: any; notifications: any[] }) => Promise<T>,
) => {
  const store = { document, notifications: [] as any[] };
  const restoreContext = stub(OfficeDocumentContextModel, {
    // A snapshot, as .lean() gives: a later write must not change what was read.
    findById: () => query(JSON.parse(JSON.stringify(store.document))),
    findOne: () => query({ management: { note: store.document.management.note } }),
    findOneAndUpdate: (filter: any, update: any) => {
      if (!matches(store.document, filter)) return query(null);
      for (const [path, value] of Object.entries(update.$set ?? {})) setAt(store.document, path, value);
      for (const [path, value] of Object.entries(update.$push ?? {})) {
        setAt(store.document, path, [...(valueAt(store.document, path) ?? []), value]);
      }
      return query(store.document);
    },
    findByIdAndUpdate: (_id: unknown, update: any) => {
      for (const [path, value] of Object.entries(update.$set ?? {})) setAt(store.document, path, value);
      return query(store.document);
    },
  });
  const restoreUser = stub(UserModel, {
    find: (filter: any) => {
      if (filter.role) return query([{ _id: filter.role === "role-DEPARTMENT_LEADER" ? leaderA : manager }]);
      return query(users.filter((user) => String(filter._id) === user._id));
    },
  });
  const restoreRole = stub(RoleModel, {
    findOne: (filter: any) => query({ _id: `role-${filter.code}` }),
  });
  const restoreDepartment = stub(DepartmentModel, {
    findById: () => query({ leader: null }),
  });
  const restoreNotification = stub(notificationRepository, {
    findOne: async () => null,
    create: async (input: any) => {
      store.notifications.push(input);
      return input;
    },
  });
  try {
    return await run(store);
  } finally {
    restoreContext();
    restoreUser();
    restoreRole();
    restoreDepartment();
    restoreNotification();
  }
};

const refusedWith = (statusCode: number) => (error: any) => error?.statusCode === statusCode;

test("the model accepts the review states and nothing else", () => {
  const errorsFor = (status: unknown) =>
    new OfficeDocumentContextModel({ management: { notRequired: { status } } }).validateSync()?.errors ?? {};
  for (const status of ["NONE", "PENDING", "CONFIRMED", "REJECTED", "CANCELLED"]) {
    assert.equal(errorsFor(status)["management.notRequired.status"], undefined);
  }
  assert.ok(errorsFor("APPROVED")["management.notRequired.status"]);
  assert.equal(new OfficeDocumentContextModel({}).get("management.notRequired.status"), "NONE");
});

test("only the owning specialist may request", async () => {
  await withDocument(incoming(), async (store) => {
    await assert.rejects(
      requestOfficeDocumentNotRequiredService(otherSpecialist, documentId, { reason: "Không phải việc của tôi" }),
      refusedWith(403),
    );
    // Leader B holds the assignment but is not the owner, and is not a specialist.
    await assert.rejects(
      requestOfficeDocumentNotRequiredService(otherLeader, documentId, { reason: "Giao nhầm" }),
      refusedWith(403),
    );
    await assert.rejects(
      requestOfficeDocumentNotRequiredService(chief, documentId, { reason: "Giao nhầm" }),
      refusedWith(403),
    );
    assert.equal(store.document.management.notRequired, undefined);
  });

  // A specialist named on the assignment does not own a document that reached
  // someone else first.
  const holder = incoming({ assignment: { userId: colleague, fullName: "Chuyên viên Hai", departmentId: departmentA } });
  await withDocument(holder, async () => {
    await assert.rejects(
      requestOfficeDocumentNotRequiredService(otherSpecialist, documentId, { reason: "Giao nhầm" }),
      refusedWith(403),
    );
  });
});

test("a manager who assigned the document owns the decision over who works it", async () => {
  const assigned = incoming({
    assignmentMode: "MANUAL",
    assignment: { userId: colleague, fullName: "Chuyên viên Hai", departmentId: departmentA },
  });
  await withDocument(assigned, async () => {
    await assert.doesNotReject(
      requestOfficeDocumentNotRequiredService(otherSpecialist, documentId, { reason: "Giao nhầm" }),
    );
    await assert.rejects(
      requestOfficeDocumentNotRequiredService(owner, documentId, { reason: "Giao nhầm" }),
      refusedWith(403),
    );
  });
});

test("a request records the state and leaves ownership alone", async () => {
  await withDocument(incoming({ note: "Ghi chú cũ" }), async (store) => {
    const before = structuredClone({
      assignment: store.document.management.assignment,
      assignmentMode: store.document.management.assignmentMode,
      updatedBy: store.document.management.updatedBy,
    });
    const result = await requestOfficeDocumentNotRequiredService(owner, documentId, { reason: "  Giao nhầm phòng  " });

    assert.equal(result.data.notRequired.status, "PENDING");
    assert.equal(result.data.notRequired.reason, "Giao nhầm phòng");
    assert.equal(result.data.notRequired.requestedBy, specialist);
    assert.equal(result.data.notRequired.requestedByName, "Chuyên viên Một");
    assert.deepEqual(result.data.notRequired.history.map((entry: any) => entry.action), ["REQUESTED"]);

    assert.deepEqual(store.document.management.assignment, before.assignment);
    assert.equal(store.document.management.assignmentMode, before.assignmentMode);
    assert.equal(store.document.management.updatedBy, before.updatedBy);
    assert.match(store.document.management.note, /^Ghi chú cũ\n\[.+\] Chuyên viên Một chuyển lại lãnh đạo.*Giao nhầm phòng$/s);
  });
});

test("a request notifies those who can decide it, not other departments", async () => {
  await withDocument(incoming(), async (store) => {
    await requestOfficeDocumentNotRequiredService(owner, documentId, { reason: "Giao nhầm" });
    assert.ok(store.notifications.length > 0);
    assert.ok(store.notifications.every((item) => item.type === "OFFICE_DOCUMENT_NOT_REQUIRED_REQUESTED"));
    const recipients = store.notifications.map((item) => item.recipient);
    assert.ok(recipients.includes(leaderA));
    assert.ok(recipients.includes(manager));
    assert.equal(recipients.includes(leaderB), false);
  });
});

test("a request needs a reason and an open document", async () => {
  await withDocument(incoming(), async () => {
    await assert.rejects(
      requestOfficeDocumentNotRequiredService(owner, documentId, { reason: "   " }),
      refusedWith(400),
    );
  });
  await withDocument(incoming(pending()), async () => {
    await assert.rejects(
      requestOfficeDocumentNotRequiredService(owner, documentId, { reason: "Lần nữa" }),
      refusedWith(409),
    );
  });
  await withDocument(incoming(pending({ status: "CONFIRMED" })), async () => {
    await assert.rejects(
      requestOfficeDocumentNotRequiredService(owner, documentId, { reason: "Lần nữa" }),
      refusedWith(409),
    );
  });
  await withDocument(incoming({}, { pageType: "outgoing" }), async () => {
    await assert.rejects(
      requestOfficeDocumentNotRequiredService(owner, documentId, { reason: "Giao nhầm" }),
      refusedWith(400),
    );
  });
  await withDocument(incoming({}, { organizationId: "64b000000000000000000002" }), async () => {
    await assert.rejects(
      requestOfficeDocumentNotRequiredService(owner, documentId, { reason: "Giao nhầm" }),
      refusedWith(404),
    );
  });
});

test("a submitted result blocks the request, eOffice completion alone does not", async () => {
  const withResult = incoming({
    businessCompletion: { completed: true, evidenceType: "WORK_DECLARATION", submittedBy: specialist },
  });
  await withDocument(withResult, async () => {
    await assert.rejects(
      requestOfficeDocumentNotRequiredService(owner, documentId, { reason: "Giao nhầm" }),
      refusedWith(409),
    );
  });

  const officialOnly = incoming();
  officialOnly.statusSync.completed = true;
  await withDocument(officialOnly, async (store) => {
    await requestOfficeDocumentNotRequiredService(owner, documentId, { reason: "Giao nhầm" });
    assert.equal(store.document.management.notRequired.status, "PENDING");
  });
});

test("a rejected task can be requested again and the history keeps both rounds", async () => {
  await withDocument(incoming(), async (store) => {
    await requestOfficeDocumentNotRequiredService(owner, documentId, { reason: "Lần một" });
    await decideOfficeDocumentNotRequiredService(ownLeader, documentId, { accept: false, note: "Đúng việc của bạn" });
    const second = await requestOfficeDocumentNotRequiredService(owner, documentId, { reason: "Lần hai" });

    assert.equal(second.data.notRequired.status, "PENDING");
    assert.equal(second.data.notRequired.reason, "Lần hai");
    assert.equal(second.data.notRequired.decisionNote, "");
    assert.equal(second.data.notRequired.decidedBy, null);
    assert.deepEqual(
      store.document.management.notRequired.history.map((entry: any) => [entry.action, entry.note]),
      [["REQUESTED", "Lần một"], ["REJECTED", "Đúng việc của bạn"], ["REQUESTED", "Lần hai"]],
    );
  });
});

test("only the requester cancels, and only while pending", async () => {
  await withDocument(incoming(pending()), async (store) => {
    await assert.rejects(cancelOfficeDocumentNotRequiredService(otherSpecialist, documentId), refusedWith(403));
    await assert.rejects(cancelOfficeDocumentNotRequiredService(ownLeader, documentId), refusedWith(403));

    const result = await cancelOfficeDocumentNotRequiredService(owner, documentId);
    assert.equal(result.data.notRequired.status, "CANCELLED");
    assert.deepEqual(store.document.management.notRequired.history.map((entry: any) => entry.action), ["REQUESTED", "CANCELLED"]);
    assert.match(store.document.management.note, /đã hủy đề nghị/);

    await assert.rejects(cancelOfficeDocumentNotRequiredService(owner, documentId), refusedWith(409));
  });
});

test("the leader of the owner's department decides, not the assignment's department", async () => {
  await withDocument(incoming(pending()), async (store) => {
    await assert.rejects(
      decideOfficeDocumentNotRequiredService(otherLeader, documentId, { accept: true }),
      refusedWith(403),
    );
    await assert.rejects(
      decideOfficeDocumentNotRequiredService(owner, documentId, { accept: true }),
      refusedWith(403),
    );
    assert.equal(store.document.management.notRequired.status, "PENDING");

    const result = await decideOfficeDocumentNotRequiredService(ownLeader, documentId, { accept: true });
    assert.equal(result.data.notRequired.status, "CONFIRMED");
    assert.equal(result.data.notRequired.decidedBy, leaderA);
    assert.match(store.document.management.note, /xác nhận việc không cần làm/);
    assert.deepEqual(
      store.notifications.map((item) => [item.recipient, item.type]),
      [[specialist, "OFFICE_DOCUMENT_NOT_REQUIRED_CONFIRMED"]],
    );
    assert.equal(store.document.management.updatedBy, null);
    assert.equal(store.document.management.assignmentMode, "AUTO");
  });
});

test("organization-wide roles decide so a department with no leader is not stuck", async () => {
  for (const actor of [chief, communeLeader, admin]) {
    await withDocument(incoming(pending()), async (store) => {
      await decideOfficeDocumentNotRequiredService(actor, documentId, { accept: true });
      assert.equal(store.document.management.notRequired.status, "CONFIRMED");
    });
  }
});

test("a rejection needs a note and an acceptance does not", async () => {
  await withDocument(incoming(pending()), async (store) => {
    await assert.rejects(
      decideOfficeDocumentNotRequiredService(ownLeader, documentId, { accept: false, note: " " }),
      refusedWith(400),
    );
    assert.equal(store.document.management.notRequired.status, "PENDING");
    const result = await decideOfficeDocumentNotRequiredService(ownLeader, documentId, { accept: false, note: "Việc của phòng" });
    assert.equal(result.data.notRequired.status, "REJECTED");
    assert.equal(result.data.notRequired.decisionNote, "Việc của phòng");
    assert.match(store.document.management.note, /từ chối đề nghị.*Việc của phòng/);
    assert.equal(store.notifications[0].type, "OFFICE_DOCUMENT_NOT_REQUIRED_REJECTED");

    await assert.rejects(
      decideOfficeDocumentNotRequiredService(ownLeader, documentId, { accept: true }),
      refusedWith(409),
    );
  });
});

test("two decisions cannot both land: the second finds the state already moved", async () => {
  await withDocument(incoming(pending()), async (store) => {
    const restore = stub(OfficeDocumentContextModel, { findOneAndUpdate: () => query(null) });
    try {
      await assert.rejects(
        decideOfficeDocumentNotRequiredService(ownLeader, documentId, { accept: true }),
        refusedWith(409),
      );
    } finally {
      restore();
    }
    assert.equal(store.document.management.notRequired.status, "PENDING");
    assert.equal(store.document.management.note, undefined);
  });
});

test("a result approved while pending cannot be confirmed away, only rejected", async () => {
  const document = incoming({
    ...pending(),
    businessCompletion: { completed: true, evidenceType: "WORK_DECLARATION", submittedBy: specialist },
  });
  await withDocument(document, async (store) => {
    await assert.rejects(
      decideOfficeDocumentNotRequiredService(ownLeader, documentId, { accept: true }),
      refusedWith(409),
    );
    await decideOfficeDocumentNotRequiredService(ownLeader, documentId, { accept: false, note: "Đã có kết quả" });
    assert.equal(store.document.management.notRequired.status, "REJECTED");
  });
});

test("a manager restores a confirmed task and the trail records it", async () => {
  await withDocument(incoming(pending({ status: "CONFIRMED" })), async (store) => {
    await assert.rejects(restoreOfficeDocumentNotRequiredService(otherLeader, documentId, {}), refusedWith(403));
    await assert.rejects(restoreOfficeDocumentNotRequiredService(owner, documentId, {}), refusedWith(403));

    const result = await restoreOfficeDocumentNotRequiredService(ownLeader, documentId, { note: "Xác nhận nhầm" });
    assert.equal(result.data.notRequired.status, "NONE");
    assert.deepEqual(
      store.document.management.notRequired.history.map((entry: any) => [entry.action, entry.note]),
      [["REQUESTED", "Giao nhầm"], ["RESTORED", "Xác nhận nhầm"]],
    );
    assert.match(store.document.management.note, /khôi phục.*Xác nhận nhầm/);
    assert.equal(store.notifications[0].type, "OFFICE_DOCUMENT_NOT_REQUIRED_RESTORED");

    await assert.rejects(restoreOfficeDocumentNotRequiredService(ownLeader, documentId, {}), refusedWith(409));
    await assert.doesNotReject(requestOfficeDocumentNotRequiredService(owner, documentId, { reason: "Lần nữa" }));
  });
});

test("restore only applies to a confirmed task", async () => {
  await withDocument(incoming(pending()), async () => {
    await assert.rejects(restoreOfficeDocumentNotRequiredService(chief, documentId, {}), refusedWith(409));
  });
});

const extensionPayload = {
  available: true,
  modalOpen: true,
  pageType: "incoming",
  title: "Văn bản đến",
  documentId: "6954",
  subject: "Văn bản kiểm thử",
  soKyHieu: "6954/TEST",
  dueDate: "25/07/2026",
  priority: "",
  draftingUnit: "",
  draftingUnitId: "",
  draftingUser: "",
  draftingUserId: "",
  relatedIncomingSoKyHieu: "",
  senderUser: "",
  senderUserId: "",
  senderDepartment: "",
  sender: { userId: "", fullName: "", department: "" },
  comment: "",
  point: null,
  reworkCount: 0,
  note: "",
  recipients: [{ userId: "tpb.lsn", department: "", fullName: "Trưởng phòng B", role: "main", entityType: "person" }],
  timeline: [],
  url: "https://vanphongdientu.example.vn/main?6yXl=VAN_BAN_DEN_CA_NHAN",
};

test("the extension upsert writes nothing over the review state", async () => {
  let update: any = null;
  const restoreContext = stub(OfficeDocumentContextModel, {
    findOne: () => query(incoming(pending({ status: "CONFIRMED" }))),
    findOneAndUpdate: async (_filter: unknown, written: any) => {
      update = written;
      return { _id: documentId };
    },
  });
  const restoreUser = stub(UserModel, {
    find: () => query([{ _id: leaderB, fullName: "Trưởng phòng B", department: departmentB, organization }]),
  });
  const restoreDepartment = stub(DepartmentModel, {
    findOne: () => query({ _id: departmentB, name: "Phòng B" }),
  });
  try {
    await upsertOfficeDocumentContext(extensionPayload);
  } finally {
    restoreContext();
    restoreUser();
    restoreDepartment();
  }
  assert.ok(update);
  assert.deepEqual(Object.keys(update), ["$set"]);
  assert.equal(Object.keys(update.$set).some((key) => key === "management" || key.startsWith("management.notRequired")), false);
});

const dated = (id: string, soKyHieu: string, dueDate: string, management: Record<string, unknown> = {}, sync: Record<string, unknown> = {}) => {
  const document = incoming(management);
  document._id = id;
  document.externalDocumentId = id;
  document.observation = { ...document.observation, soKyHieu, dueDate };
  document.statusSync = { ...document.statusSync, ...sync };
  return document;
};

/** Runs against the stored documents with every other KPI source empty. */
const withKpi = async <T>(documents: any[], run: () => Promise<T>) => {
  const restoreUser = stub(UserModel, { find: () => query(users) });
  const restoreContext = stub(OfficeDocumentContextModel, {
    find: (filter: any) => query(filter.pageType === "incoming" ? documents : []),
  });
  const restoreWork = stub(WorkDeclarationModel, { find: () => query([]) });
  const restoreLink = stub(DocumentResultLinkModel, { find: () => query([]) });
  const restoreAssessment = stub(LeadershipAssessmentModel, {
    find: () => query([]),
    findOne: () => query(null),
  });
  try {
    return await run();
  } finally {
    restoreUser();
    restoreContext();
    restoreWork();
    restoreLink();
    restoreAssessment();
  }
};

const finished = (at: string) => ({
  completed: true,
  completedAt: new Date(at),
  trackLogs: [],
});

const kpiFor = (documents: any[], actor: any = chief) =>
  withKpi(documents, async () => (await performanceOverviewService(actor, { period: "2026-07" })).data as any);

const personRow = (data: any, id: string) => data.assignees.find((row: any) => row.user.id === id);

test("a pending task is returned but counts toward no total, for anyone", async () => {
  const documents = [
    dated("64b000000000000000000031", "1/TEST", "25/07/2026", {}, finished("2026-07-20T03:00:00Z")),
    dated("64b000000000000000000032", "2/TEST", "26/07/2026", pending(), finished("2026-07-30T03:00:00Z")),
    dated("64b000000000000000000033", "3/TEST", "01/07/2026", pending()),
  ];
  const data = await kpiFor(documents);

  const reviewRows = data.documents.filter((document: any) => document.reviewSection);
  assert.deepEqual(reviewRows.map((row: any) => row.soKyHieu).sort(), ["2/TEST", "3/TEST"]);
  assert.equal(reviewRows[0].notRequired.status, "PENDING");
  assert.equal(reviewRows[0].notRequired.reason, "Giao nhầm");
  assert.equal(reviewRows[0].notRequired.requestedByName, "Chuyên viên Một");
  assert.ok(reviewRows.every((row: any) => row.creditedPoint === 0));

  assert.equal(data.summary.totalDocuments, 1);
  assert.equal(data.summary.completedDocuments, 1);
  assert.equal(data.summary.inProgressDocuments, 0);
  assert.equal(data.summary.overdueDocuments, 0);
  assert.equal(data.summary.totalPoint, 4);
  assert.equal(data.summary.pendingPoint, 0);
  assert.equal(data.summary.projectedPoint, 4);
  assert.equal(data.summary.lateWorkingDays, 0);
  assert.equal(data.summary.reviewDocumentCount, 2);

  const person = personRow(data, specialist);
  assert.equal(person.documentCount, 1);
  assert.equal(person.completedDocumentCount, 1);
  assert.equal(person.inProgressDocumentCount, 0);
  assert.equal(person.overdueDocumentCount, 0);
  assert.equal(person.totalPoint, 4);
  assert.equal(person.monthlyKpi, 4);
  assert.equal(person.pendingPoint, 0);
  assert.equal(person.projectedPoint, 4);
  assert.equal(person.lateWorkingDays, 0);
  assert.equal(person.reviewDocumentCount, 2);

  // The leader's roll-up sees the same: nothing scored, the count carried up.
  const leader = personRow(data, leaderA);
  assert.equal(leader.documentCount, 1);
  assert.equal(leader.totalPoint, 4);
  assert.equal(leader.pendingPoint, 0);
  assert.equal(leader.projectedPoint, 4);
  assert.equal(leader.overdueDocumentCount, 0);
  assert.equal(leader.lateWorkingDays, 0);
  assert.equal(leader.reviewDocumentCount, 2);
});

test("a confirmed task is gone from documents and totals", async () => {
  const data = await kpiFor([
    dated("64b000000000000000000031", "1/TEST", "25/07/2026", {}, finished("2026-07-20T03:00:00Z")),
    dated("64b000000000000000000032", "2/TEST", "01/07/2026", pending({ status: "CONFIRMED" })),
  ]);
  assert.deepEqual(data.documents.map((row: any) => row.soKyHieu), ["1/TEST"]);
  assert.equal(data.summary.totalDocuments, 1);
  assert.equal(data.summary.overdueDocuments, 0);
  assert.equal(data.summary.reviewDocumentCount, 0);
  assert.equal(personRow(data, specialist).documentCount, 1);
  assert.equal(personRow(data, specialist).reviewDocumentCount, 0);
});

test("a rejected task is back in section I with its original deadline, late as it was", async () => {
  const lateDone = dated(
    "64b000000000000000000031",
    "1/TEST",
    "01/07/2026",
    pending({ status: "REJECTED", decisionNote: "Việc của phòng" }),
    finished("2026-07-08T03:00:00Z"),
  );
  const data = await kpiFor([lateDone]);
  const [row] = data.documents;
  assert.equal(row.reviewSection, false);
  assert.equal(row.notRequired.status, "REJECTED");
  assert.equal(new Date(row.deadline).toISOString(), "2026-07-01T16:59:59.000Z");
  assert.ok(row.lateWorkingDays > 0);
  assert.ok(row.creditedPoint < 4);
  assert.equal(data.summary.totalDocuments, 1);
  assert.equal(data.summary.lateWorkingDays, row.lateWorkingDays);
  assert.equal(data.summary.reviewDocumentCount, 0);
  assert.equal(personRow(data, specialist).lateWorkingDays, row.lateWorkingDays);
});

test("rejected, cancelled and restored tasks that are unfinished count as overdue again", async () => {
  for (const status of ["REJECTED", "CANCELLED", "NONE"]) {
    const data = await kpiFor([dated("64b000000000000000000031", "1/TEST", "01/07/2026", pending({ status }))]);
    assert.equal(data.summary.overdueDocuments, 1, status);
    assert.equal(data.summary.pendingPoint, 4, status);
    assert.equal(data.documents[0].status, "OVERDUE", status);
  }
});

test("the document limit cannot cut off what a leader still has to decide", async () => {
  const scored = Array.from({ length: 5 }, (_, index) => dated(
    new Types.ObjectId().toString(),
    `${index}/TEST`,
    "01/07/2026",
  ));
  const review = dated("64b000000000000000000039", "R/TEST", "20/07/2026", pending(), finished("2026-07-20T03:00:00Z"));
  const data: any = await withKpi(
    [...scored, review],
    async () => (await performanceOverviewService(chief, { period: "2026-07" }, { documentLimit: 2 })).data,
  );
  assert.equal(data.documents.filter((row: any) => row.reviewSection).length, 1);
  assert.equal(data.documents.filter((row: any) => !row.reviewSection).length, 2);
  assert.equal(data.summary.totalDocuments, 5);
});

const workbookFor = async (documents: any[], userId = specialist) => {
  const { content } = await withKpi(documents, () => buildPerformanceWorkbook(chief, {
    userId,
    startDate: "2026-07-01",
    endDate: "2026-07-31",
  }));
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(content as any);
  return { content, sheet: workbook.worksheets[0] };
};

const rowContaining = (sheet: ExcelJS.Worksheet, text: string) => {
  for (let row = 1; row <= sheet.rowCount; row += 1) {
    if (String(sheet.getCell(`A${row}`).value ?? "").includes(text)) return row;
  }
  return 0;
};

const reviewFixture = () => [
  dated("64b000000000000000000031", "1/TEST", "10/07/2026", {}, finished("2026-07-08T03:00:00Z")),
  dated("64b000000000000000000032", "2/TEST", "12/07/2026", {}, finished("2026-07-09T03:00:00Z")),
  dated("64b000000000000000000033", "3/TEST", "15/07/2026", pending({ reason: "Không thuộc phòng A" })),
  dated("64b000000000000000000034", "4/TEST", "16/07/2026", pending({ status: "CONFIRMED" })),
];

test("the export puts review tasks in section II and keeps them out of section I", async () => {
  const { sheet } = await workbookFor(reviewFixture());

  const totalRow = rowContaining(sheet, "Tổng cộng");
  assert.equal(totalRow, 24 - 14, "two scored documents shrink the 16 template rows to two");
  assert.equal(sheet.getCell("A8").value, 1);
  assert.match(String(sheet.getCell("B8").value), /^[12]\/TEST/);
  assert.match(String(sheet.getCell("B9").value), /^[12]\/TEST/);
  for (const column of ["G", "I", "L", "N"]) {
    assert.deepEqual((sheet.getCell(`${column}${totalRow}`).value as any).formula, `SUM(${column}8:${column}9)`);
  }
  assert.equal((sheet.getCell(`I${totalRow + 1}`).value as any).formula, `IFERROR(I${totalRow}/G${totalRow},0)`);

  // The summary rows sit where footerOffset says, untouched by section II.
  assert.equal(sheet.getCell(`A${28 - 14}`).value, "TT");
  assert.equal((sheet.getCell(`I${30 - 14}`).value as any).formula, `I${totalRow + 1}`);

  const lastTemplateRow = rowContaining(sheet, "Trong ví dụ trên");
  assert.ok(lastTemplateRow > 0);
  const titleRow = rowContaining(sheet, "II. CÔNG VIỆC CẦN XEM XÉT");
  assert.equal(titleRow, lastTemplateRow + 2);
  const headers = ["A", "B", "C", "D", "J", "L"].map((column) => sheet.getCell(`${column}${titleRow + 1}`).value);
  assert.deepEqual(headers, ["STT", "Nội dung", "Hạn xử lý", "Lý do", "Người đề nghị", "Ngày đề nghị"]);

  const row = titleRow + 2;
  assert.equal(sheet.getCell(`A${row}`).value, 1);
  assert.equal(sheet.getCell(`B${row}`).value, "3/TEST\nVăn bản kiểm thử");
  assert.equal(new Date(sheet.getCell(`C${row}`).value as any).toISOString().slice(0, 10), "2026-07-15");
  assert.equal(sheet.getCell(`D${row}`).value, "Không thuộc phòng A");
  assert.equal(sheet.getCell(`J${row}`).value, "Chuyên viên Một");
  assert.equal(new Date(sheet.getCell(`L${row}`).value as any).toISOString().slice(0, 10), "2026-07-22");
  assert.ok((sheet.getRow(row).height ?? 0) >= 36);
  assert.equal(sheet.rowCount, row, "the confirmed task appears in neither section");
});

test("the department sheet names who worked each review task", async () => {
  const { sheet } = await workbookFor(reviewFixture(), leaderA);
  const row = rowContaining(sheet, "II. CÔNG VIỆC CẦN XEM XÉT") + 2;
  assert.match(String(sheet.getCell(`B${row}`).value), /\[Người làm: Chuyên viên Một\]$/);
});

test("a long reason gets the height it needs", async () => {
  const documents = [dated("64b000000000000000000033", "3/TEST", "15/07/2026", pending({ reason: "x".repeat(520) }))];
  const { sheet } = await workbookFor(documents);
  const row = rowContaining(sheet, "II. CÔNG VIỆC CẦN XEM XÉT") + 2;
  assert.equal(sheet.getRow(row).height, 150);
});

test("without review tasks the export has no section II and keeps its old shape", async () => {
  const withoutReview = reviewFixture().slice(0, 2);
  const { sheet } = await workbookFor(withoutReview);
  assert.equal(rowContaining(sheet, "II. CÔNG VIỆC CẦN XEM XÉT"), 0);
  assert.equal(sheet.rowCount, 38 - 14, "the template's 38 rows, less the 14 unused task rows");
  assert.equal(sheet.columnCount, 14);
  assert.equal(rowContaining(sheet, "Trong ví dụ trên"), sheet.rowCount);
});

test("an exported workbook with section II re-imports only its section I rows", async () => {
  const { content, sheet } = await workbookFor(reviewFixture());
  assert.ok(rowContaining(sheet, "II. CÔNG VIỆC CẦN XEM XÉT") > 0);
  assert.equal(sheet.columnCount, 14);

  const parsed = await parsePerformanceWorkbook(Buffer.from(content));
  assert.equal(parsed.fullName, "Chuyên viên Một");
  assert.deepEqual(parsed.rows.map((row) => row.row), [8, 9]);
  assert.equal(parsed.rows.some((row) => row.content.includes("3/TEST")), false);
  assert.ok(parsed.rows.every((row) => row.content.startsWith("1/TEST") || row.content.startsWith("2/TEST")));
});

test("re-importing a row does not bring back a task a leader excluded", async () => {
  const { content } = await workbookFor([
    dated("64b000000000000000000031", "1/TEST", "10/07/2026", {}, finished("2026-07-08T03:00:00Z")),
  ]);
  const excluded = pending({ status: "CONFIRMED" }).notRequired;
  const writes: any[] = [];
  const target = { _id: specialist, fullName: "Chuyên viên Một", organization, department: department(departmentA, "Phòng A", "A") };
  const restoreUser = stub(UserModel, { find: () => query([target]) });
  const restoreContext = stub(OfficeDocumentContextModel, {
    find: () => query([]),
    findOne: () => query({ _id: documentId, management: { notRequired: excluded } }),
    updateOne: async (_filter: unknown, update: any) => {
      writes.push(update);
      return { upsertedCount: 0 };
    },
  });
  try {
    await importPerformanceWorkbook(chief, { buffer: Buffer.from(content) } as any);
  } finally {
    restoreUser();
    restoreContext();
  }
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].$set.management.notRequired, excluded);
});

test("a sheet whose only tasks are under review still exports both sections", async () => {
  const { content, sheet } = await workbookFor([
    dated("64b000000000000000000033", "3/TEST", "15/07/2026", pending()),
  ]);
  const totalRow = rowContaining(sheet, "Tổng cộng");
  assert.equal(totalRow, 8);
  assert.equal(sheet.getCell(`G${totalRow}`).value, 0);
  assert.equal(sheet.getCell(`I${totalRow + 1}`).value, 0);
  assert.ok(rowContaining(sheet, "II. CÔNG VIỆC CẦN XEM XÉT") > totalRow);
  // Nothing to import, and section II must not be mistaken for something to import.
  await assert.rejects(parsePerformanceWorkbook(Buffer.from(content)), refusedWith(400));
});

test("awaiting-score skips documents under review and confirmed ones", () => {
  const done = { completed: true, trackLogs: [] };
  const noPoint = (management: Record<string, unknown>) => {
    const document = incoming(management);
    document.observation = { ...document.observation, point: null };
    document.statusSync = { ...document.statusSync, ...done };
    return document;
  };
  assert.equal(isOfficeDocumentAwaitingScore(noPoint({})), true);
  assert.equal(isOfficeDocumentAwaitingScore(noPoint(pending({ status: "REJECTED" }))), true);
  assert.equal(isOfficeDocumentAwaitingScore(noPoint(pending())), false);
  assert.equal(isOfficeDocumentAwaitingScore(noPoint(pending({ status: "CONFIRMED" }))), false);
});

test("the awaiting-score notice leaves those documents out of its count", async () => {
  const done = { completed: true, trackLogs: [] };
  const noPoint = (id: string, management: Record<string, unknown>) => {
    const document = dated(id, "1/TEST", "25/07/2026", management, done);
    document.observation = { ...document.observation, point: null };
    return document;
  };
  const restoreContext = stub(OfficeDocumentContextModel, {
    find: () => query([
      noPoint("64b000000000000000000031", {}),
      noPoint("64b000000000000000000032", pending()),
      noPoint("64b000000000000000000033", pending({ status: "CONFIRMED" })),
    ]),
  });
  const restoreRole = stub(RoleModel, { findOne: () => query(null) });
  try {
    const summary = await notifyDocumentsAwaitingScore();
    assert.equal(summary.scanned, 3);
    assert.equal(summary.awaiting, 1);
  } finally {
    restoreContext();
    restoreRole();
  }
});

test("dashboards, the assistant and the extension scope out confirmed tasks", () => {
  const scope: any = officeDocumentScope(chief);
  assert.deepEqual(scope["management.notRequired.status"], { $ne: "CONFIRMED" });
  assert.equal(officeDocumentProjection(incoming(pending())).notRequiredStatus, "PENDING");
  assert.equal(officeDocumentProjection(incoming()).notRequiredStatus, "NONE");
});

test("the late-assignment report drops a confirmed task", async () => {
  const stuck = (id: string, management: Record<string, unknown>) => {
    const document = dated(id, "1/TEST", "25/07/2026", {
      assignment: { userId: null, fullName: "", departmentId: departmentB, departmentName: "Phòng B" },
      ...management,
    });
    document.statusSync = {
      completed: false,
      trackLogs: [{ id: "1" }],
      processing: {
        currentAssignee: { userId: leaderB, fullName: "Trưởng phòng B", roleCode: "DEPARTMENT_LEADER", departmentId: departmentB, assignedAt: "25/07/2026 08:00" },
        assignees: [],
      },
    };
    return document;
  };
  const restoreDepartment = stub(DepartmentModel, { find: () => query([]) });
  const restoreUser = stub(UserModel, { find: () => query([]) });
  const restoreContext = stub(OfficeDocumentContextModel, {
    find: () => query([
      stuck("64b000000000000000000031", {}),
      stuck("64b000000000000000000032", pending({ status: "CONFIRMED" })),
    ]),
  });
  try {
    const report = await lateAssignmentReportService(chief, { filterType: "ALL_PENDING" });
    assert.deepEqual(report.data.items.map((item) => item.id), ["64b000000000000000000031"]);
  } finally {
    restoreDepartment();
    restoreUser();
    restoreContext();
  }
});

const withList = async <T>(documents: any[], run: () => Promise<T>) => {
  const restoreContext = stub(OfficeDocumentContextModel, {
    aggregate: (pipeline: any[]) => ({
      allowDiskUse: async () => (pipeline.some((stage) => stage.$group)
        ? [{ count: documents.length, updatedAt: new Date(), managedAt: Math.random() }]
        : documents),
    }),
    find: () => ({
      select: () => ({ lean: async () => [] }),
      lean: async () => [],
    }),
  });
  const restoreUser = stub(UserModel, {
    find: () => ({
      select: () => ({ populate: () => ({ lean: async () => users }), lean: async () => users }),
    }),
  });
  try {
    return await run();
  } finally {
    restoreContext();
    restoreUser();
  }
};

const listFixture = () => [
  dated("64b000000000000000000031", "1/TEST", "01/07/2026", {}),
  dated("64b000000000000000000032", "2/TEST", "01/07/2026", pending()),
  dated("64b000000000000000000033", "3/TEST", "01/07/2026", pending({ status: "CONFIRMED" })),
];

const listed = (query: Record<string, unknown>) => withList(listFixture(), async () =>
  ((await listOfficeDocumentContexts(chief, query)).data as any[]).map((row) => row.observation.soKyHieu));

test("the list exposes the state and filters on it", async () => {
  await withList(listFixture(), async () => {
    const rows = (await listOfficeDocumentContexts(chief, {})).data as any[];
    assert.deepEqual(
      rows.map((row) => row.management.notRequired?.status ?? "NONE"),
      ["NONE", "PENDING", "CONFIRMED"],
    );
  });
  assert.deepEqual(await listed({ notRequiredState: "PENDING" }), ["2/TEST"]);
  assert.deepEqual(await listed({ notRequiredState: "CONFIRMED" }), ["3/TEST"]);
  await assert.rejects(listed({ notRequiredState: "REJECTED" }), refusedWith(400));
});

test("a confirmed task leaves every deadline filter and the overdue report", async () => {
  assert.deepEqual(await listed({ deadlineStatus: "PENDING_OVERDUE" }), ["1/TEST", "2/TEST"]);
  await withList(listFixture(), async () => {
    const report = await overdueOfficeDocumentReportService(chief, {});
    assert.deepEqual(report.data.items.map((item) => item.soKyHieu).sort(), ["1/TEST", "2/TEST"]);
  });
});

test("the awaiting-score list filter agrees with the notice", async () => {
  const done = { completed: true, trackLogs: [] };
  const rows = listFixture().map((document) => {
    document.observation = { ...document.observation, point: null };
    document.statusSync = { ...document.statusSync, ...done };
    return document;
  });
  await withList(rows, async () => {
    const result = (await listOfficeDocumentContexts(chief, { scoreState: "AWAITING_SCORE" })).data as any[];
    assert.deepEqual(result.map((row) => row.observation.soKyHieu), ["1/TEST"]);
  });
});

test("a task in review keeps its trail: it cannot be hard-deleted", async () => {
  for (const status of ["PENDING", "CONFIRMED"]) {
    const restore = stub(OfficeDocumentContextModel, {
      findById: () => query(incoming(pending({ status }))),
      findByIdAndDelete: () => assert.fail("must not delete"),
    });
    try {
      await assert.rejects(deleteManagedOfficeDocumentContext(chief, documentId), refusedWith(409));
    } finally {
      restore();
    }
  }
});

test("nothing new can be attached to a confirmed task until it is restored", async () => {
  assert.throws(
    () => assertSourceDocumentCanBeLinked(incoming(pending({ status: "CONFIRMED" })), specialist),
    refusedWith(409),
  );
  assert.doesNotThrow(() => assertSourceDocumentCanBeLinked(incoming(pending()), specialist));

  const product = { _id: "64b000000000000000000040", organizationId: organization, pageType: "outgoing", management: { assignment: { userId: specialist } }, observation: {} };
  const restore = stub(OfficeDocumentContextModel, {
    findOne: (filter: any) => query(filter.pageType === "incoming" ? incoming(pending({ status: "CONFIRMED" })) : product),
  });
  try {
    await assert.rejects(
      createDocumentResultLinkService(chief, { outgoingDocumentId: product._id, incomingDocumentId: documentId }),
      refusedWith(409),
    );
  } finally {
    restore();
  }
});
