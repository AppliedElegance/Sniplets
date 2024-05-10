/* eslint-disable no-unused-vars */

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
.catch((e) => (console.warn(e), [])); // pass empty array on error for consistency

/** Injection script to grab selection text
 * @param {{preserveTags:boolean,saveSource:boolean}} options
 */
const returnSnip = ({preserveTags, saveSource}) => {
  /** Recursive for traversing embedded content - required for keyboard shortcuts
   * @param {Window} window 
   */
  const getText = (window) => {
    try {
      // check if we're inside a frame and recurse
      const frame = window.document.activeElement.contentWindow;
      if (frame) return getText(frame);
    } catch (e) {
      // console.log('Error', e);
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
        ...saveSource ? {sourceURL: window.location.href} : {},
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
async function snipSelection(target, actionSpace = {}, {pageUrl, frameUrl} = {}) {
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
      result = await getSnip({tabId: target.tabId}, settings.control);
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
    const {pageSrc, frameSrc} = result;
    const pageOrigin = [frameUrl, frameSrc].includes(pageSrc) && `${(new URL(pageSrc)).origin}/*`;
    const frameOrigin = frameUrl && `${(new URL(frameUrl)).origin}/*`;
    const srcOrigin = frameSrc && `${(new URL(frameSrc)).origin}/*`;
    const origins = [pageOrigin, frameOrigin, srcOrigin].filter(v => v && v !== 'null/*');
    if (!url || await chrome.permissions.contains({origins:origins})) {
      // nothing more we can do
      setFollowup('alert', {
        title: i18n('title_snip_blocked'),
        message: i18n('error_snip_blocked'),
      }, false);
      return;
    }
    // pass off to permissions window through service worker
    setFollowup('permissions', {
      action: 'snip',
      target: target,
      ...origins?.length ? {origins: origins} : {},
      actionSpace: actionSpace,
    });
    return;
  }

  // add snip to requested or current space and open editor
  // console.log(actionSpace, result);
  const space = new Space();
  if (!(actionSpace.name && await space.load(actionSpace)) && !(await space.loadCurrent())) return;
  const newSnip = space.addItem(new Snippet(result));
  // console.log(space);
  await space.save();
  openForEditing(space.path, newSnip.seq);
  return;
}

/** Injection script for pasting.
 * @param {Snippet} snip
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
      console.warn(e);
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
      const {editor} = window;
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
      const {content} = snip;

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
        const {value} = input;
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
 * Retrieve and paste a snippet into the selection found at the target
 * @param {{allFrames:boolean,frameIds:number[],tabId:number}} target 
 * @param {number} seq 
 * @param {{name:string,synced:boolean,path:number[]}} actionSpace 
 * @param {{pageUrl:string,frameUrl:string}} urls 
 * @returns {Promise<void>}
 */
async function pasteSnippet(target, seq, actionSpace, {pageUrl, frameUrl} = {}) {
  const url = frameUrl || pageUrl;

  // make sure we have a seq of something to paste
  if (!seq) return;
  
  // check if we're on a known blocked page
  if (isBlockedURL(url)) return reportBlockedURL(url);
  
  // retrieve snippet from space
  const space = new Space();
  if (!(actionSpace.name && await space.load(actionSpace))) {
    setFollowup('alert', {
      title: i18n('title_snip_not_found'),
      message: i18n('warning_snip_not_found'),
    });
    return;
  }
  const {snip, customFields} = await space.getProcessedSnippet(seq) || {};
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
      testInjection.target = {tabId: testInjection.target.tabId};
      errorCheck = (await injectScript(testInjection))[0]?.result;
      // console.log(result);
    }
    // report top level blocked if there's still no result
    if (!errorCheck) return reportBlockedURL(url);
  }
  // check for any security errors that require permissions
  if (errorCheck?.error === 'SecurityError') {
    // console.log(result, target, url);
    const {pageSrc, frameSrc} = errorCheck;
    const pageOrigin = [frameUrl, frameSrc].includes(pageSrc) && `${(new URL(pageSrc)).origin}/*`;
    const frameOrigin = frameUrl && `${(new URL(frameUrl)).origin}/*`;
    const srcOrigin = frameSrc && `${(new URL(frameSrc)).origin}/*`;
    const origins = [pageOrigin, frameOrigin, srcOrigin].filter(v => v && v !== 'null/*');
    if (!url || await chrome.permissions.contains({origins:origins})) {
      // nothing more we can do
      setFollowup('alert', {
        title: i18n('title_paste_blocked'),
        message: i18n('error_paste_blocked'),
      });
      return;
    }
    // pass off to permissions window through service worker
    setFollowup('permissions', {
      ...origins?.length ? {origins: origins} : {},
      action: 'paste',
      target: target,
      snip: snip,
      ...customFields?.size ? {customFields: Array.from(customFields.entries())} : {},
    });
    return;
  }
  
  // check for custom placeholders that need to be confirmed by the user before pasting
  // console.log(customFields);
  if (customFields?.size) {
    setFollowup('placeholders', {
      action: 'paste',
      target: target,
      snip: snip,
      customFields: Array.from(customFields.entries()),
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