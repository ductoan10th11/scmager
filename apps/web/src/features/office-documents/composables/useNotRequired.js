import { ref } from "vue";

const ORGANIZATION_ROLES = ["ADMIN", "OFFICE_CHIEF", "COMMUNE_LEADER"];

export const notRequiredOf = (context) => context?.management?.notRequired ?? null;
export const notRequiredStatus = (context) => notRequiredOf(context)?.status ?? "NONE";

/**
 * Who may do what with a "việc không cần làm" request, and which dialog is open.
 * These only decide what to show: the API applies the same rules. The owner comes
 * from tracking.assignee, never management.assignment, which usually names the
 * leader who dispatched the document.
 */
export const useNotRequired = ({ user, currentUserId, currentDepartmentId, documentOwnerId, personId }) => {
  const dialogOpen = ref(false);
  const dialogMode = ref("request");
  const dialogTarget = ref(null);

  const openDialog = (context, mode) => {
    dialogTarget.value = context;
    dialogMode.value = mode;
    dialogOpen.value = true;
  };

  const canManage = (context) => {
    const role = user.value?.role?.code;
    if (ORGANIZATION_ROLES.includes(role)) return true;
    return role === "DEPARTMENT_LEADER"
      && Boolean(currentDepartmentId.value)
      && personId(context?.tracking?.assignee?.departmentId) === currentDepartmentId.value;
  };

  const canRequest = (context) =>
    context?.pageType === "incoming"
    && user.value?.role?.code === "SPECIALIST"
    && documentOwnerId(context) === currentUserId.value
    && !["PENDING", "CONFIRMED"].includes(notRequiredStatus(context))
    && context?.management?.businessCompletion?.completed !== true;

  const canCancel = (context) =>
    notRequiredStatus(context) === "PENDING"
    && personId(notRequiredOf(context)?.requestedBy) === currentUserId.value;

  // A leader skips the request and takes the task out of the KPI at once.
  const canDiscard = (context) =>
    context?.pageType === "incoming"
    && canManage(context)
    && !["PENDING", "CONFIRMED"].includes(notRequiredStatus(context))
    && context?.management?.businessCompletion?.completed !== true;

  const canDecide = (context) => notRequiredStatus(context) === "PENDING" && canManage(context);
  const canRestore = (context) => notRequiredStatus(context) === "CONFIRMED" && canManage(context);

  return { dialogOpen, dialogMode, dialogTarget, openDialog, canManage, canRequest, canCancel, canDecide, canRestore, canDiscard };
};
