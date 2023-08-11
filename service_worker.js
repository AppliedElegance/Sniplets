/* import-globals-from ./shared.js */
console.log("test")
if( 'function' === typeof importScripts) {
  importScripts('./shared.js');
  console.log("test")
}

// init on installation
chrome.runtime.onInstalled.addListener(async (details) => {
  // prepare defaults
  const settings = new Settings();
  await settings.load();
  const space = new Space(settings.defaultSpace);

  switch (details.reason) {
  case 'install':
    // check if there's previous data from another browser
    const oldData = await space.load();
    // create default space if it doesn't exist yet.
    if (!oldData) space.save();
  case 'update':
    // legacy check for existing snippets
    const legacySpace = { name: 'snippets', synced: true };
    const lastVersion = details.previousVersion.split('.');
    if ((parseInt(lastVersion[0]) === 0) && (parseInt(lastVersion[1]) < 9)) {
      // upgrade simple storage method to a space if data found
      space.pivot(legacySpace);
      if (await space.load()) {
        legacySpace.name = 'Snippets'
        await space.shift(legacySpace);
        settings.defaultSpace = legacySpace;
        await settings.save();
      }
    } else {
      await space.load();
    }
    break;
  case 'chrome_update':
  case 'shared_module_update':
  default:
    break;
  }
  // set up initial context menu for snipping
  buildContextMenus(space);
});

// set up context menu listener
chrome.contextMenus.onClicked.addListener(async function(info) {
  const menuData = JSON.parse(info.menuItemId);
  if (!menuData.action) return;
  const settings = new Settings();
  await settings.load();
  switch (menuData.action) {
  case 'snip': {
    let snipName = info.selectionText;
    if (snipName.length > 27) {
      // cut down to size, then chuck trailing text
      snipName = snipName.slice(0, 28);
      snipName = (snipName.includes(' ')
               ? snipName.slice(0, snipName.lastIndexOf(' '))
               : snipName.slice(0, 27))
               + '…';
    }

    await setStorageData({ snipText: {
      space: menuData.space,
      data: {
        name: snipName,
      },
      saveURL: settings.control.saveSource,
    } })

    // workaround for full selectionText with line breaks
    // find tab and inject pull code
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabArray) {
      function getFullSelection() {
        try {
          chrome.storage.local.get('snipText', function(result) {
            result['snipText'].data.content = window.getSelection().toString();
            if (result['snipText'].saveURL)
              result['snipText'].data.sourceURL = window.location.href;
            // actioned on in listener
            chrome.storage.local.set(result);
          });
        } catch (e) {
          console.error("Couldn't snip selection!", e);
        }
      }
      chrome.scripting.executeScript({
        target: { tabId: tabArray[0].id },
        function: getFullSelection
      });
    });
    break;
  }

  case 'paste': {
    let space = new Space(menuData.space);
    await space.load();
    let snippet = space.getItem(menuData.path);
    if (snippet.content) {
      // store snippet for pasting
      await setStorageData({ pasteText: snippet.content });
      // find tab and inject paste code
      chrome.tabs.query({ active: true, currentWindow: true }, function(tabArray) {
        function pasteSnippet() {
          try {
            chrome.storage.local.get('pasteText', function(result) {
              document.execCommand('insertText', false, result.pasteText);
            });
          } catch (e) {
            console.error("Couldn't paste snippet!", e);
          }
        }
        chrome.scripting.executeScript({
          target: { tabId: tabArray[0].id },
          function: pasteSnippet
        });
      });
      // remove locally stored snippet
      removeStorageData('pasteText');
    }
    break;
  }

  default: {
    console.error("Nothin' doin'.", info);
    break;
  }}
});

// update menu items as needed
chrome.storage.onChanged.addListener(async function(changes, namespace) {
  // console.log(changes, namespace);
  for (let key in changes) {
    switch (key) {
    case 'snipText': {
      let snip = changes[key].newValue;
      if (!snip || !snip.data.content) return;
      let space = new Space(snip.space);
      await space.load();
      let snippet = new Snippet(snip.data);
      snippet = space.addItem(snippet);
      await space.save();

      // open window to edit snippet
      chrome.windows.create({
        url: chrome.runtime.getURL("popup/popup.html?action=edit&seq=" + snippet.seq),
        type: "popup",
        width: 700,
        height: 500
      });

      removeStorageData('snipText');
      break; }
  
    default: {
      // maybe we made some data change to the space and need to rebuild the context menus
      // let change = changes[key].newValue;
      // TODO: update to handle compressed data
      // console.log(change);
      // if (change && Object.prototype.hasOwnProperty.call(change, 'children')) {
      //   buildContextMenus(new Space({ name: key, synced: (namespace == 'sync'), data: change }));
      // }
      break; }
    }
  }
});