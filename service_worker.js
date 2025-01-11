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
  // console.log('Setting followup...', action, args)

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
  if (session) {
    const sendResult = sendMessage('followup', followup, session).catch(e => e)
    // console.log(sendResult)
    if (sendResult instanceof Error) return
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

  // shorthands for enum comparison of reason this event was triggered
  const { INSTALL, UPDATE } = chrome.runtime.OnInstalledReason

  console.log('Checking currently stored data...',
    await chrome.storage.local.get(null),
    await chrome.storage.sync.get(null),
  )

  // prepare defaults
  if (!(await settings.load())) {
    // legacy check
    const legacyKey = new StorageKey('settings', 'sync')
    const legacySettings = await legacyKey.get()

    // load legacy settings or reinitialize if legacy is undefined
    settings.init(legacySettings)

    // bug check if the default space is in the wrong area (should be save to remove by v1.0)
    if (!settings.defaultSpace.get()) {
      const testSpace = new StorageKey(settings.defaultSpace.name, !settings.defaultSpace.synced)
      if (await testSpace.get()) settings.defaultSpace.area = testSpace.area
    }

    // clean up legacy and save
    settings.save()
    legacyKey.clear()
  }
  const { defaultSpace, view: { action }, data: { compress } } = settings
  console.log(settings.entries)

  // set default action as needed
  setDefaultAction(action)

  // prepare space for init
  const space = new Space()

  // check for current space in case of reinstall (with legacy check since it's been moved)
  const legacyCurrentSpace = new StorageKey('currentSpace', 'local')
  const currentSpace = await KeyStore.currentSpace.get() || await legacyCurrentSpace.get()

  // try to load up current space or fall back to default
  if (!(await space.load(currentSpace || defaultSpace))) {
    console.log('creating new space')
    // no space data found, create new space
    await space.init(defaultSpace)

    // if initial install add tutorial
    if (details.reason === INSTALL) {
      const starterPath = `/_locales/${i18n('locale')}/starter.json`
      try {
        const starterFile = await fetch(starterPath)
        const starterContent = await starterFile.json()
        const starterData = new DataBucket(starterContent.data)
        space.data = await starterData.parse()
      } catch {
        // no starter data, hopefully won't happen
        // console.warn(`Starter data could not be loaded at ${starterPath}`, e)
      }
    }

    // save new space and update local current
    if (await space.save(compress)) {
      space.setAsCurrent()
      legacyCurrentSpace.clear()
    }
  } else if (details.reason === UPDATE && space.name === 'Snippets') {
    console.log('branding update')
    // update branding
    settings.defaultSpace.key = KeyStore.defaultSpace.key
    settings.save()
    await space.rename(settings.defaultSpace.name)
  }
  console.log(details.reason, UPDATE, space.name, 'Snippets')

  // make sure any updates to the current space are saved and remove legacy
  await space.setAsCurrent()
  legacyCurrentSpace.clear()

  // build context menu for current data
  buildContextMenus(space)

  // add update notice on next use
  if (details.reason === UPDATE) {
    // Set update details for next loads
    KeyStore.notice.set({
      tagline: i18n('update_tagline'),
      highlights: [
        i18n('update_highlight_1'),
        i18n('update_highlight_2'),
        i18n('update_highlight_3'),
        i18n('update_highlight_4'),
      ],
    })
  }

  console.log('Checking currently stored data...',
    await chrome.storage.local.get(null),
    await chrome.storage.sync.get(null),
  )
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
  //     type: 'popup',
  //     width: 700, // 867 for screenshots
  //     height: 460, // 540 for screenshots
  //   })
  // }
})

// handle context menu and keyboard shortcut commands
async function handleCommand(command, args) {
  // console.log('Handling command...', command, args)
  // Get result and convert caught errors to serializable object for passing to window
  const result = await runCommand(command, args)
    .catch(e => ({ error: {
      name: e.name,
      message: e.message,
      cause: e.cause,
    } }))

  // set followup if anything was returned
  if (result) setFollowup(command, {
    ...args,
    ...result,
  })
}

// set up context menu listener
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  // console.log('Context menu clicked...', info, tab)

  // get details from menu item and ignore 'empty' ones (sanity check)
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
  console.log('Storage changed...', changes, areaName)
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
      const spaceKey = new StorageKey(currentSpace.key ?? currentSpace.name, currentSpace.area ?? currentSpace.synced)
      if (!currentSpace || (spaceKey.key === key && spaceKey.area === areaName)) {
        const space = new Space()
        try {
          await space.init({
            name: key,
            synced: synced,
            data: change.newValue,
          })
          // console.log('rebuilding context menus', structuredClone(space))
          buildContextMenus(space)
        } catch (e) {
          console.error(e)
        }
      }
    }

    // check for active removed sync data without local data
    if (
      synced // only care about synced spaces
      && change.oldValue?.children // only spaces have children
      && !change.newValue // removed, not changed
    ) {
      const { timestamp } = change.oldValue
      // double-check it wasn't renamed
      /** @type {{oldName:string,newName:string,timestamp:number}[]} */
      const renameLog = await KeyStore.renameLog.get()
      if (renameLog.find(v => (key === v.oldName && timestamp < v.timestamp))) break

      // double-check we don't have it locally
      if (await getStorageData(key, 'local')) break

      // don't lose the data on other synced instances without confirming first
      const followup = {
        action: 'unsynced',
        args: {
          name: key,
          data: change.oldValue,
        },
      }
      sendMessage('followup', followup).catch(async () => {
        // open a new window to handle the followup if no sessions open
        await KeyStore.followup.set(followup)
        await settings.load()
        openSession(Contexts.get(settings.view.action))
      })
    }
  }
})
