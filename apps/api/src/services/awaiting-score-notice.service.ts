import OfficeDocumentContextModel from "../models/office-document-context.model";
import { isOfficeDocumentAwaitingScore } from "./office-document-completion.service";
import { notifyRoleUsers } from "./notification.service";

// Leaders who fill in a document's point once the work is finished.
const SCORING_ROLES = ["ADMIN", "OFFICE_CHIEF", "COMMUNE_LEADER"];

export type AwaitingScoreNoticeSummary = {
  scanned: number;
  awaiting: number;
  organizations: number;
  notified: number;
};

/**
 * Finished documents that nobody has scored stall the whole KPI calculation,
 * and nothing surfaces them on its own. This sweeps for them and leaves the
 * leaders one daily reminder per organization — createNotification's dedupe key
 * is scoped to the current day, so repeated cron ticks do not pile up.
 */
export const notifyDocumentsAwaitingScore = async (): Promise<AwaitingScoreNoticeSummary> => {
  const contexts = await OfficeDocumentContextModel.find({ pageType: "incoming" })
    .select("_id organizationId management statusSync observation")
    .lean();

  const awaiting = contexts.filter((context: any) => isOfficeDocumentAwaitingScore(context));
  const byOrganization = new Map<string, any[]>();
  for (const context of awaiting) {
    const organizationId = String((context as any).organizationId ?? "");
    if (!organizationId) continue;
    if (!byOrganization.has(organizationId)) byOrganization.set(organizationId, []);
    byOrganization.get(organizationId)!.push(context);
  }

  let notified = 0;
  for (const [organizationId, items] of byOrganization) {
    const sample = items[0];
    for (const roleCode of SCORING_ROLES) {
      const created = await notifyRoleUsers(roleCode, organizationId, {
        type: "DOCUMENTS_AWAITING_SCORE",
        title: `${items.length} văn bản đã xong nhưng chưa có điểm`,
        message: "Mở mục Văn bản và tích “Đã xong nhưng chưa có điểm” để chấm.",
        relatedModel: "IncomingDocument",
        relatedId: String(sample._id),
        metadata: {
          count: items.length,
          // One reminder per organization per day, regardless of tick count.
          dedupeKey: `awaiting-score:${organizationId}`,
        },
      });
      notified += created.filter(Boolean).length;
    }
  }

  return {
    scanned: contexts.length,
    awaiting: awaiting.length,
    organizations: byOrganization.size,
    notified,
  };
};
