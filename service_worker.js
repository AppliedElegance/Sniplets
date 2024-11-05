import { i18n } from "./modules/refs.js";
import { Settings } from "./modules/classes/settings.js";
import { Space, DataBucket, getStorageArea } from "./modules/classes/spaces.js";
import { getStorageData, removeStorageData, getCurrentSpace, setFollowup, keyStore } from "./modules/storage.js";
import { buildContextMenus, snipSelection, pasteSnip } from "./modules/actions.js";


// cache settings
const settings = new Settings();

/** Set what the browser action bar button does
 * @param {'popup'|'panel'|'panel-toggle'|'window'} action type of window to open
 */
function setDefaultAction(action) {
  // set popup action
  if (action === 'popup') {
    chrome.action.setPopup({ popup: 'popup/main.html?view=popup' })
    .catch((error) => console.error(error));
  } else {
    chrome.action.setPopup({ popup: '' })
    .catch((error) => console.error(error));
  }

  // set side panel action
  if (action === 'panel-toggle') {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error(error));
  } else {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false })
    .catch((error) => console.error(error));
  }
}

// init on installation
chrome.runtime.onInstalled.addListener(async (details) => {
  // force refresh
  self.skipWaiting();

  // check currently stored data
  // console.log(await chrome.storage.local.get(null), await chrome.storage.sync.get(null));

  // prepare defaults
  if (!(await settings.load())) {
    // settings init in case of corrupt data
    settings.init();
    // bug check if the default space is in the wrong area
    const { name, synced } = settings.defaultSpace;
    if (!(await getStorageData(name, getStorageArea(synced)))) {
      if (await getStorageData(name, getStorageArea(synced))) {
        settings.defaultSpace.synced = !synced;
      }
    }
    settings.save();
  }

  // set default action as needed
  setDefaultAction(settings.view.action);

  // prepare space for init
  const space = new Space();

  // check for current space in case of reinstall
  const currentSpace = await keyStore.currentSpace.retrieve()
                    || await getStorageData('currentSpace', 'local');
  // console.log(currentSpace);
  if (!(await space.load(currentSpace || settings.defaultSpace))) {
    // legacy check for existing sniplets
    // console.log("Checking for legacy data...");
    const legacySpace = { name: "snippets", synced: true };
    if (await space.load(legacySpace)) {
      // console.log("Confirming that legacy space is indeed legacy and shifting...");
      const lastVersion = space.data.version.split('.');
      if ((+lastVersion[0] === 0) && (+lastVersion[1] < 9)) {
        // console.log("Shifting data to default space");
        space.name = settings.defaultSpace.name;
        if (await space.save()) await removeStorageData(legacySpace.name, getStorageArea(legacySpace.synced));
      } else {
        // console.log("Updating default space... (should never happen)");
        settings.defaultSpace = legacySpace;
        settings.save();
      }
    } else {
      // no space data found, create new space and, if initial install add tutorial
      try {
        await space.init(currentSpace || settings.defaultSpace);
      } catch (e) {
        console.error('It looks like some corrupt data is left over. initializing from scratch', e);
        settings.init();
        await settings.save();
        await space.init(); // if it still throws the extension is borked
      }
      
      if (details.reason === chrome.runtime.OnInstalledReason.INSTALL) {
        const starterPath = `/_locales/${i18n('locale')}/starter.json`;
        try {
          const starterFile = await fetch(starterPath);
          const starterContent = await starterFile.json();
          const starterData = new DataBucket(starterContent.data);
          space.data = await starterData.parse();
        } catch (e) {
          console.error(`Starter data could not be loaded at ${starterPath}`, e);
        }
      }
      await space.save();
    }
  } else {
    buildContextMenus(space);
  }
  await space.setAsCurrent(settings.control.saveSource);
});

chrome.runtime.onStartup.addListener(async () => {
  // rebuild context menus in case of crash or CCleaner deletion
  const space = new Space();
  if (await space.loadCurrent()) buildContextMenus(space);
});

// Open the side panel when popup is not set
chrome.action.onClicked.addListener((tab) => {
  // openPanel(tab);
  const src = new URL(chrome.runtime.getURL("popup/main.html?view=panel"));
  chrome.sidePanel.setOptions({
    tabId: tab.id,
    enabled: true,
    path: src.href,
  }, () => {
    chrome.sidePanel.open({
      tabId: tab.id,
    });
  });
});

// set up context menu listener
chrome.contextMenus.onClicked.addListener((data, tab) => {
  // get details from menu item and ignore "empty" ones (sanity check)
  /** @type {{action:string,seq:number,menuSpace:{name:string,synced:boolean,path:number[]}}} */
  const { action, seq, menuSpace } = JSON.parse(data.menuItemId);
  // console.log(action, seq, menuSpace);
  if (!action) return;
    
  // set up injection target
  const target = {
    tabId: tab.id,
    ...data.frameId ? { frameIds: [data.frameId] } : {},
  };

  // get menu action and perform accordingly
  switch (action) {
  case 'snip':
    snipSelection(target, menuSpace, data);
    break;

  case 'paste': {
    pasteSnip(target, seq, menuSpace, data);
    break;
  }

  default:
    break;
  } // end switch(action)
});

chrome.commands.onCommand.addListener((command, { id, url }) => {
  // console.log(command, id, url);
  
  switch (command) {
  case "snip":
    snipSelection({ tabId: id }, {}, { pageUrl: url });
    break;
    
  case "paste":
    setFollowup('paste', {
      target: { tabId: id },
      pageUrl: url,
    });
    break;

  default:
    break;
  }
  return;
});

// update spaces and menu items as needed
chrome.storage.onChanged.addListener(async (changes, areaName) => {
  // console.log(changes, areaName);
  const synced = (areaName === 'sync');

  for (const [key, change] of Object.entries(changes)) {
    // check for settings updates and update the action as necessary
    if ( true
      && key === keyStore.settings.key
      && change.newValue
      && change.newValue.view.action !== change.oldValue?.view.action
    ) setDefaultAction(change.newValue.view.action);

    // check for data updates, key can be anything
    if (change.newValue?.children) {
      // send a message to update any open windows
      chrome.runtime.sendMessage({
        type: 'updateSpace',
        args: {
          name: key,
          synced: synced,
          timestamp: change.newValue.timestamp,
        },
      }).catch(() => false);

      // check if current space was changed
      const currentSpace = await getCurrentSpace();
      // console.log(name, synced, areaName);
      if (!currentSpace || (currentSpace.name === key && currentSpace.synced === synced)) {
        const space = new Space();
        try {
          await space.init({
            name: key,
            synced: synced,
            data: change.newValue,
          });
          buildContextMenus(space);
        } catch (e) {
          console.error(e);
        }
      }
    }

    // check for removed sync data without local data
    if ( true
      && synced
      && change.oldValue?.children
      && !change.newValue
    ) {
      // double-check we don't have a local space with the same name
      if (!(await getStorageData(key, 'local'))) {
        // don't lose the data on other synced instances without confirming first
        setFollowup('unsynced', {
          name: key,
          data: change.oldValue,
        });
      }
    }
  }
});