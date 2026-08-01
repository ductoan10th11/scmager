import mongoose from "mongoose";
import { connectDB } from "../configs/mongo";
import {
  DocumentResultLinkModel,
  NotificationModel,
} from "../models";

const main = async () => {
  await connectDB();
  try {
    const links = await DocumentResultLinkModel.find({
      incomingDocument: null,
    })
      .select("_id outgoingDocument status submittedBy performedBy createdAt")
      .lean();
    const ids = links.map((link: any) => link._id);
    if (!ids.length) {
      console.log(JSON.stringify({
        selected: 0,
        notificationsDeleted: 0,
        linksDeleted: 0,
      }));
      return;
    }
    const notifications = await NotificationModel.deleteMany({
      relatedModel: "DocumentResultLink",
      relatedId: { $in: ids },
    });
    const removed = await DocumentResultLinkModel.deleteMany({
      _id: { $in: ids },
      incomingDocument: null,
    });
    console.log(JSON.stringify({
      selected: links.length,
      notificationsDeleted: notifications.deletedCount,
      linksDeleted: removed.deletedCount,
    }));
  } finally {
    await mongoose.disconnect();
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
