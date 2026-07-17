const SIDE_PANEL_PATH = "sidepanel.html";

async function getActiveTab() {
  const [activeTab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  return activeTab || null;
}

async function openSidePanel(tabId) {
  if (!chrome.sidePanel?.open) {
    throw new Error("Chrome Side Panel API is not available.");
  }

  if (typeof tabId === "number") {
    await chrome.sidePanel.setOptions({
      tabId,
      path: SIDE_PANEL_PATH,
      enabled: true,
    });
    await chrome.sidePanel.open({ tabId });
    return;
  }

  const activeTab = await getActiveTab();
  if (activeTab?.id) {
    await chrome.sidePanel.setOptions({
      tabId: activeTab.id,
      path: SIDE_PANEL_PATH,
      enabled: true,
    });
    await chrome.sidePanel.open({ tabId: activeTab.id });
    return;
  }

  const currentWindow = await chrome.windows.getCurrent();
  await chrome.sidePanel.open({ windowId: currentWindow.id });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true });
});

chrome.action.onClicked.addListener((tab) => {
  openSidePanel(tab?.id).catch((error) => {
    console.error("[SidePanel] Không mở được Side Panel khi click icon.", error);
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "OPEN_SIDE_PANEL") {
    return false;
  }

  openSidePanel(sender.tab?.id)
    .then(() => {
      sendResponse({ ok: true });
    })
    .catch((error) => {
      console.error("[SidePanel] Không mở được Side Panel từ message.", error);
      sendResponse({ ok: false, error: error.message });
    });

  return true;
});
