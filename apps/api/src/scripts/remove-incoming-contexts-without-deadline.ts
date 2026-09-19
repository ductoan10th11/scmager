import mongoose from "mongoose";
import { connectDB } from "../configs/mongo";
import {
  DocumentResultLinkModel,
  NotificationModel,
  OfficeDocumentContextModel,
  TaskModel,
  WorkDeclarationModel,
} from "../models";

/**
 * Removes incoming contexts that eOffice ingest stored before the "no due date,
 * no task" rule reached the ingest paths. A context is only deleted when it
 * carries no deadline at all — neither observed nor overridden by a manager —
 * and nothing else in the system points at it. Manually declared tasks are
 * reported but never deleted: that data was typed by a person, so removing it
 * is a decision for the office, not for this script.
 *
 * Dry run by default. Pass --apply to delete.
 */

const idOf = (value: any) => String(value?._id ?? value ?? "");

const emptyText = (value: unknown) =>
  typeof value === "string" ? !value.trim() : value === null || value === undefined;

const main = async () => {
  const apply = process.argv.includes("--apply");
  await connectDB();
  try {
    const candidates: any[] = await OfficeDocumentContextModel.find({
      pageType: "incoming",
      $or: [
        { "observation.dueDate": { $in: [null, ""] } },
        { "observation.dueDate": { $exists: false } },
      ],
    })
      .select(
        "_id origin observedAt observation.soKyHieu observation.subject observation.dueDate management.overrides organizationId",
      )
      .sort({ observedAt: 1 })
      .lean();

    // management.overrides is a Mixed field, so the deadline it may carry is
    // checked here rather than in the query.
    const withoutDeadline = candidates.filter((context) =>
      emptyText(context.management?.overrides?.dueDate),
    );
    const manual = withoutDeadline.filter((context) => context.origin === "MANUAL");
    const ingested = withoutDeadline.filter((context) => context.origin !== "MANUAL");
    const ids = ingested.map((context) => context._id);

    const [declarations, tasks, links] = ids.length
      ? await Promise.all([
        WorkDeclarationModel.find({ sourceDocument: { $in: ids } })
          .select("sourceDocument")
          .lean(),
        TaskModel.find({ sourceDocument: { $in: ids } })
          .select("sourceDocument")
          .lean(),
        DocumentResultLinkModel.find({
          $or: [
            { incomingDocument: { $in: ids } },
            { outgoingDocument: { $in: ids } },
          ],
        })
          .select("incomingDocument outgoingDocument")
          .lean(),
      ])
      : [[], [], []];

    const referenced = new Set<string>([
      ...declarations.map((item: any) => idOf(item.sourceDocument)),
      ...tasks.map((item: any) => idOf(item.sourceDocument)),
      ...links.flatMap((item: any) => [
        idOf(item.incomingDocument),
        idOf(item.outgoingDocument),
      ]),
    ]);

    const removable = ingested.filter((context) => !referenced.has(idOf(context)));
    const kept = ingested.filter((context) => referenced.has(idOf(context)));
    const describe = (context: any) => ({
      id: idOf(context),
      origin: context.origin,
      soKyHieu: String(context.observation?.soKyHieu ?? ""),
      subject: String(context.observation?.subject ?? "").slice(0, 120),
      observedAt: context.observedAt ?? null,
    });

    const summary = {
      apply,
      incomingWithoutDeadline: withoutDeadline.length,
      manualKept: manual.length,
      referencedKept: kept.length,
      removable: removable.length,
      notificationsDeleted: 0,
      contextsDeleted: 0,
      samples: {
        removable: removable.slice(0, 20).map(describe),
        referencedKept: kept.slice(0, 20).map(describe),
        manualKept: manual.slice(0, 20).map(describe),
      },
    };

    if (apply && removable.length) {
      const removableIds = removable.map((context) => context._id);
      const notifications = await NotificationModel.deleteMany({
        relatedModel: "IncomingDocument",
        relatedId: { $in: removableIds },
      });
      const deleted = await OfficeDocumentContextModel.deleteMany({
        _id: { $in: removableIds },
        pageType: "incoming",
        origin: { $ne: "MANUAL" },
      });
      summary.notificationsDeleted = notifications.deletedCount ?? 0;
      summary.contextsDeleted = deleted.deletedCount ?? 0;
    }

    console.log(JSON.stringify(summary, null, 2));
    if (!apply && removable.length) {
      console.log("Dry run. Chạy lại với --apply để xoá.");
    }
  } finally {
    await mongoose.disconnect();
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
