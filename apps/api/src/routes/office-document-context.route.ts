import { Router } from "express";
import {
  createManagedOfficeDocumentContext,
  deleteManagedOfficeDocumentContext,
  getOfficeDocumentContext,
  getNextManagedOfficeDocumentReference,
  ingestIncomingBySymbol,
  listOfficeDocumentContext,
  receiveOfficeDocumentContext,
  updateManagedOfficeDocumentContext,
} from "../controllers/office-document-context.controller";
import { publicExtensionVersion } from "../controllers/config.controller";
import { requireAuth } from "../middlewares/auth.middleware";
import { verifyExtensionSignature } from "../middlewares/extension-auth.middleware";

export const extensionOfficeDocumentContextRoutes = Router();
extensionOfficeDocumentContextRoutes.get("/version", publicExtensionVersion);
extensionOfficeDocumentContextRoutes.post(
  "/office-contexts",
  verifyExtensionSignature,
  receiveOfficeDocumentContext,
);

export const officeDocumentContextRoutes = Router();
officeDocumentContextRoutes.get("/", requireAuth, listOfficeDocumentContext);
officeDocumentContextRoutes.get(
  "/manual-reference",
  requireAuth,
  getNextManagedOfficeDocumentReference,
);
officeDocumentContextRoutes.post(
  "/",
  requireAuth,
  createManagedOfficeDocumentContext,
);
officeDocumentContextRoutes.post(
  "/ingest-incoming",
  requireAuth,
  ingestIncomingBySymbol,
);
officeDocumentContextRoutes.get("/:id", requireAuth, getOfficeDocumentContext);
officeDocumentContextRoutes.patch(
  "/:id",
  requireAuth,
  updateManagedOfficeDocumentContext,
);
officeDocumentContextRoutes.delete(
  "/:id",
  requireAuth,
  deleteManagedOfficeDocumentContext,
);
