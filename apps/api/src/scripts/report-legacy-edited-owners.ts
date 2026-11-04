import mongoose from "mongoose";
import { getRuntimeConfig } from "../configs/runtime-config";
import OfficeDocumentContextModel from "../models/office-document-context.model";
import { loadOfficeDocumentOwnerDirectory } from "../services/office-document-owner-directory.service";
import {
  effectiveOfficeDocumentOwner,
  type OfficeDocumentOwnerDirectory,
} from "../services/office-document-owner.service";

/**
 * Read-only. Lists incoming documents that were edited before assignmentMode
 * existed and whose assignment differs from the first specialist in the routing.
 * They keep their current owner until a leader decides, so this is the review
 * list: some were real reassignments, others only a score edit that moved the
 * document to its leader. CSV goes to stdout; anything else goes to stderr.
 *
 *   tsx src/scripts/report-legacy-edited-owners.ts > legacy-owners.csv
 */

const idOf = (value: any) => String(value?._id ?? value ?? "");

const COLUMNS = [
  "soKyHieu",
  "externalDocumentId",
  "currentOwnerId",
  "currentOwner",
  "primaryAssigneeId",
  "primaryAssignee",
  "updatedById",
  "updatedBy",
  "updatedAt",
] as const;

const csvCell = (value: unknown) => {
  const text = String(value ?? "");
  // A leading formula character would run when the file is opened in Excel.
  const safe = /^[=+\-@\t\r]/u.test(text) ? `'${text}` : text;
  return /[",\r\n]/u.test(safe) ? `"${safe.replace(/"/gu, '""')}"` : safe;
};

export const isLegacyEditedOwnerRow = (context: any) => {
  const primaryId = idOf(context.statusSync?.processing?.primaryAssignee?.userId);
  return context.pageType === "incoming"
    && Boolean(context.management?.updatedBy)
    && (context.management?.assignmentMode ?? null) === null
    && Boolean(primaryId)
    && primaryId !== idOf(context.management?.assignment?.userId);
};

export const legacyEditedOwnersCsv = (
  contexts: any[],
  directory: OfficeDocumentOwnerDirectory = new Map(),
) => {
  const rows = contexts.filter(isLegacyEditedOwnerRow).map((context) => {
    const owner = effectiveOfficeDocumentOwner(context, { directory });
    const primary = context.statusSync.processing.primaryAssignee;
    const updatedById = idOf(context.management.updatedBy);
    const updatedAt = context.management.updatedAt;
    return [
      context.management?.overrides?.soKyHieu ?? context.observation?.soKyHieu ?? "",
      context.externalDocumentId,
      owner.userId,
      owner.fullName,
      idOf(primary.userId),
      primary.fullName ?? "",
      updatedById,
      directory.get(updatedById)?.fullName ?? "",
      updatedAt ? new Date(updatedAt).toISOString() : "",
    ].map(csvCell).join(",");
  });
  return [COLUMNS.join(","), ...rows].join("\n");
};

const main = async () => {
  await import("dotenv/config");
  // connectDB logs to stdout, which would corrupt the CSV, and the automatic
  // index and collection builds would make this script write.
  await mongoose.connect(getRuntimeConfig().mongoUri, {
    autoIndex: false,
    autoCreate: false,
  });
  try {
    const contexts = await OfficeDocumentContextModel.find({
      pageType: "incoming",
      "management.updatedBy": { $ne: null },
      "management.assignmentMode": null,
      "statusSync.processing.primaryAssignee.userId": { $ne: null },
    })
      .select("pageType externalDocumentId observation.soKyHieu statusSync.completed statusSync.processing management")
      .sort({ "management.updatedAt": -1 })
      .lean();
    const directory = await loadOfficeDocumentOwnerDirectory({});
    process.stdout.write(`${legacyEditedOwnersCsv(contexts, directory)}\n`);
  } finally {
    await mongoose.disconnect();
  }
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
