import { Contexts } from '/modules/refs.js'

/** generate clean full URL to main popup page */
const getMainUrl = () => new URL(chrome.runtime.getURL('popup/main.html'))

/** Get the currently active tab */
async function getCurrentTab() {
  const queryOptions = { active: true, currentWindow: true }
  const [tab] = await chrome.tabs.query(queryOptions)
  return tab
}

/** Open the popup action if possible
 * @param {URL} [url] The full url to open if popup unavailable
 */
async function openPopup(url) {
  url ||= chrome.action.getPopup()
  if (!url) return
  // url.searchParams.set('view', Contexts.POPUP)
  // chrome.action.setPopup({
  //   popup: url,
  // })
  const result = chrome.action.openPopup && await chrome.action.openPopup().catch(e => e)
  if (!result || result instanceof Error) {
    return openWindow(url)
  }
  return true
}

/** Open a new side panel for the tab
 * @param {URL} url full url to open
 * @param {chrome.tabs.Tab} [tab] The target tab
 */
async function openPanel(url, tab) {
  url.searchParams.set('view', Contexts.SIDE_PANEL)
  const targetTab = tab || await getCurrentTab()
  if (!targetTab) return

  await chrome.sidePanel.setOptions({
    tabId: targetTab.id,
    enabled: true,
    path: url.href,
  })
  const result = await chrome.sidePanel.open({
    tabId: targetTab.id,
  }).catch(e => e)
  return (result instanceof Error) ? false : true
}

/** Open a new popup window
 * @param {URL} url full url object to open
 */
async function openWindow(url) {
  url.searchParams.set('view', Contexts.TAB)

  // There can be more than one window open so provide a unique ID
  url.searchParams.set('uuid', crypto.randomUUID())
  const result = await chrome.windows.create({
    url: url.href,
    type: 'popup',
    width: 700, // 867 for screenshots
    height: 460, // 540 for screenshots
  }).catch(e => e)
  return (result instanceof Error) ? false : result
}

/** Open a new session in a specified context
 * @param {chrome.runtime.ContextType} contextType The type of session to open
 * @param {Array} params An array of search parameters to add to the main url
 */
async function openSession(contextType, params = []) {
  const src = getMainUrl()
  // go through params
  for (const [name, value] of params) {
    src.searchParams.set(name, value)
  }

  // available types
  const { POPUP, SIDE_PANEL, TAB } = chrome.runtime.ContextType
  const sessionMap = new Map([
    [POPUP, openWindow],
    [SIDE_PANEL, openPanel],
    [TAB, openWindow],
  ])

  const sessionMapFunc = sessionMap.get(contextType) ?? sessionMap.get(TAB)
  return sessionMapFunc(src)
}

export {
  getMainUrl,
  getCurrentTab,
  openPopup,
  openPanel,
  openWindow,
  openSession,
}
