import OutgoingDocumentModel from '../models/outgoing-document.model';
import { randomUUID } from 'node:crypto';
import type { RelatedDocumentResult, TrackLogItem } from '../services/langson-dwr.service';

const toStoredTrackLog = (log: TrackLogItem) => ({
  sender: { username: log.sender.username, fullName: log.sender.fullName },
  content: log.content,
  receivedAt: log.receivedAt,
  processingAt: log.processingAt,
  completedAt: log.completedAt,
  updatedAt: log.updatedAt ?? null,
});

const toOutgoingDocument = (related: RelatedDocumentResult, sourceDocument: any, now: Date) => ({
  documentId: related.documentId,
  soKyHieu: related.symbol ?? '',
  trichYeu: related.summary ?? '',
  ngayBanHanh: related.detail.issuedDate ?? related.documentDate ?? '',
  doKhan: related.detail.priority ?? '',
  nguoiSoan: related.detail.drafter.fullName ?? '',
  nguoiKy: related.detail.signer.fullName ?? '',
  trackLogs: related.trackLogs.map(toStoredTrackLog),
  ingest: { source: 'LANGSON_DWR', fetchedAt: now },
  sourceDocument: sourceDocument._id,
  sourceDocumentId: sourceDocument.documentId,
});

export const outgoingDocumentRepository = {
  async upsertExtensionItem(
    item: {
      soKyHieu: string;
      trichYeu: string;
      ngayBanHanh: string;
      doKhan: string;
      nguoiSoan: string;
      nguoiKy: string;
      trackLogs: ReturnType<typeof toStoredTrackLog>[];
    },
    now = new Date(),
  ) {
    const before = await OutgoingDocumentModel.exists({ soKyHieu: item.soKyHieu });
    const doc = await OutgoingDocumentModel.findOneAndUpdate(
      { soKyHieu: item.soKyHieu },
      {
        $set: {
          trichYeu: item.trichYeu,
          ngayBanHanh: item.ngayBanHanh,
          doKhan: item.doKhan,
          nguoiSoan: item.nguoiSoan,
          nguoiKy: item.nguoiKy,
          trackLogs: item.trackLogs,
          ingest: { source: 'EXTENSION', fetchedAt: now },
        },
        $setOnInsert: {
          documentId: randomUUID(),
          sourceDocuments: [],
          sourceDocumentIds: [],
        },
      },
      { returnDocument: 'after', setDefaultsOnInsert: true, upsert: true },
    );
    return { doc, inserted: !before };
  },

  async syncForIncoming(sourceDocument: any, relatedDocuments: RelatedDocumentResult[], now = new Date()) {
    // DWR returns all related records. Only outgoing records with an actual
    // tracklog are meaningful response documents and may be persisted.
    const outgoing = relatedDocuments.filter((item) => (
      item.documentDirection === 'outgoing' && item.trackLogs.length > 0
    ));
    const currentIds = outgoing.map((item) => item.documentId);

    await OutgoingDocumentModel.updateMany(
      { sourceDocuments: sourceDocument._id, documentId: { $nin: currentIds } },
      { $pull: { sourceDocuments: sourceDocument._id, sourceDocumentIds: sourceDocument.documentId } },
    );
    await OutgoingDocumentModel.deleteMany({ sourceDocuments: { $size: 0 } });

    if (outgoing.length) {
      await OutgoingDocumentModel.bulkWrite(outgoing.map((related) => {
        const value = toOutgoingDocument(related, sourceDocument, now);
        return {
          updateOne: {
            filter: { documentId: related.documentId },
            update: {
              $set: {
                soKyHieu: value.soKyHieu,
                trichYeu: value.trichYeu,
                ngayBanHanh: value.ngayBanHanh,
                doKhan: value.doKhan,
                nguoiSoan: value.nguoiSoan,
                nguoiKy: value.nguoiKy,
                trackLogs: value.trackLogs,
                ingest: value.ingest,
              },
              $addToSet: {
                sourceDocuments: value.sourceDocument,
                sourceDocumentIds: value.sourceDocumentId,
              },
            },
            upsert: true,
          },
        };
      }));
    }

    sourceDocument.set('ingest.outgoingDocumentsFetchedAt', now);
    sourceDocument.set('ingest.outgoingDocumentCount', outgoing.length);
    await sourceDocument.save();
    return outgoing.length;
  },

  findById(id: string) {
    return OutgoingDocumentModel.findById(id).lean();
  },

  findByDocumentId(documentId: string) {
    return OutgoingDocumentModel.findOne({ documentId }).lean();
  },
};
