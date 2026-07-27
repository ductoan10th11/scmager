import 'dotenv/config';
import fs from 'node:fs/promises';
import { isValidObjectId } from 'mongoose';
import { connectDB } from '../configs/mongo';
import DocumentModel from '../models/document.model';
import OutgoingDocumentModel from '../models/outgoing-document.model';
import MigrationQuarantineModel from '../models/migration-quarantine.model';

type VerifiedScope = { collection: 'Document' | 'OutgoingDocument'; legacyId: string; organizationId: string; connectorId: string; sourceSystem: string; externalSourceId: string };
const apply = process.argv.includes('--apply');
const scopeFile = process.env.TENANT_SCOPE_BACKFILL_FILE;

const readScopes = async (): Promise<VerifiedScope[]> => {
  if (!scopeFile) return [];
  const parsed = JSON.parse(await fs.readFile(scopeFile, 'utf8')) as unknown;
  if (!Array.isArray(parsed)) throw new Error('TENANT_SCOPE_BACKFILL_FILE must contain an array.');
  return parsed.map((item) => item as VerifiedScope).filter((item) => (
    ['Document', 'OutgoingDocument'].includes(item.collection)
    && [item.legacyId, item.organizationId, item.connectorId].every(isValidObjectId)
    && Boolean(item.sourceSystem?.trim()) && Boolean(item.externalSourceId?.trim())
  ));
};

const migrate = async (): Promise<void> => {
  await connectDB();
  const scopes = await readScopes();
  const [documents, outgoing] = await Promise.all([
    DocumentModel.find({ organizationId: null }).select('_id').lean(),
    OutgoingDocumentModel.find({ organizationId: null }).select('_id').lean(),
  ]);
  const known = new Set(scopes.map((scope) => `${scope.collection}:${scope.legacyId}`));
  const quarantine = [
    ...documents.filter((doc) => !known.has(`Document:${doc._id}`)).map((doc) => ({ collection: 'Document' as const, legacyId: doc._id, reasonCode: 'UNVERIFIED_TENANT_SCOPE' })),
    ...outgoing.filter((doc) => !known.has(`OutgoingDocument:${doc._id}`)).map((doc) => ({ collection: 'OutgoingDocument' as const, legacyId: doc._id, reasonCode: 'UNVERIFIED_TENANT_SCOPE' })),
  ];
  console.log(JSON.stringify({ dryRun: !apply, verifiedScopeRows: scopes.length, quarantineRows: quarantine.length }));
  if (!apply) return;
  if (process.env.P3_MIGRATION_APPROVED !== 'true') throw new Error('P3_MIGRATION_APPROVED=true is required for --apply.');
  // Mongoose creates the new compound partial indexes but never removes this
  // historical global uniqueness constraint. Remove it only in the approved
  // cutover, after the dry-run has identified every unscoped row.
  for (const Model of [DocumentModel, OutgoingDocumentModel]) {
    try {
      await Model.collection.dropIndex('documentId_1');
    } catch (error: any) {
      if (error?.codeName !== 'IndexNotFound' && error?.code !== 27) throw error;
    }
  }
  for (const scope of scopes) {
    const Model = scope.collection === 'Document' ? DocumentModel : OutgoingDocumentModel;
    await Model.updateOne({ _id: scope.legacyId, organizationId: null }, { $set: {
      organizationId: scope.organizationId, connectorId: scope.connectorId,
      sourceSystem: scope.sourceSystem, externalSourceId: scope.externalSourceId,
    } });
  }
  if (quarantine.length) await MigrationQuarantineModel.bulkWrite(quarantine.map((item) => ({ updateOne: {
    filter: { collection: item.collection, legacyId: item.legacyId }, update: { $setOnInsert: item }, upsert: true,
  } })));
};

migrate().catch((error) => { console.error('Tenant-scope migration failed:', error instanceof Error ? error.message : 'unknown error'); process.exit(1); });
