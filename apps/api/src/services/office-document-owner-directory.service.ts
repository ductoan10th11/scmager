// Registers the model that populate("department") resolves against.
import "../models/department.model";
import UserModel from "../models/user.model";
import {
  effectiveOfficeDocumentOwnerId,
  type OfficeDocumentOwnerDirectory,
} from "./office-document-owner.service";

const idOf = (value: any) => String(value?._id ?? value ?? "");

/**
 * Inactive users are kept: someone who has left still owns the documents they
 * worked on, and their department must still resolve.
 */
export const loadOfficeDocumentOwnerDirectory = async (
  filter: Record<string, unknown>,
): Promise<OfficeDocumentOwnerDirectory> => {
  const users = await UserModel.find(filter)
    .select("_id fullName department")
    .populate("department", "_id name")
    .lean();
  return new Map(
    users.map((user: any) => [
      idOf(user),
      {
        fullName: user.fullName ?? "",
        departmentId: idOf(user.department),
        departmentName: user.department?.name ?? "",
      },
    ]),
  );
};

export const officeDocumentOwnerDirectoryFor = async (
  context: any,
): Promise<OfficeDocumentOwnerDirectory> => {
  const ownerId = effectiveOfficeDocumentOwnerId(context);
  return ownerId ? loadOfficeDocumentOwnerDirectory({ _id: ownerId }) : new Map();
};
