import assert from "node:assert/strict";
import test from "node:test";
import OfficeDocumentContextModel from "../models/office-document-context.model";
import {
  outgoingPublishedFilter,
  parseOutgoingDocumentListHtml,
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
