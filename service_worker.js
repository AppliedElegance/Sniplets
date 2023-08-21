/* global Settings, Space, Snippet, DataBucket, buildContextMenus, setStorageData, injectScript, requestFrames */
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
chrome.contextMenus.onClicked.addListener(async function(data, tab) {
  // get details from menu item and ignore "empty" ones
  const menuData = JSON.parse(data.menuItemId);
  if (!menuData.action) return;
    
  // set up injection object
  const src = {
    target: {
      tabId: tab.id,
    }
  };
  if (data.frameId) src.target.frameIds = [data.frameId];

  // injection script workaround for full selectionText with line breaks
  const getFullSelection = () => {
    return window.getSelection().toString();
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
    let permRes, snipText;
    if (!res) {
      // possible cross-origin frame
      permRes = await requestFrames(tab.id);
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
    let space = new Space(menuData.space);
    await space.load();
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
    let space = new Space(menuData.space);
    await space.load();
    let snippet = space.getItem(menuData.path);
    if (snippet.content) {
      // inject paste code
      src.func = pasteSnippet;
      src.args = [snippet.content];
      injectScript(src);
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
      await change.decompress();
      buildContextMenus(new Space({ name: key, synced: (namespace == 'sync'), data: change }));
    }
  }
});