import DocumentModel from '../models/document.model';
import { randomUUID } from 'node:crypto';
import type {
  DocumentListItem,
  TrackLogItem,
} from '../services/langson-dwr.service';

export interface DocumentEnrichmentUpdate {
  trackLogs: TrackLogItem[];
  completed: boolean;
  completedRule: string;
  point: number;
  processing: Record<string, unknown>;
  now?: Date;
}

export interface DocumentListOptions {
  filter: Record<string, unknown>;
  skip: number;
  limit: number;
  sort: Record<string, 1 | -1>;
}

export type ExtensionIncomingDocumentItem = Omit<DocumentListItem, 'documentId'>;

const toStoredTrackLog = (log: TrackLogItem) => ({
  sender: { username: log.sender.username, fullName: log.sender.fullName },
  content: log.content,
  receivedAt: log.receivedAt,
  processingAt: log.processingAt,
  completedAt: log.completedAt,
  updatedAt: log.updatedAt ?? null,
});

export const documentRepository = {
  async upsertListItem(
    item: DocumentListItem,
    now = new Date(),
    source: 'LANGSON_DWR' | 'EXTENSION' = 'LANGSON_DWR',
  ) {
    const update = {
      $set: {
        soKyHieu: item.soKyHieu,
        trichYeu: item.trichYeu,
        ngayDen: item.ngayDen,
        doKhan: item.doKhan,
        nguoiXuLy: item.nguoiXuLy,
        deadline: item.deadline,
        'ingest.listFetchedAt': now,
        'ingest.lastError': '',
      },
      $setOnInsert: {
        documentId: item.documentId,
        point: 0,
        processing: { status: 'UNASSIGNED', currentAssignee: null, assignees: [] },
        trackLogs: [],
        'ingest.source': source,
        'ingest.trackLogFetchedAt': null,
        'ingest.outgoingDocumentsFetchedAt': null,
        'ingest.outgoingDocumentCount': 0,
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

  async upsertExtensionListItem(item: ExtensionIncomingDocumentItem, now = new Date()) {
    const update = {
      $set: {
        soKyHieu: item.soKyHieu,
        trichYeu: item.trichYeu,
        ngayDen: item.ngayDen,
        doKhan: item.doKhan,
        nguoiXuLy: item.nguoiXuLy,
        deadline: item.deadline,
        'ingest.listFetchedAt': now,
        'ingest.lastError': '',
      },
      $setOnInsert: {
        documentId: randomUUID(),
        point: 0,
        processing: { status: 'UNASSIGNED', currentAssignee: null, assignees: [] },
        trackLogs: [],
        'ingest.source': 'EXTENSION',
        'ingest.trackLogFetchedAt': now,
        'ingest.outgoingDocumentsFetchedAt': now,
        'ingest.outgoingDocumentCount': 0,
        'ingest.completed': false,
        'ingest.completedRule': '',
        'ingest.attempts': 0,
        'ingest.lastAttemptAt': now,
        'ingest.nextRetryAt': null,
        'ingest.deadLetter': false,
        'ingest.deadLetterAt': null,
        'ingest.deadLetterReason': '',
      },
    };

    const before = await DocumentModel.exists({ soKyHieu: item.soKyHieu });
    const doc = await DocumentModel.findOneAndUpdate({ soKyHieu: item.soKyHieu }, update, {
      returnDocument: 'after',
      setDefaultsOnInsert: true,
      upsert: true,
    });

    return { doc, inserted: !before };
  },

  findPendingForEnrichment(year: string, month: string, now = new Date()) {
    const monthStart = new Date(Date.UTC(Number(year), Number(month) - 1, 1));
    const monthEnd = new Date(Date.UTC(Number(year), Number(month), 1));
    return DocumentModel.find({
      'ingest.listFetchedAt': { $gte: monthStart, $lt: monthEnd },
      'ingest.source': { $ne: 'EXTENSION' },
      'ingest.deadLetter': { $ne: true },
      $and: [
        {
          $or: [
            { 'ingest.completed': { $ne: true } },
            { 'ingest.trackLogFetchedAt': null },
            { 'ingest.trackLogFetchedAt': { $exists: false } },
            { 'ingest.outgoingDocumentsFetchedAt': null },
            { 'ingest.outgoingDocumentsFetchedAt': { $exists: false } },
          ],
        },
        {
          $or: [
            { 'ingest.nextRetryAt': null },
            { 'ingest.nextRetryAt': { $exists: false } },
            { 'ingest.nextRetryAt': { $lte: now } },
          ],
        },
      ],
    })
      .sort({ 'ingest.lastAttemptAt': 1, updatedAt: 1 });
  },

  findLatestBySoKyHieu(soKyHieu: string) {
    return DocumentModel.findOne({ soKyHieu })
      .select('soKyHieu point updatedAt')
      .sort({ updatedAt: -1 })
      .lean();
  },

  findWithoutOutgoingRelations(now = new Date()) {
    return DocumentModel.find({
      'ingest.source': { $ne: 'EXTENSION' },
      'ingest.deadLetter': { $ne: true },
      $and: [
        {
          $or: [
            { 'ingest.outgoingDocumentsFetchedAt': null },
            { 'ingest.outgoingDocumentsFetchedAt': { $exists: false } },
          ],
        },
        {
          $or: [
            { 'ingest.nextRetryAt': null },
            { 'ingest.nextRetryAt': { $exists: false } },
            { 'ingest.nextRetryAt': { $lte: now } },
          ],
        },
      ],
    })
      .sort({ deadline: -1, updatedAt: 1 });
  },

  async markEnriched(documentId: string, update: DocumentEnrichmentUpdate) {
    const now = update.now ?? new Date();
    const existing = await DocumentModel.findOne({ documentId });
    if (!existing) return null;

    existing.trackLogs = update.trackLogs.map(toStoredTrackLog) as any;
    existing.point = update.point;
    const manual = (existing as any).processing?.manual?.processedAt
      ? (existing as any).processing.manual.toObject?.() ?? (existing as any).processing.manual
      : null;
    existing.set('processing', manual
      ? { ...update.processing, status: 'MANUALLY_PROCESSED', currentAssignee: null, manual }
      : update.processing);

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

  findRawByDocumentId(documentId: string) {
    return DocumentModel.findOne({ documentId });
  },
};
