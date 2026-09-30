import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import OfficeDocumentContextModel from '../models/office-document-context.model';
import MigrationQuarantineModel from '../models/migration-quarantine.model';
import OrganizationModel from '../models/organization.model';

dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });
dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/scmager';

export async function migrateTenantScope() {
  console.log('[Migration] Connecting to MongoDB:', MONGODB_URI);
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(MONGODB_URI);
  }
  console.log('[Migration] Connected successfully.');

  try {
    const defaultOrg = await OrganizationModel.findOne({ isActive: true }).lean();
    const defaultOrgId = defaultOrg?._id ? String(defaultOrg._id) : null;

    let docScoped = 0;
    let docQuarantined = 0;

    // Process unscoped OfficeDocumentContext records
    const unScopedDocs = await OfficeDocumentContextModel.find({
      $or: [{ organizationId: null }, { organizationId: { $exists: false } }],
    });

    console.log(`[Migration] Found ${unScopedDocs.length} unscoped OfficeDocumentContext records.`);

    for (const doc of unScopedDocs) {
      if (defaultOrgId) {
        doc.organizationId = defaultOrgId as any;
        await doc.save();
        docScoped++;
      } else {
        await MigrationQuarantineModel.updateOne(
          { collection: 'OfficeDocumentContext', legacyId: doc._id },
          {
            $setOnInsert: {
              collection: 'OfficeDocumentContext',
              legacyId: doc._id,
              reasonCode: 'UNSCOPED_TENANT',
            },
          },
          { upsert: true },
        );
        docQuarantined++;
      }
    }

    console.log(`[Migration Completed]
      OfficeDocumentContext: ${docScoped} scoped, ${docQuarantined} quarantined.
    `);

    return { scoped: docScoped, quarantined: docQuarantined };
  } catch (error) {
    console.error('[Migration Failed]:', error);
    throw error;
  }
}

if (require.main === module) {
  migrateTenantScope()
    .then(async () => {
      await mongoose.disconnect();
      console.log('[Migration] Disconnected from MongoDB.');
    })
    .catch(async (err) => {
      console.error(err);
      await mongoose.disconnect();
      process.exit(1);
    });
}
