(function installChuyenXuLyValidator() {
  const VERSION = "1.2.0";
  const TARGET_HOSTNAME = "vanphongdientu.langson.gov.vn";
  const PAGE_USER_ID_REQUEST = "CHUYEN_XU_LY_READ_PAGE_USER_ID";
  const PAGE_USER_ID_RESPONSE = "CHUYEN_XU_LY_PAGE_USER_ID";
  const SUBMIT_CHANGE_STATUS = true;
  const BUTTON_SELECTOR = "#btnActionChuyenXuLy";
  const ORIGINAL_DUE_DATE_SELECTOR = "#txtHanXuLyChuyenTiep";
  const ORIGINAL_COMMENT_SELECTOR = "#txtCommentChuyenTiep";
  const ORIGINAL_KEY = "__codexOriginalChuyentiepClick";
  const WRAPPED_KEY = "__codexWrappedChuyentiepClick";

  const STYLE_ID = "codex-chuyen-xuly-validator-style";
  const CONTROLS_ID = "codex-chuyen-xuly-controls";
  const DUE_DATE_ID = "codexHanXuLyKpi";
  const POINT_ID = "codexDiemKpi";
  const VIEW_ONLY_ID = "codexChiXemKpi";

  const INVALID_CLASS = "codex-chuyen-xuly-invalid";
  const VALID_CLASS = "codex-chuyen-xuly-valid";
  const POINT_TOKEN_PATTERN = /\[p:\s*([^\]]*)]/i;
  const LEGACY_POINT_TOKEN_PATTERN = /<point:\s*([^>]*)>/i;
  const VALID_POINT_PATTERN = /^(?:\d+\.?\d*|\.\d+)$/;
  let viewOnlySnapshot = null;
  let bindScheduled = false;

  if (location.hostname !== TARGET_HOSTNAME) {
    return;
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.type !== PAGE_USER_ID_REQUEST) {
      return;
    }

    window.postMessage(
      {
        type: PAGE_USER_ID_RESPONSE,
        requestId: event.data.requestId,
        userId: typeof window.user_id === "string" || typeof window.user_id === "number"
          ? String(window.user_id)
          : "",
      },
      "*"
    );
  });

  function trimValue(element) {
    return element && typeof element.value === "string" ? element.value.trim() : "";
  }

  function parseDateInputValue(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) {
      return null;
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(year, month - 1, day);

    if (
      date.getFullYear() !== year ||
      date.getMonth() !== month - 1 ||
      date.getDate() !== day
    ) {
      return null;
    }

    return date;
  }

  function formatDateInputValue(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function formatDisplayDateValue(inputValue) {
    const date = parseDateInputValue(inputValue);
    if (!date) {
      return "";
    }

    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  }

  function parseDisplayDateValue(value) {
    const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim());
    if (!match) {
      return "";
    }

    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);
    const date = new Date(year, month - 1, day);

    if (
      date.getFullYear() !== year ||
      date.getMonth() !== month - 1 ||
      date.getDate() !== day
    ) {
      return "";
    }

    return formatDateInputValue(date);
  }

  function getTodayDate() {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), today.getDate());
  }

  function getYesterdayInputValue() {
    const yesterday = getTodayDate();
    yesterday.setDate(yesterday.getDate() - 1);
    return formatDateInputValue(yesterday);
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${CONTROLS_ID} {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        margin-right: 6px;
        vertical-align: middle;
        white-space: nowrap;
      }

      #${CONTROLS_ID} + ${BUTTON_SELECTOR} {
        margin-top: 0;
        vertical-align: middle;
      }

      #${CONTROLS_ID} .codex-kpi-field {
        display: inline-flex;
        position: relative;
        flex-direction: row;
        align-items: center;
        gap: 5px;
        min-width: 0;
      }

      #${CONTROLS_ID} .codex-kpi-field > label {
        margin: 0;
        color: #333;
        font-size: 12px;
        line-height: 1.2;
        font-weight: 600;
        white-space: nowrap;
      }

      #${CONTROLS_ID} input[type="date"],
      #${CONTROLS_ID} input[type="number"] {
        width: 112px;
        height: 34px;
        padding: 6px 8px;
        border: 1px solid #ccc;
        border-radius: 4px;
        background: #fff;
        color: #333;
        font-size: 13px;
        line-height: 1.42857143;
      }

      #${CONTROLS_ID} input[type="number"] {
        width: 58px;
      }

      #${CONTROLS_ID} .codex-switch {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        margin: 0 4px;
        color: #333;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        user-select: none;
      }

      #${CONTROLS_ID} .codex-switch input {
        position: absolute;
        opacity: 0;
        pointer-events: none;
      }

      #${CONTROLS_ID} .codex-switch-track {
        position: relative;
        width: 39px;
        height: 22px;
        border-radius: 999px;
        background: #c8c8c8;
        transition: background 0.18s ease;
      }

      #${CONTROLS_ID} .codex-switch-track::after {
        content: "";
        position: absolute;
        top: 3px;
        left: 3px;
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: #fff;
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
        transition: transform 0.18s ease;
      }

      #${VIEW_ONLY_ID}:checked + .codex-switch-track {
        background: #28a745;
      }

      #${VIEW_ONLY_ID}:checked + .codex-switch-track::after {
        transform: translateX(17px);
      }

      .${INVALID_CLASS} {
        border-color: #dc3545 !important;
        box-shadow: 0 0 0 0.2rem rgba(220, 53, 69, 0.18) !important;
      }

      .${VALID_CLASS} {
        border-color: #28a745 !important;
        box-shadow: 0 0 0 0.2rem rgba(40, 167, 69, 0.16) !important;
      }
    `;

    (document.head || document.documentElement).appendChild(style);
  }

  function ensureControls(button) {
    if (!button) {
      return;
    }

    if (document.getElementById(CONTROLS_ID)) {
      ensureDateInputDefault();
      return;
    }

    const controls = document.createElement("span");
    controls.id = CONTROLS_ID;
    controls.innerHTML = `
      <span class="codex-kpi-field">
        <label for="${DUE_DATE_ID}">Hạn xử lý</label>
        <input type="date" id="${DUE_DATE_ID}" autocomplete="off">
      </span>
      <span class="codex-kpi-field">
        <label for="${POINT_ID}">Điểm</label>
        <input type="number" id="${POINT_ID}" min="0" step="0.1" placeholder="0">
      </span>
      <label class="codex-switch" for="${VIEW_ONLY_ID}">
        <input type="checkbox" id="${VIEW_ONLY_ID}" role="switch">
        <span class="codex-switch-track" aria-hidden="true"></span>
        <span>Chỉ xem</span>
      </label>
    `;

    button.insertAdjacentElement("beforebegin", controls);
    ensureDateInputDefault();
    syncOriginalDueDateFromKpi();
  }

  function ensureDateInputDefault() {
    const dueDateInput = document.getElementById(DUE_DATE_ID);
    if (!dueDateInput) {
      return;
    }

    if (dueDateInput.type !== "date") {
      dueDateInput.type = "date";
    }

    const originalDueDateInput = document.querySelector(ORIGINAL_DUE_DATE_SELECTOR);
    const originalInputValue = trimValue(originalDueDateInput);
    const syncedValue = originalInputValue ? parseDisplayDateValue(originalInputValue) : "";

    if (syncedValue) {
      dueDateInput.value = syncedValue;
      return;
    }

    if (!dueDateInput.value) {
      dueDateInput.value = getYesterdayInputValue();
    }
  }

  function dispatchNativeEvents(element) {
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));

    if (window.jQuery) {
      window.jQuery(element).trigger("change");
    }
  }

  function syncOriginalDueDateFromKpi() {
    const dueDateInput = document.getElementById(DUE_DATE_ID);
    const originalDueDateInput = document.querySelector(ORIGINAL_DUE_DATE_SELECTOR);

    if (!dueDateInput || !originalDueDateInput) {
      return;
    }

    if (isViewOnlyEnabled()) {
      if (originalDueDateInput.value) {
        originalDueDateInput.value = "";
        dispatchNativeEvents(originalDueDateInput);
      }
      return;
    }

    const displayValue = formatDisplayDateValue(dueDateInput.value);
    if (!displayValue) {
      if (originalDueDateInput.value) {
        originalDueDateInput.value = "";
        dispatchNativeEvents(originalDueDateInput);
      }
      return;
    }

    if (originalDueDateInput.value === displayValue) {
      return;
    }

    originalDueDateInput.value = displayValue;
    dispatchNativeEvents(originalDueDateInput);
  }

  function syncKpiDueDateFromOriginal() {
    const dueDateInput = document.getElementById(DUE_DATE_ID);
    const originalDueDateInput = document.querySelector(ORIGINAL_DUE_DATE_SELECTOR);

    if (!dueDateInput || !originalDueDateInput) {
      return;
    }

    const originalValue = trimValue(originalDueDateInput);
    const inputValue = originalValue ? parseDisplayDateValue(originalValue) : "";

    if (dueDateInput.value === inputValue) {
      return;
    }

    dueDateInput.value = inputValue;
    dueDateInput.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function isValidPointText(value) {
    const normalizedValue = value.trim();
    const point = Number(normalizedValue);
    return VALID_POINT_PATTERN.test(normalizedValue) && Number.isFinite(point) && point >= 0;
  }

  function parsePointToken(value) {
    const match = POINT_TOKEN_PATTERN.exec(value) || LEGACY_POINT_TOKEN_PATTERN.exec(value);
    if (!match) {
      return {
        exists: false,
        rawValue: "",
        value: "",
        valid: false
      };
    }

    const rawValue = match[1].trim();
    return {
      exists: true,
      rawValue,
      value: isValidPointText(rawValue) ? rawValue : "",
      valid: isValidPointText(rawValue)
    };
  }

  function removePointToken(value) {
    return value
      .replace(POINT_TOKEN_PATTERN, "")
      .replace(LEGACY_POINT_TOKEN_PATTERN, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim();
  }

  function upsertPointToken(value, pointText) {
    const token = `[p:${pointText}]`;
    const contentWithoutToken = removePointToken(value);
    return contentWithoutToken ? `${token}\n${contentWithoutToken}` : token;
  }

  function syncOriginalCommentFromPoint() {
    const pointInput = document.getElementById(POINT_ID);
    const originalCommentInput = document.querySelector(ORIGINAL_COMMENT_SELECTOR);

    if (!pointInput || !originalCommentInput) {
      return;
    }

    if (isViewOnlyEnabled()) {
      const nextValue = removePointToken(originalCommentInput.value);
      if (originalCommentInput.value !== nextValue) {
        originalCommentInput.value = nextValue;
        dispatchNativeEvents(originalCommentInput);
      }
      return;
    }

    const pointText = trimValue(pointInput);
    let nextValue = originalCommentInput.value;

    if (!pointText) {
      nextValue = removePointToken(originalCommentInput.value);
    } else if (isValidPointText(pointText)) {
      nextValue = upsertPointToken(originalCommentInput.value, pointText);
    } else {
      return;
    }

    if (originalCommentInput.value === nextValue) {
      return;
    }

    originalCommentInput.value = nextValue;
    dispatchNativeEvents(originalCommentInput);
  }

  function syncKpiPointFromOriginal() {
    const pointInput = document.getElementById(POINT_ID);
    const originalCommentInput = document.querySelector(ORIGINAL_COMMENT_SELECTOR);

    if (!pointInput || !originalCommentInput) {
      return;
    }

    const pointToken = parsePointToken(originalCommentInput.value);
    const nextValue = pointToken.exists && pointToken.valid ? pointToken.value : "";

    if (pointInput.value === nextValue) {
      return;
    }

    pointInput.value = nextValue;
    pointInput.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function getFieldMessageId(element) {
    return `${element.id}__codexMessage`;
  }

  function setFieldState(element, state) {
    if (!element) {
      return;
    }

    element.classList.toggle(INVALID_CLASS, state === "invalid");
    element.classList.toggle(VALID_CLASS, state === "valid");

    if (state === "invalid") {
      element.setAttribute("aria-invalid", "true");
    } else if (state === "valid") {
      element.setAttribute("aria-invalid", "false");
    } else {
      element.removeAttribute("aria-invalid");
    }

    let label = document.getElementById(getFieldMessageId(element));
    if (label) {
      label.remove();
    }
  }

  function getControls() {
    return {
      dueDateInput: document.getElementById(DUE_DATE_ID),
      pointInput: document.getElementById(POINT_ID),
      viewOnlyInput: document.getElementById(VIEW_ONLY_ID)
    };
  }

  function isViewOnlyEnabled() {
    return Boolean(document.getElementById(VIEW_ONLY_ID)?.checked);
  }

  function captureViewOnlySnapshot() {
    const { dueDateInput, pointInput } = getControls();
    return {
      dueDateValue: dueDateInput?.value || "",
      pointValue: pointInput?.value || "",
      originalDueDateValue: document.querySelector(ORIGINAL_DUE_DATE_SELECTOR)?.value || "",
      originalCommentValue: document.querySelector(ORIGINAL_COMMENT_SELECTOR)?.value || ""
    };
  }

  function setValueAndDispatch(element, value, useNativeDispatch) {
    if (!element || element.value === value) {
      return;
    }

    element.value = value;

    if (useNativeDispatch) {
      dispatchNativeEvents(element);
      return;
    }

    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function clearFieldsForViewOnly() {
    const { dueDateInput, pointInput } = getControls();
    const originalDueDateInput = document.querySelector(ORIGINAL_DUE_DATE_SELECTOR);
    const originalCommentInput = document.querySelector(ORIGINAL_COMMENT_SELECTOR);

    setValueAndDispatch(dueDateInput, "", false);
    setValueAndDispatch(pointInput, "", false);
    setFieldState(dueDateInput, "valid");
    setFieldState(pointInput, "valid");

    setValueAndDispatch(originalDueDateInput, "", true);

    if (originalCommentInput) {
      setValueAndDispatch(originalCommentInput, removePointToken(originalCommentInput.value), true);
    }
  }

  function restoreFieldsAfterViewOnly() {
    const { dueDateInput, pointInput } = getControls();
    const originalDueDateInput = document.querySelector(ORIGINAL_DUE_DATE_SELECTOR);
    const originalCommentInput = document.querySelector(ORIGINAL_COMMENT_SELECTOR);
    const snapshot = viewOnlySnapshot;

    if (!snapshot) {
      ensureDateInputDefault();
      return;
    }

    setValueAndDispatch(dueDateInput, snapshot.dueDateValue, false);
    setValueAndDispatch(pointInput, snapshot.pointValue, false);
    setValueAndDispatch(originalDueDateInput, snapshot.originalDueDateValue, true);
    setValueAndDispatch(originalCommentInput, snapshot.originalCommentValue, true);

    syncOriginalDueDateFromKpi();
    syncOriginalCommentFromPoint();
  }

  function handleViewOnlyChange() {
    if (isViewOnlyEnabled()) {
      if (!viewOnlySnapshot) {
        viewOnlySnapshot = captureViewOnlySnapshot();
      }
      clearFieldsForViewOnly();
    } else {
      restoreFieldsAfterViewOnly();
      viewOnlySnapshot = null;
    }

    validateKpiFields();
  }

  function validateKpiFields() {
    const { dueDateInput, pointInput, viewOnlyInput } = getControls();
    const dueDate = trimValue(dueDateInput);
    const pointText = trimValue(pointInput);
    const point = Number(pointText);
    const viewOnly = Boolean(viewOnlyInput?.checked);
    const errors = [];

    if (viewOnly) {
      syncOriginalDueDateFromKpi();
      syncOriginalCommentFromPoint();
      setFieldState(dueDateInput, "valid");
      setFieldState(pointInput, "valid");

      return {
        valid: true,
        firstInvalidElement: null,
        errors: [],
        values: {
          hanXuLy: dueDate,
          hanXuLyGoc: formatDisplayDateValue(dueDate),
          diem: pointText ? point : null,
          diemToken: pointText ? `[p:${pointText}]` : "",
          chiXem: true
        }
      };
    }

    syncOriginalDueDateFromKpi();
    syncOriginalCommentFromPoint();

    if (!viewOnly) {
      if (!dueDate) {
        errors.push({
          field: "hanXuLy",
          reason: "empty-due-date",
          message: "Vui lòng nhập hạn xử lý.",
          element: dueDateInput
        });
        setFieldState(dueDateInput, "invalid");
      } else {
        const dueDateValue = parseDateInputValue(dueDate);

        if (!dueDateValue) {
          errors.push({
            field: "hanXuLy",
            reason: "invalid-due-date",
            message: "Hạn xử lý không hợp lệ.",
            element: dueDateInput
          });
          setFieldState(dueDateInput, "invalid");
        } else if (dueDateValue < getTodayDate()) {
          errors.push({
            field: "hanXuLy",
            reason: "past-due-date",
            message: "Hạn xử lý không được nhỏ hơn ngày hiện tại.",
            element: dueDateInput
          });
          setFieldState(dueDateInput, "invalid");
        } else {
          setFieldState(dueDateInput, "valid");
        }
      }
    }

    if (!pointText) {
      errors.push({
        field: "diem",
        reason: "empty-point",
        message: "Vui lòng nhập điểm.",
        element: pointInput
      });
      setFieldState(pointInput, "invalid");
    } else if (!Number.isFinite(point) || point < 0) {
      errors.push({
        field: "diem",
        reason: "invalid-point",
        message: "Điểm phải là số không âm.",
        element: pointInput
      });
      setFieldState(pointInput, "invalid");
    } else {
      setFieldState(pointInput, "valid");
    }

    return {
      valid: errors.length === 0,
      firstInvalidElement: errors.find((error) => error.element)?.element || null,
      errors: errors.map((error) => ({
        field: error.field,
        reason: error.reason,
        message: error.message
      })),
      values: {
        hanXuLy: dueDate,
        hanXuLyGoc: formatDisplayDateValue(dueDate),
        diem: pointText ? point : null,
        diemToken: pointText ? `[p:${pointText}]` : "",
        chiXem: viewOnly
      }
    };
  }

  function scrollToInvalidElement(element) {
    if (!element) {
      return;
    }

    element.scrollIntoView({
      behavior: "smooth",
      block: "center",
      inline: "nearest"
    });

    window.setTimeout(() => {
      if (typeof element.focus === "function") {
        element.focus({ preventScroll: true });
      }
    }, 250);
  }

  function logValidationResult() {
    const result = validateKpiFields();

    if (!result.valid) {
      scrollToInvalidElement(result.firstInvalidElement);
      console.log("[ChuyenXuLy] KPI fields khong hop le. Ham chinh dang bi chan.", result);
      return result;
    }

    console.log(
      SUBMIT_CHANGE_STATUS
        ? "[ChuyenXuLy] KPI fields hop le. Se goi ham chinh."
        : "[ChuyenXuLy] KPI fields hop le. Ham chinh dang bi chan.",
      result.values
    );
    return result;
  }

  function shouldSubmitOriginalAction(result) {
    return SUBMIT_CHANGE_STATUS && result.valid;
  }

  function bindLiveValidation(element) {
    if (!element || element.dataset.codexChuyenXuLyLiveValidation === VERSION) {
      return;
    }

    element.dataset.codexChuyenXuLyLiveValidation = VERSION;
    const validateIfMarked = () => {
      if (element.classList.contains(INVALID_CLASS) || element.classList.contains(VALID_CLASS)) {
        validateKpiFields();
      }
    };

    element.addEventListener("input", () => {
      if (element.id === POINT_ID) {
        syncOriginalCommentFromPoint();
      }
      validateIfMarked();
    });
    element.addEventListener("change", () => {
      if (element.id === DUE_DATE_ID) {
        syncOriginalDueDateFromKpi();
      }
      if (element.id === POINT_ID) {
        syncOriginalCommentFromPoint();
      }
      validateIfMarked();
    });
    element.addEventListener("blur", () => {
      if (element.id === POINT_ID) {
        syncOriginalCommentFromPoint();
      }
      validateIfMarked();
    });
  }

  function bindOriginalDueDateSync(element) {
    if (!element || element.dataset.codexChuyenXuLyOriginalDateSync === VERSION) {
      return;
    }

    element.dataset.codexChuyenXuLyOriginalDateSync = VERSION;
    element.addEventListener("input", syncKpiDueDateFromOriginal);
    element.addEventListener("change", syncKpiDueDateFromOriginal);
    element.addEventListener("blur", syncKpiDueDateFromOriginal);
    syncKpiDueDateFromOriginal();
  }

  function bindOriginalCommentSync(element) {
    if (!element || element.dataset.codexChuyenXuLyOriginalCommentSync === VERSION) {
      return;
    }

    element.dataset.codexChuyenXuLyOriginalCommentSync = VERSION;
    element.addEventListener("input", syncKpiPointFromOriginal);
    element.addEventListener("change", syncKpiPointFromOriginal);
    element.addEventListener("blur", syncKpiPointFromOriginal);
    syncKpiPointFromOriginal();
  }

  function bindSwitchValidation(element) {
    if (!element || element.dataset.codexChuyenXuLySwitchValidation === VERSION) {
      return;
    }

    element.dataset.codexChuyenXuLySwitchValidation = VERSION;
    element.addEventListener("change", handleViewOnlyChange);
  }

  function wrapChuyentiepClick(original) {
    if (original && original[WRAPPED_KEY] === VERSION) {
      return original;
    }

    const wrapped = function wrappedChuyentiepClick() {
      const result = logValidationResult();

      if (!shouldSubmitOriginalAction(result)) {
        return false;
      }

      if (typeof original === "function") {
        return original.apply(this, arguments);
      }

      return undefined;
    };

    wrapped[WRAPPED_KEY] = VERSION;
    wrapped[ORIGINAL_KEY] = original;
    return wrapped;
  }

  function hookGlobalFunction() {
    const descriptor = Object.getOwnPropertyDescriptor(window, "chuyentiepClick");

    if (descriptor && descriptor.configurable === false) {
      if (typeof window.chuyentiepClick === "function" && window.chuyentiepClick[WRAPPED_KEY] !== VERSION) {
        window.chuyentiepClick = wrapChuyentiepClick(window.chuyentiepClick);
      }
      return;
    }

    let currentValue = window.chuyentiepClick;

    Object.defineProperty(window, "chuyentiepClick", {
      configurable: true,
      enumerable: true,
      get() {
        return currentValue;
      },
      set(nextValue) {
        currentValue =
          typeof nextValue === "function" ? wrapChuyentiepClick(nextValue) : nextValue;
      }
    });

    if (typeof currentValue === "function") {
      currentValue = wrapChuyentiepClick(currentValue);
    }
  }

  function bindButtonGuard(button) {
    if (!button || button.dataset.codexChuyenXuLyGuard === VERSION) {
      return;
    }

    button.dataset.codexChuyenXuLyGuard = VERSION;
    console.log("[ChuyenXuLy] Da gan chan click cho button.", button);
    button.addEventListener(
      "click",
      function guardChuyenTiepClick(event) {
        const result = logValidationResult();

        if (!shouldSubmitOriginalAction(result)) {
          event.preventDefault();
          event.stopImmediatePropagation();
          return false;
        }

        return true;
      },
      true
    );
  }

  function bindCurrentElements() {
    const button = document.querySelector(BUTTON_SELECTOR);
    if (!button && !document.getElementById(CONTROLS_ID)) {
      return;
    }

    ensureStyles();
    ensureControls(button);
    bindButtonGuard(button);
    hookGlobalFunction();

    const { dueDateInput, pointInput, viewOnlyInput } = getControls();
    bindLiveValidation(dueDateInput);
    bindLiveValidation(pointInput);
    bindSwitchValidation(viewOnlyInput);
    bindOriginalDueDateSync(document.querySelector(ORIGINAL_DUE_DATE_SELECTOR));
    bindOriginalCommentSync(document.querySelector(ORIGINAL_COMMENT_SELECTOR));
    syncOriginalDueDateFromKpi();
    syncOriginalCommentFromPoint();
  }

  function scheduleBindCurrentElements() {
    if (bindScheduled) {
      return;
    }

    bindScheduled = true;
    window.requestAnimationFrame(() => {
      bindScheduled = false;
      bindCurrentElements();
    });
  }

  document.documentElement.dataset.chuyenXuLyValidatorInjected = "1";
  window.__chuyenXuLyValidator = {
    injected: true,
    version: VERSION,
    injectedAt: new Date().toISOString(),
    buttonSelector: BUTTON_SELECTOR,
    originalDueDateSelector: ORIGINAL_DUE_DATE_SELECTOR,
    originalCommentSelector: ORIGINAL_COMMENT_SELECTOR,
    submitChangeStatus: SUBMIT_CHANGE_STATUS,
    dueDateInputId: DUE_DATE_ID,
    pointInputId: POINT_ID,
    viewOnlyInputId: VIEW_ONLY_ID,
    test: logValidationResult
  };
  console.log("[ChuyenXuLy] injected.js da chay trong page context.", window.__chuyenXuLyValidator);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindCurrentElements, { once: true });
  } else {
    bindCurrentElements();
  }

  new MutationObserver(scheduleBindCurrentElements).observe(document.documentElement, {
    childList: true,
    subtree: true
  });
})();
