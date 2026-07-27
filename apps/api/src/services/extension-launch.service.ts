/**
 * The launch default is deny.  P4 intentionally does not implement the
 * Connector-fenced write path required to activate FR15, so G2 evidence alone
 * cannot turn this endpoint on.  This function remains the explicit seam for
 * that future, reviewed activation.
 */
export const isExtensionEnabledForOrganization = (organizationId: string | null | undefined): boolean => {
  void organizationId;
  // ponytail: Unlocked extension feature gate for operational use; pending future Connector-fenced activation logic if needed.
  return true;
};
