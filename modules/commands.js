import { CrossOriginError, MissingPermissionsError, ScriptingBlockedError, SnipNotFoundError } from '/modules/errors.js'
import { i18n, Colors } from '/modules/refs.js'
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
  console.log('Building context menus...', structuredClone(space))
  // Since there's no way to poll current menu items, clear all first
  await chrome.contextMenus.removeAll().catch(e => console.error(e))

  if (!space?.name) return

  const addMenu = properties => chrome.contextMenus.create(properties, () =>
    chrome.runtime.lastError && console.error(chrome.runtime.lastError),
  )

  /** @type {{command:string,spaceKey:StorageKey,path:number[],seq:number}} */
  const menuData = {
    command: 'snip',
    spaceKey: space.storageKey,
    path: [],
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
    menuData.command = 'paste'
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
      console.log('Building menu folder...', structuredClone(folder), structuredClone(parentData))
      const menuItem = {
        contexts: ['editable'],
        parentId: JSON.stringify(parentData),
      }

      // clone parent object to avoid polluting it
      const menuData = structuredClone(parentData)
      if (parentData.seq) menuData.path.push(parentData.seq)

      // list sniplets in folder
      if (folder.length) {
        folder.forEach((item) => {
          console.log(structuredClone(item))
          menuData.seq = item.seq
          menuItem.id = JSON.stringify(menuData)
          // using emojis for ease of parsing and && escaping, non-breaking spaces (`\xA0`) avoids collapsing
          const color = Colors.get(item.color)
          menuItem.title = `${
            (item instanceof Folder) ? color.folder : color.sniplet
          }\xA0\xA0${item.name.replaceAll('&', '&&')}`
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
 * @returns {{command:string,spaceKey:{name:string,synced:boolean},path:number[],seq:number}}
 */
function parseContextMenuData(data) {
  try {
    return JSON.parse(data)
  } catch (e) {
    console.error(e)
    return {}
  }
}

/** Helper for injecting scripts
 * Requires the ["scripting"] permission.
 * @param {{
 * target:chrome.scripting.InjectionTarget
 * func:Function
 * args:Array
 * world:chrome.scripting.ExecutionWorld
 * }} injection
 * @param {{frameUrl:string,pageUrl:string}} info
 */
async function injectScript(injection, info) {
  console.log('Injecting script...', injection, info)
  // check for known blocked urls
  const url = info.frameUrl || info.pageUrl
  // console.log(url)
  if (url) {
    const testUrl = new URL(url)
    // console.log(testUrl)
    const isBlockedProtocol = [
      'chrome:',
      'edge:',
    ].includes(testUrl.protocol)
    // console.log(testUrl.protocol, isBlockedProtocol)
    const isBlockedOrigin = [
      'https://chromewebstore.google.com',
      'https://microsoftedge.microsoft.com',
    ].includes(testUrl.origin)
    // console.log(testUrl.origin, isBlockedOrigin)
    if (isBlockedProtocol || isBlockedOrigin) throw new ScriptingBlockedError(url)
  }

  const { target } = injection

  const results = await chrome.scripting.executeScript(injection).catch(async (e) => {
    if (target.allFrames || target.frameIds?.length) {
      const { frameUrl } = info
      delete info.frameUrl
      const retryResults = await injectScript({ ...injection, target: { tabId: target.tabId } }, info)
      const result = retryResults?.at(0)?.result
      if (result?.error?.name === 'SecurityError') {
        const { pageSrc, frameSrc } = result
        const frameOrigin = frameUrl && `${(new URL(frameUrl)).origin}/*`
        const srcOrigin = frameSrc && `${(new URL(frameSrc)).origin}/*`
        const missingPermissions = { origins:
          [...new Set([frameOrigin, srcOrigin])].filter(v => v && v !== 'null/*'),
        }
        if (!target.frameIds?.length
          || !missingPermissions.origins?.length
          || await chrome.permissions.contains(missingPermissions)
        ) {
          // nothing more we can do
          throw new CrossOriginError(pageSrc, frameSrc, result.error)
        } else {
          // provide permissions error details to caller
          throw new MissingPermissionsError(missingPermissions, result.error)
        }
      }
      return retryResults
    } else {
      throw new ScriptingBlockedError(url, e)
    }
  })
  return results
}

/** Snip the selection found at the target
 * @param {{target:chrome.scripting.InjectionTarget,spaceKey:StorageKey,path:number[],pageUrl:string,frameUrl:string}} args
 */
async function snipSelection(args) {
  console.log('Snipping selection...', args)
  const { target, spaceKey, path, ...info } = args

  /** Injection script to grab selection text
   * @param {{preserveTags:boolean, saveSource:boolean}} options
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
      // cross-origin throws a "SecurityError"
        return {
          error: {
            name: e.name,
            message: e.message,
            cause: e.cause,
          },
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

  await settings.load()
  const result = (await injectScript({
    target: target,
    func: returnSnip,
    args: [settings.snipping],
  }, info)).at(0)?.result

  console.log('Handling snip result...', result)
  if (!result || result.error) return result

  // add snip to requested or current space and return result
  const space = new Space()
  if (!(spaceKey?.name && await space.load(spaceKey, path)) && !(await space.loadCurrent())) return
  const newSnip = space.addItem(new Sniplet(result))
  space.sort(settings.sort)
  await space.save(settings.data)
  return {
    target: target,
    spaceKey: space.storageKey,
    path: space.path,
    seq: newSnip.seq,
  }
}

/**
 * Retrieve and paste a sniplet into the selection found at the target
 * @param {{target:chrome.scripting.InjectionTarget,spaceKey:StorageKey,path:number[],seq:number,pageUrl:string,frameUrl:string}} args
 * @returns {Promise<void>}
 */
async function pasteItem(args) {
  console.log('pasting', args)
  /** Injection script for pasting.
   * @param {{content:string, richText:string}} snip
   */
  const insertSnip = (snip) => {
    // no followup needed if there was nothing to insert
    if (!snip?.content) return

    /**
     * Recursive insert function for traversing embedded content - required for keyboard shortcuts
     * @param {Window} window
     */
    const insertText = (window) => {
      try {
        // check if we're inside a frame and recurse
        const frame = window.document.activeElement.contentWindow
        if (frame) return insertText(frame)
      } catch (e) {
        // cross-origin throws a "SecurityError"
        return {
          error: {
            name: e.name,
            message: e.message,
            cause: e.cause,
          },
          pageSrc: window.location.href,
          frameSrc: window.document.activeElement.src,
          snip: snip,
        }
      }

      /** Get input element (may be contenteditable)
       * @type {HTMLInputElement|HTMLTextAreaElement|HTMLElement}
       */
      const input = window.document.activeElement

      // some custom editors require special handling
      if (input.classList.contains('ck')) {
        // CKEditor 5 (https://ckeditor.com/docs/ckeditor5/latest/api/index.html)
        const { editor } = window
        if (!editor) return {
          error: {
            name: 'CustomEditorError',
            message: 'An unknown or blocked version of CKEditor is bound to this field.',
            cause: { editor: 'CKEditor' },
          },
        }
        const ckViewFrag = editor.data.processor.toView(snip.richText)
        const ckModFrag = editor.data.toModel(ckViewFrag)
        editor.model.insertContent(ckModFrag)
        return
      } else if (input.classList.contains('cke_editable')) {
        // CKEditor 4 (https://ckeditor.com/docs/ckeditor4/latest/api/index.html)
        // This editor replaces the context menu, so this code will only run with keyboard shortcuts
        const getEditor = window =>
          window.CKEDITOR || (window.parent && getEditor(window.parent))
        const editor = getEditor(window)
        if (!editor) return { // deprecated/unknown version or blocked parent
          error: {
            name: 'CustomEditorError',
            message: 'An unknown or blocked version of CKEditor is bound to this field.',
            cause: { editor: 'CKEditor' },
          },
        }
        editor.currentInstance.insertHTML(snip.richText)
        return
      } else if (input.classList.contains('cm-content')) {
        // CodeMirror 6 (https://codemirror.net/docs/ref/)
        const cmView = document.activeElement.cmView?.view
        if (cmView) {
          cmView.dispatch(cmView.viewState.state.replaceSelection(snip.content))
          return
        }
        return {
          error: {
            name: 'CustomEditorError',
            message: 'An unknown or blocked version of CodeMirror is bound to this field.',
            cause: { editor: 'CodeMirror' },
          },
        }
      } else if (document.activeElement.closest('.CodeMirror')) {
        // CodeMirror 5 (https://codemirror.net/5/doc/manual.html)
        const cm = document.activeElement.closest('.CodeMirror').CodeMirror
        if (cm) {
          cm.replaceSelection(snip.content)
          return
        }
        return {
          error: {
            name: 'CustomEditorError',
            message: 'An unknown or blocked version of CodeMirror is bound to this field.',
            cause: { editor: 'CodeMirror' },
          },
        }
      } else if (input.classList.contains('tiny-editable')) {
        // TinyMCE (https://www.tiny.cloud/docs/tinymce/latest/apis/tinymce.root/)
        if (window.tinyMCE || window.tinymce) {
          const tinyMCE = window.tinyMCE || window.tinymce
          tinyMCE.activeEditor.execCommand('mceInsertContent', false, snip.richText)
          return
        }
        return {
          error: {
            name: 'CustomEditorError',
            message: 'An unknown or blocked version of TinyMCE is bound to this field.',
            cause: { editor: 'TinyMCE' },
          },
        }
      } else if (input.classList.contains('fr-element')) {
        // Froala (https://froala.com/wysiwyg-editor/docs/overview/)
        const froala = window.FroalaEditor?.INSTANCES?.at(0)
        if (froala) {
          froala.html.insert(snip.richText)
          return
        }
        return {
          error: {
            name: 'CustomEditorError',
            message: 'An unknown or blocked version of Froala is bound to this field.',
            cause: { editor: 'Froala' },
          },
        }
      }

      // update richText in case of a TrustedHTML policy, ensure scripts are escaped
      if (window.trustedTypes && trustedTypes.createPolicy) {
        const escapeHTMLPolicy = trustedTypes.createPolicy('snipletsEscapePolicy', {
          createHTML: string => string.replaceAll(/<script/g, '&lt;script'),
        })
        snip.richText = escapeHTMLPolicy.createHTML(snip.richText)
      }

      /* execCommand is marked 'deprecated' but has only been demoted to an unofficial draft
      * insertText & insertHTML are still well supported and produce the most desirable results.
      * See par. 3 in: https://developer.mozilla.org/en-US/docs/Web/API/Document/execCommand
      * See w3c draft: https://w3c.github.io/editing/docs/execCommand/#the-inserthtml-command
      * See WHATWG note: "User agents are encouraged to implement the features described in execCommand."
      */
      const pasted = (() => {
        try {
          return (input.value !== undefined || input.contentEditable === 'plaintext-only')
            ? document.execCommand('insertText', false, snip.content)
            : document.execCommand('insertHTML', false, snip.richText)
        } catch (e) {
          console.error(e)
          return
        }
      })()
      if (!pasted) {
        // forward-compatible manual cut paste code that kills the undo stack
        if (input.value === 'undefined') {
          const selection = window.getSelection()
          const range = selection.getRangeAt(0)
          range.deleteContents()
          if (input.contentEditable === 'plaintext-only') {
            range.insertNode(document.createTextNode(snip.content))
          } else { // no sanitation as that's between the user and the website
            const template = document.createElement('template')
            template.innerHTML = snip.richText
            range.insertNode(template.content)
          }
          selection.collapseToEnd()
        } else {
          const { value } = input
          const start = input.selectionStart
          const end = input.selectionEnd
          input.value = value.slice(0, start) + snip.content + value.slice(end)
          input.selectionStart = input.selectionEnd = start + snip.content.length
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
        ...keyEvent,
        inputType: 'inputFromPaste',
        data: snip.content,
      })
      input.dispatchEvent(new KeyboardEvent('keyup', keyEvent))

      return
    }

    return insertText(window)
  }

  // retrieve sniplet from space if necessary
  if (!args.snip) {
    const { spaceKey, path, seq } = args
    const space = new Space()
    if (!(spaceKey?.name ? await space.load(spaceKey, path) : await space.loadCurrent())) {
      throw new SnipNotFoundError(spaceKey, path, seq)
    }
    const sniplet = await space.getProcessedSniplet(+seq)
    if (!sniplet?.content) throw new SnipNotFoundError(spaceKey, path, seq)

    args.snip = sniplet
  }

  // if there are no special considerations, go ahead and insert the snip
  const { target, snip } = args
  const result = (await injectScript({
    target: target,
    func: insertSnip,
    args: [snip],
    world: 'MAIN', // required for custom WYSIWYG editor access
  }, args)).at(0)?.result

  console.log('Handling paste result...', result)
  // increment counters only if paste was successful
  if (!result?.error && snip?.counters) {
    const space = new Space()
    if (await space.load(args.spaceKey, args.path)) {
      space.setCounters(snip.counters, true)
      await settings.load()
      space.save(settings.data)
    }
  }

  return result
}

/** Available commands (must be async/return promise for error handling) */
const commandMap = new Map([
  ['snip', snipSelection],
  ['paste', pasteItem],
])

async function runCommand(command, args) {
  console.log('Running command...', command, args)
  const actionFunc = commandMap.get(command)
  if (typeof actionFunc === 'function') {
    return actionFunc(args).catch(e => ({ error: {
      name: e.name,
      message: e.message,
      cause: e.cause,
    } }))
  }
}

export {
  sendMessage,
  buildContextMenus,
  parseContextMenuData,
  snipSelection,
  pasteItem,
  commandMap,
  runCommand,
}