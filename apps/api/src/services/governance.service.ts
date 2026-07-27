import { isValidObjectId } from "mongoose";
import ConnectorMappingModel from "../models/connector-mapping.model";
import ConnectorModel from "../models/connector.model";
import GovernancePolicyModel from "../models/governance-policy.model";
import { forbidden, notFound } from "../utils/http-error";
import { classifyForLaunch } from "./classification.service";

export type GovernanceSnapshot = {
  policyEpoch: number;
  mappingVersion: number;
};

type ApprovalOptions = {
  requireActive?: boolean;
  expected?: GovernanceSnapshot;
};

const gateApproved = () => process.env.GOVERNANCE_GATE_APPROVED === "true";

/** Validates G3 and persisted approval before any secret or source request. */
export const governanceService = {
  async assertApproved(
    connectorId: string,
    organizationId: string,
    options: ApprovalOptions = {},
  ): Promise<GovernanceSnapshot> {
    if (!gateApproved())
      throw forbidden("Connector governance is blocked pending G3 approval.");
    if (!isValidObjectId(connectorId) || !isValidObjectId(organizationId))
      throw forbidden("Connector scope is invalid.");

    const connector = await ConnectorModel.findOne({
      _id: connectorId,
      organizationId,
    }).lean();
    if (!connector || (options.requireActive !== false && connector.state !== "ACTIVE"))
      throw forbidden("Connector is not active.");
    if (!connector.governancePolicyId || !connector.governancePolicyEpoch)
      throw forbidden("Governance policy is not approved.");
    const policy = await GovernancePolicyModel.findOne({
      _id: connector.governancePolicyId,
      organizationId,
      state: "APPROVED",
      version: connector.governancePolicyEpoch,
      "approval.approvedAt": { $ne: null },
      "approval.provenance": { $ne: "" },
    }).lean();
    if (!policy)
      throw forbidden("Governance policy is unavailable or revoked.");
    const mapping = await ConnectorMappingModel.findOne({
      connectorId,
      organizationId,
      version: connector.mappingVersion,
      state: "APPROVED",
      approvedAt: { $ne: null },
    }).lean();
    if (!mapping || !classifyForLaunch(mapping.classification).allowed) {
      throw forbidden("Connector mapping is not approved for launch.");
    }
    const snapshot = {
      policyEpoch: connector.governancePolicyEpoch,
      mappingVersion: connector.mappingVersion,
    };
    if (
      options.expected &&
      (options.expected.policyEpoch !== snapshot.policyEpoch ||
        options.expected.mappingVersion !== snapshot.mappingVersion)
    ) {
      throw forbidden("Connector governance fence is stale.");
    }
    return snapshot;
  },

  async revoke(policyId: string): Promise<void> {
    const policy = await GovernancePolicyModel.findByIdAndUpdate(policyId, {
      $set: { state: "REVOKED" },
    });
    if (!policy) throw notFound("Governance policy not found.");
    await ConnectorModel.updateMany(
      { governancePolicyId: policyId },
      {
        $set: {
          state: "BLOCKED",
          leaseUntil: null,
          "session.status": "BLOCKED",
        },
        $inc: { credentialEpoch: 1, scheduleGeneration: 1 },
      },
    );
  },
};
