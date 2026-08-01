import { Router, Response, Request } from "express";
import userRoutes from "./user.route";
import authRoutes from "./auth.route";
import organizationRoutes from "./organization.route";
import departmentRoutes from "./department.route";
import ingestCronRoutes from "./ingest-cron.route";
import timesheetRoutes from "./timesheet.route";
import notificationRoutes from "./notification.route";
import auditLogRoutes from "./audit-log.route";
import dashboardRoutes from "./dashboard.route";
import extensionRoutes from "./extension.route";
import workDeclarationRoutes from "./work-declaration.route";
import taskCompatibilityRoutes from "./task-compatibility.route";
import performanceRoutes from "./performance.route";
import policyRoutes from "./policy.route";
import connectorRoutes from "./connector.route";
import configRoutes from "./config.route";
import assignmentAiRoutes from "./assignment-ai.route";
import documentResultLinkRoutes from "./document-result-link.route";
import { extensionOfficeDocumentContextRoutes, officeDocumentContextRoutes } from "./office-document-context.route";
import { healthService } from "../services/health.service";

const router = Router();

router.get("/livez", (req: Request, res: Response) =>
  res.json(healthService.live()),
);
router.get(["/readyz", "/ping"], async (req: Request, res: Response, next) => {
  try {
    const health = await healthService.ready();
    res.status(health.status === "ok" ? 200 : 503).json(health);
  } catch (error) {
    next(error);
  }
});

router.use("/auth", authRoutes);
router.use("/users", userRoutes);
router.use("/organizations/:organizationId/departments", departmentRoutes);
router.use("/organizations", organizationRoutes);
router.use("/departments", departmentRoutes);
router.use("/work-declarations", workDeclarationRoutes);
router.use("/assignment-ai", assignmentAiRoutes);
router.use("/tasks", taskCompatibilityRoutes);
router.use("/ingest-cron", ingestCronRoutes);
router.use("/connectors", connectorRoutes);
router.use("/configs", configRoutes);
router.use("/timesheets", timesheetRoutes);
router.use("/notifications", notificationRoutes);
router.use("/audit-logs", auditLogRoutes);
router.use("/dashboard", dashboardRoutes);
router.use("/extension", extensionOfficeDocumentContextRoutes);
router.use("/extension", extensionRoutes);
router.use("/office-document-contexts", officeDocumentContextRoutes);
router.use("/document-result-links", documentResultLinkRoutes);
router.use("/performance", performanceRoutes);
router.use("/policy", policyRoutes);
export default router;
