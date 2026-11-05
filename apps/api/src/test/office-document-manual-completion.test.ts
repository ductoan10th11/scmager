import assert from "node:assert/strict";
import test from "node:test";
import OfficeDocumentContextModel from "../models/office-document-context.model";
import UserModel from "../models/user.model";
import {
  applyOfficeDocumentBusinessCompletion,
  effectiveOfficeDocumentCompletion,
  effectiveOfficeDocumentReworkCount,
  isOfficeDocumentAwaitingScore,
  rawOfficeDocumentPoint,
} from "../services/office-document-completion.service";
import {
  completeOfficeDocumentManuallyService,
  undoOfficeDocumentManualCompletionService,
} from "../services/office-document-manual-completion.service";
import { effectiveOfficeDocumentOwnerId } from "../services/office-document-owner.service";

const documentId = "507f1f77bcf86cd799439031";
const organization = "507f1f77bcf86cd799439032";
const departmentA = "507f1f77bcf86cd799439033";
const departmentB = "507f1f77bcf86cd799439034";
const specialist = "507f1f77bcf86cd799439035";
const leader = "507f1f77bcf86cd799439036";

const actorOf = (code: string, department: string | null = departmentA) => ({
  id: leader, username: "lead", email: "l@x", fullName: "Lãnh đạo", status: "ACTIVE",
  role: { id: "r", code, level: 1 }, organization, department,
}) as any;

const task = (management: Record<string, unknown> = {}, statusSync: Record<string, unknown> = {}) => ({
  _id: documentId,
  pageType: "incoming",
  organizationId: organization,
  observation: { reworkCount: 2 },
  statusSync: {
    completed: false,
    processing: { primaryAssignee: { userId: specialist, departmentId: departmentA } },
    ...statusSync,
  },
  management: { assignment: { userId: leader, departmentId: departmentA }, ...management },
});

const applySet = (document: any, set: Record<string, unknown>) => {
  const next = structuredClone(document);
  for (const [path, value] of Object.entries(set)) {
    const keys = path.split(".");
    let node = next;
    for (const key of keys.slice(0, -1)) node = node[key] ??= {};
    node[keys.at(-1) as string] = value;
  }
  return next;
};

/** Runs a service against one stored document and returns what it wrote. */
const run = async (document: any, call: () => Promise<any>, stored: boolean = true) => {
  const writes: any[] = [];
  const originals = {
    findById: OfficeDocumentContextModel.findById,
    findOne: OfficeDocumentContextModel.findOne,
    findOneAndUpdate: OfficeDocumentContextModel.findOneAndUpdate,
    findByIdAndUpdate: OfficeDocumentContextModel.findByIdAndUpdate,
    userFind: UserModel.find,
  };
  Object.assign(OfficeDocumentContextModel, {
    findById: () => ({ lean: async () => document }),
    findOne: () => ({ session: () => ({ lean: async () => document }) }),
    findOneAndUpdate: (filter: unknown, update: any) => {
      writes.push({ filter, set: update.$set });
      return { lean: async () => (stored ? applySet(document, update.$set) : null) };
    },
    findByIdAndUpdate: () => ({ lean: async () => document }),
  });
  (UserModel as any).find = () => ({
    select: () => ({
      populate: () => ({
        lean: async () => [{ _id: specialist, fullName: "Chuyên viên", department: { _id: departmentA, name: "Phòng A" } }],
      }),
    }),
  });
  try {
    const result = await call();
    return { result, write: writes[0] };
  } finally {
    Object.assign(OfficeDocumentContextModel, {
      findById: originals.findById,
      findOne: originals.findOne,
      findOneAndUpdate: originals.findOneAndUpdate,
      findByIdAndUpdate: originals.findByIdAndUpdate,
    });
    (UserModel as any).find = originals.userFind;
  }
};

test("a leader completes a task without touching eOffice state or its owner", async () => {
  const document = task({ manualScore: 3 });
  const { write } = await run(document, () =>
    completeOfficeDocumentManuallyService(actorOf("OFFICE_CHIEF"), documentId, {}));
  assert.equal(Object.keys(write.set).some((path) => path.startsWith("statusSync")), false);
  assert.equal(Object.keys(write.set).some((path) => path.includes("assignment")), false);
  assert.equal("management.updatedBy" in write.set, false);
  const saved = applySet(document, write.set);
  assert.equal(effectiveOfficeDocumentCompletion(saved).completed, true);
  assert.equal(effectiveOfficeDocumentCompletion(saved).source, "MANUAL");
  assert.equal(effectiveOfficeDocumentOwnerId(saved), specialist);
});

test("completing keeps the score source and the rework count", async () => {
  const document = task({ manualScore: 3 });
  const { write } = await run(document, () =>
    completeOfficeDocumentManuallyService(actorOf("OFFICE_CHIEF"), documentId, {}));
  const saved = applySet(document, write.set);
  assert.equal(rawOfficeDocumentPoint(saved), 3);
  assert.equal(effectiveOfficeDocumentReworkCount(saved), 2);
});

test("a completed task with no score is left awaiting one", async () => {
  const document = task();
  const { write } = await run(document, () =>
    completeOfficeDocumentManuallyService(actorOf("OFFICE_CHIEF"), documentId, {}));
  assert.equal(isOfficeDocumentAwaitingScore(applySet(document, write.set)), true);
});

test("an earlier date is recorded at the end of office hours, in Vietnam time", async () => {
  const { write } = await run(task(), () =>
    completeOfficeDocumentManuallyService(actorOf("OFFICE_CHIEF"), documentId, { completedDate: "2026-10-20" }));
  assert.equal(
    write.set["management.businessCompletion.submittedAt"].toISOString(),
    "2026-10-20T10:00:00.000Z",
  );
});

test("the completion date cannot be invalid or in the future", async () => {
  for (const completedDate of ["2999-01-01", "2026-02-31", "20/10/2026"]) {
    await assert.rejects(
      run(task(), () => completeOfficeDocumentManuallyService(actorOf("OFFICE_CHIEF"), documentId, { completedDate })),
      /Ngày hoàn thành/,
    );
  }
});

test("only leaders can complete, and a department leader only in their department", async () => {
  await assert.rejects(
    run(task(), () => completeOfficeDocumentManuallyService(actorOf("SPECIALIST"), documentId, {})),
    /Chỉ lãnh đạo/,
  );
  await assert.rejects(
    run(task(), () => completeOfficeDocumentManuallyService(actorOf("DEPARTMENT_LEADER", departmentB), documentId, {})),
    /trong phòng mình/,
  );
  await run(task(), () => completeOfficeDocumentManuallyService(actorOf("DEPARTMENT_LEADER"), documentId, {}));
});

test("a task already done, or in the not-required flow, is refused", async () => {
  const leaderActor = actorOf("OFFICE_CHIEF");
  await assert.rejects(
    run(task({}, { completed: true, trackLogs: [] }), () =>
      completeOfficeDocumentManuallyService(leaderActor, documentId, {})),
    /đã hoàn thành/,
  );
  await assert.rejects(
    run(task({ businessCompletion: { completed: true, evidenceType: "DOCUMENT_RESULT" } }), () =>
      completeOfficeDocumentManuallyService(leaderActor, documentId, {})),
    /đã hoàn thành/,
  );
  for (const status of ["PENDING", "CONFIRMED"]) {
    await assert.rejects(
      run(task({ notRequired: { status } }), () =>
        completeOfficeDocumentManuallyService(leaderActor, documentId, {})),
      /việc không cần làm/,
    );
  }
});

test("a product task is refused", async () => {
  await assert.rejects(
    run({ ...task(), pageType: "outgoing" }, () =>
      completeOfficeDocumentManuallyService(actorOf("OFFICE_CHIEF"), documentId, {})),
    /Chỉ nhiệm vụ/,
  );
});

test("undo reopens a manual completion and nothing else", async () => {
  const document = task({ businessCompletion: { completed: true, evidenceType: "MANUAL", point: null } });
  const { write } = await run(document, () =>
    undoOfficeDocumentManualCompletionService(actorOf("OFFICE_CHIEF"), documentId));
  assert.equal(write.filter["management.businessCompletion.evidenceType"], "MANUAL");
  assert.equal(effectiveOfficeDocumentCompletion(applySet(document, write.set)).completed, false);
  await assert.rejects(
    run(task(), () => undoOfficeDocumentManualCompletionService(actorOf("OFFICE_CHIEF"), documentId), false),
    /hoàn thành thủ công/,
  );
});

test("real evidence replaces a manual completion", async () => {
  let filter: any = null;
  const original = OfficeDocumentContextModel.findOneAndUpdate;
  (OfficeDocumentContextModel as any).findOneAndUpdate = (query: unknown) => {
    filter = query;
    return { lean: async () => ({ _id: documentId }) };
  };
  try {
    await applyOfficeDocumentBusinessCompletion({
      incomingDocumentId: documentId,
      organizationId: organization,
      evidenceType: "DOCUMENT_RESULT",
      evidenceId: leader,
      submittedBy: specialist,
      submittedAt: new Date(),
      approvedBy: leader,
      approvedAt: new Date(),
      point: 1,
      reworkCount: 0,
    });
  } finally {
    (OfficeDocumentContextModel as any).findOneAndUpdate = original;
  }
  assert.deepEqual(filter.$or, [
    { "management.businessCompletion.completed": { $ne: true } },
    { "management.businessCompletion.evidenceType": "MANUAL" },
  ]);
});

test("the score and rework count entered on completing take effect", async () => {
  const document = task();
  const { write } = await run(document, () =>
    completeOfficeDocumentManuallyService(actorOf("OFFICE_CHIEF"), documentId, { score: 1.18, reworkCount: 1 }));
  const saved = applySet(document, write.set);
  assert.equal(rawOfficeDocumentPoint(saved), 1.18);
  assert.equal(effectiveOfficeDocumentReworkCount(saved), 1);
  assert.equal(isOfficeDocumentAwaitingScore(saved), false);
  assert.ok(saved.management.scoreEditedAt);
});

test("a score of zero counts as scored, not as missing", async () => {
  const document = task();
  const { write } = await run(document, () =>
    completeOfficeDocumentManuallyService(actorOf("OFFICE_CHIEF"), documentId, { score: 0, reworkCount: 0 }));
  const saved = applySet(document, write.set);
  assert.equal(rawOfficeDocumentPoint(saved), 0);
  assert.equal(isOfficeDocumentAwaitingScore(saved), false);
  assert.equal(effectiveOfficeDocumentReworkCount(saved), 0);
});

test("on an imported task they reach the values KPI reads", async () => {
  const document = task({ kpiImport: { importKey: "k", point: 5, reworkCount: 3 } });
  const { write } = await run(document, () =>
    completeOfficeDocumentManuallyService(actorOf("OFFICE_CHIEF"), documentId, { score: 2, reworkCount: 1 }));
  assert.equal(write.set["management.kpiImport.point"], 2);
  assert.equal(write.set["management.kpiImport.reworkCount"], 1);
});

test("what the leader entered survives undoing the completion", async () => {
  const document = task();
  const { write } = await run(document, () =>
    completeOfficeDocumentManuallyService(actorOf("OFFICE_CHIEF"), documentId, { score: 2, reworkCount: 1 }));
  const completed = applySet(document, write.set);
  const { write: undo } = await run(completed, () =>
    undoOfficeDocumentManualCompletionService(actorOf("OFFICE_CHIEF"), documentId));
  const reopened = applySet(completed, undo.set);
  assert.equal(rawOfficeDocumentPoint(reopened), 2);
  assert.equal(effectiveOfficeDocumentReworkCount(reopened), 1);
});

test("an invalid score or rework count is refused", async () => {
  for (const body of [{ score: -1 }, { score: "abc" }, { score: 1_000_001 }, { reworkCount: 1.5 }, { reworkCount: -1 }]) {
    await assert.rejects(
      run(task(), () => completeOfficeDocumentManuallyService(actorOf("OFFICE_CHIEF"), documentId, body)),
      /Điểm|làm lại/,
    );
  }
});

