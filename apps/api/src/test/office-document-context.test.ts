import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import app from "../app";
import OfficeDocumentContextModel from "../models/office-document-context.model";
import {
  createManagedOfficeDocumentContext,
  normalizeOfficeDocumentContext,
} from "../services/office-document-context.service";
import {
  extensionOfficeDocumentContextRoutes,
  officeDocumentContextRoutes,
} from "../routes/office-document-context.route";

const payload = {
  available: true,
  modalOpen: true,
  pageType: "incoming",
  title: "Văn bản đến",
  documentId: "123",
  subject: "Nội dung quan sát",
  soKyHieu: "01/TEST",
  dueDate: "25/07/2026",
  priority: "Khẩn",
  draftingUnit: "",
  draftingUnitId: "",
  draftingUser: "",
  draftingUserId: "",
  relatedIncomingSoKyHieu: "",
  senderUser: "Nguyễn Văn A",
  senderUserId: "nvana.lsn",
  senderDepartment: "Phòng Tổng hợp",
  sender: {
    userId: "nvana.lsn",
    fullName: "Nguyễn Văn A",
    department: "Phòng Tổng hợp",
  },
  comment: "",
  point: null,
  reworkCount: 0,
  note: "",
  recipients: [],
  timeline: [],
  url: "https://vanphongdientu.example.vn/main?6yXl=VAN_BAN_DEN_CA_NHAN",
};

test("Office context identity uses source host, page type and external document id", () => {
  const normalized = normalizeOfficeDocumentContext(payload);
  assert.deepEqual(
    [normalized.sourceHost, normalized.pageType, normalized.externalDocumentId],
    ["vanphongdientu.example.vn", "incoming", "123"],
  );
  assert.notEqual(
    normalized.externalDocumentId,
    normalized.observation.soKyHieu,
  );
  assert.deepEqual(normalized.observation.sender, payload.sender);
  const indexes = OfficeDocumentContextModel.schema.indexes() as Array<
    [Record<string, number>, { unique?: boolean }]
  >;
  assert.ok(
    indexes.some(
      ([keys, options]) =>
        keys.sourceHost === 1 &&
        keys.pageType === 1 &&
        keys.externalDocumentId === 1 &&
        options.unique,
    ),
  );
});

test("Office context rejects malformed or oversized observations before persistence", () => {
  assert.throws(() =>
    normalizeOfficeDocumentContext({ ...payload, documentId: "" }),
  );
  assert.throws(() =>
    normalizeOfficeDocumentContext({ ...payload, url: "javascript:alert(1)" }),
  );
  assert.throws(() =>
    normalizeOfficeDocumentContext({
      ...payload,
      recipients: new Array(201).fill({}),
    }),
  );
  assert.throws(() =>
    normalizeOfficeDocumentContext({
      ...payload,
      timeline: [{}],
      pageType: "unknown",
    }),
  );
  assert.throws(() =>
    normalizeOfficeDocumentContext({
      ...payload,
      sender: { ...payload.sender, unexpected: true },
    }),
  );
  assert.throws(() =>
    normalizeOfficeDocumentContext({
      ...payload,
      sender: { ...payload.sender, fullName: 123 },
    }),
  );
  assert.deepEqual(
    normalizeOfficeDocumentContext({
      ...payload,
      sender: { userId: "", fullName: "", department: "" },
    }).observation.sender,
    { userId: "", fullName: "", department: "" },
  );
  assert.deepEqual(
    normalizeOfficeDocumentContext({
      ...payload,
      senderUser: undefined,
      senderUserId: undefined,
      senderDepartment: undefined,
      sender: undefined,
    }).observation.sender,
    { userId: "", fullName: "", department: "" },
  );
  assert.throws(() =>
    normalizeOfficeDocumentContext({ ...payload, extra: true }),
  );
});

test("management can create a MANUAL context while a specialist cannot", async () => {
  const originalCreate = OfficeDocumentContextModel.create;
  let created: any = null;
  OfficeDocumentContextModel.create = (async (value: any) => {
    created = value;
    return { toObject: () => value };
  }) as unknown as typeof OfficeDocumentContextModel.create;
  const admin = { role: { code: "OFFICE_CHIEF" } } as any;
  const specialist = { role: { code: "SPECIALIST" } } as any;
  try {
    const result = await createManagedOfficeDocumentContext(admin, {
      pageType: "incoming",
      documentId: "MAN-01",
      subject: "Văn bản tạo thủ công",
      dueDate: "25/07/2026",
    });
    assert.equal(created.origin, "MANUAL");
    assert.equal(created.pageType, "incoming");
    assert.equal(created.externalDocumentId, "MAN-01");
    assert.equal(result.data.observation.subject, "Văn bản tạo thủ công");
    await assert.rejects(
      () =>
        createManagedOfficeDocumentContext(specialist, {
          pageType: "incoming",
          subject: "Không được phép",
        }),
      { statusCode: 403 },
    );
  } finally {
    OfficeDocumentContextModel.create = originalCreate;
  }
});

test("Office context routes expose the endpoint without an environment gate", () => {
  assert.equal(extensionOfficeDocumentContextRoutes.stack.length, 2);
  assert.equal(officeDocumentContextRoutes.stack.length, 6);
  assert.equal(
    extensionOfficeDocumentContextRoutes.stack[0].route?.path,
    "/version",
  );
  assert.equal(
    extensionOfficeDocumentContextRoutes.stack[1].route?.path,
    "/office-contexts",
  );
  assert.equal(officeDocumentContextRoutes.stack[0].route?.path, "/");
  assert.equal(officeDocumentContextRoutes.stack[1].route?.path, "/");
  assert.equal(
    officeDocumentContextRoutes.stack[2].route?.path,
    "/ingest-incoming",
  );
  assert.equal(officeDocumentContextRoutes.stack[4].route?.path, "/:id");
  assert.equal(officeDocumentContextRoutes.stack[5].route?.path, "/:id");
});

test("Office context HMAC rejects unsigned, invalid, and replayed requests", () => {
  const {
    verifyExtensionSignature,
  } = require("../middlewares/extension-auth.middleware");
  const crypto = require("crypto");
  const timestamp = String(Date.now());
  const nonce = `test-${timestamp}`;
  const extensionId = "abcdefghijklmnopabcdefghijklmnop";
  const body = { documentId: "123" };
  const signature = crypto
    .createHmac("sha256", "ework-ext-secret-2026-v1")
    .update(`${timestamp}.${nonce}.${JSON.stringify(body)}`)
    .digest("hex");
  let error: any = null;
  let accepted = false;
  const next = (result?: any) => {
    if (result) error = result;
    else accepted = true;
  };

  verifyExtensionSignature({ headers: {}, body } as any, {} as any, next);
  assert.equal(error?.statusCode, 401);

  error = null;
  accepted = false;
  verifyExtensionSignature(
    {
      headers: {
        "x-ework-timestamp": timestamp,
        "x-ework-nonce": nonce,
        "x-ework-extension-id": extensionId,
        "x-ework-signature": "bad",
      },
      body,
    } as any,
    {} as any,
    next,
  );
  assert.equal(error?.statusCode, 401);

  error = null;
  accepted = false;
  verifyExtensionSignature(
    {
      headers: {
        "x-ework-timestamp": timestamp,
        "x-ework-nonce": nonce,
        "x-ework-extension-id": extensionId,
        "x-ework-signature": signature,
      },
      body,
    } as any,
    {} as any,
    next,
  );
  assert.equal(error, null);
  assert.equal(accepted, true);

  error = null;
  accepted = false;
  verifyExtensionSignature(
    {
      headers: {
        "x-ework-timestamp": timestamp,
        "x-ework-nonce": nonce,
        "x-ework-extension-id": extensionId,
        "x-ework-signature": signature,
      },
      body,
    } as any,
    {} as any,
    next,
  );
  assert.equal(error?.statusCode, 401);
  assert.equal(accepted, false);
});

test("Office context list requires an authenticated session on both API mounts", async () => {
  const originalFind = OfficeDocumentContextModel.find;
  const originalCountDocuments = OfficeDocumentContextModel.countDocuments;
  const filters: Array<Record<string, unknown>> = [];
  const chain = {
    sort: () => chain,
    skip: () => chain,
    limit: () => chain,
    lean: async () => [],
  };

  OfficeDocumentContextModel.find = ((filter: Record<string, unknown>) => {
    filters.push(filter);
    return chain;
  }) as unknown as typeof OfficeDocumentContextModel.find;
  OfficeDocumentContextModel.countDocuments = (async () =>
    0) as unknown as typeof OfficeDocumentContextModel.countDocuments;

  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const apiResponse = await fetch(
      `${baseUrl}/api/office-document-contexts?pageType=incoming`,
    );
    const rootResponse = await fetch(
      `${baseUrl}/office-document-contexts?pageType=outgoing,outgoing_c2`,
    );

    assert.equal(apiResponse.status, 401);
    assert.equal(rootResponse.status, 401);
    assert.deepEqual(filters, []);
  } finally {
    OfficeDocumentContextModel.find = originalFind;
    OfficeDocumentContextModel.countDocuments = originalCountDocuments;
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
