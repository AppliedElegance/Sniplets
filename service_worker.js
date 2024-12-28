import { i18n, Contexts } from '/modules/refs.js'
import settings from '/modules/settings.js'
import { Space, DataBucket } from '/modules/spaces.js'
import { getStorageData, KeyStore, StorageKey } from '/modules/storage.js'
import { sendMessage, buildContextMenus, parseContextMenuData, commandMap, runCommand } from '/modules/commands.js'
import { getMainUrl, openSession } from '/modules/sessions.js'

/** Sends a followup action to a main page.
 * If no extension pages are open, the followup will be stored in session
 * and a new window opened to action it.
 * @param {string} action Action which needs handling in a popup window
 * @param {object} [args] Properties needed by the followup function
 */
async function setFollowup(action, args = {}) {
  console.log('Setting followup...', action, args)

  const followup = {
    action: action,
    args: args,
  }

  // check for visible open sessions (only in case of POPUP or SIDE_PANEL)
  const sessions = await chrome.runtime.getContexts({
    contextTypes: [
      Contexts.SIDE_PANEL,
      Contexts.POPUP,
    ],
  })

  // send followup to any found contexts available to the current tab if possible
  const session = sessions.find(o =>
    (+(new URL(o.documentUrl).searchParams.get('tabId')) === args.target?.tabId),
  ) || sessions.find(o =>
    !(new URL(o.documentUrl).searchParams.get('tabId')),
  )
  console.log(session, sessions)
  if (session) {
    sendMessage('followup', followup, session)
      .catch(e => (console.warn(e, followup)))
  } else {
    // save followup as session data and open a new session to action it
    await KeyStore.followup.set(followup)
    await settings.load()
    openSession(Contexts.get(settings.view.action))
  }

  return
}

/** Set what the browser action bar button does
 * @param {'popup'|'panel'|'panel-toggle'|'window'} action type of window to open
 */
function setDefaultAction(action) {
  // set popup action
  if (action === 'popup') {
    chrome.action.setPopup({ popup: 'popup/main.html?view=popup' })
      .catch(e => console.error(e))
  } else {
    chrome.action.setPopup({ popup: '' })
      .catch(e => console.error(e))
  }

  // set side panel action
  if (action === 'panel') {
    // disable except when opened by action on specific tab
    chrome.sidePanel.setOptions({ enabled: false })
      .catch(e => console.error(e))
  } else {
    // enable for right-click open and toggle action
    chrome.sidePanel.setOptions({ enabled: true })
      .catch(e => console.error(e))
  }

  // set side panel toggle behaviour
  if (action === 'panel-toggle') {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
      .catch(e => console.error(e))
  } else {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false })
      .catch(e => console.error(e))
  }
}

// init on installation
chrome.runtime.onInstalled.addListener(async (details) => {
  // force refresh
  self.skipWaiting()

  // console.log('Checking currently stored data...',
  //   await chrome.storage.local.get(null),
  //   await chrome.storage.sync.get(null),
  // )

  // prepare defaults
  if (!(await settings.load())) {
    // settings init in case of corrupt data
    settings.init()
    // bug check if the default space is in the wrong area
    if (!settings.defaultSpace.get()) {
      const testSpace = new StorageKey(settings.defaultSpace.key, !settings.defaultSpace.synced)
      if (await testSpace.get()) settings.defaultSpace.area = testSpace.area
    }
    settings.save()
  }

  // set default action as needed
  setDefaultAction(settings.view.action)

  // prepare space for init
  const space = new Space()

  // check for current space in case of reinstall
  const legacyCurrentSpace = new StorageKey('currentSpace', 'local')
  const currentSpace = await KeyStore.currentSpace.get() || await legacyCurrentSpace.get()
  if (!(await space.load(currentSpace || settings.defaultSpace))) {
    // no space data found, create new space
    await space.init(currentSpace || settings.defaultSpace)

    // if initial install add tutorial
    if (details.reason === chrome.runtime.OnInstalledReason.INSTALL) {
      const starterPath = `/_locales/${i18n('locale')}/starter.json`
      try {
        const starterFile = await fetch(starterPath)
        const starterContent = await starterFile.json()
        const starterData = new DataBucket(starterContent.data)
        space.data = await starterData.parse()
      } catch (e) {
        console.warn(`Starter data could not be loaded at ${starterPath}`, e)
      }
    }

    // save new space
    await space.save(settings.data)
  }
  await space.setAsCurrent(settings.view.rememberPath)
  buildContextMenus(space)
})

chrome.runtime.onStartup.addListener(async () => {
  // rebuild context menus in case of crash or CCleaner deletion
  const space = new Space()
  if (await space.loadCurrent()) buildContextMenus(space)
})

chrome.action.onClicked.addListener((tab) => {
  // Open the side panel when set instead of a popup (only triggered when popup not set)
  if (!tab.id) return

  const src = getMainUrl()
  src.searchParams.append('view', 'panel')
  src.searchParams.append('tabId', tab.id)

  // use single callback only to avoid losing gesture (nested callbacks and async are broken)
  chrome.sidePanel.setOptions({
    tabId: tab.id,
    enabled: true,
    path: src.href,
  }, () => {
    chrome.sidePanel.open({
      tabId: tab.id,
    })
  })

  // It's currently not possible to check settings storage when inactive on this gesture
  // if (settings.view.action === 'window') {
  //   src.searchParams.append('view', 'window')
  //   chrome.windows.create({
  //     url: src.href,
  //     type: "popup",
  //     width: 700, // 867 for screenshots
  //     height: 460, // 540 for screenshots
  //   })
  // }
})

// handle context menu and keyboard shortcut commands
async function handleCommand(command, args) {
  console.log('Handling command...', command, args)
  // Get result and convert caught errors to serializable object for passing to window
  const result = await runCommand(command, args)
    .catch(e => ({ error: {
      name: e.name,
      message: e.message,
      cause: e.cause,
    } }))
  console.log(result)

  // set followup if anything was returned
  if (result) setFollowup(command, {
    ...args,
    ...result,
  })
}

// set up context menu listener
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  // console.log('Context menu clicked...', info, tab)

  // get details from menu item and ignore "empty" ones (sanity check)
  const { command, ...data } = parseContextMenuData(info.menuItemId)
  if (!commandMap.has(command)) return

  // set up command injection
  handleCommand(command, {
    target: {
      tabId: tab.id,
      ...info.frameId ? { frameIds: [info.frameId] } : {},
    },
    ...info,
    ...data,
  })
})

chrome.commands.onCommand.addListener(async (command, tab) => {
  // console.log('Keyboard command received...', command, tab)
  if (!commandMap.has(command)) return

  // Get result and convert caught errors to serializable object
  handleCommand(command, {
    target: { tabId: tab.id },
    pageUrl: tab.url,
  })
})

// update spaces and menu items as needed
chrome.storage.onChanged.addListener(async (changes, areaName) => {
  // console.log('Storage changed...', changes, areaName)
  const synced = (areaName === 'sync')

  for (const [key, change] of Object.entries(changes)) {
    // check for settings updates and update the action as necessary
    if ((key === KeyStore.settings.key) && change.newValue) {
      // update actions to match new settings
      if (change.newValue.view.action !== change.oldValue?.view.action) {
        setDefaultAction(change.newValue.view.action)
      }
    }

    // check for data updates, key can be anything
    if (change.newValue?.children) {
      // send a message to update any open windows
      sendMessage('updateSpace', {
        name: key,
        synced: synced,
        timestamp: change.newValue.timestamp,
      }).catch(() => false)

      // check if current space was changed
      const currentSpace = await KeyStore.currentSpace.get()
      if (!currentSpace || (currentSpace.name === key && currentSpace.synced === synced)) {
        const space = new Space()
        try {
          await space.init({
            name: key,
            synced: synced,
            data: change.newValue,
          })
          buildContextMenus(space)
        } catch (e) {
          console.error(e)
        }
      }
    }

    // check for removed sync data without local data
    if (
      synced
      && change.oldValue?.children
      && !change.newValue
    ) {
      // double-check we don't have a local space with the same name
      if (!(await getStorageData(key, 'local'))) {
        // don't lose the data on other synced instances without confirming first
        setFollowup('unsynced', {
          name: key,
          data: change.oldValue,
        })
      }
    }
  }
})
