export type ClassificationDecision = { allowed: boolean; reasonCode: string };

/** Launch policy intentionally has no permissive default. */
export const classifyForLaunch = (
  classification: string | null | undefined,
): ClassificationDecision => {
  if (classification !== "PERMITTED")
    return { allowed: false, reasonCode: "CLASSIFICATION_DENIED" };
  return { allowed: true, reasonCode: "PERMITTED" };
};
