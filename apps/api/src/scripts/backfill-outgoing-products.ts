import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import mongoose from "mongoose";
import { connectDB } from "../configs/mongo";
import OfficeDocumentContextModel from "../models/office-document-context.model";
import { syncCurrentYearOutgoingProducts } from "../services/outgoing-product-reconciliation.service";

const currentVietnamYear = () => Number(
  new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
  }).format(new Date()),
);

const main = async () => {
  const apply = process.argv.includes("--apply");
  const yearArgument = process.argv.find((value) => /^--year=\d{4}$/u.test(value));
  const year = yearArgument ? Number(yearArgument.split("=")[1]) : currentVietnamYear();
  await connectDB();
  try {
    let backupPath: string | null = null;
    if (apply) {
      const backupDirectory = path.resolve(process.cwd(), "backups");
      await mkdir(backupDirectory, { recursive: true });
      backupPath = path.join(
        backupDirectory,
        `outgoing-products-${year}-${new Date().toISOString().replace(/[:.]/gu, "-")}.json`,
      );
      const products = await OfficeDocumentContextModel.find({
        pageType: { $in: ["outgoing", "outgoing_c2"] },
      }).lean();
      await writeFile(backupPath, JSON.stringify(products, null, 2), {
        encoding: "utf8",
        mode: 0o600,
      });
    }
    const summary = await syncCurrentYearOutgoingProducts({
      year,
      dryRun: !apply,
    });
    console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", backupPath, summary }, null, 2));
    if (summary.failed) process.exitCode = 2;
  } finally {
    await mongoose.disconnect();
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
