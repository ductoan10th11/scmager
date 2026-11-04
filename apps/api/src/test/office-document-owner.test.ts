import assert from "node:assert/strict";
import test from "node:test";
import { Types } from "mongoose";
import DepartmentModel from "../models/department.model";
import DocumentResultLinkModel from "../models/document-result-link.model";
import OfficeDocumentContextModel from "../models/office-document-context.model";
import RoleModel from "../models/role.model";
import UserModel from "../models/user.model";
import { legacyEditedOwnersCsv } from "../scripts/report-legacy-edited-owners";
import { requestOfficeDocumentComplaintService } from "../services/office-document-complaint.service";
import {
  createManagedOfficeDocumentContext,
  getOfficeDocumentContext,
  listOfficeDocumentContexts,
  updateManagedOfficeDocumentContext,
  upsertOfficeDocumentContext,
} from "../services/office-document-context.service";
import {
  effectiveOfficeDocumentOwner,
  effectiveOfficeDocumentOwnerId,
  isAssignmentManual,
  officeDocumentOwnerCandidateClauses,
} from "../services/office-document-owner.service";
import { rawOfficeDocumentPoint } from "../services/office-document-completion.service";
import { officeDocumentProjection, officeDocumentScope } from "../services/office-document-projection.service";
import { performanceDocumentOwnerId } from "../services/performance.service";
import { assertSourceDocumentCanBeLinked } from "../services/work-declaration.service";

const organization = "64b000000000000000000001";
const departmentA = "64b0000000000000000000a1";
const departmentB = "64b0000000000000000000b1";
const specialist = "64b000000000000000000011";
const leader = "64b000000000000000000012";
const colleague = "64b000000000000000000013";
const manager = "64b000000000000000000014";
const documentId = "64b000000000000000000020";

const chief: any = {
  id: manager,
  username: "chief",
  fullName: "Chánh văn phòng",
  organization,
  department: null,
  role: { code: "OFFICE_CHIEF", level: 2 },
};

const directoryUsers = [
  { _id: specialist, fullName: "Chuyên viên Một", username: "cv1", department: { _id: departmentB, name: "Phòng B" } },
  { _id: colleague, fullName: "Chuyên viên Hai", username: "cv2", department: { _id: departmentA, name: "Phòng A" } },
  { _id: leader, fullName: "Trưởng phòng A", username: "tp", department: { _id: departmentA, name: "Phòng A" } },
];

const collaboratorRecipients = directoryUsers.map((user) => ({
  userId: user.username,
  department: "",
  fullName: user.fullName,
  role: "collaborator",
  entityType: "person",
}));

/** An unedited incoming document: routed to the leader, worked by the specialist. */
const routedDocument = (management: Record<string, unknown> = {}, statusSync: Record<string, unknown> = {}): any => ({
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
    recipients: [],
  },
  statusSync: {
    completed: false,
    processing: {
      primaryAssignee: { userId: new Types.ObjectId(specialist), fullName: "Chuyên viên Một", departmentId: null },
      assignees: [],
    },
    ...statusSync,
  },
  management: {
    assignment: {
      userId: leader,
      fullName: "Trưởng phòng A",
      departmentId: departmentA,
      departmentName: "Phòng A",
    },
    updatedBy: null,
    ...management,
  },
});

const stub = (target: any, overrides: Record<string, unknown>) => {
  const originals = Object.fromEntries(Object.keys(overrides).map((key) => [key, target[key]]));
  Object.assign(target, overrides);
  return () => Object.assign(target, originals);
};

const applySet = (document: any, set: Record<string, unknown>) => {
  const next = { ...document, management: { ...document.management, assignment: { ...document.management.assignment } } };
  for (const [path, value] of Object.entries(set)) {
    const keys = path.split(".");
    if (keys[0] !== "management") continue;
    let node = next;
    for (const key of keys.slice(0, -1)) node = node[key] ??= {};
    node[keys.at(-1) as string] = value;
  }
  return next;
};

/** Runs a save and returns what was written and the document it left behind. */
const saveManaged = async (document: any, payload: unknown, actor = chief) => {
  let set: Record<string, any> = {};
  let options: Record<string, any> = {};
  const transitions: any[] = [];
  const restore = stub(OfficeDocumentContextModel, {
    findById: () => ({ lean: async () => document }),
    findOne: () => ({ session: () => ({ lean: async () => document }) }),
    findOneAndUpdate: (filter: unknown, update: any) => {
      transitions.push({ filter, update });
      return { lean: async () => document };
    },
    findByIdAndUpdate: (_id: unknown, update: any, updateOptions: any) => {
      if (update.$set?.["management.note"] === undefined || Object.keys(update.$set).length > 1) {
        set = update.$set;
        options = updateOptions;
      }
      return { lean: async () => applySet(document, set) };
    },
  });
  try {
    const { data } = await updateManagedOfficeDocumentContext(actor, documentId, payload);
    return { set, options, transitions, saved: applySet(document, set), data: data as any };
  } finally {
    restore();
  }
};

const withAssignableUser = async (user: any, run: () => Promise<void>) => {
  const restoreDepartment = stub(DepartmentModel, {
    findOne: () => ({ lean: async () => ({ _id: user.department._id, name: user.department.name }) }),
  });
  const restoreUser = stub(UserModel, {
    findOne: () => ({
      select: () => ({ lean: async () => ({ ...user, department: user.department._id }) }),
    }),
  });
  try {
    await run();
  } finally {
    restoreDepartment();
    restoreUser();
  }
};

const assignmentWrites = (set: Record<string, unknown>) =>
  Object.keys(set).filter((key) => key.startsWith("management.assignment."));

test("assignmentMode decides manual ownership and legacy rows fall back to updatedBy", () => {
  assert.equal(isAssignmentManual({ management: { assignmentMode: "MANUAL" } }), true);
  assert.equal(isAssignmentManual({ management: { assignmentMode: "AUTO", updatedBy: manager } }), false);
  assert.equal(isAssignmentManual({ management: { assignmentMode: null, updatedBy: manager } }), true);
  assert.equal(isAssignmentManual({ management: { updatedBy: null } }), false);
  assert.equal(isAssignmentManual(null), false);
});

test("the model accepts AUTO, MANUAL and the legacy null, and nothing else", () => {
  const errorsFor = (assignmentMode: unknown) =>
    new OfficeDocumentContextModel({ management: { assignmentMode } }).validateSync()?.errors ?? {};
  assert.equal(errorsFor("AUTO")["management.assignmentMode"], undefined);
  assert.equal(errorsFor("MANUAL")["management.assignmentMode"], undefined);
  assert.equal(errorsFor(null)["management.assignmentMode"], undefined);
  assert.ok(errorsFor("OTHER")["management.assignmentMode"]);
  assert.equal(new OfficeDocumentContextModel({}).get("management.assignmentMode"), null);
});

test("owner precedence is result submitter, then first specialist, then assignment", () => {
  const unedited = routedDocument();
  assert.equal(effectiveOfficeDocumentOwnerId(unedited), specialist);
  assert.equal(performanceDocumentOwnerId(unedited), specialist);

  const manual = routedDocument({ assignmentMode: "MANUAL" });
  assert.equal(effectiveOfficeDocumentOwnerId(manual), leader);

  const submitted = routedDocument({
    assignmentMode: "MANUAL",
    businessCompletion: { completed: true, evidenceType: "DOCUMENT_RESULT", submittedBy: colleague },
  });
  assert.equal(effectiveOfficeDocumentOwnerId(submitted), colleague);
  assert.equal(performanceDocumentOwnerId(submitted), colleague);

  // eOffice completion outranks a business completion, exactly as the KPI does.
  const official = routedDocument(
    { businessCompletion: { completed: true, evidenceType: "DOCUMENT_RESULT", submittedBy: colleague } },
    { completed: true },
  );
  assert.equal(effectiveOfficeDocumentOwnerId(official), specialist);
});

test("score-only save leaves the owner with the first specialist", async () => {
  const { set, saved } = await saveManaged(routedDocument(), { management: { manualScore: 7 } });
  assert.deepEqual(assignmentWrites(set), []);
  assert.equal(set["management.assignmentMode"], "AUTO");
  assert.equal(set["management.updatedBy"], manager);
  assert.equal(effectiveOfficeDocumentOwnerId(saved), specialist);
  assert.equal(performanceDocumentOwnerId(saved), specialist);
});

const completedByEvidence = (point: number | null) => ({
  businessCompletion: { completed: true, evidenceType: "WORK_DECLARATION", submittedBy: specialist, point, reworkCount: 0 },
});
const importedFromPl4 = () => ({
  kpiImport: { importKey: "pl4-key", point: 2, assignedQuantity: 1, completedQuantity: 1 },
});

test("a score-only save writes the score and bookkeeping, and nothing about ownership", async () => {
  const document = routedDocument({ ...completedByEvidence(3), ...importedFromPl4() });
  const { set, saved } = await saveManaged(document, { management: { manualScore: 1.18 } });
  assert.deepEqual(Object.keys(set).sort(), [
    "management.assignmentMode",
    "management.businessCompletion.point",
    "management.kpiImport.point",
    "management.manualScore",
    "management.scoreEditedAt",
    "management.scoreEditedBy",
    "management.updatedAt",
    "management.updatedBy",
  ]);
  assert.deepEqual(saved.management.assignment, document.management.assignment);
  assert.equal(effectiveOfficeDocumentOwnerId(saved), effectiveOfficeDocumentOwnerId(document));
  assert.equal(performanceDocumentOwnerId(saved), performanceDocumentOwnerId(document));
});

test("a score takes effect over the business completion point that was winning", async () => {
  const { set, saved, data } = await saveManaged(routedDocument(completedByEvidence(3)), {
    management: { manualScore: 1.4 },
  });
  assert.equal(set["management.businessCompletion.point"], 1.4);
  assert.equal(set["management.kpiImport.point"], undefined);
  assert.equal(rawOfficeDocumentPoint(saved), 1.4);
  assert.deepEqual(data.tracking, { score: 1.4, rawScore: 1.4, awaitingScore: false, manualScore: 1.4 });
});

test("a score of zero still replaces the winning business completion point", async () => {
  const { saved } = await saveManaged(routedDocument(completedByEvidence(3)), { management: { manualScore: 0 } });
  assert.equal(rawOfficeDocumentPoint(saved), 0);
});

test("a business completion that is not winning is left alone", async () => {
  const unscored = await saveManaged(routedDocument(completedByEvidence(null)), { management: { manualScore: 2 } });
  assert.equal(unscored.set["management.businessCompletion.point"], undefined);
  assert.equal(rawOfficeDocumentPoint(unscored.saved), 2);

  const reopened = await saveManaged(
    routedDocument({ businessCompletion: { completed: false, point: 3 } }),
    { management: { manualScore: 2 } },
  );
  assert.equal(reopened.set["management.businessCompletion.point"], undefined);
});

test("a score reaches the KPI point of an imported document", async () => {
  const { set, saved } = await saveManaged(routedDocument(importedFromPl4()), { management: { manualScore: 0.9 } });
  assert.equal(set["management.kpiImport.point"], 0.9);
  assert.equal(saved.management.kpiImport.point, 0.9);
  assert.equal(saved.management.kpiImport.importKey, "pl4-key");
  assert.equal(set["management.businessCompletion.point"], undefined);
});

test("a kpiImport with no key is not an import, so its point is left alone", async () => {
  const { set } = await saveManaged(routedDocument({ kpiImport: { importKey: "", point: null } }), {
    management: { manualScore: 0.9 },
  });
  assert.equal(set["management.kpiImport.point"], undefined);
});

test("clearing the score leaves the business completion and KPI points alone", async () => {
  for (const manualScore of [null, ""]) {
    const { set, saved } = await saveManaged(routedDocument({ ...completedByEvidence(3), ...importedFromPl4() }), {
      management: { manualScore },
    });
    assert.equal(set["management.manualScore"], null);
    assert.equal(set["management.businessCompletion.point"], undefined);
    assert.equal(set["management.kpiImport.point"], undefined);
    assert.equal(saved.management.businessCompletion.point, 3);
    assert.equal(saved.management.kpiImport.point, 2);
  }
});

test("a save that does not submit a score leaves both points alone", async () => {
  const { set } = await saveManaged(routedDocument({ ...completedByEvidence(3), ...importedFromPl4() }), {
    management: { note: "Ghi chú" },
  });
  assert.equal(set["management.businessCompletion.point"], undefined);
  assert.equal(set["management.kpiImport.point"], undefined);
});

test("saving the form as prefilled with the owner keeps it AUTO", async () => {
  const { set, saved } = await saveManaged(routedDocument(), {
    management: { manualScore: 7, assignment: { userId: specialist, departmentId: departmentB } },
  });
  assert.deepEqual(assignmentWrites(set), []);
  assert.equal(set["management.assignmentMode"], "AUTO");
  assert.equal(effectiveOfficeDocumentOwnerId(saved), specialist);
});

test("the kept owner is not re-validated, so a leader can still score their document", async () => {
  const departmentLeader = { ...chief, id: leader, department: departmentA, role: { code: "DEPARTMENT_LEADER", level: 3 } };
  const restoreDepartment = stub(DepartmentModel, {
    findOne: () => { throw new Error("the kept owner's department must not be validated"); },
  });
  const restoreUser = stub(UserModel, {
    findOne: () => { throw new Error("the kept owner must not be validated"); },
  });
  try {
    const { saved } = await saveManaged(routedDocument(), {
      management: { manualScore: 7, assignment: { userId: specialist, departmentId: departmentB } },
    }, departmentLeader);
    assert.equal(effectiveOfficeDocumentOwnerId(saved), specialist);
  } finally {
    restoreDepartment();
    restoreUser();
  }
});

test("a legacy edited document keeps its assignment through further saves", async () => {
  const legacy = routedDocument({ updatedBy: manager, updatedAt: new Date("2026-06-01T00:00:00Z") });
  assert.equal(effectiveOfficeDocumentOwnerId(legacy), leader);

  const { set, saved } = await saveManaged(legacy, {
    management: { manualScore: 7, assignment: { userId: leader, departmentId: departmentA } },
  });
  assert.deepEqual(assignmentWrites(set), []);
  // Still awaiting review: AUTO would hand it to the specialist and drop it from
  // the report, MANUAL would drop it from the report.
  assert.equal("management.assignmentMode" in set, false);
  assert.equal(effectiveOfficeDocumentOwnerId(saved), leader);
  assert.equal(legacyEditedOwnersCsv([saved]).split("\n").length, 2);
});

test("a true reassignment becomes MANUAL and owns the document", async () => {
  await withAssignableUser(directoryUsers[1], async () => {
    const { set, saved } = await saveManaged(routedDocument(), {
      management: { assignment: { userId: colleague, departmentId: departmentA } },
    });
    assert.equal(set["management.assignmentMode"], "MANUAL");
    assert.equal(set["management.assignment.userId"], colleague);
    assert.equal(effectiveOfficeDocumentOwnerId(saved), colleague);
  });
});

test("a legacy document reassigned to its first specialist is MANUAL, not silently AUTO", async () => {
  await withAssignableUser(directoryUsers[0], async () => {
    const { set, saved } = await saveManaged(routedDocument({ updatedBy: manager }), {
      management: { assignment: { userId: specialist, departmentId: departmentB } },
    });
    assert.equal(set["management.assignmentMode"], "MANUAL");
    assert.equal(effectiveOfficeDocumentOwnerId(saved), specialist);
  });
});

test("re-assigning to the same person stays AUTO, and a MANUAL document stays MANUAL", async () => {
  const auto = await saveManaged(routedDocument({ assignmentMode: "AUTO", updatedBy: manager }), {
    management: { assignment: { userId: specialist, departmentId: departmentB } },
  });
  assert.equal(auto.set["management.assignmentMode"], "AUTO");
  assert.deepEqual(assignmentWrites(auto.set), []);

  const manual = await saveManaged(routedDocument({ assignmentMode: "MANUAL", updatedBy: manager }), {
    management: { manualScore: 3, assignment: { userId: leader, departmentId: departmentA } },
  });
  assert.equal("management.assignmentMode" in manual.set, false);
  assert.deepEqual(assignmentWrites(manual.set), []);
  assert.equal(effectiveOfficeDocumentOwnerId(manual.saved), leader);
});

test("clearing the assignee is a manual decision that leaves the document unowned", async () => {
  const { set, saved } = await saveManaged(routedDocument(), {
    management: { assignment: { userId: "", departmentId: "" } },
  });
  assert.equal(set["management.assignmentMode"], "MANUAL");
  assert.equal(effectiveOfficeDocumentOwnerId(saved), "");
});

test("giving an unowned document a department with no person is not discarded", async () => {
  const unowned = routedDocument({ assignment: { userId: null, fullName: "", departmentId: null } }, { processing: null });
  await withAssignableUser(directoryUsers[1], async () => {
    const { set } = await saveManaged(unowned, {
      management: { assignment: { userId: "", departmentId: departmentA } },
    });
    assert.equal(set["management.assignmentMode"], "MANUAL");
    assert.equal(set["management.assignment.departmentId"], departmentA);
  });
});

test("a manually created incoming document is MANUAL and an outgoing one has no mode", async () => {
  const created: any[] = [];
  const restoreContext = stub(OfficeDocumentContextModel, {
    create: async (value: any) => {
      created.push(value);
      return { _id: documentId, toObject: () => value };
    },
  });
  try {
    await withAssignableUser(directoryUsers[1], async () => {
      const assignment = { userId: colleague, departmentId: departmentA };
      await createManagedOfficeDocumentContext(chief, {
        pageType: "incoming",
        subject: "Nhiệm vụ thủ công",
        soKyHieu: "1/VBN",
        dueDate: "25/07/2026",
        management: { assignment, manualScore: 1 },
      });
      await createManagedOfficeDocumentContext(chief, {
        pageType: "outgoing",
        subject: "Sản phẩm thủ công",
        soKyHieu: "2/VBN",
        createdDate: "20/07/2026",
        draftingUnit: "Phòng A",
        management: { assignment, manualScore: 1 },
      });
    });
    assert.equal(created[0]["management.assignmentMode"], "MANUAL");
    assert.equal("management.assignmentMode" in created[1], false);
  } finally {
    restoreContext();
  }
});

test("outgoing edits never touch the mode and still write the submitted assignment", async () => {
  const product = { ...routedDocument({ updatedBy: manager }), pageType: "outgoing", statusSync: {} };
  const restoreLinks = stub(DocumentResultLinkModel, { exists: async () => null });
  try {
    await withAssignableUser(directoryUsers[1], async () => {
      const { set } = await saveManaged(product, {
        management: { assignment: { userId: leader, departmentId: departmentA } },
      });
      assert.equal("management.assignmentMode" in set, false);
      assert.equal(String(set["management.assignment.userId"]), colleague);
    });
  } finally {
    restoreLinks();
  }
});

const upsertSet = async (previous: any) => {
  let set: Record<string, any> = {};
  const restoreContext = stub(OfficeDocumentContextModel, {
    findOne: () => ({ select: () => ({ lean: async () => previous }) }),
    findOneAndUpdate: async (_filter: unknown, update: any) => {
      set = update.$set;
      return { _id: documentId };
    },
  });
  const users = [{ _id: leader, fullName: "Trưởng phòng A", department: departmentA, organization }];
  const restoreUser = stub(UserModel, {
    find: () => ({
      select: () => ({ limit: () => ({ lean: async () => users }), lean: async () => users }),
    }),
  });
  const restoreDepartment = stub(DepartmentModel, {
    findOne: () => ({ select: () => ({ lean: async () => ({ _id: departmentA, name: "Phòng A" }) }) }),
  });
  try {
    await upsertOfficeDocumentContext({
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
      recipients: [{ userId: "tp.lsn", department: "", fullName: "Trưởng phòng A", role: "main", entityType: "person" }],
      timeline: [],
      url: "https://vanphongdientu.example.vn/main?6yXl=VAN_BAN_DEN_CA_NHAN",
    });
    return set;
  } finally {
    restoreContext();
    restoreUser();
    restoreDepartment();
  }
};

test("MANUAL survives an extension upsert, including a manager's cleared assignment", async () => {
  const manual = await upsertSet(routedDocument({
    assignmentMode: "MANUAL",
    assignment: { userId: colleague, fullName: "Chuyên viên Hai", departmentId: departmentA },
  }));
  assert.deepEqual(assignmentWrites(manual), []);
  assert.equal("management.assignmentMode" in manual, false);

  const cleared = await upsertSet(routedDocument({
    assignmentMode: "MANUAL",
    assignment: { userId: null, fullName: "", departmentId: null },
  }));
  assert.deepEqual(assignmentWrites(cleared), []);

  const legacy = await upsertSet(routedDocument({ updatedBy: manager }));
  assert.deepEqual(assignmentWrites(legacy), []);
});

test("an AUTO document, even one edited since, still follows the extension", async () => {
  const set = await upsertSet(routedDocument({
    assignmentMode: "AUTO",
    updatedBy: manager,
    assignment: { userId: null, fullName: "", departmentId: null },
  }));
  assert.equal(String(set["management.assignment.userId"]), leader);
});

const listWith = async (documents: any[], query: Record<string, unknown>, actor = chief) => {
  const restoreContext = stub(OfficeDocumentContextModel, {
    find: () => ({
      sort: () => ({ lean: async () => documents }),
      select: () => ({ lean: async () => [] }),
      lean: async () => [],
    }),
  });
  const restoreUser = stub(UserModel, {
    find: (filter: any) => {
      const inDepartment = filter.department
        ? directoryUsers.filter((user) => user.department._id === String(filter.department))
        : directoryUsers;
      return {
        select: () => ({
          populate: () => ({ lean: async () => directoryUsers }),
          lean: async () => inDepartment.map((user) => ({ ...user, department: user.department._id })),
        }),
      };
    },
    findOne: (filter: any) => ({
      select: () => ({
        lean: async () => {
          const user = directoryUsers.find((item) => item._id === String(filter._id));
          return user ? { ...user, department: user.department._id } : null;
        },
      }),
    }),
  });
  const restoreDepartment = stub(DepartmentModel, {
    findOne: (filter: any) => ({
      select: () => ({
        lean: async () => ({
          _id: filter._id,
          name: String(filter._id) === departmentA ? "Phòng A" : "Phòng B",
        }),
      }),
    }),
  });
  try {
    return (await listOfficeDocumentContexts(actor, query)).data as any[];
  } finally {
    restoreContext();
    restoreUser();
    restoreDepartment();
  }
};

const withId = (document: any, externalDocumentId: string) => ({
  ...document,
  _id: new Types.ObjectId().toString(),
  externalDocumentId,
  observation: { ...document.observation, soKyHieu: `${externalDocumentId}/TEST` },
});
const external = (documents: any[]) => documents.map((document) => document.externalDocumentId).sort();

test("the person filter returns the owner's documents and no collaborator's", async () => {
  const primaryOf = (userId: string, fullName: string) => ({
    processing: { primaryAssignee: { userId, fullName, departmentId: null }, assignees: [] },
  });
  const owned = routedDocument();
  owned.observation.recipients = collaboratorRecipients;
  const collaboratorOnly = routedDocument({}, primaryOf(colleague, "Chuyên viên Hai"));
  collaboratorOnly.observation.recipients = collaboratorRecipients;
  const staleAssignment = routedDocument({
    assignment: { userId: specialist, fullName: "Chuyên viên Một", departmentId: departmentB },
  }, primaryOf(colleague, "Chuyên viên Hai"));
  const submitted = routedDocument(
    { businessCompletion: { completed: true, evidenceType: "DOCUMENT_RESULT", submittedBy: specialist } },
    primaryOf(colleague, "Chuyên viên Hai"),
  );
  const documents = [
    withId(owned, "owned"),
    withId(collaboratorOnly, "collaborator-only"),
    withId(staleAssignment, "stale-assignment"),
    withId(submitted, "submitted"),
  ];
  assert.deepEqual(external(await listWith(documents, { userId: specialist })), ["owned", "submitted"]);
  assert.deepEqual(
    external(await listWith(documents, { userId: colleague })),
    ["collaborator-only", "stale-assignment"],
  );
  assert.deepEqual(external(await listWith(documents, { userId: leader })), []);
});

test("an owner with no internal id is matched by name, never through recipients", async () => {
  const nameOnly = routedDocument({ assignment: { userId: null, fullName: "Chuyên viên Một", departmentId: null } }, {
    processing: null,
  });
  const recipientOnly = routedDocument({ assignment: { userId: null, fullName: "", departmentId: null } }, {
    processing: null,
  });
  recipientOnly.observation.recipients = [{ ...collaboratorRecipients[0], role: "main" }];
  const documents = [withId(nameOnly, "name-only"), withId(recipientOnly, "recipient-only")];
  assert.deepEqual(external(await listWith(documents, { userId: specialist })), ["name-only"]);
});

test("the department filter follows the owner's department", async () => {
  const unit = { userId: "", department: "Phòng A", fullName: "Phòng A", role: "main", entityType: "unit" };
  const staleDepartment = routedDocument();
  staleDepartment.observation.recipients = [unit];
  const unownedByUnit = routedDocument({ assignment: { userId: null, fullName: "", departmentId: null } }, {
    processing: null,
  });
  unownedByUnit.observation.recipients = [unit];
  const unownedByAssignment = routedDocument({
    assignment: { userId: null, fullName: "", departmentId: departmentA },
  }, { processing: null });
  const ownedInA = routedDocument({ assignmentMode: "MANUAL" });
  const documents = [
    withId(staleDepartment, "stale-department"),
    withId(unownedByUnit, "unowned-by-unit"),
    withId(unownedByAssignment, "unowned-by-assignment"),
    withId(ownedInA, "owned-in-a"),
  ];
  assert.deepEqual(
    external(await listWith(documents, { departmentId: departmentA })),
    ["owned-in-a", "unowned-by-assignment", "unowned-by-unit"],
  );
  // The first specialist's snapshot has no department; the user record supplies it.
  assert.deepEqual(external(await listWith(documents, { departmentId: departmentB })), ["stale-department"]);
});

test("outgoing person matching is unchanged", async () => {
  const product = {
    ...routedDocument({ assignment: { userId: specialist, fullName: "Chuyên viên Một", departmentId: departmentB } }),
    pageType: "outgoing",
    statusSync: {},
    observation: {
      ...routedDocument().observation,
      draftingUserId: "cv2",
      draftingUser: "Chuyên viên Hai",
      relatedIncomingSoKyHieu: "1/TEST",
    },
  };
  const documents = [withId(product, "product")];
  assert.deepEqual(external(await listWith(documents, { pageType: "outgoing", userId: specialist })), ["product"]);
  assert.deepEqual(external(await listWith(documents, { pageType: "outgoing", userId: colleague })), ["product"]);
  assert.deepEqual(external(await listWith(documents, { pageType: "outgoing", userId: leader })), []);
  const [row] = await listWith(documents, { pageType: "outgoing" });
  assert.deepEqual(row.tracking.assignee, {
    source: "MANUAL",
    userId: specialist,
    fullName: "Chuyên viên Một",
    departmentId: departmentB,
    departmentName: "",
  });
});

test("tracking.assignee names the KPI owner and says where that came from", async () => {
  const assigneeOf = async (document: any) => {
    const [row] = await listWith([document], {});
    assert.equal(row.tracking.assignee.userId, performanceDocumentOwnerId(document));
    return row.tracking.assignee;
  };
  assert.deepEqual(await assigneeOf(routedDocument()), {
    source: "WORKFLOW_PRIMARY",
    userId: specialist,
    fullName: "Chuyên viên Một",
    departmentId: departmentB,
    departmentName: "Phòng B",
  });
  assert.equal((await assigneeOf(routedDocument({ assignmentMode: "MANUAL" }))).source, "MANUAL");
  assert.equal((await assigneeOf(routedDocument({ updatedBy: manager }))).source, "MANUAL");
  assert.equal((await assigneeOf(routedDocument({}, { processing: null }))).source, "AUTO_ASSIGNMENT");
  assert.deepEqual(
    await assigneeOf(routedDocument({
      businessCompletion: { completed: true, evidenceType: "DOCUMENT_RESULT", submittedBy: colleague },
    })),
    {
      source: "DOCUMENT_RESULT",
      userId: colleague,
      fullName: "Chuyên viên Hai",
      departmentId: departmentA,
      departmentName: "Phòng A",
    },
  );
});

test("the owner's department never comes from an assignment held by someone else", () => {
  const owner = effectiveOfficeDocumentOwner(routedDocument());
  assert.equal(owner.userId, specialist);
  assert.equal(owner.departmentId, "");
  assert.equal(owner.departmentName, "");
});

test("the detail payload carries the same owner as the list", async () => {
  const restoreContext = stub(OfficeDocumentContextModel, {
    findById: () => ({ lean: async () => routedDocument() }),
  });
  const chain: any = { sort: () => chain, populate: () => chain, lean: async () => [] };
  const restoreLinks = stub(DocumentResultLinkModel, { find: () => chain });
  const restoreUser = stub(UserModel, {
    find: () => ({ select: () => ({ populate: () => ({ lean: async () => directoryUsers }) }) }),
  });
  try {
    const { data } = await getOfficeDocumentContext(chief, documentId);
    assert.equal(data.tracking.assignee.userId, specialist);
    assert.equal(data.tracking.assignee.source, "WORKFLOW_PRIMARY");
    assert.equal(data.tracking.assignee.departmentId, departmentB);
  } finally {
    restoreContext();
    restoreLinks();
    restoreUser();
  }
});

const complaintFrom = async (actorId: string) => {
  const document = {
    ...routedDocument(),
    set() {},
    save: async () => {},
  };
  // The old holder of the assignment is a specialist here, so the check bites.
  const actor = { ...chief, id: actorId, role: { code: "SPECIALIST", level: 4 } };
  const restoreContext = stub(OfficeDocumentContextModel, { findById: async () => document });
  const restoreRole = stub(RoleModel, { findOne: () => ({ select: async () => null }) });
  try {
    return await requestOfficeDocumentComplaintService(actor, documentId, {
      requestedPoint: 5,
      reason: "Điểm chưa đúng",
    });
  } finally {
    restoreContext();
    restoreRole();
  }
};

test("a complaint is allowed for the primary owner and refused for the old assignment holder", async () => {
  await assert.doesNotReject(complaintFrom(specialist));
  await assert.rejects(complaintFrom(leader), (error: any) => error?.statusCode === 403);
});

test("a work declaration links to the task's owner, not the assignment holder", () => {
  assert.doesNotThrow(() => assertSourceDocumentCanBeLinked(routedDocument(), specialist));
  assert.throws(
    () => assertSourceDocumentCanBeLinked(routedDocument(), leader),
    (error: any) => error?.statusCode === 403,
  );
});

test("the dashboard projection and scope reach the owner", () => {
  assert.equal(officeDocumentProjection(routedDocument()).owner.id, specialist);
  assert.equal(officeDocumentProjection(routedDocument()).owner.fullName, "Chuyên viên Một");
  assert.equal(officeDocumentProjection(routedDocument({ assignmentMode: "MANUAL" })).owner.id, leader);

  const clauses = officeDocumentOwnerCandidateClauses([specialist]);
  const primaryIds: any[] = (clauses[2]["statusSync.processing.primaryAssignee.userId"] as any).$in;
  assert.ok(primaryIds.includes(specialist));
  assert.ok(primaryIds.some((id) => id instanceof Types.ObjectId && String(id) === specialist));

  const scope: any = officeDocumentScope({ ...chief, id: specialist, role: { code: "SPECIALIST" } });
  assert.ok(scope.$or.some((clause: any) => "statusSync.processing.primaryAssignee.userId" in clause));
});

test("the legacy report lists only edited rows whose assignment differs from the first specialist", () => {
  const editedAt = new Date("2026-06-01T00:00:00Z");
  const reviewed = routedDocument({ updatedBy: manager, updatedAt: editedAt });
  const csv = legacyEditedOwnersCsv(
    [
      reviewed,
      routedDocument(),
      routedDocument({ updatedBy: manager, assignmentMode: "AUTO" }),
      routedDocument({ updatedBy: manager, assignmentMode: "MANUAL" }),
      routedDocument({ updatedBy: manager, assignment: { userId: specialist } }),
      routedDocument({ updatedBy: manager }, { processing: null }),
    ],
    new Map([[manager, { fullName: "Chánh, văn phòng" }]]),
  );
  assert.deepEqual(csv.split("\n"), [
    "soKyHieu,externalDocumentId,currentOwnerId,currentOwner,primaryAssigneeId,primaryAssignee,updatedById,updatedBy,updatedAt",
    `6954/TEST,6954,${leader},Trưởng phòng A,${specialist},Chuyên viên Một,${manager},"Chánh, văn phòng",${editedAt.toISOString()}`,
  ]);
});

test("a score-only save keeps the row in place, any other edit moves it", async () => {
  const scored = await saveManaged(routedDocument(), { management: { manualScore: 2 } });
  assert.equal(scored.options.timestamps, false);
  const noted = await saveManaged(routedDocument(), { management: { manualScore: 2, note: "x" } });
  assert.equal(noted.options.timestamps, undefined);
  const subject = await saveManaged(routedDocument(), { subject: "x", management: { manualScore: 2 } });
  assert.equal(subject.options.timestamps, undefined);
});

test("reassigning a task closes its pending not-required request", async () => {
  await withAssignableUser(directoryUsers[1], async () => {
    const { transitions } = await saveManaged(
      routedDocument({ notRequired: { status: "PENDING", requestedBy: specialist } }),
      { management: { assignment: { userId: colleague, departmentId: departmentA } } },
    );
    assert.equal(transitions.length, 1);
    assert.equal(transitions[0].filter["management.notRequired.status"], "PENDING");
    assert.equal(transitions[0].update.$set["management.notRequired.status"], "CANCELLED");
    assert.equal(transitions[0].update.$push["management.notRequired.history"].action, "CANCELLED");
  });
});

test("a save that keeps the owner leaves a pending not-required request open", async () => {
  const { transitions } = await saveManaged(
    routedDocument({ notRequired: { status: "PENDING", requestedBy: specialist } }),
    { management: { manualScore: 2 } },
  );
  assert.equal(transitions.length, 0);
});
