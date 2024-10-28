import { i18n, getColor, getRichText } from "./refs.js";
import { Settings } from "./classes/settings.js";
import { Folder, Sniplet, Space } from "./classes/spaces.js";
import { setFollowup } from "./storage.js";
// import { openWindow } from "./dom.js";


/** (Re)build context menu for snipping and pasting
 * @param {Space} space 
 */
async function buildContextMenus(space) {
  // Since there's no way to poll current menu items, clear all first
  await new Promise((resolve, reject) => {
    chrome.contextMenus.removeAll(() =>
      (chrome.runtime.lastError)
      ? reject(chrome.runtime.lastError)
      : resolve(true),
    );
  }).catch((e) => console.error(e));

  if (!space?.name) return;

  const addMenu = (properties) => chrome.contextMenus.create(properties, () =>
    chrome.runtime.lastError && console.error(chrome.runtime.lastError),
  );
  
  /** @type {{action:string,path:number[],seq:number,menuSpace:{name:string,synced:boolean}}} */
  const menuData = {
    action: 'snip',
    menuSpace: {
      name: space.name,
      synced: space.synced,
      path: [],
    },
  };

  // create snipper for selected text
  addMenu({
    "id": JSON.stringify(menuData),
    "title": i18n('action_snip_selection'),
    "contexts": ["selection"],
  });

  // build paster for saved sniplets
  // console.log(space);
  if (space.data?.children?.length) {
    // set root menu item
    menuData.action = 'paste';
    addMenu({
      "id": JSON.stringify(menuData),
      "title": i18n('action_paste'),
      "contexts": ["editable"],
    });

    /**
     * Recursive function for sniplet tree
     * @param {(TreeItem|Folder|Sniplet)[]} folder 
     * @param {*} parentData 
     */
    const buildFolder = (folder, parentData) => {
      const menuItem = {
        "contexts": ["editable"],
        "parentId": JSON.stringify(parentData),
      };
      // clone parent object to avoid polluting it
      const menuData = structuredClone(parentData);
      // console.log(menuData, parentData);
      if (menuData.seq) menuData.menuSpace.path.push(menuData.seq);
      // list sniplets in folder
      if (folder.length) {
        folder.forEach(item => {
          menuData.seq = item.seq;
          menuItem.id = JSON.stringify(menuData);
          // using emojis for ease of parsing, && escaping, nbsp needed for chrome bug
          const color = getColor(item.color);
          menuItem.title = `${(item instanceof Folder) ? color.folder : color.sniplet}\xA0\xA0${item.name.replaceAll("&", "&&")}`;
          addMenu(menuItem);
          if (item instanceof Folder) buildFolder(item.children, menuData);
        });
      } else {
        menuData.seq = undefined;
        menuItem.id = JSON.stringify(menuData);
        menuItem.title = i18n('folder_empty');
        menuItem.enabled = false;
        addMenu(menuItem);
      }
    };
    // build paste sniplet menu tree
    buildFolder(space.data.children, menuData);
  }
}

/** Checks if a url is a known blocked site
 * @param {string|URL} url 
 */
const isBlockedURL = url => {
  if (!url) return;
  const submission = new URL(url);
  if (["chrome:", "edge:"].includes(submission.protocol) || [
    "https://chromewebstore.google.com",
    "https://microsoftedge.microsoft.com",
  ].includes(submission.origin)) {
    return true;
  }
  return false;
};

/** Reports if a url is completely blocked at the top level (permissions won't help)
 * @param {string|URL} url 
 */
const reportBlockedURL = (url) => {
  setFollowup('alert', {
    title: i18n('title_scripting_blocked'),
    message: i18n('error_scripting_blocked', new URL(url).hostname),
  });
  return;
};

/** Ensure script injection errors including permission blocks are always handled gracefully.
 * Requires the ["scripting"] permission.
 * @param {chrome.scripting.ScriptInjection<*,*>} injection - The details of the script to inject.
 * @returns {Promise<chrome.scripting.InjectionResult<*>[]>|void}
 */
const injectScript = (injection) => chrome.scripting.executeScript(injection)
.catch((e) => (console.error(e), [])); // pass empty array on error for consistency

/** Injection script to grab selection text
 * @param {{preserveTags:boolean,saveSource:boolean}} options
 */
const returnSnip = ({ preserveTags, saveSource }) => {
  /** Recursive for traversing embedded content - required for keyboard shortcuts
   * @param {Window} window 
   */
  const getText = (window) => {
    try {
      // check if we're inside a frame and recurse
      const frame = window.document.activeElement.contentWindow;
      if (frame) return getText(frame);
    } catch (e) {
      // console.error('Error', e);
      // cross-origin throws a "SecurityError"
      return {
        error: e.name,
        pageSrc: window.location.href,
        frameSrc: window.document.activeElement.src,
      };
    }

      const selection = window.getSelection();
      let text;
      // TODO: add option to convert lists to numbers/bullets
      if (preserveTags) {
        const range = selection.getRangeAt(0);
        const content = range.cloneContents();
        const container = range.commonAncestorContainer;
        if(['UL', 'OL'].includes(container.tagName)) {
          const list = container.cloneNode();
          list.append(content);
          text = list.outerHTML;
        } else {
          const temp = document.createElement('template');
          temp.content.append(content);
          text = temp.content.innerHTML;
        }
      } else {
        text = selection.toString();
      }
      return {
        content: text,
        ...saveSource ? { sourceURL: window.location.href } : {},
      };
  };

  // grab selection
  return getText(window);
};

/** Inject snip code for retrieving selection
 * @param {InjectionTarget} target 
 * @param {{preserveTags:boolean,saveSource:boolean}} options 
 * @param {{name:string,synced:boolean,path:number[]}} [actionSpace]
 * @return {Promise<{content:string,error:string,pageSrc:string,frameSrc:string}>}
 */
const getSnip = async (target, options) => (await injectScript({
  target: target,
  func: returnSnip,
  args: [options],
}))[0]?.result;

/**
 * Snip the selection found at the target
 * @param {{allFrames:boolean,frameIds:number[],tabId:number}} target 
 * @param {{name:string,synced:boolean,path:number[]}} actionSpace 
 * @param {{pageUrl:string,frameUrl:string}} urls 
 * @returns {Promise<void>}
 */
async function snipSelection(target, actionSpace = {}, { pageUrl, frameUrl } = {}) {
  const url = frameUrl || pageUrl;

  // check if we're on a known blocked page
  if (isBlockedURL(url)) {
    reportBlockedURL(url);
    return;
  }

  const settings = new Settings;
  await settings.load();
  let result = await getSnip(target, settings.control);
  // console.log(result);

  if (!result) {
    // Double-check we're not just inside a frame and activeTab isn't working
    if ((target.allFrames || target.frameIds?.length)) {
      result = await getSnip({ tabId: target.tabId }, settings.control);
      // console.log(result);
    }
    // report top level blocked if there's still no result
    if (!result) {
      reportBlockedURL(url);
      return;
    }
  }

  // check for cross-origin errors
  if (result.error === 'SecurityError') {
    // console.log(result, target, url);
    const { pageSrc, frameSrc } = result;
    const pageOrigin = [frameUrl, frameSrc].includes(pageSrc) && `${(new URL(pageSrc)).origin}/*`;
    const frameOrigin = frameUrl && `${(new URL(frameUrl)).origin}/*`;
    const srcOrigin = frameSrc && `${(new URL(frameSrc)).origin}/*`;
    const origins = [pageOrigin, frameOrigin, srcOrigin].filter(v => v && v !== 'null/*');
    if (!url || await chrome.permissions.contains({ origins:origins })) {
      // nothing more we can do
      setFollowup('alert', {
        title: i18n('title_snip_blocked'),
        message: i18n('error_snip_blocked'),
      });
      return;
    }
    // pass off to permissions window through service worker
    setFollowup('permissions', {
      action: 'snip',
      target: target,
      ...origins?.length ? { origins: origins } : {},
      actionSpace: actionSpace,
    });
    return;
  }

  // add snip to requested or current space and open editor
  // console.log(actionSpace, result);
  const space = new Space();
  if (!(actionSpace.name && await space.load(actionSpace)) && !(await space.loadCurrent())) return;
  const newSnip = space.addItem(new Sniplet(result));
  space.sort(settings.sort);
  await space.save();
  setFollowup('action', {
    action: 'focus',
    path: space.path.join('-'),
    seq: newSnip.seq,
    field: 'name',
  });
  // openWindow({
  //   action: 'focus',
  //   path: space.path.join('-'),
  //   seq: newSnip.seq,
  //   field: 'name',
  // });
  return;
}

/** Injection script for pasting.
 * @param {Sniplet} snip
 * @param {string} richText
 */
const paste = (snip, richText) => {
  // console.log(snip, richText);
  if (!snip?.content) return {
    error: 'nosnip',
  };

  /**
   * Recursive for traversing embedded content - required for keyboard shortcuts
   * @param {Window} window 
   * @returns {boolean|{error:string,srcUrl:string}}
   */
  const insertText = (window) => {
    try {
      // check if we're inside a frame and recurse
      const frame = window.document.activeElement.contentWindow;
      // console.log(frame?.location.href);
      if (frame) return insertText(frame);
    } catch (e) {
      console.error(e);
      // cross-origin throws a "SecurityError", normally checked using copy command
      return {
        error: e.name,
        pageSrc: window.location.href,
        frameSrc: window.document.activeElement.src,
        snip: snip,
      };
    }

    /** Get input element (may be contenteditable)
     * @type {HTMLInputElement|HTMLTextAreaElement} */
    const input = window.document.activeElement;

    // CKEditor requires special handling
    if (input.classList.contains('ck') && window.editor) {
      // CKEditor 5
      const { editor } = window;
      const ckViewFrag = editor.data.processor.toView(richText);
      const ckModFrag = editor.data.toModel(ckViewFrag);
      editor.model.insertContent(ckModFrag);
      return {
        snip: snip,
      };
    } else if (input.classList.contains('cke_editable')) {
      // CKEditor 4 and below replace the context menu, so this should only work with keyboard shortcuts
      const getEditor = (window) =>
      window.CKEDITOR || window.parent && getEditor(window.parent);
      const editor = getEditor(window);
      if (!editor) return { // deprecated/unknown version or blocked parent
        error: 'ckeditor',
      };
      editor.currentInstance.insertHTML(richText);
      return {
        snip: snip,
      };
    }

    /* execCommand is marked 'deprecated' but has only been demoted to an unofficial draft
     * insertText & insertHTML are still well supported and produce the most desirable results.
     * See par. 3 in: https://developer.mozilla.org/en-US/docs/Web/API/Document/execCommand
     * See w3c draft: https://w3c.github.io/editing/docs/execCommand/#the-inserthtml-command
     * See WHATWG note: "User agents are encouraged to implement the features described in execCommand."
     */
    // console.log(input.value === undefined, input.contentEditable);
    const pasted = (input.value !== undefined || input.contentEditable === 'plaintext-only')
    ? document.execCommand('insertText', false, snip.content)
    : document.execCommand('insertHTML', false, richText);
    if (!pasted) {
      // prepare content for backup code
      const { content } = snip;

      // forward-compatible manual cut paste code - kills the undo stack
      if (input.value === 'undefined') {
        const selection = window.getSelection();
        const range = selection.getRangeAt(0);
        range.deleteContents();
        if (input.contentEditable === 'plaintext-only') {
          range.insertNode(document.createTextNode(content));
        } else { // no sanitation as that's between the user and the website
          const template = document.createElement('template');
          template.innerHTML = richText;
          range.insertNode(template.content);
        }
        selection.collapseToEnd();
      } else {
        const { value } = input;
        const start = input.selectionStart;
        const end = input.selectionEnd;
        input.value = value.slice(0, start) + content + value.slice(end);
        input.selectionStart = input.selectionEnd = start + content.length;
      }
    }

    // event dispatch for editors that handle their own undo stack like stackoverflow
    const keyEvent = {
      bubbles: true,
      cancelable: true,
      composed: true,
    };
    input.dispatchEvent(new KeyboardEvent('keydown', keyEvent));
    input.dispatchEvent(new InputEvent('input'), {
      bubbles: true,
      composed: true,
      inputType: "inputFromPaste",
      data: snip.content,
    });
    input.dispatchEvent(new KeyboardEvent('keyup', keyEvent));

    return {
      snip: snip,
    };
  };

  return insertText(window);
};

/** Inject paste code for retrieving selection
 * @param {InjectionTarget} target 
 * @param {{content:string}} snip 
 * @return {Promise<{error:string,pageSrc:string,frameSrc:string,snip:{content:string,richText:string}}>}
 */
const insertSnip = async (target, snip) => (await injectScript({
  target: target,
  func: paste,
  args: [snip, await getRichText(snip)],
  world: 'MAIN', // to access CKEditor if needed
}))[0]?.result;

/**
 * Retrieve and paste a sniplet into the selection found at the target
 * @param {{allFrames:boolean,frameIds:number[],tabId:number}} target 
 * @param {number} seq 
 * @param {{name:string,synced:boolean,path:number[]}} actionSpace 
 * @param {{pageUrl:string,frameUrl:string}} urls 
 * @returns {Promise<void>}
 */
async function pasteSnip(target, seq, actionSpace, { pageUrl, frameUrl } = {}) {
  const url = frameUrl || pageUrl;

  // make sure we have a seq of something to paste
  if (!seq) return;
  
  // check if we're on a known blocked page
  if (isBlockedURL(url)) return reportBlockedURL(url);
  
  // retrieve sniplet from space
  const space = new Space();
  if (!(actionSpace.name && await space.load(actionSpace))) {
    setFollowup('alert', {
      title: i18n('title_snip_not_found'),
      message: i18n('warning_snip_not_found'),
    });
    return;
  }
  const { snip, customFields, counters } = await space.getProcessedSniplet(seq) || {};
  if (!snip) {
    setFollowup('alert', {
      title: i18n('title_snip_not_found'),
      message: i18n('warning_snip_not_found'),
    });
    return;
  }

  // use copy action to check for permission errors before confirming custom fields
  const testInjection = {
    target: target,
    func: returnSnip,
    args: [{}],
  };
  let errorCheck = (await injectScript(testInjection))[0]?.result;
  if (!errorCheck) {
    // Double-check we're not just inside a frame and activeTab isn't working
    if ((target.allFrames || target.frameIds?.length)) {
      testInjection.target = { tabId: testInjection.target.tabId };
      errorCheck = (await injectScript(testInjection))[0]?.result;
      // console.log(result);
    }
    // report top level blocked if there's still no result
    if (!errorCheck) return reportBlockedURL(url);
  }
  // check for any security errors that require permissions
  if (errorCheck?.error === 'SecurityError') {
    // console.log(result, target, url);
    const { pageSrc, frameSrc } = errorCheck;
    const pageOrigin = [frameUrl, frameSrc].includes(pageSrc) && `${(new URL(pageSrc)).origin}/*`;
    const frameOrigin = frameUrl && `${(new URL(frameUrl)).origin}/*`;
    const srcOrigin = frameSrc && `${(new URL(frameSrc)).origin}/*`;
    const origins = [pageOrigin, frameOrigin, srcOrigin].filter(v => v && v !== 'null/*');
    if (!url || await chrome.permissions.contains({ origins:origins })) {
      // nothing more we can do
      setFollowup('alert', {
        title: i18n('title_paste_blocked'),
        message: i18n('error_paste_blocked'),
      });
      return;
    }
    // pass off to permissions window through service worker
    setFollowup('permissions', {
      ...origins?.length ? { origins: origins } : {},
      action: 'paste',
      target: target,
      snip: snip,
      actionSpace: actionSpace,
      ...customFields ? { customFields: Array.from(customFields.entries()) } : {},
      ...counters ? { counters: Array.from(counters.entries()) } : {},
    });
    return;
  }
  
  // check for custom placeholders that need to be confirmed by the user before pasting
  // console.log(customFields);
  if (customFields) {
    setFollowup('placeholders', {
      action: 'paste',
      target: target,
      snip: snip,
      actionSpace: actionSpace,
      customFields: Array.from(customFields.entries()),
      ...counters ? { counters: Array.from(counters.entries()) } : {},
    });
    return;
  }

  // if there are no special considerations, go ahead and insert the snip
  const result = await insertSnip(target, snip);
  // console.log(result);

  if (!result) {
    // something strange went wrong
    setFollowup('alert', {
      title: i18n('title_paste_blocked'),
      message: i18n('error_paste_failed'),
    });
    return;
  }

  // check if ckeditor paste was unsuccessful
  if (result.error === 'ckeditor') {
    setFollowup('alert', {
      title: i18n('title_scripting_blocked'),
      message: i18n('error_ck_blocked'),
    });
    return;
  }

  return;
}

export {
  buildContextMenus,
  snipSelection,
  insertSnip,
  pasteSnip,
};