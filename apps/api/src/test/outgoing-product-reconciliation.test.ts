import assert from "node:assert/strict";
import test from "node:test";
import OfficeDocumentContextModel from "../models/office-document-context.model";
import {
  getLatestTrackLogPoint,
  outgoingPublishedFilter,
  parseOutgoingDocumentListHtml,
  parseTrackLogHtmlResponse,
  reworkCountIn,
  trackLogNote,
  withoutScoreHeader,
} from "../services/langson-dwr.service";
import { outgoingProductReconciliationInternals } from "../services/outgoing-product-reconciliation.service";

const dwrHtml = (html: string) => {
  const escaped = html
    .replace(/\\/gu, "\\\\")
    .replace(/"/gu, '\\"')
    .replace(/\n/gu, "\\n");
  return `var s0="${escaped}";DWREngine._handleResponse('0','0',s0);`;
};

test("outgoing DWR filter covers the complete requested year", () => {
  const filter = outgoingPublishedFilter(2026);
  assert.equal(filter.typeget, "vanban_di_da_banhanh");
  assert.equal(filter.value_search_start_date, "01/01/2026");
  assert.equal(filter.value_search_end_date, "31/12/2026");
  assert.equal(filter.field_search_date, "ngay_tao");
  assert.equal(filter.sort, "desc");
  assert.throws(() => outgoingPublishedFilter(1999), /year is invalid/u);
});

test("outgoing DWR parser preserves source identity and metadata", () => {
  const payload = dwrHtml(`
    <table><tbody>
      <tr tridrecord="2426001" so_ky_hieu="1281/UBND-KT" trich_yeu="Đề nghị thanh toán"
          don_vi_ban_hanh="UBND xã Thiện Tân" hinh_thuc="Công văn"
          ngay_van_ban="31/07/2026" do_khan="Thường" don_vi_soan_thao="Phòng Kinh tế">
        <td>1</td><td>1281/UBND-KT</td><td>Đề nghị thanh toán</td>
      </tr>
      <tr FlyID="2426002" so_ky_hieu="12/QĐ-UBND" trich_yeu="Quyết định thành lập tổ">
        <td>2</td><td>12/QĐ-UBND</td><td>Quyết định thành lập tổ</td>
      </tr>
    </tbody></table>
  `);
  const documents = parseOutgoingDocumentListHtml(payload);
  assert.equal(documents.length, 2);
  assert.deepEqual(documents[0], {
    documentId: "2426001",
    soKyHieu: "1281/UBND-KT",
    trichYeu: "Đề nghị thanh toán",
    donViBanHanh: "UBND xã Thiện Tân",
    hinhThuc: "Công văn",
    ngayVanBan: "31/07/2026",
    doKhan: "Thường",
    donViSoanThao: "Phòng Kinh tế",
  });
  assert.equal(documents[1]?.documentId, "2426002");
});

test("product reconciliation schema rejects unsupported workflow states", () => {
  const valid = new OfficeDocumentContextModel({
    sourceHost: "vanphongdientu.langson.gov.vn",
    pageType: "outgoing",
    externalDocumentId: "2426001",
    sourceUrl: "https://vanphongdientu.langson.gov.vn/main",
    observation: {},
    observedAt: new Date(),
    management: {
      product: {
        classification: "STANDALONE_PRODUCT",
        performerStatus: "RESOLVED",
        scoreStatus: "PENDING",
      },
    },
  });
  assert.doesNotThrow(() => valid.validateSync());
  assert.equal(valid.management?.product?.attempts, 0);
  assert.deepEqual(valid.management?.product?.history, []);

  const invalid = new OfficeDocumentContextModel({
    sourceHost: "vanphongdientu.langson.gov.vn",
    pageType: "outgoing",
    externalDocumentId: "2426002",
    sourceUrl: "https://vanphongdientu.langson.gov.vn/main",
    observation: {},
    observedAt: new Date(),
    management: { product: { classification: "CREDITED_WITHOUT_APPROVAL" } },
  });
  assert.match(invalid.validateSync()?.message ?? "", /classification/u);
});

test("year and rework helpers use source values deterministically", () => {
  assert.equal(outgoingProductReconciliationInternals.dateInYear("31/07/2026", 2026), true);
  assert.equal(outgoingProductReconciliationInternals.dateInYear("01/01/2025", 2026), false);
  assert.equal(outgoingProductReconciliationInternals.reworkCountFrom([
    {
      id: "1",
      sequence: 1,
      sender: { username: "a", fullName: "A" },
      receiver: { username: "b", fullName: "B" },
      action: "Trả lại",
      comment: "Làm lại: 2",
      content: "",
      receivedAt: null,
      processingAt: null,
      completedAt: null,
    },
  ]), 2);
  const fingerprint = outgoingProductReconciliationInternals.sourceFingerprint({ id: 1 });
  assert.equal(fingerprint.length, 64);
  assert.equal(
    fingerprint,
    outgoingProductReconciliationInternals.sourceFingerprint({ id: 1 }),
  );
  assert.equal(outgoingProductReconciliationInternals.retryDelayMs(1), 5 * 60_000);
  assert.equal(outgoingProductReconciliationInternals.retryDelayMs(2), 10 * 60_000);
  assert.equal(outgoingProductReconciliationInternals.retryDelayMs(1_000), 6 * 60 * 60_000);
  assert.equal(outgoingProductReconciliationInternals.needsReconciliation({
    management: {
      product: {
        classification: "STANDALONE_PRODUCT",
        performerStatus: "RESOLVED",
        scoreStatus: "PENDING",
        lastReconciledAt: new Date(),
        lastError: "",
      },
    },
  }), false);
  assert.equal(outgoingProductReconciliationInternals.needsReconciliation({
    management: {
      product: {
        classification: "PENDING_RELATION",
        performerStatus: "RESOLVED",
        scoreStatus: "NOT_APPLICABLE",
        lastReconciledAt: new Date(),
      },
    },
  }), true);
  assert.equal(outgoingProductReconciliationInternals.needsReconciliation({
    management: {
      product: {
        classification: "PENDING_RELATION",
        performerStatus: "RESOLVED",
        scoreStatus: "PENDING",
        lastReconciledAt: new Date(),
        nextRetryAt: new Date(Date.now() + 60_000),
      },
    },
  }), false);
});

test("existing tenantless incoming source is attached without overwriting observation", async () => {
  const originalFindOne = OfficeDocumentContextModel.findOne;
  const originalFindById = OfficeDocumentContextModel.findById;
  const originalUpdateOne = OfficeDocumentContextModel.updateOne;
  const incoming = {
    _id: "64b000000000000000000021",
    organizationId: null,
    pageType: "incoming",
    externalDocumentId: "2425000",
    observation: {
      dueDate: "08/08/2026",
      subject: "Payload đầy đủ từ extension",
      recipients: [],
    },
  };
  let update: any = null;
  OfficeDocumentContextModel.findOne = (() => ({
    lean: async () => incoming,
  })) as unknown as typeof OfficeDocumentContextModel.findOne;
  OfficeDocumentContextModel.updateOne = (async (filter: any, value: any) => {
    update = { filter, value };
    return { modifiedCount: 1 };
  }) as unknown as typeof OfficeDocumentContextModel.updateOne;
  OfficeDocumentContextModel.findById = (() => ({
    lean: async () => ({ ...incoming, organizationId: "64b000000000000000000022" }),
  })) as unknown as typeof OfficeDocumentContextModel.findById;
  try {
    const result = await outgoingProductReconciliationInternals.upsertIncomingSource(
      incoming.externalDocumentId,
      "64b000000000000000000022",
      "unused-csrf",
    );
    assert.equal(result?.observation?.dueDate, "08/08/2026");
    assert.deepEqual(update.filter, { _id: incoming._id, organizationId: null });
    assert.equal(update.value.$set.organizationId, "64b000000000000000000022");
    assert.equal(update.value.$set.observation, undefined);
  } finally {
    OfficeDocumentContextModel.findOne = originalFindOne;
    OfficeDocumentContextModel.findById = originalFindById;
    OfficeDocumentContextModel.updateOne = originalUpdateOne;
  }
});

test("missing related incoming source is not created by reconciliation", async () => {
  const originalFindOne = OfficeDocumentContextModel.findOne;
  let findOneCalls = 0;
  OfficeDocumentContextModel.findOne = (() => {
    findOneCalls += 1;
    return { lean: async () => null };
  }) as unknown as typeof OfficeDocumentContextModel.findOne;
  try {
    const result = await outgoingProductReconciliationInternals.upsertIncomingSource(
      "missing-incoming-2426003",
      "64b000000000000000000022",
      "unused-csrf",
    );
    assert.equal(result, null);
    assert.equal(findOneCalls, 1);
  } finally {
    OfficeDocumentContextModel.findOne = originalFindOne;
  }
});

test("withoutScoreHeader removes the score block from either end of a remark", () => {
  const cases: Array<[string, string]> = [
    ["Đề nghị xử lý đúng hạn.\n[P=0.9,R=,GV]", "Đề nghị xử lý đúng hạn."],
    ["Đã hoàn thành dự thảo.\n[P=0.8,R=1,GV]", "Đã hoàn thành dự thảo."],
    ["Sửa lại theo góp ý.\n[P=,R=2,GV]", "Sửa lại theo góp ý."],
    ["Sửa lại theo góp ý.\n[R=2,GV]", "Sửa lại theo góp ý."],
    ["Chuyển xử lý.\n[P=,R=,GV]", "Chuyển xử lý."],
    ["Đã hoàn thành dự thảo[P=0,8,R=1,GV]", "Đã hoàn thành dự thảo"],
    ["[P=0.8,R=1,GV]", ""],
    ["Đề nghị xử lý đúng hạn.\n[GV]", "Đề nghị xử lý đúng hạn."],
    ["Đề nghị xử lý đúng hạn [GV]", "Đề nghị xử lý đúng hạn"],
    ["Đề nghị xử lý đúng hạn[GV]", "Đề nghị xử lý đúng hạn"],
    ["[GV]", ""],
    ["Đề nghị xử lý đúng hạn. Điểm: 0.9, Làm lại: 1. [GV]", "Đề nghị xử lý đúng hạn."],
    ["Xem [GV] ở mục 2 và [phụ lục, GV]", "Xem [GV] ở mục 2 và [phụ lục, GV]"],
    ["Đề nghị xử lý đúng hạn.\nĐiểm: 0.9, Làm lại: 1.", "Đề nghị xử lý đúng hạn."],
    ["Đề nghị xử lý đúng hạn. Điểm: 0,9, Làm lại: 1", "Đề nghị xử lý đúng hạn."],
    ["Đề nghị xử lý đúng hạn. Làm lại: 2", "Đề nghị xử lý đúng hạn."],
    ["Đề nghị xử lý đúng hạn, Điểm: 0.9", "Đề nghị xử lý đúng hạn"],
    ["Điểm: 0.9, Làm lại: 1.\nĐề nghị xử lý đúng hạn.", "Đề nghị xử lý đúng hạn."],
    ["Điểm: 0.9. Làm lại: 1. Đề nghị xử lý đúng hạn.", "Đề nghị xử lý đúng hạn."],
    ["Điểm: 0.9, Làm lại: 1.", ""],
    ["Làm lại: 2", ""],
    ["Đề nghị xử lý đúng hạn.", "Đề nghị xử lý đúng hạn."],
    ["Làm lại: 2 lần theo yêu cầu của lãnh đạo", "lần theo yêu cầu của lãnh đạo"],
    ["Tiêu chí Điểm: 5 cần rà soát lại.", "Tiêu chí Điểm: 5 cần rà soát lại."],
  ];
  for (const [input, expected] of cases) {
    assert.equal(withoutScoreHeader(input), expected, input);
  }
});

test("trackLogNote reads one field so a repeated remark is not doubled", () => {
  const remark = "Đề nghị xử lý đúng hạn. Điểm: 0.9, Làm lại: 1.";
  assert.equal(trackLogNote({ comment: remark, content: remark }), "Đề nghị xử lý đúng hạn.");
  assert.equal(trackLogNote({ comment: remark, content: "" }), "Đề nghị xử lý đúng hạn.");
});

test("routing signal keeps the rework count and a clean note when the score is at the end", () => {
  const remark = "Đề nghị xử lý đúng hạn. Điểm: 0.9, Làm lại: 1.";
  const signal = outgoingProductReconciliationInternals.routingSignalFrom([
    {
      id: "1",
      sequence: 1,
      sender: { username: "a", fullName: "A" },
      receiver: { username: "b", fullName: "B" },
      action: "Chuyển tới",
      comment: remark,
      content: remark,
      receivedAt: null,
      processingAt: null,
      completedAt: null,
    },
  ]);
  assert.deepEqual(signal, { reworkCount: 1, note: "Đề nghị xử lý đúng hạn." });
});

test("a score in its own eOffice paragraph is still read from the tracklog", () => {
  const cell = (value: string) => `<td>${value}</td>`;
  const remark = '<span name="comment"><p>Đề nghị xử lý đúng hạn.</p><p>Điểm: 0.9, Làm lại: 1.</p></span>';
  const logs = parseTrackLogHtmlResponse(dwrHtml(
    `<table><tr class="log_role_type_received" act_id="1" stt="1">${
      ["1", "A", "B", "", "", "", "", remark].map(cell).join("")
    }</tr></table>`,
  ));
  assert.equal(logs.length, 1);
  assert.equal(logs[0].comment, "Đề nghị xử lý đúng hạn. Điểm: 0.9, Làm lại: 1.");
  assert.equal(getLatestTrackLogPoint(logs)?.point, 0.9);
  assert.equal(trackLogNote(logs[0]), "Đề nghị xử lý đúng hạn.");
});

test("a score already stored fused onto the previous sentence is still read", () => {
  const point = getLatestTrackLogPoint([
    {
      id: "1",
      sequence: 1,
      sender: { username: "a", fullName: "A" },
      receiver: { username: "b", fullName: "B" },
      action: "Chuyển tới",
      comment: "Đề nghị xử lý đúng hạn.Điểm: 0.9",
      content: "Đề nghị xử lý đúng hạn.Điểm: 0.9",
      receivedAt: null,
      processingAt: null,
      completedAt: null,
    },
  ]);
  assert.equal(point?.point, 0.9);
});

test("a [GV] comment yields a clean note and no score from the tracklog", () => {
  const remark = "Sửa lại theo góp ý.\n[GV]";
  const log = {
    id: "1",
    sequence: 1,
    sender: { username: "a", fullName: "A" },
    receiver: { username: "b", fullName: "B" },
    action: "Chuyển tới",
    comment: remark,
    content: remark,
    receivedAt: null,
    processingAt: null,
    completedAt: null,
  };
  assert.equal(getLatestTrackLogPoint([log]), null);
  assert.deepEqual(
    outgoingProductReconciliationInternals.routingSignalFrom([log]),
    { reworkCount: 0, note: "Sửa lại theo góp ý." },
  );
});

test("the [P=,R=,GV] token is read from the tracklog, blank values included", () => {
  const log = (comment: string) => ({
    id: "1",
    sequence: 1,
    sender: { username: "a", fullName: "A" },
    receiver: { username: "b", fullName: "B" },
    action: "Chuyển tới",
    comment,
    content: comment,
    receivedAt: null,
    processingAt: null,
    completedAt: null,
  });
  const pointOf = (comment: string) => getLatestTrackLogPoint([log(comment)])?.point ?? null;

  assert.equal(pointOf("Đã hoàn thành dự thảo.\n[P=0.8,R=1,GV]"), 0.8);
  assert.equal(pointOf("Đã hoàn thành dự thảo.\n[P=0,8,R=1,GV]"), 0.8);
  assert.equal(pointOf("Đề nghị xử lý đúng hạn.\n[P=0.9,R=,GV]"), 0.9);
  assert.equal(pointOf("Sửa lại theo góp ý.\n[P=,R=2,GV]"), null);
  assert.equal(pointOf("Sửa lại theo góp ý.\n[R=2,GV]"), null);

  assert.equal(reworkCountIn("Đã hoàn thành dự thảo.\n[P=0.8,R=1,GV]"), 1);
  assert.equal(reworkCountIn("Sửa lại theo góp ý.\n[P=,R=2,GV]"), 2);
  assert.equal(reworkCountIn("Đề nghị xử lý đúng hạn.\n[P=0.9,R=,GV]"), null);
  assert.equal(reworkCountIn("Làm lại: 3"), 3);

  assert.deepEqual(
    outgoingProductReconciliationInternals.routingSignalFrom([log("Đã hoàn thành dự thảo.\n[P=0.8,R=1,GV]")]),
    { reworkCount: 1, note: "Đã hoàn thành dự thảo." },
  );
});
