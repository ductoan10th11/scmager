(function injectValidationScript() {
  const TARGET_HOSTNAME = "vanphongdientu.langson.gov.vn";
  const PAGE_USER_ID_REQUEST = "CHUYEN_XU_LY_READ_PAGE_USER_ID";
  const PAGE_USER_ID_RESPONSE = "CHUYEN_XU_LY_PAGE_USER_ID";

  if (location.hostname !== TARGET_HOSTNAME) {
    return;
  }

  function appendInjectedScript() {
    const parent = document.documentElement || document.head || document.body;
    if (!parent) {
      document.addEventListener("DOMContentLoaded", appendInjectedScript, { once: true });
      return;
    }

    if (document.documentElement?.dataset.chuyenXuLyContentInjected === "1") {
      return;
    }

    if (document.documentElement) {
      document.documentElement.dataset.chuyenXuLyContentInjected = "1";
    }

    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("injected.js");
    script.onload = () => {
      console.log("[ChuyenXuLy] Content script da chen injected.js vao trang.");
      script.remove();
    };
    script.onerror = () => {
      console.log("[ChuyenXuLy] Loi: khong chen duoc injected.js vao trang.");
    };

    parent.appendChild(script);
  }

  appendInjectedScript();

  if (chrome.runtime.onMessage.hasListeners?.()) {
    return;
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== "CHUYEN_XU_LY_GET_PAGE_USER_ID") {
      return false;
    }

    const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const timeoutId = window.setTimeout(() => {
      window.removeEventListener("message", handlePageMessage);
      sendResponse({ userId: "" });
    }, 800);

    function handlePageMessage(event) {
      if (event.source !== window || event.data?.type !== PAGE_USER_ID_RESPONSE) {
        return;
      }

      if (event.data.requestId !== requestId) {
        return;
      }

      window.clearTimeout(timeoutId);
      window.removeEventListener("message", handlePageMessage);
      sendResponse({ userId: event.data.userId || "" });
    }

    window.addEventListener("message", handlePageMessage);
    window.postMessage({ type: PAGE_USER_ID_REQUEST, requestId }, "*");
    return true;
  });
})();
