import { writeFile } from "node:fs/promises";
import { EJSON } from "bson";
import mongoose from "mongoose";
import { connectDB } from "../configs/mongo";

const collections = [
  "documents",
  "outgoingdocuments",
  "incomingdocuments",
  "officedocumentcontexts",
  "tasks",
  "workdeclarations",
  "auditlogs",
];

const main = async () => {
  const output = process.env.BACKUP_OUTPUT;
  if (!output) throw new Error("BACKUP_OUTPUT is required.");

  await connectDB();
  try {
    const db = mongoose.connection.db;
    if (!db) throw new Error("MongoDB database is not available.");
    const snapshot: { createdAt: Date; collections: Record<string, unknown[]> } = {
      createdAt: new Date(),
      collections: {},
    };
    for (const name of collections) {
      snapshot.collections[name] = await db.collection(name).find({}).toArray();
    }
    await writeFile(output, EJSON.stringify(snapshot, null, 2), "utf8");
    console.log(
      JSON.stringify(
        Object.fromEntries(
          Object.entries(snapshot.collections).map(([name, items]) => [name, items.length]),
        ),
      ),
    );
  } finally {
    await mongoose.disconnect();
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
