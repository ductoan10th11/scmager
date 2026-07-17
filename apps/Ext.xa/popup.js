(function initPopup() {
  window.lucide?.createIcons();

  const API_BASE_URL = "https://ework.naot.me/api";
  const ROUTES = new Set(["overview", "assignment", "performance"]);
  const STATUS_LABELS = {
    DRAFT: "Nháp",
    PENDING_APPROVAL: "Chờ duyệt",
    RETURNED: "Cần bổ sung",
    APPROVED: "Đã duyệt",
    CANCELLED: "Đã hủy",
  };
  const NOTIFICATION_LABELS = {
    WORK_DECLARATION_SUBMITTED: "Công việc chờ duyệt",
    WORK_DECLARATION_FORWARDED: "Công việc chuyển duyệt",
    WORK_DECLARATION_APPROVED: "Công việc đã duyệt",
    WORK_DECLARATION_RETURNED: "Công việc cần bổ sung",
    TASK_DUE_SOON: "Gần hạn",
    TASK_OVERDUE: "Quá hạn",
  };

  let loadingDotsTimer = null;
  let currentUser = null;
  let overviewCache = null;
  let assignmentsCache = [];
  let approvalsCache = [];
  let notificationsCache = [];
  const loadedRoutes = new Set();

  const $ = (id) => document.getElementById(id);
  const elements = {
    loadingOverlay: $("loadingOverlay"),
    loadingDots: Array.from(document.querySelectorAll("#loadingDots span")),
    authView: $("authView"),
    overviewView: $("overviewView"),
    loginForm: $("loginForm"),
    usernameInput: $("usernameInput"),
    passwordInput: $("passwordInput"),
    passwordToggle: $("passwordToggle"),
    rememberInput: $("rememberInput"),
    loginButton: $("loginButton"),
    loginError: $("loginError"),
    forgotPasswordButton: $("forgotPasswordButton"),
    logoutButton: $("logoutButton"),
    refreshButton: $("refreshButton"),
    todayCount: $("todayCount"),
    todayNote: $("todayNote"),
    overdueCount: $("overdueCount"),
    documentCount: $("documentCount"),
    documentPointCount: $("documentPointCount"),
    unreadBadge: $("unreadBadge"),
    overviewFeed: $("overviewFeed"),
    dockNav: document.querySelector(".dock-nav"),
    dockItems: Array.from(document.querySelectorAll("[data-route]")),
    routePages: Array.from(document.querySelectorAll("[data-route-page]")),
    toggleCreateTaskButton: $("toggleCreateTaskButton"),
    openApprovalButton: $("openApprovalButton"),
    approvalCountBadge: $("approvalCountBadge"),
    taskModal: $("taskModal"),
    closeTaskModalButton: $("closeTaskModalButton"),
    approvalModal: $("approvalModal"),
    closeApprovalModalButton: $("closeApprovalModalButton"),
    approvalList: $("approvalList"),
    createTaskForm: $("createTaskForm"),
    taskTitleInput: $("taskTitleInput"),
    taskStartInput: $("taskStartInput"),
    taskEndInput: $("taskEndInput"),
    taskPointInput: $("taskPointInput"),
    taskDescriptionInput: $("taskDescriptionInput"),
    submitTaskInput: $("submitTaskInput"),
    createTaskButton: $("createTaskButton"),
    taskFormMessage: $("taskFormMessage"),
    assignmentCountBadge: $("assignmentCountBadge"),
    assignmentSchedule: $("assignmentSchedule"),
    completedDocumentPointCount: $("completedDocumentPointCount"),
    pendingDocumentPointCount: $("pendingDocumentPointCount"),
    overdueDocumentPointCount: $("overdueDocumentPointCount"),
    dueSoonDocumentPointCount: $("dueSoonDocumentPointCount"),
    completionRateNote: $("completionRateNote"),
    overdueRateNote: $("overdueRateNote"),
    documentKpiList: $("documentKpiList"),
  };

  function buildUrl(path) {
    return `${API_BASE_URL}${path}`;
  }

  async function readJson(res) {
    const text = await res.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      throw new Error("Máy chủ trả về dữ liệu không hợp lệ.");
    }
  }

  function getErrorMessage(payload, fallback) {
    return payload?.error?.message || payload?.message || fallback;
  }

  async function request(path, options = {}) {
    const res = await fetch(buildUrl(path), {
      credentials: "include",
      ...options,
      headers: {
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {}),
      },
    });
    const payload = await readJson(res);
    if (!res.ok) {
      const error = new Error(getErrorMessage(payload, `Yêu cầu thất bại: ${res.status}`));
      error.status = res.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  async function getMe() {
    try {
      const payload = await request("/auth/me");
      if (payload?.data?.authenticated === false) return null;
      return payload?.data?.user || null;
    } catch (error) {
      if (error.status === 401) return null;
      throw error;
    }
  }

  function startLoadingDots() {
    if (loadingDotsTimer || !elements.loadingDots.length) return;
    loadingDotsTimer = window.setInterval(() => {
      elements.loadingDots.forEach((dot) => {
        dot.classList.toggle("is-bright", Math.random() > 0.52);
      });
    }, 170);
  }

  function hideLoadingOverlay() {
    elements.loadingOverlay.classList.remove("is-active");
    if (loadingDotsTimer) window.clearInterval(loadingDotsTimer);
    loadingDotsTimer = null;
  }

  function setBusy(isBusy) {
    [elements.loginButton, elements.logoutButton, elements.refreshButton, elements.createTaskButton, elements.openApprovalButton]
      .filter(Boolean)
      .forEach((button) => {
        button.disabled = isBusy;
      });
  }

  function showLoginError(message) {
    elements.loginError.textContent = message;
    elements.loginError.classList.add("is-visible");
  }

  function clearLoginError() {
    elements.loginError.classList.remove("is-visible");
  }

  function setInlineMessage(message, type = "info") {
    elements.taskFormMessage.textContent = message || "";
    elements.taskFormMessage.className = `inline-message ${message ? "is-visible" : ""} ${type}`;
  }

  function formatNumber(value) {
    return new Intl.NumberFormat("vi-VN").format(Number(value || 0));
  }

  function formatDateTime(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("vi-VN", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }

  function formatTime(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit" }).format(date);
  }

  function formatDateInput(date) {
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function emptyMarkup(title, copy = "") {
    return `<div class="empty-state compact"><p class="empty-title">${escapeHtml(title)}</p>${copy ? `<p class="empty-copy">${escapeHtml(copy)}</p>` : ""}</div>`;
  }

  function normalizeRoute(route) {
    if (route === "task") return "assignment";
    if (route === "kpi") return "performance";
    return ROUTES.has(route) ? route : "overview";
  }

  function getCurrentRoute() {
    return normalizeRoute(window.location.hash.replace(/^#\/?/, ""));
  }

  function setView(viewName) {
    const isAuth = viewName === "auth";
    hideLoadingOverlay();
    elements.authView.classList.toggle("is-active", isAuth);
    elements.overviewView.classList.toggle("is-active", !isAuth);
    if (!isAuth) setRoute(getCurrentRoute());
  }

  function setRoute(route) {
    const nextRoute = normalizeRoute(route);
    elements.routePages.forEach((page) => {
      page.classList.toggle("is-active", page.dataset.routePage === nextRoute);
    });
    elements.dockItems.forEach((item) => {
      item.classList.toggle("is-active", item.dataset.route === nextRoute);
      item.classList.toggle("is-current-overview", nextRoute === "overview" && item.dataset.route === "overview");
    });
    elements.dockNav?.classList.toggle("is-overview-route", nextRoute === "overview");
    updateDockIndicator();
    void ensureRouteData(nextRoute);
  }

  function updateDockIndicator() {
    if (!elements.dockNav) return;
    const currentRoute = getCurrentRoute();
    const targetItem = elements.dockItems.find((item) => item.dataset.route === currentRoute);
    if (!targetItem) return;
    window.requestAnimationFrame(() => {
      const navRect = elements.dockNav.getBoundingClientRect();
      const itemRect = targetItem.getBoundingClientRect();
      if (!navRect.width || !itemRect.width) return;
      const indicatorSize = Number.parseFloat(getComputedStyle(elements.dockNav).getPropertyValue("--dock-indicator-size")) || itemRect.width;
      const indicatorX = itemRect.left - navRect.left + (itemRect.width - indicatorSize) / 2;
      elements.dockNav.style.setProperty("--dock-indicator-x", `${indicatorX}px`);
      elements.dockNav.style.setProperty("--dock-indicator-scale", currentRoute === "overview" ? "0" : "1");
    });
  }

  function renderUser(user) {
    currentUser = user || currentUser;
    elements.openApprovalButton.classList.toggle("hidden", !canApproveTasks());
  }

  function canApproveTasks() {
    const roleLevel = Number(currentUser?.role?.level ?? 99);
    const roleCode = currentUser?.role?.code;
    return roleLevel <= 3 || ["ADMIN", "COMMUNE_LEADER", "OFFICE_CHIEF", "DEPARTMENT_LEADER"].includes(roleCode);
  }

  function openModal(modal) {
    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    window.lucide?.createIcons();
  }

  function closeModal(modal) {
    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");
    if (elements.taskModal.classList.contains("hidden") && elements.approvalModal.classList.contains("hidden")) {
      document.body.classList.remove("modal-open");
    }
  }

  function openTaskModal() {
    setInlineMessage("");
    if (!elements.taskStartInput.value) setDefaultTaskTimes();
    openModal(elements.taskModal);
    window.setTimeout(() => elements.taskTitleInput.focus(), 40);
  }

  async function openApprovalModal() {
    openModal(elements.approvalModal);
    await loadApprovals(true);
  }

  function renderOverview(overview) {
    overviewCache = overview;
    const taskSummary = overview.tasks?.summary || {};
    const documentSummary = overview.ingestDocuments?.summary || {};
    const performance = overview.ingestDocuments?.performance || {};
    elements.todayCount.textContent = formatNumber(taskSummary.today);
    elements.todayNote.textContent = `${formatNumber(taskSummary.total)} việc khai báo`;
    elements.overdueCount.textContent = formatNumber(taskSummary.overdue);
    elements.documentCount.textContent = formatNumber(documentSummary.total);
    elements.documentPointCount.textContent = formatNumber(performance.totalPoint);
    renderUser(overview.user);
    renderOverviewFeed();
    renderPerformance();
  }

  function renderOverviewFeed() {
    const unread = notificationsCache.filter((item) => !item.readAt).length;
    elements.unreadBadge.textContent = `${formatNumber(unread)} mới`;
    const notifications = notificationsCache.slice(0, 3).map((item) => ({
      title: item.title,
      meta: `${NOTIFICATION_LABELS[item.type] || item.type || "Thông báo"} - ${formatDateTime(item.createdAt)}`,
      badge: item.readAt ? "Đã đọc" : "Mới",
    }));
    const documents = (overviewCache?.ingestDocuments?.items || []).slice(0, 3).map((doc) => ({
      title: doc.soKyHieu || doc.trichYeu || `SĐ ${doc.soDen}`,
      meta: `SĐ ${doc.soDen || "—"} - hạn ${formatDateTime(doc.deadline)} - ${formatNumber(doc.point)} điểm`,
      badge: doc.completed ? "Xong" : "Theo dõi",
    }));
    const items = [...notifications, ...documents].slice(0, 6);
    elements.overviewFeed.innerHTML = items.length
      ? items.map(renderCompactItem).join("")
      : emptyMarkup("Chưa có mục cần chú ý.", "Thông báo và văn bản gần hạn sẽ hiển thị tại đây.");
  }

  function renderCompactItem(item) {
    return `
      <article class="compact-item">
        <div>
          <p>${escapeHtml(item.title || "Không có tiêu đề")}</p>
          <span>${escapeHtml(item.meta || "")}</span>
        </div>
        <em>${escapeHtml(item.badge || "")}</em>
      </article>
    `;
  }

  function isSameLocalDay(left, right) {
    return left.getFullYear() === right.getFullYear()
      && left.getMonth() === right.getMonth()
      && left.getDate() === right.getDate();
  }

  function taskOwner(task) {
    return task.createdBy || task.assignedTo || {};
  }

  function normalizeAssignmentTask(task) {
    return {
      id: task._id || task.id,
      title: task.title || "Không có tiêu đề",
      status: task.status,
      point: Number(task.declaredPoint ?? task.point ?? 0),
      start: new Date(task.workStartAt || task.assignedAt || task.createdAt),
      end: new Date(task.workEndAt || task.dueAt || task.createdAt),
      owner: taskOwner(task),
    };
  }

  function renderAssignmentSchedule(payload) {
    assignmentsCache = (payload?.data || []).map(normalizeAssignmentTask);
    const today = new Date();
    const dayStart = new Date(today);
    dayStart.setHours(8, 0, 0, 0);
    const dayEnd = new Date(today);
    dayEnd.setHours(18, 0, 0, 0);
    const totalMs = dayEnd.getTime() - dayStart.getTime();
    const visibleTasks = assignmentsCache.filter((task) => (
      !Number.isNaN(task.start.getTime())
      && !Number.isNaN(task.end.getTime())
      && isSameLocalDay(task.start, today)
      && task.status !== "CANCELLED"
    ));
    elements.assignmentCountBadge.textContent = `${formatNumber(visibleTasks.length)} việc`;

    const rows = new Map();
    visibleTasks.forEach((task) => {
      const ownerId = String(task.owner?._id || task.owner?.id || currentUser?.id || "me");
      if (!rows.has(ownerId)) {
        rows.set(ownerId, {
          owner: task.owner,
          tasks: [],
        });
      }
      rows.get(ownerId).tasks.push(task);
    });

    if (!rows.size) {
      elements.assignmentSchedule.innerHTML = emptyMarkup("Hôm nay chưa có lịch.", "Các việc khai báo sẽ xuất hiện theo khung 08:00 - 18:00.");
      return;
    }

    const hourTicks = ["08", "10", "12", "14", "16", "18"];
    elements.assignmentSchedule.innerHTML = `
      <div class="schedule-hours">${hourTicks.map((hour) => `<span>${hour}:00</span>`).join("")}</div>
      ${Array.from(rows.values()).map((row) => renderScheduleRow(row, dayStart, totalMs)).join("")}
    `;
  }

  function renderApprovals(payload) {
    approvalsCache = payload?.data || [];
    elements.approvalCountBadge.textContent = formatNumber(payload?.meta?.total ?? approvalsCache.length);
    elements.openApprovalButton.classList.toggle("has-pending", approvalsCache.length > 0);
    elements.approvalList.innerHTML = approvalsCache.length
      ? approvalsCache.map(renderApprovalItem).join("")
      : emptyMarkup("Không có task chờ duyệt.", "Khi chuyên viên gửi duyệt, danh sách sẽ xuất hiện tại đây.");
    window.lucide?.createIcons();
  }

  function renderApprovalItem(task) {
    const owner = taskOwner(task);
    return `
      <article class="approval-item" data-id="${escapeHtml(task._id || task.id)}">
        <div class="approval-main">
          <h3>${escapeHtml(task.title || "Không có tiêu đề")}</h3>
          <p>${escapeHtml(owner.fullName || owner.username || "—")} · ${escapeHtml(formatDateTime(task.workStartAt))}-${escapeHtml(formatDateTime(task.workEndAt))}</p>
          <span>${escapeHtml(task.description || "Không có mô tả.")}</span>
        </div>
        <div class="approval-score">
          <strong>${escapeHtml(formatNumber(task.declaredPoint))}</strong>
          <span>điểm</span>
        </div>
        <div class="approval-actions">
          <button class="button secondary mini return-button" type="button" data-action="return" data-id="${escapeHtml(task._id || task.id)}">
            <i data-lucide="rotate-ccw" aria-hidden="true"></i>
            Trả
          </button>
          <button class="button mini approve-button" type="button" data-action="approve" data-id="${escapeHtml(task._id || task.id)}">
            <i data-lucide="check" aria-hidden="true"></i>
            Duyệt
          </button>
        </div>
      </article>
    `;
  }

  function renderScheduleRow(row, dayStart, totalMs) {
    const ownerName = row.owner?.fullName || row.owner?.username || currentUser?.fullName || "Tôi";
    const role = row.owner?.position || row.owner?.role?.name || "Nhân sự";
    const blocks = row.tasks.map((task) => {
      const left = Math.max(0, Math.min(100, ((task.start.getTime() - dayStart.getTime()) / totalMs) * 100));
      const width = Math.max(3, Math.min(100 - left, ((task.end.getTime() - task.start.getTime()) / totalMs) * 100));
      const tiny = width < 8;
      return `
        <button class="schedule-block ${tiny ? "is-tiny" : ""}" type="button" title="${escapeHtml(task.title)}" style="left:${left}%;width:${width}%">
          <strong>${escapeHtml(tiny ? "" : task.title)}</strong>
          <span>${escapeHtml(formatTime(task.start))}-${escapeHtml(formatTime(task.end))} · ${escapeHtml(formatNumber(task.point))}đ</span>
        </button>
      `;
    }).join("");
    return `
      <article class="schedule-row">
        <div class="schedule-person">
          <strong>${escapeHtml(ownerName)}</strong>
          <span>${escapeHtml(role)}</span>
        </div>
        <div class="schedule-track">${blocks}</div>
      </article>
    `;
  }

  function renderPerformance() {
    const performance = overviewCache?.ingestDocuments?.performance || {};
    const documents = overviewCache?.ingestDocuments?.items || [];
    elements.completedDocumentPointCount.textContent = formatNumber(performance.completedPoint);
    elements.pendingDocumentPointCount.textContent = formatNumber(performance.pendingPoint);
    elements.overdueDocumentPointCount.textContent = formatNumber(performance.overduePoint);
    elements.dueSoonDocumentPointCount.textContent = formatNumber(performance.dueSoonPoint);
    elements.completionRateNote.textContent = `${formatNumber(performance.completionRate)}% hoàn thành`;
    elements.overdueRateNote.textContent = `${formatNumber(performance.overdueRate)}% quá hạn`;
    elements.documentKpiList.innerHTML = documents.length
      ? documents.map(renderDocumentItem).join("")
      : emptyMarkup("Chưa có văn bản có hạn xử lý.", "Ingest chỉ lưu văn bản có hạn xử lý để tính KPI.");
  }

  function renderDocumentItem(doc) {
    const isDone = doc.completed || ["COMPLETED", "MANUALLY_PROCESSED"].includes(doc.processingStatus);
    return `
      <article class="work-item">
        <div class="work-main">
          <div class="work-title-row">
            <h3>${escapeHtml(doc.soKyHieu || doc.trichYeu || `SĐ ${doc.soDen}`)}</h3>
            <span class="status-pill ${isDone ? "approved" : "pending_approval"}">${isDone ? "Xong" : "Theo dõi"}</span>
          </div>
          <p class="work-meta">SĐ ${escapeHtml(doc.soDen || "—")} · hạn ${escapeHtml(formatDateTime(doc.deadline))}</p>
          <p class="work-desc">${escapeHtml(doc.trichYeu || doc.donViBanHanh || "Không có trích yếu.")}</p>
        </div>
        <div class="work-side">
          <strong>${escapeHtml(formatNumber(doc.point))}</strong>
          <span>điểm</span>
        </div>
      </article>
    `;
  }

  async function loadOverview() {
    clearLoginError();
    setBusy(true);
    try {
      const overview = await getOverview();
      if (!overview.authenticated) {
        setView("auth");
        return;
      }
      renderOverview(overview);
      await loadNotifications().catch(() => undefined);
      setView("overview");
    } catch (error) {
      setView("auth");
      showLoginError(getErrorMessage(error.payload, error.message || "Không tải được tổng quan."));
    } finally {
      setBusy(false);
    }
  }

  async function getOverview(limit = 12) {
    try {
      const payload = await request(`/extension/overview?limit=${encodeURIComponent(limit)}`);
      return { authenticated: true, ...(payload?.data || {}) };
    } catch (error) {
      if (error.status === 401) return { authenticated: false };
      throw error;
    }
  }

  async function loadNotifications() {
    const [itemsPayload, countPayload] = await Promise.all([
      request("/notifications?page=1&limit=10"),
      request("/notifications/unread-count"),
    ]);
    notificationsCache = itemsPayload?.data || [];
    elements.unreadBadge.textContent = `${formatNumber(countPayload?.data?.count ?? 0)} mới`;
    renderOverviewFeed();
  }

  async function loadAssignments(force = false) {
    if (!force && loadedRoutes.has("assignment")) return;
    elements.assignmentSchedule.innerHTML = emptyMarkup("Đang tải lịch...");
    const payload = await request("/work-declarations?limit=100");
    renderAssignmentSchedule(payload);
    loadedRoutes.add("assignment");
    if (canApproveTasks()) await loadApprovals(false).catch(() => undefined);
  }

  async function loadApprovals(force = false) {
    if (!canApproveTasks()) return;
    if (!force && loadedRoutes.has("approvals")) return;
    elements.approvalList.innerHTML = emptyMarkup("Đang tải task chờ duyệt...");
    const payload = await request("/work-declarations?pendingForMe=true&status=PENDING_APPROVAL&limit=50");
    renderApprovals(payload);
    loadedRoutes.add("approvals");
  }

  async function ensureRouteData(route) {
    if (!currentUser && route !== "overview") return;
    try {
      if (route === "assignment") await loadAssignments();
      if (route === "performance") renderPerformance();
    } catch (error) {
      if (route === "assignment") elements.assignmentSchedule.innerHTML = emptyMarkup("Không tải được lịch.", error.message);
      if (error.status === 401) setView("auth");
    }
  }

  function setDefaultTaskTimes() {
    const now = new Date();
    now.setSeconds(0, 0);
    const end = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    elements.taskStartInput.value = formatDateInput(now);
    elements.taskEndInput.value = formatDateInput(end);
  }

  async function handleCreateTask(event) {
    event.preventDefault();
    setInlineMessage("");
    const body = {
      title: elements.taskTitleInput.value.trim(),
      description: elements.taskDescriptionInput.value.trim(),
      workStartAt: elements.taskStartInput.value,
      workEndAt: elements.taskEndInput.value,
      declaredPoint: Number(elements.taskPointInput.value || 0),
    };
    if (!body.title) {
      setInlineMessage("Vui lòng nhập tên công việc.", "error");
      return;
    }
    setBusy(true);
    try {
      const created = await request("/work-declarations", {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (elements.submitTaskInput.checked && ["DRAFT", "RETURNED"].includes(created?.data?.status)) {
        await request(`/work-declarations/${created?.data?._id}/submit`, {
          method: "POST",
          body: JSON.stringify({}),
        });
      }
      elements.createTaskForm.reset();
      setDefaultTaskTimes();
      setInlineMessage("Đã lưu công việc.", "success");
      loadedRoutes.delete("assignment");
      loadedRoutes.delete("approvals");
      await Promise.all([loadAssignments(true), loadOverview()]);
      window.setTimeout(() => closeModal(elements.taskModal), 450);
    } catch (error) {
      setInlineMessage(getErrorMessage(error.payload, error.message || "Không lưu được công việc."), "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleApprovalAction(button) {
    const id = button?.dataset?.id;
    const action = button?.dataset?.action;
    if (!id || !action) return;
    let body = {};
    if (action === "return") {
      const note = window.prompt("Lý do trả về");
      if (!note) return;
      body = { note };
    }
    setBusy(true);
    try {
      await request(`/work-declarations/${id}/${action === "approve" ? "approve" : "return"}`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      loadedRoutes.delete("assignment");
      loadedRoutes.delete("approvals");
      await Promise.all([loadAssignments(true), loadApprovals(true), loadOverview()]);
    } catch (error) {
      window.alert(getErrorMessage(error.payload, error.message || "Không xử lý được task."));
    } finally {
      setBusy(false);
    }
  }

  async function handleLogin(event) {
    event.preventDefault();
    clearLoginError();
    const loginValue = elements.usernameInput.value.trim();
    const password = elements.passwordInput.value;
    if (!loginValue || !password) {
      showLoginError("Vui lòng nhập tài khoản và mật khẩu.");
      return;
    }
    setBusy(true);
    try {
      const data = await request("/auth/me", {
        method: "POST",
        body: JSON.stringify({ login: loginValue, password, remember: elements.rememberInput.checked }),
      });
      localStorage.setItem("ework:lastLogin", loginValue);
      elements.passwordInput.value = "";
    renderUser(data?.data?.user);
      loadedRoutes.clear();
      await loadOverview();
    } catch (error) {
      setView("auth");
      showLoginError(getErrorMessage(error.payload, error.message || "Không đăng nhập được."));
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    setBusy(true);
    try {
      await request("/auth/me", { method: "DELETE" });
    } catch (error) {
      if (error.status !== 204) showLoginError(getErrorMessage(error.payload, error.message || "Đăng xuất thất bại."));
    } finally {
      currentUser = null;
      loadedRoutes.clear();
      setView("auth");
      setBusy(false);
    }
  }

  async function refreshCurrentRoute() {
    loadedRoutes.delete(getCurrentRoute());
    await loadOverview();
    await ensureRouteData(getCurrentRoute());
  }

  async function prefillUsername() {
    const lastLogin = localStorage.getItem("ework:lastLogin");
    if (lastLogin) elements.usernameInput.value = lastLogin;
    if (typeof chrome === "undefined" || !chrome.tabs?.query || elements.usernameInput.value.trim()) return;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return;
      const response = await chrome.tabs.sendMessage(tab.id, { type: "CHUYEN_XU_LY_GET_PAGE_USER_ID" });
      if (response?.userId && !elements.usernameInput.value.trim()) elements.usernameInput.value = response.userId;
    } catch {
      // Không phải tab eOffice hoặc content script chưa sẵn sàng.
    }
  }

  function bindEvents() {
    elements.loginForm.addEventListener("submit", handleLogin);
    elements.logoutButton.addEventListener("click", handleLogout);
    elements.refreshButton.addEventListener("click", refreshCurrentRoute);
    elements.createTaskForm.addEventListener("submit", handleCreateTask);
    elements.toggleCreateTaskButton.addEventListener("click", openTaskModal);
    elements.closeTaskModalButton.addEventListener("click", () => closeModal(elements.taskModal));
    elements.openApprovalButton.addEventListener("click", () => void openApprovalModal());
    elements.closeApprovalModalButton.addEventListener("click", () => closeModal(elements.approvalModal));
    elements.taskModal.addEventListener("click", (event) => {
      if (event.target === elements.taskModal) closeModal(elements.taskModal);
    });
    elements.approvalModal.addEventListener("click", (event) => {
      if (event.target === elements.approvalModal) closeModal(elements.approvalModal);
      const button = event.target.closest("[data-action]");
      if (button) void handleApprovalAction(button);
    });
    window.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      closeModal(elements.taskModal);
      closeModal(elements.approvalModal);
    });
    elements.forgotPasswordButton.addEventListener("click", () => {
      showLoginError("Tính năng quên mật khẩu sẽ dùng theo cổng thông tin eWork.");
    });
    elements.passwordToggle.addEventListener("click", () => {
      const shouldShow = elements.passwordInput.type === "password";
      elements.passwordInput.type = shouldShow ? "text" : "password";
      elements.passwordToggle.classList.toggle("is-visible", shouldShow);
      elements.passwordToggle.setAttribute("aria-label", shouldShow ? "Ẩn mật khẩu" : "Hiện mật khẩu");
      elements.passwordToggle.setAttribute("aria-pressed", shouldShow ? "true" : "false");
      elements.passwordInput.focus();
    });
    elements.dockItems.forEach((item) => {
      item.addEventListener("click", () => {
        const nextRoute = normalizeRoute(item.dataset.route);
        const nextHash = `#${nextRoute}`;
        if (window.location.hash === nextHash) {
          setRoute(nextRoute);
          return;
        }
        window.location.hash = nextHash;
      });
    });
    window.addEventListener("hashchange", () => {
      if (elements.overviewView.classList.contains("is-active")) setRoute(getCurrentRoute());
    });
    window.addEventListener("resize", () => {
      if (elements.overviewView.classList.contains("is-active")) updateDockIndicator();
    });
  }

  async function start() {
    startLoadingDots();
    bindEvents();
    setDefaultTaskTimes();
    await prefillUsername();
    try {
      const user = await getMe();
      if (!user) {
        setView("auth");
        return;
      }
      renderUser(user);
      await loadOverview();
    } catch (error) {
      setView("auth");
      showLoginError(getErrorMessage(error.payload, error.message || "Không kiểm tra được phiên."));
    }
  }

  start();
})();
