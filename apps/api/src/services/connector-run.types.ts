export type FencedConnectorIdentity = {
  organizationId: string;
  connectorId: string;
  fenceToken: number;
  credentialEpoch: number;
  mappingVersion: number;
  governancePolicyEpoch: number;
};
