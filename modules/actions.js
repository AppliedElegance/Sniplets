import { i18n, getRichText, Colors } from '/modules/refs.js'
import settings from '/modules/settings.js'
import { Folder, Sniplet, Space } from '/modules/spaces.js'

/** Send an internal message
 * @param {string} subject What is expected of the receiver
 * @param {*} body What the receiver needs to follow up
 * @param {chrome.runtime.ExtensionContext=} to A chrome session object
 */
async function sendMessage(subject, body, to) {
  return chrome.runtime.sendMessage({
    to: to,
    subject: subject,
    body: body,
  })
}

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
    )
  }).catch(e => console.error(e))

  if (!space?.name) return

  const addMenu = properties => chrome.contextMenus.create(properties, () =>
    chrome.runtime.lastError && console.error(chrome.runtime.lastError),
  )

  /** @type {{action:string,path:number[],seq:number,menuSpace:{name:string,synced:boolean}}} */
  const menuData = {
    action: 'snip',
    menuSpace: {
      name: space.name,
      synced: space.synced,
      path: [],
    },
  }

  // create snipper for selected text
  addMenu({
    id: JSON.stringify(menuData),
    title: i18n('action_snip_selection'),
    contexts: ['selection'],
  })

  // build paster for saved sniplets
  if (space.data?.children?.length) {
    // set root menu item
    menuData.action = 'paste'
    addMenu({
      id: JSON.stringify(menuData),
      title: i18n('action_paste'),
      contexts: ['editable'],
    })

    /**
     * Recursive function for sniplet tree
     * @param {(Folder|Sniplet)[]} folder
     * @param {*} parentData
     */
    const buildFolder = (folder, parentData) => {
      const menuItem = {
        contexts: ['editable'],
        parentId: JSON.stringify(parentData),
      }
      // clone parent object to avoid polluting it
      const menuData = structuredClone(parentData)
      if (menuData.seq) menuData.menuSpace.path.push(menuData.seq)
      // list sniplets in folder
      if (folder.length) {
        folder.forEach((item) => {
          menuData.seq = item.seq
          menuItem.id = JSON.stringify(menuData)
          // using emojis for ease of parsing and && escaping, nbsp needed for chrome bug
          const color = Colors.get(item.color)
          menuItem.title = `${(item instanceof Folder) ? color.folder : color.sniplet}\xA0\xA0${item.name.replaceAll('&', '&&')}`
          addMenu(menuItem)
          if (item instanceof Folder) buildFolder(item.children, menuData)
        })
      } else {
        menuData.seq = undefined
        menuItem.id = JSON.stringify(menuData)
        menuItem.title = i18n('folder_empty')
        menuItem.enabled = false
        addMenu(menuItem)
      }
    }
    // build paste sniplet menu tree
    buildFolder(space.data.children, menuData)
  }
}

/** Parse the MenuItemID providing data for context menu items
 * @param {string} data The menuItemId from the ContextMenus onClicked event info
 * @returns {{action:string,path:number[],seq:number,menuSpace:{name:string,synced:boolean}}}
 */
function parseContextMenuData(data) {
  try {
    return JSON.parse(data)
  } catch (e) {
    console.error(e)
    return ({})
  }
}

/** Ensure script injection errors including permission blocks are always handled gracefully.
 * Requires the ["scripting"] permission.
 * @param {chrome.scripting.ScriptInjection<*,*>} injection - The details of the script to inject.
 */
async function injectScript(injection) {
  // pass empty array on error for consistency
  return chrome.scripting.executeScript(injection)
    .catch(e => (console.error(e), []))
}

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
      const frame = window.document.activeElement.contentWindow
      if (frame) return getText(frame)
    } catch (e) {
      // console.error('Error', e);
      // cross-origin throws a "SecurityError"
      return {
        error: e.name,
        pageSrc: window.location.href,
        frameSrc: window.document.activeElement.src,
      }
    }

    const selection = window.getSelection()
    let text
    // TODO: add option to convert lists to numbers/bullets
    if (preserveTags) {
      const range = selection.getRangeAt(0)
      const content = range.cloneContents()
      const container = range.commonAncestorContainer
      if (['UL', 'OL'].includes(container.tagName)) {
        const list = container.cloneNode()
        list.append(content)
        text = list.outerHTML
      } else {
        const temp = document.createElement('template')
        temp.content.append(content)
        text = temp.content.innerHTML
      }
    } else {
      text = selection.toString()
    }
    return {
      content: text,
      ...saveSource ? { sourceURL: window.location.href } : {},
    }
  }

  // grab selection
  return getText(window)
}

/** Inject snip code for retrieving selection
 * @param {chrome.scripting.InjectionTarget} target
 * @param {{preserveTags:boolean,saveSource:boolean}} options
 * @returns {Promise<{content:string,error:string,pageSrc:string,frameSrc:string}>}
 */
async function getSnip(target, options) {
  const results = await injectScript({
    target: target,
    func: returnSnip,
    args: [options],
  })
  return results.at(0)?.result
}

/**
 * Snip the selection found at the target
 * @param {{allFrames:boolean,frameIds:number[],tabId:number}} target
 * @param {{name:string,synced:boolean,path:number[]}} actionSpace
 * @param {{pageUrl:string,frameUrl:string}} urls
 * @returns {Promise<void>}
 */
async function snipSelection(target, actionSpace = {}, { pageUrl, frameUrl } = {}) {
  const url = frameUrl || pageUrl

  // check if we're on a known blocked page
  if (isBlockedURL(url)) {
    reportBlockedURL(url)
    return
  }

  await settings.load()
  let result = await getSnip(target, settings.control)

  if (!result) {
    // Double-check we're not just inside a frame and activeTab isn't working
    if ((target.allFrames || target.frameIds?.length)) {
      result = await getSnip({ tabId: target.tabId }, settings.control)
    }
    // report top level blocked if there's still no result
    if (!result) {
      reportBlockedURL(url)
      return
    }
  }

  // check for cross-origin errors
  if (result.error === 'SecurityError') {
    const { pageSrc, frameSrc } = result
    const pageOrigin = [frameUrl, frameSrc].includes(pageSrc) && `${(new URL(pageSrc)).origin}/*`
    const frameOrigin = frameUrl && `${(new URL(frameUrl)).origin}/*`
    const srcOrigin = frameSrc && `${(new URL(frameSrc)).origin}/*`
    const origins = [pageOrigin, frameOrigin, srcOrigin].filter(v => v && v !== 'null/*')
    if (!url || await chrome.permissions.contains({ origins: origins })) {
      // nothing more we can do
      setFollowup('alert', {
        title: i18n('title_snip_blocked'),
        message: i18n('error_snip_blocked'),
      })
      return
    }
    // pass off to permissions window through service worker
    setFollowup('permissions', {
      action: 'snip',
      target: target,
      ...origins?.length ? { origins: origins } : {},
      actionSpace: actionSpace,
    })
    return
  }

  // add snip to requested or current space and open editor
  const space = new Space()
  if (!(actionSpace.name && await space.load(actionSpace)) && !(await space.loadCurrent())) return
  const newSnip = space.addItem(new Sniplet(result))
  space.sort(settings.sort)
  await space.save(settings.data)
  setFollowup('action', {
    action: 'focus',
    path: space.path.join('-'),
    seq: newSnip.seq,
    field: 'name',
  })
  // openWindow({
  //   action: 'focus',
  //   path: space.path.join('-'),
  //   seq: newSnip.seq,
  //   field: 'name',
  // });
  return
}

/** Injection script for pasting.
 * @param {Sniplet} snip
 * @param {string} richText
 */
const paste = (snip, richText) => {
  if (!snip?.content) return {
    error: 'nosnip',
  }

  /**
   * Recursive for traversing embedded content - required for keyboard shortcuts
   * @param {Window} window
   * @returns {boolean|{error:string,srcUrl:string}}
   */
  const insertText = (window) => {
    try {
      // check if we're inside a frame and recurse
      const frame = window.document.activeElement.contentWindow
      if (frame) return insertText(frame)
    } catch (e) {
      console.error(e)
      // cross-origin throws a "SecurityError", normally checked using copy command
      return {
        error: e.name,
        pageSrc: window.location.href,
        frameSrc: window.document.activeElement.src,
        snip: snip,
      }
    }

    /** Get input element (may be contenteditable)
     * @type {HTMLInputElement|HTMLTextAreaElement}
     */
    const input = window.document.activeElement

    // CKEditor requires special handling
    if (input.classList.contains('ck') && window.editor) {
      // CKEditor 5
      const { editor } = window
      const ckViewFrag = editor.data.processor.toView(richText)
      const ckModFrag = editor.data.toModel(ckViewFrag)
      editor.model.insertContent(ckModFrag)
      return {
        snip: snip,
      }
    } else if (input.classList.contains('cke_editable')) {
      // CKEditor 4 and below replace the context menu, so this should only work with keyboard shortcuts
      const getEditor = window =>
        window.CKEDITOR || (window.parent && getEditor(window.parent))
      const editor = getEditor(window)
      if (!editor) return { // deprecated/unknown version or blocked parent
        error: 'ckeditor',
      }
      editor.currentInstance.insertHTML(richText)
      return {
        snip: snip,
      }
    }

    /* execCommand is marked 'deprecated' but has only been demoted to an unofficial draft
     * insertText & insertHTML are still well supported and produce the most desirable results.
     * See par. 3 in: https://developer.mozilla.org/en-US/docs/Web/API/Document/execCommand
     * See w3c draft: https://w3c.github.io/editing/docs/execCommand/#the-inserthtml-command
     * See WHATWG note: "User agents are encouraged to implement the features described in execCommand."
     */
    const pasted = (input.value !== undefined || input.contentEditable === 'plaintext-only')
      ? document.execCommand('insertText', false, snip.content)
      : document.execCommand('insertHTML', false, richText)
    if (!pasted) {
      // prepare content for backup code
      const { content } = snip

      // forward-compatible manual cut paste code - kills the undo stack
      if (input.value === 'undefined') {
        const selection = window.getSelection()
        const range = selection.getRangeAt(0)
        range.deleteContents()
        if (input.contentEditable === 'plaintext-only') {
          range.insertNode(document.createTextNode(content))
        } else { // no sanitation as that's between the user and the website
          const template = document.createElement('template')
          template.innerHTML = richText
          range.insertNode(template.content)
        }
        selection.collapseToEnd()
      } else {
        const { value } = input
        const start = input.selectionStart
        const end = input.selectionEnd
        input.value = value.slice(0, start) + content + value.slice(end)
        input.selectionStart = input.selectionEnd = start + content.length
      }
    }

    // event dispatch for editors that handle their own undo stack like stackoverflow
    const keyEvent = {
      bubbles: true,
      cancelable: true,
      composed: true,
    }
    input.dispatchEvent(new KeyboardEvent('keydown', keyEvent))
    input.dispatchEvent(new InputEvent('input'), {
      bubbles: true,
      composed: true,
      inputType: 'inputFromPaste',
      data: snip.content,
    })
    input.dispatchEvent(new KeyboardEvent('keyup', keyEvent))

    return {
      snip: snip,
    }
  }

  return insertText(window)
}

/** Inject paste code for retrieving selection
 * @param {chrome.scripting.InjectionTarget} target
 * @param {{content:string}} snip
 * @returns {Promise<{error:string,pageSrc:string,frameSrc:string,snip:{content:string,richText:string}}>}
 */
async function insertSnip(target, snip) {
  const results = await injectScript({
    target: target,
    func: paste,
    args: [snip, await getRichText(snip)],
    world: 'MAIN', // to access CKEditor if needed
  }).catch(e => (console.error(e), []))
  return results.at(0)?.result
}

/**
 * Retrieve and paste a sniplet into the selection found at the target
 * @param {{allFrames:boolean,frameIds:number[],tabId:number}} target
 * @param {number} seq
 * @param {{name:string,synced:boolean,path:number[]}} actionSpace
 * @param {{pageUrl:string,frameUrl:string}} urls
 * @returns {Promise<void>}
 */
async function pasteSnip(target, seq, actionSpace, { pageUrl, frameUrl } = {}) {
  const url = frameUrl || pageUrl

  // make sure we have a seq of something to paste
  if (!seq) return

  // check if we're on a known blocked page
  if (isBlockedURL(url)) return reportBlockedURL(url)

  // retrieve sniplet from space
  const space = new Space()
  if (!(actionSpace.name && await space.load(actionSpace))) {
    setFollowup('alert', {
      title: i18n('title_snip_not_found'),
      message: i18n('warning_snip_not_found'),
    })
    return
  }
  const { snip, customFields, counters } = await space.getProcessedSniplet(seq) || {}
  if (!snip) {
    setFollowup('alert', {
      title: i18n('title_snip_not_found'),
      message: i18n('warning_snip_not_found'),
    })
    return
  }

  // use copy action to check for permission errors before confirming custom fields
  const testInjection = async () => {
    const testTarget = (target.allFrames || target.frameIds?.length)
      ? { tabId: target.tabId }
      : target
    const results = await injectScript({
      target: testTarget,
      func: returnSnip,
      args: [{}],
    }).catch(e => (console.error(e), []))
    return results.at(0)?.result
  }
  if (!(await testInjection())) return reportBlockedURL(url)

  // check for any security errors that require permissions
  if (errorCheck?.error === 'SecurityError') {
    const { pageSrc, frameSrc } = errorCheck
    const pageOrigin = [frameUrl, frameSrc].includes(pageSrc) && `${(new URL(pageSrc)).origin}/*`
    const frameOrigin = frameUrl && `${(new URL(frameUrl)).origin}/*`
    const srcOrigin = frameSrc && `${(new URL(frameSrc)).origin}/*`
    const origins = [pageOrigin, frameOrigin, srcOrigin].filter(v => v && v !== 'null/*')
    if (!url || await chrome.permissions.contains({ origins: origins })) {
      // nothing more we can do
      setFollowup('alert', {
        title: i18n('title_paste_blocked'),
        message: i18n('error_paste_blocked'),
      })
      return
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
    })
    return
  }

  // check for custom placeholders that need to be confirmed by the user before pasting
  if (customFields) {
    setFollowup('placeholders', {
      action: 'paste',
      target: target,
      snip: snip,
      actionSpace: actionSpace,
      customFields: Array.from(customFields.entries()),
      ...counters ? { counters: Array.from(counters.entries()) } : {},
    })
    return
  }

  // if there are no special considerations, go ahead and insert the snip
  const result = await insertSnip(target, snip)

  if (!result) {
    // something strange went wrong
    setFollowup('alert', {
      title: i18n('title_paste_blocked'),
      message: i18n('error_paste_failed'),
    })
    return
  }

  // check if ckeditor paste was unsuccessful
  if (result.error === 'ckeditor') {
    setFollowup('alert', {
      title: i18n('title_scripting_blocked'),
      message: i18n('error_ck_blocked'),
    })
    return
  }

  return
}

async function runAction(action, target, data) {
  switch (action) {
    case 'snip':
      snipSelection(target, data)
      break

    case 'paste':
      pasteSnip(target, data)
      break

    default:
      break
  }
}

export {
  sendMessage,
  buildContextMenus,
  parseContextMenuData,
  snipSelection,
  insertSnip,
  pasteSnip,
  runAction,
}
