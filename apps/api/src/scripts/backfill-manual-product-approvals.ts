import mongoose from "mongoose";
import { connectDB } from "../configs/mongo";
import {
  DocumentResultLinkModel,
  OfficeDocumentContextModel,
  UserModel,
} from "../models";
import { createDocumentResultLinkService } from "../services/document-result-link.service";
import type { AuthUser } from "../types/auth";

const idOf = (value: any) => String(value?._id ?? value ?? "");

const actorFromUser = (user: any): AuthUser => ({
  id: idOf(user),
  email: String(user.email ?? ""),
  username: String(user.username ?? ""),
  fullName: String(user.fullName ?? ""),
  position: user.position ?? null,
  role: {
    id: idOf(user.role),
    code: String(user.role?.code ?? ""),
    name: String(user.role?.name ?? ""),
    level: Number(user.role?.level ?? 0),
  },
  organization: idOf(user.organization) || null,
  department: idOf(user.department) || null,
  status: String(user.status ?? ""),
});

const main = async () => {
  await connectDB();
  try {
    const products: any[] = await OfficeDocumentContextModel.find({
      origin: "MANUAL",
      pageType: { $in: ["outgoing", "outgoing_c2"] },
      organizationId: { $ne: null },
      "observation.soKyHieu": { $type: "string", $ne: "" },
      "observation.createdDate": { $type: "string", $ne: "" },
      "management.assignment.userId": { $ne: null },
    })
      .select(
        "_id organizationId observation management.assignment management.updatedBy",
      )
      .sort({ createdAt: 1 })
      .lean();
    const existing = await DocumentResultLinkModel.find({
      outgoingDocument: { $in: products.map((product) => product._id) },
    })
      .select("outgoingDocument")
      .lean();
    const linked = new Set(
      existing.map((link: any) => idOf(link.outgoingDocument)),
    );
    const summary = {
      selected: products.length,
      drafterBackfilled: 0,
      independentProducts: 0,
      alreadyLinked: 0,
      created: 0,
      approved: 0,
      pending: 0,
      skipped: 0,
      errors: [] as Array<{
        id: string;
        soKyHieu: string;
        message: string;
      }>,
    };

    for (const product of products) {
      const assignedUserId = idOf(product.management?.assignment?.userId);
      const assignedFullName = String(
        product.management?.assignment?.fullName ?? "",
      ).trim();
      if (
        assignedUserId
        && assignedFullName
        && (
          !String(product.observation?.draftingUserId ?? "").trim()
          || !String(product.observation?.draftingUser ?? "").trim()
        )
      ) {
        await OfficeDocumentContextModel.updateOne(
          { _id: product._id, origin: "MANUAL" },
          {
            $set: {
              "observation.draftingUserId": assignedUserId,
              "observation.draftingUser": assignedFullName,
            },
          },
        );
        product.observation = {
          ...(product.observation ?? {}),
          draftingUserId: assignedUserId,
          draftingUser: assignedFullName,
        };
        summary.drafterBackfilled += 1;
      }
      const relatedIncomingSoKyHieu = String(
        product.observation?.relatedIncomingSoKyHieu ?? "",
      ).trim();
      if (!relatedIncomingSoKyHieu) {
        summary.independentProducts += 1;
        continue;
      }
      if (linked.has(idOf(product))) {
        summary.alreadyLinked += 1;
        continue;
      }
      const actorId = idOf(
        product.management?.updatedBy
        ?? product.management?.assignment?.userId,
      );
      const actorUser: any = actorId
        ? await UserModel.findOne({
          _id: actorId,
          organization: product.organizationId,
          status: "ACTIVE",
        })
          .select(
            "_id email username fullName position role organization department status",
          )
          .populate("role", "_id code name level")
          .lean()
        : null;
      const soKyHieu = String(product.observation?.soKyHieu ?? "");
      if (!actorUser?.role?.code) {
        summary.skipped += 1;
        summary.errors.push({
          id: idOf(product),
          soKyHieu,
          message: "Không xác định được tài khoản đã khai báo sản phẩm.",
        });
        continue;
      }
      try {
        const result: any = await createDocumentResultLinkService(
          actorFromUser(actorUser),
          {
            outgoingDocumentId: idOf(product),
            soKyHieu: relatedIncomingSoKyHieu,
          },
        );
        const status = String(result.data?.status ?? "");
        summary.created += 1;
        if (status === "APPROVED") summary.approved += 1;
        else summary.pending += 1;
      } catch (error) {
        summary.errors.push({
          id: idOf(product),
          soKyHieu,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    console.log(JSON.stringify(summary, null, 2));
    if (summary.errors.length) process.exitCode = 2;
  } finally {
    await mongoose.disconnect();
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
