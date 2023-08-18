/* global Settings, Space, Snippet, DataBucket, buildContextMenus, setStorageData, removeStorageData */
if( 'function' === typeof importScripts) {
  importScripts('./shared.js');
}

// init on installation
chrome.runtime.onInstalled.addListener(async () => {
  // force refresh
  self.skipWaiting();

  // prepare defaults
  const settings = new Settings();
  await settings.load();

  // legacy check for existing snippets, creating new space otherwise
  const legacySpace = { name: 'snippets', synced: true };
  const space = new Space(legacySpace);
  if (await space.load()) {
    const lastVersion = space.data.version.split('.');
    if ((parseInt(lastVersion[0]) == 0) && (parseInt(lastVersion[1]) < 9)) {
      space.name = 'Snippets';
      await space.shift(legacySpace);
      settings.defaultSpace = legacySpace;
      await settings.save();
    }
  } else {
    space.pivot(settings.defaultSpace);
    const data = await space.load();
    if (!data) {
      await space.save();
    } else {
      buildContextMenus(space);
    }
  }
});

// set up context menu listener
chrome.contextMenus.onClicked.addListener(async function(info) {
  // ignore disallowed URLs
  console.log(info);
  // get details from menu item and ignore "empty" ones or
  const menuData = JSON.parse(info.menuItemId);
  if (!menuData.action) return;

  // get tab and frame info for injecting script
  const tabID = await new Promise((resolve, reject) => {
    try {
      chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
        resolve(tabs[0].id);
      });
    } catch (e) {
      reject(e);
    }
  })
  const frameID = info.frameId;
    
  // set up injection object
  const src = {
    target: { tabId : tabID }
  };

  // check if we're in an iFrame and inject script to see if we have the relevant permissions
  if (frameID) {
    const getOrigin = () => {
      let origins = [window.location.origin + "/*"]
      if (document.activeElement.nodeName.toUpperCase() == "IFRAME") {
        // add src of all iframes on page so user only needs to request permission once
        Array.from(document.getElementsByTagName("IFRAME")).forEach((frame) => {
          origins.push((new URL(frame.src).origin) + "/*");
        });
      }
      return origins;
    };

    // attempt frame injection
    src.target.frameIds = [frameID];
    src.func = getOrigin;
    let origins = await chrome.scripting.executeScript(src).catch(() => null);
    if (!origins) {
      // request permission for iFrame if access was blocked
      delete src.target.frameIds;
      const res = await chrome.scripting.executeScript(src);
      origins = res[0].result;
      await setStorageData({ origins: origins });
      // popup required to request permission
      chrome.windows.create({
        url: chrome.runtime.getURL("permissions.html"),
        type: "popup",
        width: 480,
        height: 300
      });

      // console.log(origin);
      // chrome.permissions.request({
      //   origins: [origin]
      // }, (granted) => {
      //   console.log(granted);
      //   if (granted) {
      //     src.target.frameIds = [frameID];
      //   } else {
      //     const blockAlert = () => {
      //       alert("This action can't be performed on the embedded field without the requested permissions. The extension popup can still be used for manual copying and pasting.");
      //     }
      //     src.func = blockAlert;
      //     chrome.scripting.executeScript(src);
      //     return false;
      //   }
      // });
    }
  }

  // injected script workaround for full selectionText with line breaks
  const getFullSelection = (snipText) => {
    try {
      snipText.data.content = window.getSelection().toString();
      // actioned on in listener
      chrome.storage.local.set(snipText);
    } catch (e) {
      console.error("Couldn't snip selection!", e);
    }
  }

  // injection script for pasting
  const pasteSnippet = (snipText) => {
    const selNode = document.activeElement;

    // execCommand is deprecated but insertText is still supported in chrome as wontfix
    // and produces the most desirable result. See par. 3 in:
    // https://developer.mozilla.org/en-US/docs/Web/API/Document/execCommand
    const pasted = document.execCommand('insertText', false, snipText);

    // forward compatible alt code for inserting text, but kills the undo stack
    if (!pasted) {
      if (selNode.value != undefined) {
        const selVal = selNode.value;
        const selStart = selNode.selectionStart;
        selNode.value = selVal.slice(0, selStart) + snipText + selVal.slice(selNode.selectionEnd);
        selNode.selectionStart = selNode.selectionEnd = selStart + snipText.length;
      } else {
        const sel = window.getSelection();
        const selRng = sel.getRangeAt(0);
        selRng.deleteContents();
        selRng.insertNode(document.createTextNode(snipText));
        sel.collapseToEnd();
      }
    }

    // event dispatch for editors that handle their own undo stack like stackoverflow
    selNode.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Shift',
      view: window,
      bubbles: true,
      cancelable: true,
    }));
    selNode.dispatchEvent(new InputEvent('input', {
      inputType: 'insertText',
      data: snipText,
      view: window,
      bubbles: true,
      cancelable: true,
    }));
    selNode.dispatchEvent(new KeyboardEvent('keyup', {
      key: 'Shift',
      view: window,
      bubbles: true,
      cancelable: true,
    }));
  }

  // get menu action and perform accordingly
  switch (menuData.action) {
  case 'snip': {
    // get settings for storage
    const settings = new Settings();
    await settings.load();
    // create snippet title from selectionText which does not include newlines
    let snipName = info.selectionText;
    if (snipName.length > 27) {
      // cut down to size, then chuck trailing text if possible so no words are cut off
      snipName = snipName.slice(0, 28);
      snipName = (snipName.includes(' ')
               ? snipName.slice(0, snipName.lastIndexOf(' '))
               : snipName.slice(0, 27))
               + '…';
    }

    // prepare info for injected script
    const snipText = {
      space: menuData.space,
      data: {
        name: snipName,
      },
    }
    if (settings.control.saveSource) snipText.data.sourceURL = info.pageUrl;

    // inject script to grab full selection including line breaks
    src.func = getFullSelection;
    src.args = [snipText];
    chrome.scripting.executeScript(src);
    break;
  }

  case 'paste': {
    let space = new Space(menuData.space);
    await space.load();
    let snippet = space.getItem(menuData.path);
    if (snippet.content) {
      // inject paste code
      src.func = pasteSnippet;
      src.args = [snippet.content];
      chrome.scripting.executeScript(src);
    }
    break;
  }

  default:
    console.error("Nothin' doin'.", info);
    break;
  }
});

// update menu items as needed
chrome.storage.onChanged.addListener(async function(changes, namespace) {
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
      let change = changes[key].newValue;
      if (change && Object.prototype.hasOwnProperty.call(change, 'children')) {
        change = new DataBucket(change);
        await change.decompress();
        buildContextMenus(new Space({ name: key, synced: (namespace == 'sync'), data: change }));
      }
      break; }
    }
  }
});