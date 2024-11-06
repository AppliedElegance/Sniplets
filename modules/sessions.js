import { keyStore } from "./storage.js";


/** generate clean full URL to main popup page */
const getMainUrl = () => new URL(chrome.runtime.getURL("popup/main.html"));

/** Store list of opened session windows
 * @param {string[]} sessionList List of currently active sessions
 */
const setActiveSessions = async (sessionList) => keyStore.activeSessions.set(sessionList);

/** Retrieve list of opened session windows
 * @returns {Promise<string[]>} List of currently active sessions
 */
const getActiveSessions = async () => (await keyStore.activeSessions.get()) || [];

/** Retrieve last focused session */
async function getActiveSession() {
  const activeSessions = await getActiveSessions();
  return activeSessions[0];
}

/** Store a session's tab id for cleaner message passing
 * @param {string} tabId The tab id of the current window
 */
async function storeSession(tabId) {
  const activeSessions = await getActiveSessions();
  if (activeSessions.indexOf(tabId) > -1) {
    // move to start (first is active)
    activeSessions.sort((a, b) => a === tabId ? -1 : b === tabId ? 1 : 0);
  } else {
    activeSessions.unshift(tabId);
  }
  return setActiveSessions(activeSessions);
}

/** Remove a session's tab id from storage
 * @param {string} tabId The current window's tab ID
 */
async function removeSession(tabId) {
  /** @type {string[]} */
  const activeSessions = await getActiveSessions();
  const i = activeSessions.indexOf(tabId);
  return (i > -1) && setActiveSessions(activeSessions.splice(i, 1));
}

/** Get the currently active tab */
async function getCurrentTab() {
  const queryOptions = { active: true, currentWindow: true };
  const [tab] = await chrome.tabs.query(queryOptions);
  return tab;
}

/** Open the popup action */
async function openPopup() {
  return chrome.action.openPopup && chrome.action.openPopup()
  .then(() => true).catch((e) => (console.error(e), false));
}

/** Open a new popup window
 * @param {{[name:string]:string}} params Search parameters to add to the main URL
 */
async function openWindow(params = {}) {
  const src = getMainUrl();
  for (const [name, value] of Object.entries(params)) {
    src.searchParams.set(name, value);
  }
  src.searchParams.set('view', 'window');
  return chrome.windows.create({
    url: src.href,
    type: "popup",
    width: 700, // 867 for screenshots
    height: 460, // 540 for screenshots
  })
  .then(() => true).catch((e) => (console.error(e), false));
}

/** Open a new side panel for the tab
 * @param {string} tab The current tab ID
 * @param {{[name:string]:string}} params Any parameters to honour (current folder, etc.)
 */
async function openPanel(tab, params = {}) {
  tab ||= await getCurrentTab();
  if (!tab) return;

  const src = getMainUrl();
  for (const [name, value] of Object.entries(params)) {
    src.searchParams.set(name, value);
  }
  src.searchParams.set('view', 'panel');

  await chrome.sidePanel.setOptions({
    tabId: tab.id,
    enabled: true,
    path: src.href,
  });
  return chrome.sidePanel.open({
    tabId: tab.id,
  })
    .then(() => true)
    .catch((e) => (console.error(e), false));
}


export {
  getMainUrl,
  getActiveSession,
  storeSession,
  removeSession,
  getCurrentTab,
  openPopup,
  openPanel,
  openWindow,
  // openSession,
};