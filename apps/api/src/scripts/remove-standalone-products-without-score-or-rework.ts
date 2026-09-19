import mongoose from "mongoose";
import { connectDB } from "../configs/mongo";
import {
  DocumentResultLinkModel,
  NotificationModel,
  OfficeDocumentContextModel,
  TaskModel,
  WorkDeclarationModel,
} from "../models";
import {
  effectiveOfficeDocumentReworkCount,
  rawOfficeDocumentPoint,
} from "../services/office-document-completion.service";

/**
 * Removes outgoing product contexts that are standalone (unlinked to any incoming task)
 * and carry no score and no rework count.
 *
 * Dry run by default. Pass --apply to delete.
 */

const idOf = (value: any) => String(value?._id ?? value ?? "");

const emptyText = (value: unknown) =>
  typeof value === "string" ? !value.trim() : value === null || value === undefined;

const main = async () => {
  const apply = process.argv.includes("--apply");
  if (process.env.MONGO_URI?.includes("@mongodb:")) {
    try {
      const dns = await import("node:dns/promises");
      await dns.lookup("mongodb");
    } catch {
      process.env.MONGO_URI = process.env.MONGO_URI.replace("@mongodb:8000", "@127.0.0.1:9006");
    }
  }
  await connectDB();
  try {
    const candidates: any[] = await OfficeDocumentContextModel.find({
      pageType: { $in: ["outgoing", "outgoing_c2"] },
      $and: [
        {
          $or: [
            { "observation.relatedIncomingSoKyHieu": { $in: [null, ""] } },
            { "observation.relatedIncomingSoKyHieu": { $exists: false } },
          ],
        },
        {
          $or: [
            { "management.product.classification": { $ne: "LINKED_RESULT" } },
            { "management.product.classification": { $exists: false } },
          ],
        },
      ],
    })
      .select(
        "_id origin pageType observedAt observation.soKyHieu observation.subject observation.point observation.reworkCount observation.relatedIncomingSoKyHieu management.manualScore management.overrides management.product management.businessCompletion organizationId",
      )
      .sort({ observedAt: 1 })
      .lean();

    // Filter down to records that genuinely have no related incoming task,
    // no score, and no rework count.
    const standaloneWithoutScoreOrRework = candidates.filter((context) => {
      const hasRelatedSymbol = !emptyText(context.management?.overrides?.relatedIncomingSoKyHieu)
        || !emptyText(context.observation?.relatedIncomingSoKyHieu);
      if (hasRelatedSymbol) return false;

      const isLinkedResult = context.management?.product?.classification === "LINKED_RESULT";
      if (isLinkedResult) return false;

      const hasPoint = rawOfficeDocumentPoint(context) !== null
        || context.management?.product?.scoreStatus === "APPROVED";
      if (hasPoint) return false;

      const hasRework = effectiveOfficeDocumentReworkCount(context) > 0;
      if (hasRework) return false;

      return true;
    });

    const manual = standaloneWithoutScoreOrRework.filter((context) => context.origin === "MANUAL");
    const ingested = standaloneWithoutScoreOrRework.filter((context) => context.origin !== "MANUAL");
    const ids = standaloneWithoutScoreOrRework.map((context) => context._id);

    const [declarations, tasks, links] = ids.length
      ? await Promise.all([
        WorkDeclarationModel.find({ sourceDocument: { $in: ids } })
          .select("sourceDocument")
          .lean(),
        TaskModel.find({ sourceDocument: { $in: ids } })
          .select("sourceDocument")
          .lean(),
        DocumentResultLinkModel.find({
          outgoingDocument: { $in: ids },
          status: { $ne: "REJECTED" },
        })
          .select("incomingDocument outgoingDocument status")
          .lean(),
      ])
      : [[], [], []];

    const referenced = new Set<string>([
      ...declarations.map((item: any) => idOf(item.sourceDocument)),
      ...tasks.map((item: any) => idOf(item.sourceDocument)),
      ...links.map((item: any) => idOf(item.outgoingDocument)),
    ]);

    const removable = standaloneWithoutScoreOrRework.filter((context) => !referenced.has(idOf(context)));
    const kept = standaloneWithoutScoreOrRework.filter((context) => referenced.has(idOf(context)));

    const describe = (context: any) => ({
      id: idOf(context),
      origin: context.origin,
      pageType: context.pageType,
      soKyHieu: String(context.observation?.soKyHieu ?? ""),
      subject: String(context.observation?.subject ?? "").slice(0, 120),
      observedAt: context.observedAt ?? null,
      classification: context.management?.product?.classification ?? "STANDALONE_PRODUCT",
      score: rawOfficeDocumentPoint(context),
      reworkCount: effectiveOfficeDocumentReworkCount(context),
    });

    const summary: Record<string, unknown> = {
      apply,
      totalStandaloneWithoutScoreOrRework: standaloneWithoutScoreOrRework.length,
      manualKept: manual.length,
      referencedKept: kept.length,
      removable: removable.length,
      notificationsDeleted: 0,
      contextsDeleted: 0,
      samples: {
        removable: removable.slice(0, 20).map(describe),
        referenced: kept.slice(0, 10).map(describe),
      },
    };

    if (apply && removable.length > 0) {
      const removableIds = removable.map((c) => c._id);
      const [contextsResult, notificationsResult] = await Promise.all([
        OfficeDocumentContextModel.deleteMany({ _id: { $in: removableIds } }),
        NotificationModel.deleteMany({
          relatedModel: "OfficeDocumentContext",
          relatedId: { $in: removableIds },
        }),
      ]);
      summary.contextsDeleted = contextsResult.deletedCount;
      summary.notificationsDeleted = notificationsResult.deletedCount;
    }

    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await mongoose.disconnect();
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
