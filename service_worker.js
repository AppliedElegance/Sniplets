if(typeof importScripts === 'function') {
  importScripts("./shared.js");
}

// init on installation
chrome.runtime.onInstalled.addListener(async () => {
  // force refresh
  self.skipWaiting();

  // console.log(getStorageData(null), getStorageData(null, true));

  // prepare defaults
  const settings = new Settings();
  if (!await settings.load()) {
    settings.init();
    // bug check
    const { name, synced } = settings.defaultSpace;
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
  const { currentSpace } = await getStorageData('currentSpace');
  // console.log(currentSpace);
  if (!await space.load(currentSpace || settings.defaultSpace)) {
    // legacy check for existing snippets
    // console.log("Checking for legacy data...");
    const legacySpace = { name: "snippets", synced: true };
    if (await space.load(legacySpace)) {
      // console.log("Confirming that legacy space is indeed legacy and shifting...");
      const lastVersion = space.data.version.split('.');
      if ((parseInt(lastVersion[0]) === 0) && (parseInt(lastVersion[1]) < 9)) {
        // console.log("Shifting data to default space");
        await space.shift(settings.defaultSpace);
      } else {
        // console.log("Updating default space... (should never happen)");
        settings.defaultSpace = legacySpace;
        settings.save();
      }
    } else {
      // no space information found, create new space
      // console.log("Creating new space...");
      await space.init(currentSpace || settings.defaultSpace);
      await space.save();
    }
  }

  // always rebuild context menus on install/update
  // console.log(space);
  buildContextMenus(space);
});

chrome.runtime.onStartup.addListener(async () => {
  // rebuild context menus in case of crash or CCleaner deletion
  const { currentSpace } = await getStorageData('currentSpace');
  if (!currentSpace) return;
  const space = new Space(currentSpace);
  if (await space.load()) {
    buildContextMenus(space);
  }
});

// set up context menu listener
chrome.contextMenus.onClicked.addListener(async (data, tab) => {
  // get details from menu item and ignore "empty" ones
  /** @type {{action:string,path:number[],space:Object}} */
  const menuData = JSON.parse(data.menuItemId);
  // console.log(menuData);
  if (!menuData.action) return;
  // get space for handling actions
  const space = new Space();
  if (!(await space.load(menuData.space))) return;
  // get settings for storage
  const settings = new Settings();
  await settings.load();
    
  // set up injection object
  const target = {
    tabId: tab.id,
    frameIds: [data.frameId],
  };

  // get menu action and perform accordingly
  switch (menuData.action) {
  case 'snip': {
    let snip = await snipSelection(target);
    if (!snip) {
      // possible cross-origin frame
      const permRes = await requestFrames(menuData.action, target, data);
      // console.log(permRes);
      if (!permRes) {
        // scripting blocked, snip basic selection provided by context menu
        snip = new Snippet({ content: data.selectionText });
      } else {
        return; // if it was possible to request permission, follow up there
      }
    }

    // add snip to space
    if (settings.control.saveSource) snip.sourceURL = data.pageUrl;
    snip = space.addItem(snip);
    await space.save();
    
    // open window to view/edit snippet
    // console.log("creating window");
    chrome.windows.create({
      url: chrome.runtime.getURL(`popups/main.html?action=focus&seq=${ snip.seq }&field=name`),
      type: "popup",
      width: 700,
      height: 500,
    });
    break;
  }

  case 'paste': {
    // console.log("Getting processed snippet", menuData);
    const snip = await space.getProcessedSnippet(menuData.path.pop(), menuData.path);
    if (!snip) return;
    if (snip.customFields) {
      // request fields (avoids losing selection)
      return await chrome.storage.session.set({ request: {
        type: 'placeholders',
        action: menuData.action,
        target: target,
        data: data,
        snip: snip,
      }}).then(() => true).catch(e => e);
    }
    const result = await pasteSnippet(target, snip);
    if (!result?.pasted) {
      // possible cross-origin frame
      if (!result && await requestFrames(menuData.action, target, data, [snip])) {
        return;
      }
      // Unable to paste, open window to requested selection for manual copy/paste
      const editor = chrome.windows.create({
        url: chrome.runtime.getURL("popups/main.html?action=focus&field=copy&reason=blocked"
        + "&path=" + menuData.path.join('-')
        + "&seq=" + snip.seq),
        type: "popup",
        width: 700,
        height: 500,
      });
      return editor;
    }
    break;
  }

  default:
    console.error("Nothin' doin'.", data);
    break;
  }
});

// update spaces and menu items as needed
chrome.storage.onChanged.addListener(async (changes, areaName) => {
  console.log(changes, areaName);
  for (let key in changes) {
    // ignore currentSpace updates, prepare currentSpace info for comparison otherwise
    if (key === 'currentSpace') continue;
    const { currentSpace } = await getStorageData('currentSpace');

    // check for snip/paste requests
    if (areaName === 'session' && key === 'request' && changes[key].newValue) {
      chrome.windows.create({
        url: chrome.runtime.getURL("popups/main.html"),
        type: "popup",
        width: 867,
        height: 540,
      }).catch(() => false);
    }

    // check for areaName shifts
    // if (key === 'shift') {
    //   // get shift information
    //   const { oldSpace, newSpace } = changes.shift.newValue;

    //   // function for shifting space
    //   const shiftSpace = async (preserve = true) => {
    //     const space = new Space();
    //     await space.load(oldSpace);
    //     space.name = newSpace.name;
    //     space.synced = newSpace.synced;
    //     await space.save();
    //     if (!preserve) removeStorageData(oldSpace.name, oldSpace.synced);
    //     // update local current space if necessary
    //     if (currentSpace?.name === oldSpace.name) {
    //       setStorageData({ currentSpace: newSpace });
    //     }
    //   };

    //   // TODO: Confirmation popup

    //   // check which direction we're shifting
    //   // console.log(oldSpace, newSpace);
    //   if (oldSpace.synced > newSpace.synced) {
    //     // console.log(`Stopping sync for everyone...`);
    //     // only copy synced data to local if the instance isn't already local
    //     const localSpace = await getStorageData(newSpace.name);
    //     if (!localSpace[newSpace.name]) {
    //       await shiftSpace();
    //     }
    //   } else if (oldSpace.synced < newSpace.synced) {
    //     // console.log(`Starting sync for everyone...`);
    //     // // check for a local copy and confirm overwrite
    //     // const localSpace = await getStorageData(newSpace.name);
    //     // if (!localSpace[newSpace.name] || confirm("Another browser would like to sync its snippits. Overwite local copy?\nIf Yes, you will be asked to backup your local snippets before the sync.\nIf No, local editing will be preserved and this browser will not be kept in sync.")) {
    //       // TODO: run a backup request before deleting local
    //       await shiftSpace(false);
    //     // } else {
    //     //   // TODO: Use a popup window to handle this
    //     // }
    //   }
    // }

    // check if current space was changed and the context menus need to be rebuilt
    console.log(key, currentSpace);
    if (key === currentSpace?.name) {
      const space = new Space();
      await space.init({ name: key, synced: (areaName === 'sync'), data: changes[key].newValue });
      // console.log("Building context menus...", newVal);
      buildContextMenus(space);
    }
  }
});