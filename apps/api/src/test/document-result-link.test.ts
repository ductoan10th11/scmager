import assert from "node:assert/strict";
import test from "node:test";
import { Types } from "mongoose";
import DocumentResultLinkModel from "../models/document-result-link.model";
import {
  canReadDocumentResultLink,
  DOCUMENT_RESULT_INCOMING_POPULATE_SELECT,
  DOCUMENT_RESULT_OUTGOING_POPULATE_SELECT,
  documentResultCompletionValues,
  resolveDocumentResultPerformerId,
} from "../services/document-result-link.service";
import {
  effectiveOfficeDocumentCompletion,
  effectiveOfficeProductPoint,
  normalizeOfficeDocumentSymbol,
} from "../services/office-document-completion.service";
import { assertSourceDocumentCanBeLinked } from "../services/work-declaration.service";
import { performanceDocumentOwnerId } from "../services/performance.service";

test("document symbols are normalized without losing Vietnamese identity", () => {
  assert.equal(
    normalizeOfficeDocumentSymbol(" 44/2026/qđ-ubnd "),
    "44/2026/QĐ-UBND",
  );
  assert.equal(normalizeOfficeDocumentSymbol(""), "");
});

test("official eOffice completion remains authoritative over business evidence", () => {
  const businessOnly = effectiveOfficeDocumentCompletion({
    statusSync: { completed: false },
    management: {
      businessCompletion: {
        completed: true,
        evidenceType: "DOCUMENT_RESULT",
        evidenceId: new Types.ObjectId(),
        submittedAt: new Date("2026-07-30T01:00:00.000Z"),
        approvedAt: new Date("2026-07-30T02:00:00.000Z"),
      },
    },
  });
  assert.equal(businessOnly.completed, true);
  assert.equal(businessOnly.source, "DOCUMENT_RESULT");

  const official = effectiveOfficeDocumentCompletion({
    statusSync: {
      completed: true,
      completedAt: new Date("2026-07-30T03:00:00.000Z"),
      trackLogs: [],
    },
    management: {
      businessCompletion: {
        completed: true,
        evidenceType: "DOCUMENT_RESULT",
        submittedAt: new Date("2026-07-30T01:00:00.000Z"),
      },
    },
  });
  assert.equal(official.completed, true);
  assert.equal(official.source, "EOFFICE");
});

test("document result links reject invalid workflow status and revision", async () => {
  const common = {
    organization: new Types.ObjectId(),
    incomingDocument: new Types.ObjectId(),
    outgoingDocument: new Types.ObjectId(),
    submittedBy: new Types.ObjectId(),
    performedBy: new Types.ObjectId(),
  };
  const valid = new DocumentResultLinkModel(common);
  await valid.validate();

  const missingIncoming = new DocumentResultLinkModel({
    ...common,
    incomingDocument: null,
  });
  await assert.rejects(() => missingIncoming.validate(), /incomingDocument/);

  const invalidStatus = new DocumentResultLinkModel({
    ...common,
    status: "DONE",
  });
  await assert.rejects(() => invalidStatus.validate(), /status/);

  const invalidRevision = new DocumentResultLinkModel({
    ...common,
    revision: 0,
  });
  await assert.rejects(() => invalidRevision.validate(), /revision/);

  const indexes = DocumentResultLinkModel.schema.indexes() as Array<
    [Record<string, number>, { unique?: boolean }]
  >;
  assert.ok(indexes.some(([keys, options]) =>
    keys.organization === 1
    && keys.outgoingDocument === 1
    && options.unique === true));

});

test("document result detail never exposes a counterpart outside specialist scope", () => {
  const organization = new Types.ObjectId().toString();
  const specialistId = new Types.ObjectId().toString();
  const anotherUserId = new Types.ObjectId().toString();
  const actor = {
    id: specialistId,
    username: "specialist",
    organization,
    department: new Types.ObjectId().toString(),
    role: { code: "SPECIALIST", level: 4 },
  } as any;
  const link = {
    organization,
    incomingDocument: {
      organizationId: organization,
      management: { assignment: { userId: specialistId } },
      statusSync: { processing: { assignees: [] } },
      observation: { recipients: [] },
    },
    outgoingDocument: {
      organizationId: organization,
      management: { assignment: { userId: anotherUserId } },
      observation: {},
    },
  };

  assert.equal(canReadDocumentResultLink(actor, link), true);
  assert.equal(canReadDocumentResultLink(actor, link, true), false);
});

test("document result population always retains tenant scope", () => {
  assert.match(
    DOCUMENT_RESULT_INCOMING_POPULATE_SELECT,
    /\borganizationId\b/,
  );
  assert.match(
    DOCUMENT_RESULT_OUTGOING_POPULATE_SELECT,
    /\borganizationId\b/,
  );
});

test("source tasks can only be linked by their assigned owner before completion", () => {
  const ownerId = new Types.ObjectId().toString();
  assert.doesNotThrow(() => assertSourceDocumentCanBeLinked({
    management: {
      assignment: { userId: ownerId },
      businessCompletion: { completed: false },
    },
  }, ownerId));
  assert.throws(() => assertSourceDocumentCanBeLinked({
    management: {
      assignment: { userId: new Types.ObjectId() },
      businessCompletion: { completed: false },
    },
  }, ownerId), (error: any) => error?.statusCode === 403);
  assert.throws(() => assertSourceDocumentCanBeLinked({
    management: {
      assignment: { userId: ownerId },
      businessCompletion: { completed: true },
    },
  }, ownerId), (error: any) => error?.statusCode === 409);
});

test("product drafter owns the result while a linked task supplies its KPI point", () => {
  const sourceOwner = new Types.ObjectId().toString();
  const productOwner = new Types.ObjectId().toString();
  const actorId = new Types.ObjectId().toString();
  const incoming = {
    management: {
      assignment: { userId: sourceOwner },
      manualScore: 5,
      overrides: { reworkCount: 1 },
      businessCompletion: { completed: false },
    },
    observation: { point: 2, reworkCount: 0 },
  };
  const outgoing = {
    management: {
      assignment: { userId: productOwner },
      manualScore: 0,
    },
    observation: { point: 0 },
  };

  assert.equal(
    resolveDocumentResultPerformerId(actorId, outgoing, incoming),
    productOwner,
  );
  assert.deepEqual(
    documentResultCompletionValues(incoming, [{ action: "RETURNED" }]),
    { point: 5, reworkCount: 2 },
  );
  assert.equal(
    resolveDocumentResultPerformerId(actorId, outgoing, null),
    productOwner,
  );
  assert.equal(effectiveOfficeProductPoint(outgoing, undefined), 0);
  assert.equal(effectiveOfficeProductPoint({
    management: { manualScore: 3 },
  }, undefined), 3);
  assert.equal(effectiveOfficeProductPoint(outgoing, 5), 5);
  assert.equal(
    performanceDocumentOwnerId({
      management: {
        assignment: { userId: sourceOwner },
        businessCompletion: {
          completed: true,
          evidenceType: "DOCUMENT_RESULT",
          submittedBy: productOwner,
        },
      },
    }),
    productOwner,
  );
});
