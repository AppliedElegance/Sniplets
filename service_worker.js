if(typeof importScripts === 'function') {
  importScripts("./scripts/shared.js");
  importScripts("./scripts/nodeBuilders.js");
  importScripts("./scripts/modals.js");
  importScripts("./scripts/inject.js");
}

// init on installation
chrome.runtime.onInstalled.addListener(async (details) => {
  // force refresh
  self.skipWaiting();

  // check currently stored data
  // console.log(await getStorageData(null), await getStorageData(null, true));

  // prepare defaults
  const settings = new Settings();

  // settings init in case of first install or missing settings
  if (!await settings.load()) {
    settings.init();
    // bug check
    const {name, synced} = settings.defaultSpace;
    let defaultSpace = await getStorageData(name, synced);
    // console.log(defaultSpace);
    if (!defaultSpace[name]) {
      defaultSpace = await getStorageData(name, !synced);
      // console.log(defaultSpace);
      if (defaultSpace[name]) {
        settings.defaultSpace.synced = !synced;
      }
    }
    settings.save();
  }

  // prepare space for init
  const space = new Space();

  // check for current space in case of reinstall
  const currentSpace = await getCurrentSpace();
  // console.log(currentSpace);
  if (!await space.load(currentSpace || settings.defaultSpace)) {
    // legacy check for existing snippets
    // console.log("Checking for legacy data...");
    const legacySpace = {name: "snippets", synced: true};
    if (await space.load(legacySpace)) {
      // console.log("Confirming that legacy space is indeed legacy and shifting...");
      const lastVersion = space.data.version.split('.');
      if ((+lastVersion[0] === 0) && (+lastVersion[1] < 9)) {
        // console.log("Shifting data to default space");
        space.name = settings.defaultSpace.name;
        if (await space.save()) await removeStorageData(legacySpace);
      } else {
        // console.log("Updating default space... (should never happen)");
        settings.defaultSpace = legacySpace;
        settings.save();
      }
    } else {
      // no space data found, create new space and, if initial install add tutorial
      // console.log("Creating new space...");
      await space.init(currentSpace || settings.defaultSpace);
      // console.log(space);
      if (details.reason === chrome.runtime.OnInstalledReason.INSTALL) {
        const starterData = await fetch(`/_locales/${i18n('locale')}/starter.json`)
        .then(r => r.json())
        .catch(() => void 0);
        if (starterData) {
          const data = new DataBucket(starterData.data);
          space.data = await data.parse();
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

// TODO: add setting to load popout instead of popup
// (the below code only triggers when no popup url set)
// chrome.action.onClicked.addListener(() => openPopup());

// set up context menu listener
chrome.contextMenus.onClicked.addListener(async (data, tab) => {
  // get details from menu item and ignore "empty" ones (sanity check)
  /** @type {{action:string},{menuSpace:{name:string,synced:boolean,path:number[]}}} */
  const {action, seq, menuSpace} = JSON.parse(data.menuItemId);
  // console.log(action, seq, menuSpace);
  if (!action) return;
    
  // set up injection target
  const target = {
    tabId: tab.id,
    ...data.frameId ? {frameIds: [data.frameId]} : {},
  };

  // get menu action and perform accordingly
  switch (action) {
  case 'snip':
    snipSelection(target, menuSpace, data);
    break;

  case 'paste': {
    pasteSnippet(target, seq, menuSpace, data);
    break;
  }

  default:
    break;
  } // end switch(action)
});

chrome.commands.onCommand.addListener(async (command, {id, url}) => {
  // console.log(command, id, url);
  
  switch (command) {
  case "snip":
    snipSelection({tabId: id}, {}, {pageUrl: url});
    break;
    
  case "paste":
    //TODO: open Snippets with selection dialogue
    break;

  default:
    break;
  }
  return;
});

// update spaces and menu items as needed
chrome.storage.onChanged.addListener(async (changes, areaName) => {
  // console.log(changes, areaName);
  const isSyncChange = (areaName === 'sync');

  for (const key in changes) {
    // console.log(key, changes[key], areaName);
    // ignore updates to currentSpace itself
    if (key === 'currentSpace') continue;

    // check for data updates
    if (changes[key].newValue?.children) {
      // send a message to update any open windows
      chrome.runtime.sendMessage({
        type: 'updateSpace',
        args: {
          name: key,
          synced: isSyncChange,
          timestamp: changes[key].newValue.timestamp,
        },
      }).catch(() => false);

      // check if current space was changed
      const currentSpace = await getCurrentSpace();
      // console.log(name, synced, areaName);
      if (!currentSpace || (currentSpace.name === key && currentSpace.synced === isSyncChange)) {
        const space = new Space();
        await space.init({
          name: key,
          synced: isSyncChange,
          data: changes[key].newValue,
        });
        // console.log(changes[key], space, areaName);
        buildContextMenus(space);
      }
    }

    // check for removed sync data without local data
    // console.log(isSyncChange, await new DataBucket(changes[key].oldValue).parse(), await new DataBucket(changes[key].newValue).parse());
    if (isSyncChange && changes[key].oldValue?.children && !changes[key].newValue) {
      // double-check we don't have a local space with the same name
      const bucket = await getStorageData(key, false);
      // console.log(bucket);
      if (!bucket[key]) {
        // don't lose the data on other synced instances without confirming first
        setFollowup('unsynced', {
          name: key,
          data: changes[key].oldValue,
        });
      }
    }
  }
});