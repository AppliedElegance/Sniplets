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

  // legacy check for existing snippets, creating new space otherwise
  const legacySpace = { name: "snippets", synced: true };
  const space = new Space(legacySpace);
  if (await space.load()) {
    const lastVersion = space.data.version.split('.');
    if ((parseInt(lastVersion[0]) === 0) && (parseInt(lastVersion[1]) < 9)) {
      space.name = "Snippets";
      await space.shift(legacySpace);
      settings.defaultSpace = legacySpace;
      await settings.save();
    }
  } else {
    // check for current space in case of reinstall
    const { currentSpace } = await getStorageData('currentSpace');
    if (currentSpace) {
      await space.pivot(currentSpace);
    } else {
      const data = await space.pivot(settings.defaultSpace);
      if (!data) {
        await space.save();
      }
    }
    buildContextMenus(space);
  }
});

chrome.runtime.onStartup.addListener(async () => {
  // rebuild context menus in case of crash or CCleaner deletion
  const { currentSpace } = await getStorageData('currentSpace');
  const space = new Space(currentSpace);
  if (await space.load()) {
    buildContextMenus(space);
  }
});

// set up context menu listener
chrome.contextMenus.onClicked.addListener(async function(data, tab) {
  // get details from menu item and ignore "empty" ones
  const menuData = JSON.parse(data.menuItemId);
  if (!menuData.action) return;
  // get space for handling actions
  const space = new Space(menuData.space);
  if (!(await space.load())) return;
  // get settings for storage
  const settings = new Settings();
  await settings.load();
    
  // set up injection object
  const src = {
    target: {
      tabId: tab.id,
    }
  };
  if (data.frameId) src.target.frameIds = [data.frameId];

  // get menu action and perform accordingly
  switch (menuData.action) {
  case 'snip': {
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

    // inject script to grab full selection including line breaks
    src.func = getFullSelection;
    const res = await injectScript(src);
    let snipText;
    if (!res) {
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
    
    if (!snipText) return;

    // add snip to space
    let snip = new Snippet({ name: snipName, content: snipText });
    if (settings.control.saveSource) snip.sourceURL = data.pageUrl;
    snip = space.addItem(snip);
    await space.save();
    
    // open window to edit snippet
    chrome.windows.create({
      url: chrome.runtime.getURL("popup/popup.html?action=edit&seq=" + snip.seq),
      type: "popup",
      width: 700,
      height: 500
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
    if (res[0].result.pasted === false || !permRes) {
      // // Unable to paste, copy result text to clipboard for manual paste
      // await navigator.clipboard.write([new ClipboardItem({
      //   "text/plain": res[0].result.text,
      //   "text/html": res[0].result.richText,
      // })]);
      // // notify user of result
      // chrome.notifications.create()
      // open window to requested selection for manual copy/paste
      const editor = chrome.windows.create({
        url: chrome.runtime.getURL("popup/popup.html?action=copy"
          + "&path=" + menuData.path.slice(0, -1).join(',')
          + "&seq=" + menuData.path.slice(-1)),
        type: "popup",
        width: 700,
        height: 500
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

// update menu items as needed
chrome.storage.onChanged.addListener(async function(changes, namespace) {
  for (let key in changes) {
    // maybe we made some data change to the space and need to rebuild the context menus
    let change = changes[key].newValue;
    if (change && Object.hasOwn(change, 'children')) {
      change = new DataBucket(change);
      await change.parse();
      buildContextMenus(new Space({ name: key, synced: (namespace === 'sync'), data: change }));
    }
  }
});