import DocumentModel from '../models/document.model';
import type {
  DocDetailResult,
  DocumentListItem,
  TrackLogItem,
} from '../services/langson-dwr.service';

export interface DocumentEnrichmentUpdate {
  detail: DocDetailResult;
  trackLogs: TrackLogItem[];
  completed: boolean;
  completedRule: string;
  point: number | null;
  pointSource: { trackLogId: string; comment: string } | null;
  processing: Record<string, unknown>;
  now?: Date;
}

export interface DocumentListOptions {
  filter: Record<string, unknown>;
  skip: number;
  limit: number;
  sort: Record<string, 1 | -1>;
}

function preferNewValue(next: string, current?: string): string {
  return next.trim() ? next : (current ?? '');
}

export const documentRepository = {
  async upsertListItem(item: DocumentListItem, now = new Date()) {
    const update = {
      $set: {
        processKey: item.processKey,
        soDen: item.soDen,
        soKyHieu: item.soKyHieu,
        trichYeu: item.trichYeu,
        donViBanHanh: item.donViBanHanh,
        hinhThuc: item.hinhThuc,
        ngayVanBan: item.ngayVanBan,
        ngayDen: item.ngayDen,
        doKhan: item.doKhan,
        doMat: item.doMat,
        nguoiXuLy: item.nguoiXuLy,
        trangThai: item.trangThai,
        deadline: item.deadline,
        'ingest.listFetchedAt': now,
        'ingest.lastError': '',
      },
      $setOnInsert: {
        documentId: item.documentId,
        point: 0,
        pointSource: { trackLogId: null, comment: null, extractedAt: null },
        processing: { status: 'UNASSIGNED', currentAssignee: null, assignees: [] },
        trackLogs: [],
        'ingest.source': 'LANGSON_DWR',
        'ingest.detailFetchedAt': null,
        'ingest.trackLogFetchedAt': null,
        'ingest.completed': false,
        'ingest.completedRule': '',
        'ingest.attempts': 0,
        'ingest.lastAttemptAt': null,
        'ingest.nextRetryAt': null,
        'ingest.deadLetter': false,
        'ingest.deadLetterAt': null,
        'ingest.deadLetterReason': '',
      },
    };

    const before = await DocumentModel.exists({ documentId: item.documentId });
    const doc = await DocumentModel.findOneAndUpdate({ documentId: item.documentId }, update, {
      returnDocument: 'after',
      setDefaultsOnInsert: true,
      upsert: true,
    });

    return { doc, inserted: !before };
  },

  findPendingForEnrichment(ngayDenValues: string[], now = new Date()) {
    if (ngayDenValues.length === 0) return DocumentModel.find({ _id: null });

    return DocumentModel.find({
      ngayDen: { $in: ngayDenValues },
      deadline: { $ne: null },
      'ingest.completed': { $ne: true },
      'ingest.deadLetter': { $ne: true },
      $or: [
        { 'ingest.nextRetryAt': null },
        { 'ingest.nextRetryAt': { $exists: false } },
        { 'ingest.nextRetryAt': { $lte: now } },
      ],
    })
      .sort({ 'ingest.lastAttemptAt': 1, updatedAt: 1 });
  },

  async markEnriched(documentId: string, update: DocumentEnrichmentUpdate) {
    const now = update.now ?? new Date();
    const existing = await DocumentModel.findOne({ documentId });
    if (!existing) return null;

    existing.soDen = preferNewValue(update.detail.soDen, existing.soDen);
    existing.soKyHieu = preferNewValue(update.detail.soKyHieu, existing.soKyHieu);
    existing.trichYeu = preferNewValue(update.detail.trichYeu, existing.trichYeu);
    existing.donViBanHanh = preferNewValue(update.detail.donViBanHanh, existing.donViBanHanh);
    existing.hinhThuc = preferNewValue(update.detail.hinhThuc, existing.hinhThuc);
    existing.ngayVanBan = preferNewValue(update.detail.ngayVanBan, existing.ngayVanBan);
    existing.ngayDen = preferNewValue(update.detail.ngayDen, existing.ngayDen);
    existing.doKhan = preferNewValue(update.detail.doKhan, existing.doKhan);
    existing.doMat = preferNewValue(update.detail.doMat, existing.doMat);
    existing.nguoiSoan = preferNewValue(update.detail.nguoiSoan, existing.nguoiSoan);
    existing.nguoiKy = preferNewValue(update.detail.nguoiKy, existing.nguoiKy);
    existing.trackLogs = update.trackLogs as any;
    existing.point = update.point;
    existing.set('pointSource', update.pointSource
      ? { ...update.pointSource, extractedAt: now }
      : { trackLogId: null, comment: null, extractedAt: null });
    const manual = (existing as any).processing?.manual?.processedAt
      ? (existing as any).processing.manual.toObject?.() ?? (existing as any).processing.manual
      : null;
    existing.set('processing', manual
      ? { ...update.processing, status: 'MANUALLY_PROCESSED', currentAssignee: null, manual }
      : update.processing);

    existing.set('ingest.detailFetchedAt', now);
    existing.set('ingest.trackLogFetchedAt', now);
    existing.set('ingest.completed', update.completed);
    existing.set('ingest.completedRule', update.completed ? update.completedRule : '');
    existing.set('ingest.attempts', 0);
    existing.set('ingest.lastAttemptAt', now);
    existing.set('ingest.nextRetryAt', null);
    existing.set('ingest.lastError', '');
    existing.set('ingest.deadLetter', false);
    existing.set('ingest.deadLetterAt', null);
    existing.set('ingest.deadLetterReason', '');

    return existing.save();
  },

  markEnrichFailed(
    documentId: string,
    error: unknown,
    nextRetryAt: Date,
    now = new Date(),
    deadLetter = false,
  ) {
    const message = error instanceof Error ? error.message : String(error);
    return DocumentModel.updateOne(
      { documentId },
      {
        $inc: { 'ingest.attempts': 1 },
        $set: {
          'ingest.lastAttemptAt': now,
          'ingest.nextRetryAt': deadLetter ? null : nextRetryAt,
          'ingest.lastError': message.slice(0, 1000),
          'ingest.deadLetter': deadLetter,
          'ingest.deadLetterAt': deadLetter ? now : null,
          'ingest.deadLetterReason': deadLetter ? message.slice(0, 1000) : '',
        },
      },
    );
  },

  count(filter: Record<string, unknown>) {
    return DocumentModel.countDocuments(filter);
  },

  list(options: DocumentListOptions) {
    return DocumentModel.find(options.filter)
      .sort(options.sort)
      .skip(options.skip)
      .limit(options.limit)
      .lean();
  },

  findById(id: string) {
    return DocumentModel.findById(id).lean();
  },

  findRawById(id: string) {
    return DocumentModel.findById(id);
  },

  save(document: any) {
    return document.save();
  },

  findByDocumentId(documentId: string) {
    return DocumentModel.findOne({ documentId }).lean();
  },
};
