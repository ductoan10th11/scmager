import { Router } from "express";
import {
  activateConnector,
  createConnector,
  deleteConnector,
  disableConnector,
  getConnectorOperationalStatus,
  listConnectors,
  requestConnectorRun,
  retryConnectorDeadLetter,
  updateConnector,
} from "../controllers/connector.controller";
import { requireAuth } from "../middlewares/auth.middleware";

const router = Router();
router.use(requireAuth);
router.route("/").get(listConnectors).post(createConnector);
router.route("/:connectorId").patch(updateConnector).delete(deleteConnector);
router.post("/:connectorId/activate", activateConnector);
router.post("/:connectorId/disable", disableConnector);
router.post("/:connectorId/runs", requestConnectorRun);
router.get("/:connectorId/operational-status", getConnectorOperationalStatus);
router.post("/:connectorId/dead-letters/:deadLetterId/retry", retryConnectorDeadLetter);
export default router;
