import { i18n, ContextTypes } from '/modules/refs.js'
import settings from '/modules/settings.js'
import { Space, DataBucket, getStorageArea } from '/modules/spaces.js'
import { getStorageData, removeStorageData, KeyStore } from '/modules/storage.js'
import { sendMessage, buildContextMenus, snipSelection, pasteSnip, parseContextMenuData } from '/modules/actions.js'
import { getMainUrl, openSession } from '/modules/sessions.js'

/** Sends a followup action to a main page.
 * If no extension pages are open, the followup will be stored in session
 * and a new window opened to action it.
 * @param {string} type Action which needs handling in a popup window
 * @param {object=} args Properties needed by the followup function
 */
async function setFollowup(type, args = {}) {
  console.log(type, args)

  const followup = {
    type: type,
    args: args || {}, // default value for destructuring
  }

  // check for open sessions (only in case of POPUP or SIDE_PANEL)
  const sessions = await chrome.runtime.getContexts({
    contextTypes: [
      ContextTypes.SIDE_PANEL,
      ContextTypes.POPUP,
    ],
  })

  // alert any contexts associated with a tab that they should check for follow-ups
  const sidePanel = sessions.find(o => o.contextType === ContextTypes.SIDE_PANEL)
  const popup = sessions.find(o => o.contextType === ContextTypes.POPUP)
  const session = sidePanel || popup
  if (session) {
    sendMessage('followup', followup, session)
      .catch(e => (console.error(e, followup)))
  } else {
    // save followup as session data and open a new session to action it
    await KeyStore.followup.set(followup)
    await settings.load()
    openSession(ContextTypes.get(settings.view.action))
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

  // check currently stored data
  // console.log(await chrome.storage.local.get(null), await chrome.storage.sync.get(null));

  // prepare defaults
  if (!(await settings.load())) {
    // settings init in case of corrupt data
    settings.init()
    // bug check if the default space is in the wrong area
    const { name, synced } = settings.defaultSpace
    if (!(await getStorageData(name, getStorageArea(synced)))) {
      if (await getStorageData(name, getStorageArea(!synced))) {
        settings.defaultSpace.synced = !synced
      }
    }
    settings.save()
  }

  // set default action as needed
  setDefaultAction(settings.view.action)

  // prepare space for init
  const space = new Space()

  // check for current space in case of reinstall
  // TODO: make legacy check explicit
  const currentSpace = (await KeyStore.currentSpace.get()) || (await getStorageData('currentSpace', 'local'))
  if (!(await space.load(currentSpace || settings.defaultSpace))) {
    // legacy check for existing sniplets
    const legacySpace = { name: 'snippets', synced: true }
    if (await space.load(legacySpace)) {
      // confirm that legacy space is indeed legacy and shift
      const lastVersion = space.data.version.split('.')
      if ((+lastVersion.at(0) === 0) && (+lastVersion.at(1) < 9)) {
        space.name = settings.defaultSpace.name
        if (await space.save(settings.data)) await removeStorageData(legacySpace.name, getStorageArea(legacySpace.synced))
      } else {
        // update default space... (should never happen as this value was not set in legacy versions)
        settings.defaultSpace = legacySpace
        settings.save()
      }
    } else {
      // no space data found, create new space and, if initial install add tutorial
      try {
        await space.init(currentSpace || settings.defaultSpace)
      } catch (e) {
        console.error('It looks like some corrupt data is left over. initializing from scratch', e)
        settings.init()
        await settings.save()
        await space.init() // if it still throws the extension is borked
      }

      if (details.reason === chrome.runtime.OnInstalledReason.INSTALL) {
        // load tutorial data
        const starterPath = `/_locales/${i18n('locale')}/starter.json`
        try {
          const starterFile = await fetch(starterPath)
          const starterContent = await starterFile.json()
          const starterData = new DataBucket(starterContent.data)
          space.data = await starterData.parse()
        } catch (e) {
          console.error(`Starter data could not be loaded at ${starterPath}`, e)
        }
      }
      await space.save(settings.data)
    }
  } else {
    buildContextMenus(space)
  }
  await space.setAsCurrent(settings.control.saveSource)
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

  // use callback only to avoid losing gesture
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
  //   src.searchParams.append('view', 'window');
  //   chrome.windows.create({
  //     url: src.href,
  //     type: "popup",
  //     width: 700, // 867 for screenshots
  //     height: 460, // 540 for screenshots
  //   });
  // }
})

// set up context menu listener
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  // get details from menu item and ignore "empty" ones (sanity check)
  const { action, ...data } = parseContextMenuData(info.menuItemId)
  if (!action) return

  // set up injection target
  const target = {
    tabId: tab.id,
    ...info.frameId ? { frameIds: [info.frameId] } : {},
  }

  // TODO: add followups
  // get menu action and perform accordingly
  switch (action) {
    case 'snip': {
      const result = await snipSelection(target, data).catch(e => e)
      console.log(result)
      break
    }

    case 'paste': {
      const result = await pasteSnip(target, data).catch(e => e)
      console.log(result)
      break
    }

    default:
      break
  } // end switch(action)
})

chrome.commands.onCommand.addListener((command, tab) => {
  const target = { tabId: tab.id }
  const data = { pageUrl: tab.url }

  setFollowup('check', { command: command, target: target, data: data })

  // switch (command) {
  //   case 'snip':
  //     snipSelection(target, data)
  //     break

  //   case 'paste':
  //     setFollowup('paste', {
  //       target: target,
  //       data: data,
  //     })
  //     break

  //   default:
  //     break
  // }
  return
})

// update spaces and menu items as needed
chrome.storage.onChanged.addListener(async (changes, areaName) => {
  // console.log(changes, areaName);
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
      // console.log(name, synced, areaName);
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
