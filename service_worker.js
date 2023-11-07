if(typeof importScripts === 'function') {
  importScripts("./shared.js");
}

// init on installation
chrome.runtime.onInstalled.addListener(async () => {
  // force refresh
  self.skipWaiting();

  // prepare defaults
  const settings = new Settings();
  await settings.load();

  // prepare space for init
  const space = new Space();

  // check for current space in case of reinstall
  const { currentSpace } = await getStorageData('currentSpace');
  if (currentSpace) {
    console.log("Loading current space...", currentSpace);
    await space.load(currentSpace);
  } else if (settings?.defaultSpace) {
    // load default space if available
    console.log("Loading default space...", settings?.defaultSpace);
    await space.load(settings.defaultSpace);
  } else {
    console.log("Checking for legacy data...");
    // settings missing or corrupt, save default settings
    settings.init();
    settings.save();

    // legacy check for existing snippets
    const legacySpace = { name: "snippets", synced: true };
    if (await space.load(legacySpace)) {
      console.log("Confirming that legacy space is indeed legacy and shifting...");
      const lastVersion = space.data.version.split('.');
      if ((parseInt(lastVersion[0]) === 0) && (parseInt(lastVersion[1]) < 9)) {
        console.log("Shifting data to default space");
        await space.shift(settings.defaultSpace);
      } else {
        console.log("Updating default space... (should never happen)");
        settings.defaultSpace = legacySpace;
        settings.save();
      }
    } else {
      // no space information found, create new space
      console.log("Creating new space...");
      await space.init(settings.defaultSpace);
      await space.save();
    }
  }

  // always rebuild context menus on install/update
  console.log(space);
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
  const menuData = JSON.parse(data.menuItemId);
  if (!menuData.action) return;
  // get space for handling actions
  const space = new Space();
  if (!(await space.load(menuData.space))) return;
  // get settings for storage
  const settings = new Settings();
  await settings.load();
    
  // set up injection object
  const src = {
    target: {
      tabId: tab.id,
    },
  };
  if (data.frameId) src.target.frameIds = [data.frameId];

  // get menu action and perform accordingly
  switch (menuData.action) {
  case 'snip': {
    console.log("Starting snip...", menuData);
    // create snippet title from selectionText which does not include newlines
    let snipName = data.selectionText;
    if (snipName.length > 27) {
      // cut down to size, then chuck trailing text if possible so no words are cut off
      snipName = snipName.slice(0, 28);
      snipName = (snipName.includes(' ')
               ? snipName.slice(0, snipName.lastIndexOf(' '))
               : snipName.slice(0, 27))
               + '…';
    }

    console.log("Injecting script...", snipName);
    // inject script to grab full selection including line breaks
    src.func = getFullSelection;
    const res = await injectScript(src);
    console.log("Check for result...", res);
    let snipText;
    if (!res) {
      console.log("Check for iframe permissions...");
      // possible cross-origin frame
      const permRes = await requestFrames(menuData.action, src);
      if (!permRes) {
        snipText = data.selectionText;
      } else {
        return; // if it was possible to request permission, let the user try again
      }
    } else {
      snipText = res[0].result;
    }
    
    console.log("Check for snip...", snipText);
    if (!snipText) return;

    // add snip to space
    let snip = new Snippet({ name: snipName, content: snipText });
    if (settings.control.saveSource) snip.sourceURL = data.pageUrl;
    console.log("Adding snippet...\n", snip, space);
    snip = space.addItem(snip);
    console.log("Saving snippet...", space);
    await space.save();
    
    // open window to view/edit snippet
    chrome.windows.create({
      url: chrome.runtime.getURL(`popups/main.html?action=focus&seq=${ snip.seq }&field=name`),
      type: "popup",
      width: 700,
      height: 500,
    });
    break;
  }

  case 'paste': {
    const snip = await space.getProcessedSnippet(menuData.path);
    // inject paste code
    src.func = pasteSnippet;
    src.args = [snip];
    const res = await injectScript(src);
    let permRes = true;
    if (!res) {
      // possible cross-origin frame
      permRes = await requestFrames(menuData.action, src);
    }
    if (!permRes || res[0].result.pasted === false) {
      // // Unable to paste, copy result text to clipboard for manual paste
      // await navigator.clipboard.write([new ClipboardItem({
      //   "text/plain": res[0].result.text,
      //   "text/html": res[0].result.richText,
      // })]);
      // // notify user of result
      // chrome.notifications.create()
      // open window to requested selection for manual copy/paste
      const editor = chrome.windows.create({
        url: chrome.runtime.getURL("popups/main.html?action=copy"
          + "&path=" + menuData.path.slice(0, -1).join(',')
          + "&seq=" + menuData.path.slice(-1)),
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

    // check for areaName shifts
    if (key === 'shift') {
      // get shift information
      const { oldSpace, newSpace } = changes.shift.newValue;

      // function for shifting space
      const shiftSpace = async (oldSpace, newSpace, preserve = true) => {
        const space = new Space();
        await space.load(oldSpace);
        space.name = newSpace.name;
        space.synced = newSpace.synced;
        await space.save();
        if (!preserve) removeStorageData(oldSpace.name, oldSpace.synced);
      };

      if (oldSpace.synced > newSpace.synced) { // stopping sync for everyone
        // only copy synced data to local if the instance isn't already local
        const localSpace = await getStorageData(newSpace.name);
        if (!localSpace[newSpace.name]) {
          await shiftSpace(oldSpace, newSpace);
        }
      } else if (oldSpace.synced < newSpace.synced) { // starting sync
        // check for a local copy and confirm overwrite
        const localSpace = await getStorageData(newSpace.name);
        if (!localSpace[newSpace.name] || confirm("Another browser would like to sync its snippits. Overwite local copy?\nIf Yes, you will be asked to backup your local snippets before the sync.\nIf No, local editing will be preserved and this browser will not be kept in sync.")) {
          // TODO: run a backup request before deleting local
          await shiftSpace(oldSpace, newSpace, false);
        } else {
          // TODO: Use a popup window to handle this
        }
      }
      // update local current space if necessary
      if (currentSpace?.name === oldSpace.name && currentSpace?.synced === oldSpace.synced) {
        setStorageData({ currentSpace: newSpace });
      }
    }

    // check if current space was changed and the context menus need to be rebuilt
    if (key === currentSpace?.name) {
      const newVal = new DataBucket(changes[key].newValue);
      await newVal.parse();
      console.log("Building context menus...", newVal);
      buildContextMenus(new Space({ name: key, synced: (areaName === 'sync'), data: newVal }));
    }
  }
});