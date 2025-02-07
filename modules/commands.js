import { CrossOriginError, CustomPlaceholderError, MissingPermissionsError, ScriptingBlockedError, SnipNotFoundError } from '/modules/errors.js'
import { i18n, Colors } from '/modules/refs.js'
import settings from '/modules/settings.js'
import { Folder, getRichText, Space } from '/modules/spaces.js'

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
  await chrome.contextMenus.removeAll().catch(e => e)
  // lastError must be explicitly checked for contextMenu promises
  chrome.runtime.lastError

  if (!space?.name) return

  const addMenu = properties => new Promise((resolve, reject) => {
    const id = chrome.contextMenus.create(properties, () => {
      chrome.runtime.lastError && reject(chrome.runtime.lastError)
      resolve(id)
    })
  }).catch(e => e)

  /** @type {{command:string,spaceKey:StorageKey,path:number[],seq:number}} */
  const menuData = {
    command: 'snip',
  }

  // create snipper for selected text
  await addMenu({
    id: JSON.stringify(menuData),
    title: i18n('action_snip_selection'),
    contexts: ['selection'],
  })

  // build paster for saved sniplets
  if (space.data?.children?.length) {
    // set root menu item
    menuData.command = 'paste'
    menuData.spaceKey = space.storageKey,
    menuData.path = []
    await addMenu({
      id: JSON.stringify(menuData),
      title: i18n('action_paste'),
      contexts: ['editable'],
    })

    /**
     * Recursive function for sniplet tree
     * @param {(Folder|Sniplet)[]} folder
     * @param {*} parentData
     */
    const buildFolder = async (folder, parentData) => {
      const menuItem = {
        contexts: ['editable'],
        parentId: JSON.stringify(parentData),
      }

      // clone parent object to avoid polluting it
      const menuData = structuredClone(parentData)
      if (parentData.seq) menuData.path.push(parentData.seq)

      // list sniplets in folder
      if (folder.length) {
        for (const item of folder) {
          menuData.seq = item.seq
          menuItem.id = JSON.stringify(menuData)
          // using emojis for ease of parsing and && escaping, non-breaking spaces (`\xA0`) avoids collapsing
          const color = Colors.get(item.color)
          menuItem.title = `${
            (item instanceof Folder) ? color.folder : color.sniplet
          }\xA0\xA0${item.name.replaceAll('&', '&&')}`
          await addMenu(menuItem)
          if (item instanceof Folder) await buildFolder(item.children, menuData)
        }
      } else {
        menuData.seq = undefined
        menuItem.id = JSON.stringify(menuData)
        menuItem.title = i18n('folder_empty')
        menuItem.enabled = false
        await addMenu(menuItem)
      }
    }
    // build paste sniplet menu tree
    await buildFolder(space.data.children, menuData)
  }
}

/** Parse the MenuItemID providing data for context menu items
 * @param {string} data The menuItemId from the ContextMenus onClicked event info
 * @returns {{command:string,spaceKey:{name:string,synced:boolean},path?:number[],seq?:number}}
 */
function parseContextMenuData(data) {
  try {
    return JSON.parse(data)
  } catch {
    return {}
  }
}

/** Check for known blocked urls
 * @param {string} src
 */
function isBlockedUrl(src) {
  if (!src) return

  const url = new URL(src)
  const isBlockedProtocol = [
    'chrome:',
    'edge:',
  ].includes(url.protocol)
  const isBlockedOrigin = [
    'https://chromewebstore.google.com',
    'https://microsoftedge.microsoft.com',
  ].includes(url.origin)
  return isBlockedProtocol || isBlockedOrigin
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
  // console.log('Injecting script...', injection, info)

  const src = info.frameUrl || info.pageUrl
  const { target } = injection

  const results = await chrome.scripting.executeScript(injection).catch(async (e) => {
    // only happens if aggressively blocked by browser, retry if it's just the frame
    if (target.allFrames || target.frameIds?.length) {
      const { frameUrl } = info
      delete info.frameUrl
      const retryResults = await chrome.scripting.executeScript({
        ...injection,
        target: { tabId: target.tabId },
      }).catch(e => ({ error: e }))
      if (retryResults?.error) throw new ScriptingBlockedError(src, e)

      const result = retryResults?.at(0)?.result
      if (result?.error?.name === 'SecurityError') {
        const { pageSrc, frameSrc } = result
        const frameOrigin = frameUrl && `${(new URL(frameUrl)).origin}/*`
        const srcOrigin = frameSrc && `${(new URL(frameSrc)).origin}/*`
        const missingPermissions = { origins:
          [...new Set([frameOrigin, srcOrigin].filter(v => v && v !== 'null/*'))],
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
      throw new ScriptingBlockedError(src, e)
    }
  })
  const result = results?.at(0)?.result

  if (result?.error?.name === 'SecurityError') {
    const frameOrigin = result.frameSrc && `${new URL(result.frameSrc).origin}/*`

    // see if we can try again by injecting a relay to find the right frame
    // (a bit silly, but the only way)
    if (!(target.allFrames || target.frameIds?.length)) {
      // get the extension ID to avoid window variable conflicts
      const xId = i18n('@@extension_id')

      // add ping function and listener to a window
      const injectRelay = async (xId) => {
        // skip in case already attached
        if (typeof window[xId]?.pingFrame === 'function') return
        window[xId] = {}

        // attach ping function to window so it can be fired on a subsequent call
        window[xId].pingFrame = async (frame, origins) => {
          if (!frame || !Array.isArray(origins)) return

          // promise for send/response needed to confirm when done
          const ping = new Promise((resolve, reject) => {
            // open channel
            const channel = new MessageChannel()

            // settle the promise after receiving a response
            channel.port1.onmessage = ({ data }) => {
              if (data instanceof Error) reject(data)
              else resolve(data)
            }

            // send the ping message and pass the port
            frame.postMessage({
              xId: xId,
              origins: origins,
            }, '*', [channel.port2])
          })

          // use a timeout function to avoid hanging
          const timeout = new Promise((resolve, reject) => {
            // reduce timeout for each level
            const ms = 400 / origins.length

            // Set timeout error
            const frameSrc = document.activeElement.src
            try {
              // about pages come up not valid
              origins.push(new URL(frameSrc).origin)
            } catch {
              origins.push(null)
            }
            setTimeout(reject, ms, new Error(`Failed to receive a response from the frame within ${ms}ms`, { cause: {
              frameSrc: frameSrc,
              origins: origins,
              lastError: 'TimeoutError',
            } }))
          })

          // return response or timeout, whichever comes first
          return Promise.race([ping, timeout]).catch(e => e)
        }

        // attach event listener to relay the message or set the destination flag
        window.addEventListener('message', async ({ data, ports }) => {
          // ignore messages that aren't for us
          if (!(data.xId === xId) || !ports.length) return

          // update the list of origins
          const { origins } = data
          if (Array.isArray(origins)) {
            try {
              // about pages come up not valid
              origins.push(new URL(window.location.href).origin)
            } catch {
              origins.push(null)
            }
          }

          // check if we're in the final frame yet
          const frame = document.activeElement.contentWindow
          if (frame) {
            // relay the ping and send back the result
            const result = await window[xId].pingFrame(frame, origins).catch(e => e)
            ports[0].postMessage(result)
          } else {
            // set the flag and respond
            window[xId].flag = true
            ports[0].postMessage(origins)
          }
        }, false)
      }

      // ping frames to mark the active one
      const markFrame = async (xId) => {
        // grab the frame
        const frame = document.activeElement.contentWindow

        // start an origin chain
        const origins = []
        try {
          // in case the page url comes up not valid (should only happen on frames)
          origins.push(new URL(window.location.href).origin)
        } catch {
          origins.push(null)
        }

        // finish here if there's no active frame
        if (!frame) {
          window[xId].flag = true
          return origins
        }

        // ping the frame (serialize errors for return)
        const response = await window[xId].pingFrame(frame, origins).catch(e => e)
        // console.log(response)
        if (response instanceof Error) {
          return ({ error: {
            name: response.name,
            message: response.message,
            cause: response.cause,
            string: response.toString(),
          } })
        }

        return response
      }

      // find the frame that's marked active
      const findFlag = (xId) => {
        const { flag } = window[xId]
        delete window[xId].flag
        return flag
      }

      // get the tabId from the provided injection object
      const { tabId } = injection.target

      // inject the relay
      const injectRelayResults = await chrome.scripting.executeScript({
        target: {
          tabId: tabId,
          allFrames: true,
        },
        world: 'MAIN',
        func: injectRelay,
        args: [xId],
      }).catch(e => e)
      if (injectRelayResults instanceof Error) return result

      // fire the relay from the top level
      const markFrameResults = await chrome.scripting.executeScript({
        target: {
          tabId: tabId,
        },
        world: 'MAIN',
        func: markFrame,
        args: [xId],
      }).catch(e => e)
      if (markFrameResults instanceof Error) return result

      // check for TimeoutError indicating a blocked frame
      const markFrameError = markFrameResults.at(0).result?.error
      if (markFrameError) {
        const { cause, string } = markFrameError
        if (cause.lastError === 'TimeoutError') {
          throw new MissingPermissionsError({ origins:
            [`${cause.origins.at(-1)}/*`],
          }, string)
        } else {
          return result
        }
      }

      // check all frames for the flag to find the right one
      const findFlagResults = await chrome.scripting.executeScript({
        target: {
          tabId: tabId,
          allFrames: true,
        },
        world: 'MAIN',
        func: findFlag,
        args: [xId],
      }).catch(e => e)
      if (findFlagResults instanceof Error) return result

      // use the frameId to try again
      const frameID = findFlagResults.find(v => v.result)?.frameId
      if (frameID) {
        const retryResults = await chrome.scripting.executeScript({
          ...injection,
          target: {
            tabId: target.tabId,
            frameIds: [frameID],
          },
        }).catch(e => ({ error: e }))
        if (retryResults?.error) throw new ScriptingBlockedError(src, retryResults.error)

        return retryResults
      }
    }

    const missingPermissions = { origins:
      [frameOrigin].filter(v => v && v !== 'null/*'),
    }
    throw new MissingPermissionsError(missingPermissions, result.error)
  }

  return results
}

/** Snip the selection found at the target
 * @param {{target:chrome.scripting.InjectionTarget,spaceKey:StorageKey,path:number[],pageUrl:string,frameUrl:string}} args
 */
async function snipSelection(args) {
  // console.log('Snipping selection...', args)
  await settings.load()

  const src = args.frameUrl || args.pageUrl
  if (isBlockedUrl(src)) throw new ScriptingBlockedError(src)

  // const { target, spaceKey, path, ...info } = args
  const { target, ...info } = args

  // Make sure we have a space to return into
  // const space = new Space()
  // if (!(spaceKey?.name && await space.load(spaceKey, path)) && !(await space.loadCurrent(settings.view.rememberPath))) {
  //   throw new SnipNotFoundError(spaceKey, path, 'TBD')
  // }

  /** Injection script to grab selection text
   * @param {{preserveTags:boolean, saveSource:boolean}} options
   */
  const returnSnip = ({ preserveTags, saveSource }) => {
    // console.log('Snipping selection...', preserveTags, saveSource)

    /** Recursive for traversing embedded content - required for keyboard shortcuts
     * @param {Window} window
     */
    const getText = (window) => {
      const frame = window.document.activeElement.contentWindow
      try {
        // check if we're inside a frame and recurse
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

      const returnText = (text) => {
        if (!text) return {
          // message-passable (serialized) error in case of no selection
          error: {
            name: 'NoSelectionError',
            message: 'No selection found on active page or frame.',
          },
          pageSrc: window.location.href,
          frameSrc: window.document.activeElement.src,
        }

        return {
          content: text,
          ...saveSource ? { sourceURL: window.location.href } : {},
        }
      }

      // in case selection is inside an input or text area
      /** @type {HTMLTextAreaElement|HTMLInputElement} */
      const input = document.activeElement
      if (['TEXTAREA', 'INPUT'].includes(input.nodeName)) {
        return returnText(input.value.slice(input.selectionStart, input.selectionEnd))
      }

      // get regular selection
      const selection = window.getSelection()
      if (selection.isCollapsed) return returnText()

      // TODO: add option to convert lists to numbers/bullets
      if (preserveTags) {
        const range = selection.getRangeAt(0)
        const content = range.cloneContents()
        const container = range.commonAncestorContainer
        if (['UL', 'OL'].includes(container.nodeName)) {
          const list = container.cloneNode()
          list.append(content)
          return returnText(list.outerHTML)
        } else {
          const temp = document.createElement('template')
          temp.content.append(content)
          return returnText(temp.content.innerHTML)
        }
      }

      return returnText(selection.toString())
    }

    // grab selection
    return getText(window)
  }

  // const result =
  return (await injectScript({
    target: target,
    func: returnSnip,
    args: [settings.snipping],
  }, info)).at(0)?.result

  // console.log('Handling snip result...', result)
  // if (!result || result.error) return result

  // add snip to space and return result
  // const newSnip = space.addItem(new Sniplet(result))
  // space.sort(settings.sort)
  // await space.save(settings.data.compress)
  // return {
  //   target: target,
  //   spaceKey: space.storageKey,
  //   seq: newSnip.seq,
  //   ...path ? { path: space.path } : {},
  // }
}

/**
 * Retrieve and paste a sniplet into the selection found at the target
 * @param {{target:chrome.scripting.InjectionTarget,spaceKey:StorageKey,path:number[],seq:number,pageUrl:string,frameUrl:string}} args
 * @returns {Promise<void>}
 */
async function pasteItem(args) {
  // console.log('Pasting', args)

  const src = args.frameUrl || args.pageUrl
  if (isBlockedUrl(src)) throw new ScriptingBlockedError(src)

  /** Injection script for pasting.
   * @param {{content:string, richText:string}} snip
   */
  const insertSnip = (snip) => {
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

      // no followup needed if there was nothing to insert (done after to clear EOL markers)
      if (!snip?.content) return

      /** Get input element (may be contenteditable)
       * @type {HTMLInputElement|HTMLTextAreaElement|HTMLElement}
       */
      const input = window.document.activeElement

      // some custom editors require special handling
      if (input.classList.contains('ck-editor__editable')) {
        // CKEditor 5 (https://ckeditor.com/docs/ckeditor5/latest/api/index.html)
        const editor = input.closest('.ck-content')?.ckeditorInstance || window.editor
        if (editor) {
          const ckViewFrag = editor.data.processor.toView(snip.richText)
          const ckModFrag = editor.data.toModel(ckViewFrag)
          editor.model.insertContent(ckModFrag)
          return
        }
        // non-standard implementation, execCommand will fail silently (returns true without pasting)
        return {
          error: {
            name: 'CustomEditorError',
            message: 'An unknown or blocked version of CKEditor is bound to this field.',
            cause: { editor: 'CKEditor' },
          },
        }
      } else if (input.classList.contains('cke_editable')) {
        // CKEditor 4 (https://ckeditor.com/docs/ckeditor4/latest/api/index.html)
        // This editor replaces the context menu, so this code will only run with keyboard shortcuts
        const getEditor = window =>
          window.CKEDITOR || (window.parent && getEditor(window.parent))
        const editor = getEditor(window)
        if (editor) {
          editor.currentInstance.insertHTML(snip.richText)
          return
        }
        // deprecated/unknown version or blocked parent (execCommand won't work)
        return {
          error: {
            name: 'CustomEditorError',
            message: 'An unknown or blocked version of CKEditor is bound to this field.',
            cause: { editor: 'CKEditor' },
          },
        }
      } else if (input.classList.contains('cm-content')) {
        // CodeMirror 6 (https://codemirror.net/docs/ref/)
        const cmView = document.activeElement.cmView?.view
        if (cmView) {
          cmView.dispatch(cmView.viewState.state.replaceSelection(snip.content))
          // dispatch does not return a success message, so just assume success
          return
        }
        // document.execCommand returns false, so manual code will take over
      } else if (document.activeElement.closest('.CodeMirror')) {
        // CodeMirror 5 (https://codemirror.net/5/doc/manual.html)
        const cm = document.activeElement.closest('.CodeMirror').CodeMirror
        if (cm) {
          cm.replaceSelection(snip.content)
          // dispatch does not return a success message, so just assume success
          return
        }
        // document.execCommand returns false, so manual code will take over
      } else if (input.classList.contains('tiny-editable')) {
        // TinyMCE (https://www.tiny.cloud/docs/tinymce/latest/apis/tinymce.root/)
        if (window.tinyMCE || window.tinymce) {
          const tinyMCE = window.tinyMCE || window.tinymce
          const pasted = tinyMCE.activeEditor.execCommand('mceInsertContent', false, snip.richText)
          if (pasted) return
        }
        // document.execCommand normally works as well
      } else if (input.classList.contains('fr-element')) {
        // Froala (https://froala.com/wysiwyg-editor/docs/overview/)
        const froala = window.FroalaEditor?.INSTANCES?.find(i => i.el === document.activeElement)
          || input.closest('.fr-box')['data-froala.editor']
        if (froala) {
          froala.undo.saveStep()
          froala.html.insert(snip.richText)
          froala.undo.saveStep()
          return
        }
        // document.execCommand normally works as well
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
        } catch {
          return
        }
      })()

      if (!pasted) {
        // return error if the selection is not editable
        if (!(['TEXTAREA', 'INPUT'].includes(input.nodeName) || input.isContentEditable)) return {
          error: {
            name: 'NoSelectionError',
            message: 'No selection found on active page or frame.',
            cause: {
              nodeName: input.nodeName,
              isContentEditable: input.isContentEditable,
              value: input.value,
              textContent: input.textContent,
            },
          },
          pageSrc: window.location.href,
          frameSrc: window.document.activeElement.src,
        }

        // forward-compatible manual cut paste code that kills the undo stack
        if (input.selectionStart) {
          const start = input.selectionStart
          const end = input.selectionEnd
          input.value = input.value.slice(0, start) + snip.content + input.value.slice(end)
          input.selectionStart = input.selectionEnd = start + snip.content.length
        } else {
          const selection = window.getSelection()
          const range = selection.getRangeAt(0)
          range.deleteContents()
          if (input.contentEditable === 'plaintext-only'
            // assume monospace is a code block with highlighting (like CodeMirror) and paste plaintext
            || getComputedStyle(input).fontFamily.includes('monospace')) {
            range.insertNode(document.createTextNode(snip.content))
          } else {
            // no sanitation as that's between the user and the website
            const template = document.createElement('template')
            template.innerHTML = snip.richText
            range.insertNode(template.content)
          }
          selection.collapseToEnd()
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
    const sniplet = space.getProcessedSniplet(seq, path)
    if (!sniplet?.content) throw new SnipNotFoundError(spaceKey, path, seq)
    if (sniplet.customFields) throw new CustomPlaceholderError(sniplet)

    // generate richText if everything is ready
    await settings.load()
    sniplet.richText = getRichText(sniplet, settings.pasting)

    // assign sniplet to command
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

  // increment counters only if paste was successful
  if (!result?.error && snip?.counters) {
    const space = new Space()
    if (await space.load(args.spaceKey, args.path)) {
      space.setCounters(snip.counters, true)
      await settings.load()
      space.save(settings.data.compress)
    }
  }

  return result
}

/** Available commands (must be async/return promise for error handling) */
const commandMap = new Map([
  ['snip', snipSelection],
  ['paste', pasteItem],
])

/** Run a command on the selection
 * @param {'snip'|'paste'} command
 * @param {{}} args
 * @returns {*|{error:Error}}
 */
async function runCommand(command, args) {
  // console.log('Running command...', command, args)
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
  isBlockedUrl,
  commandMap,
  runCommand,
}
