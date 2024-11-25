import { Contexts } from '/modules/refs.js'

/** generate clean full URL to main popup page */
const getMainUrl = () => new URL(chrome.runtime.getURL('popup/main.html'))

/** Get the currently active tab */
async function getCurrentTab() {
  const queryOptions = { active: true, currentWindow: true }
  const [tab] = await chrome.tabs.query(queryOptions)
  return tab
}

/** Open the popup action if possible */
async function openPopup() {
  return chrome.action.openPopup && chrome.action.openPopup()
    .then(() => true)
    .catch(e => (console.error(e)))
}

/** Open a new side panel for the tab
 * @param {URL} url full url to open
 * @param {chrome.tabs.Tab=} tab The target tab
 */
async function openPanel(url, tab) {
  url.searchParams.set('view', 'panel')
  const targetTab = tab || await getCurrentTab()
  if (!targetTab) return

  await chrome.sidePanel.setOptions({
    tabId: targetTab.id,
    enabled: true,
    path: url.href,
  })
  return chrome.sidePanel.open({
    tabId: targetTab.id,
  })
    .then(() => true)
    .catch(e => (console.error(e), false))
}

/** Open a new popup window
 * @param {URL} url full url object to open
 */
async function openWindow(url) {
  url.searchParams.set('view', 'window')

  // There can be more than one window open so provide a unique ID
  url.searchParams.set('uuid', crypto.randomUUID())
  return chrome.windows.create({
    url: url.href,
    type: 'popup',
    width: 700, // 867 for screenshots
    height: 460, // 540 for screenshots
  })
    .then(() => true)
    .catch(e => (console.error(e), false))
}

/** Open a new session in a specified context
 * @param {string} view The type of session to open
 * @param {Array} params An array of search parameters to add to the main url
 */
async function openSession(view, params = []) {
  const src = getMainUrl()
  // go through params
  for (const [name, value] of params) {
    src.searchParams.set(name, value)
  }

  switch (Contexts.get(view)) {
    case Contexts.POPUP:
      if (!(await openPopup())) openWindow(src)
      break

    case Contexts.SIDE_PANEL:
      openPanel(src)
      break

    default:
      openWindow(src)
      break
  }
}

export {
  getMainUrl,
  getCurrentTab,
  openPopup,
  openPanel,
  openWindow,
  openSession,
}
