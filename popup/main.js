import settings from '/modules/settings.js'
import { getCurrentTab, openWindow } from '/modules/sessions.js'
import { i18n, locale, i18nNum } from '/modules/refs.js'
import { setStorageData, getStorageData, removeStorageData, KeyStore, setClipboard, StorageKey } from '/modules/storage.js'
import { Folder, Sniplet, DataBucket, Space, getStorageArea, getRichText, parseStringPath } from '/modules/spaces.js'
import {
  buildNode,
  buildSvg,
  setSvgSprite,
  buildActionIcon,
  buildPopoverMenu,
  buildMenuItem,
  buildMenuSeparator,
  buildSubMenu,
  buildMenuControl,
  buildItemWidget,
  buildTreeWidget,
  buildColorMenu,
} from '/modules/dom.js'
import { showModal, showAlert, confirmAction, confirmSelection, showAbout, toast } from '/modules/modals.js'
import { isBlockedUrl, runCommand } from '/modules/commands.js'
import { CustomPlaceholderError, MissingPermissionsError, ScriptingBlockedError, SnipNotFoundError } from '/modules/errors.js'

/**
 * Shorthand for document.getElementById(id)
 * @param {string} id
 * @returns {HTMLElement}
 */
const $ = id => document.getElementById(id)

/**
 * Shorthand for document.querySelector(query)
 * @param {string} query
 * @returns {HTMLElement}
 */
const q$ = query => document.querySelector(query)

/**
 * Shorthand for document.querySelectorAll(query)
 * @param {string} query
 * @returns {HTMLElement}
 */
const qa$ = query => document.querySelectorAll(query)

// globals for settings and keeping track of the current folder
const space = new Space()
const saveSpace = async () => space.save(settings.data.compress)
const setCurrentSpace = async () => space.setAsCurrent()
const loadCurrentSpace = async () => space.loadCurrent(settings.view.rememberPath)

// resize helper for editors
const adjustEditors = () => {
  for (const ta of qa$('.snip-content textarea')) adjustTextArea(ta)
}

/**
 * @param {ResizeObserverEntry[]} entries
 */
const adjustOnResize = ([{ target, contentBoxSize: [{ inlineSize }] }]) => {
  const { lastInlineSize } = target.dataset
  if (inlineSize !== +lastInlineSize) {
    adjustPath()
    adjustEditors()
  }
  target.dataset.lastInlineSize = inlineSize
}

// observer for resizing the header path and textAreas
// debounce may cause flashing but prevents loop errors
const debounce = function setDelay(f, delay) {
  let timer = 0
  return function (...args) {
    clearTimeout(timer)
    timer = setTimeout(() => f.apply(this, args), delay)
  }
}
const onResize = new ResizeObserver(debounce(adjustOnResize, 0))

// (note that side panel doesn't currently allow switching window focus.
// see https://github.com/w3c/webextensions/issues/693)
/** Load the sniplets list and focus the requested field
 * @param {number} seq
 * @param {'name'|'content'|'sourceURL'} [fieldName]
 * @param {boolean} [select]
 */
function loadAndFocus(seq, fieldName = 'name', select = true) {
  //  turn off transition temporarily for better scrollIntoView
  $('sniplets').classList.add('no-transition')

  // load results
  loadSniplets()

  // focus the new sniplet's name field after redraw
  setTimeout(() => {
    /** @type {HTMLInputElement} */
    const field = q$(`[name="${fieldName}"][data-seq="${seq}"]`)
    if (!field) return
    field.closest('.card').scrollIntoView({ behavior: 'smooth' })
    field.focus()
    if (select) field.select()
    $('sniplets').classList.remove('no-transition')
  }, 0)
}

async function handleError({ error, ...args }) {
  async function handleScriptingBlockedError({ cause }) {
    console.log('Handling Scripting Blocked Error', cause)
    const { url } = cause

    await showAlert(
      i18n('alert_message_scripting_blocked', url),
      i18n('alert_title_scripting_blocked'),
    )
  }

  async function handleCrossOriginError({ cause }) {
    // console.log('Handling Cross Origin Error', cause)
    const { task, pageSrc, frameSrc } = cause

    await showAlert(
      i18n('error_cross_origin_message', [i18n(`error_action_${task}`), pageSrc, frameSrc]),
      i18n('error_cross_origin_title'),
    )
  }

  async function handleMissingPermissionsError({ cause }) {
    // console.log('Handling Missing Permissions Error', cause)
    const { origins } = cause
    const allUrls = ['<all_urls>']

    // check if we already have the permissions in question and therefore only all_urls will help
    const haveOrigins = !origins.length || (origins.length && await chrome.permissions.contains({
      origins: origins,
    }))

    // empty objects are truthy signifying the request can be retried
    if (haveOrigins && await confirmAction(i18n('request_origins_all'), i18n('action_permit'))) {
      if (await chrome.permissions.request({
        origins: allUrls,
      }).catch(() => false)) return {}
    } else if (origins.length) {
      const request = await confirmSelection(i18n('request_origins', origins.join(', ')), [
        { title: i18n('request_all_site_permissions'), value: JSON.stringify(allUrls) },
        { title: i18n('request_site_permissions'), value: JSON.stringify(origins) },
      ], i18n('action_permit'))
      if (request && await chrome.permissions.request({
        origins: JSON.parse(request),
      }).catch(() => false)) return {}
    }

    return
  }

  async function handleSnipNotFoundError({ cause }) {
    // console.log('Handling Snip Not Found Error', cause)
    const { name, synced, path, seq } = cause
    await showAlert(
      i18n('warning_snip_not_found', [name, synced, path, seq]),
      i18n('title_snip_not_found'),
    )
  }

  async function handleNoSelectionError() {
    await showAlert(
      i18n('warning_selection_not_found'),
      i18n('title_selection_not_found'),
    )
  }

  async function handleCustomPlaceholderError({ cause }) {
    // console.log('Handling Custom Placeholder Error', cause)
    const snip = structuredClone(cause.snip)
    const { customFields } = snip

    const confirmedFields = await showModal({
      title: i18n('title_custom_placeholders'),
      fields: customFields.map(([placeholder, field], i) => ({
        type: field.type,
        name: `placeholder-${i}`,
        label: placeholder,
        value: field.value,
        options: field.options,
      })),
      buttons: [
        {
          title: i18n('confirm'),
          value: JSON.stringify(customFields),
          id: 'confirmFields',
        },
      ],
    }, (event) => {
      /** @type {HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement} */
      const input = event.target
      const modal = input.closest('dialog')
      /** @type {HTMLButtonElement} */
      const button = modal.querySelector('#confirmFields')
      const fields = new Map(JSON.parse(button.value))
      const field = fields.get(input.title)
      field.value = input.value
      fields.set(input.title, field)
      button.value = JSON.stringify(Array.from(fields.entries()))
    })

    // update confirmed fields and richText
    const fieldMap = new Map(confirmedFields ? JSON.parse(confirmedFields) : [])
    if (!fieldMap) return // assume cancelled

    snip.content = snip.content.replaceAll(
      /\$\[(.+?)(?:\(.+?\))?(?:\{.+?\})?\]/g,
      (match, placeholder) => {
        const value = fieldMap.get(placeholder)?.value
        // confirm that selections have been updated with values
        return (typeof value === 'string') ? value : match
      },
    )
    snip.richText = getRichText(snip, settings.pasting)

    // remove custom field info after finished processing
    delete snip.customFields

    return { snip: snip }
  }

  async function handleCustomEditorError({ cause }) {
    // console.log('Handling Custom Editor Error', cause)
    const { editor } = cause

    await showAlert(
      i18n('alert_message_custom_editor_error', [editor || i18n('placeholder_custom_editor')]),
      i18n('alert_title_scripting_blocked'),
    )
  }

  async function handleUnknownError({ name, message, cause }) {
    await showAlert(
      i18n('alert_message_unknown_error', [name, message, cause]),
      i18n('alert_title_unknown_error'),
    )
  }

  const errorHandlers = {
    ScriptingBlockedError: handleScriptingBlockedError,
    CrossOriginError: handleCrossOriginError,
    MissingPermissionsError: handleMissingPermissionsError,
    SnipNotFoundError: handleSnipNotFoundError,
    NoSelectionError: handleNoSelectionError,
    CustomPlaceholderError: handleCustomPlaceholderError,
    handleCustomEditorError: handleCustomEditorError,
  }

  const errorHandler = errorHandlers[error.name]
  if (typeof errorHandler === 'function') {
    const errorHandlerResult = await errorHandler(error)
    if (errorHandlerResult) {
      return {
        ...args,
        ...errorHandlerResult,
      }
    }
  } else {
    await handleUnknownError(error)
  }
}

async function handleFollowup({ action, args }) {
  console.log('Handling followup...', action, args)

  async function handleUnsync(args) {
    // update settings and get current space for comparison
    await settings.load()
    const currentSpace = (await KeyStore.currentSpace.get()) || settings.defaultSpace

    // TODO: remove name check once space switching is implemented (renames handled by service worker)
    // ignore if we're not syncing
    if (!currentSpace.synced || args.name !== currentSpace.name) {
      loadSniplets()
      return
    }

    // make sure it hasn't already been restored and we're not removing a replacement
    if ((await getStorageData(args.name, 'sync'))
      || !(await KeyStore.currentSpace.get()) // resolves race condition
    ) return

    // check if this is a rename we haven't caught up with
    const renameLog = await KeyStore.renameLog.get()
    const renameEntry = renameLog?.find(v => (args.name === v.oldName))
    if (renameEntry?.oldName === currentSpace.name
      && await space.load(new StorageKey(renameEntry.newName, currentSpace.synced), settings.view.rememberPath ? currentSpace.path : [])
    ) {
      setCurrentSpace()
      loadSniplets()
      return
    }

    // make it possible to keep local data or keep synchronizing on this machine just in case
    args.synced = await confirmAction(
      i18n('warning_sync_stopped'),
      i18n('action_keep_syncing'),
      i18n('action_use_local'),
    )
    // assume ignore (keep synchronizing) if popup dismissed
    if (!(typeof args.synced === 'boolean')) args.synced = true

    // if not currently working on the same data, make do with saving the data
    if (args.name !== currentSpace.name) {
      setStorageData(args.name, args.data, getStorageArea(args.synced))
      return
    }

    // recover the data
    try {
      await space.init(args)
      if (!(await saveSpace())) {
        showAlert(i18n('error_data_corrupt'))
        return
      }
      setCurrentSpace()
      loadSniplets()
    } catch {
      showAlert(i18n('error_data_corrupt'))
    }
  }

  async function handleSnipResult(result) {
    // make sure we have the latest globals (in case the window was popped open)
    await settings.load()
    if (!space.name) await loadCurrentSpace()

    // update result in case error handling and additional followup is needed.
    // if (!result.spaceKey) result.spaceKey = space.storageKey
    // if (!Array.isArray(result.path)) result.path = space.path

    // make sure this window can handle the followup
    // if (!(result.spaceKey?.key === space.storageKey.key
    //   && result.spaceKey?.area === space.storageKey.area)) return

    // handle errors first and retry if successfully handled
    if (result.error) {
      const errorResult = await handleError(result)
      if (errorResult) {
        delete result.error
        const retryResult = await runCommand('snip', {
          ...result,
          ...errorResult,
        })
        if (retryResult) return handleFollowup({ action: 'snip', args: {
          ...result,
          ...retryResult,
        } })
      }
      return
    }

    // add sniplet
    const { seq } = space.addItem(new Sniplet(result))
    space.sort(settings.sort)
    saveSpace()

    loadAndFocus(seq)
  }

  async function handlePasteResult(result) {
    // make sure we have the latest globals (in case the window was popped open)
    await settings.load()
    await loadCurrentSpace()

    // currently, only errors need handling
    console.log('Handling paste result...', result, space.storageKey)

    if (!result.spaceKey) result.spaceKey = space.storageKey
    if (!result.path) result.path = space.path

    // make sure this window can handle the followup
    if (!(result.spaceKey?.key === space.storageKey.key
      && result.spaceKey?.area === space.storageKey.area)) return

    // handle errors and retry if successfully handled
    if (result.error) {
      const errorResult = await handleError(result)
      if (errorResult) {
        delete result.error
        const retryResult = await runCommand('paste', {
          ...result,
          ...errorResult,
        })
        if (retryResult) return handleFollowup({ action: 'paste', args: {
          ...result,
          ...retryResult,
        } })
      } else {
        // load and show the appropriate sniplet
        space.path = Array.isArray(result.path) ? result.path : []
        loadAndFocus(result.seq, 'content', false)
      }
    }
  }

  const followupHandlers = {
    alert: showAlert,
    snip: handleSnipResult,
    paste: handlePasteResult,
    unsynced: handleUnsync,
  }

  const followupHandler = followupHandlers[action]
  if (typeof followupHandler === 'function') {
    await followupHandler(args)
  }

  // check if anythings loaded after handling the followup and close otherwise
  if (!$('path')) window.close()
}

async function getProcessedSniplet(seq) {
  const snip = space.getProcessedSniplet(seq)
  if (!snip) return

  // handle placeholders
  if (snip.customFields) {
    const errorResult = await handleError({ error: new CustomPlaceholderError(snip) })
    if (errorResult?.snip?.content) return errorResult.snip
    else return
  }

  // generate richText if everything is ready
  snip.richText = getRichText(snip, settings.pasting)

  return snip
}

async function copySniplet(args) {
  // console.log('Copying sniplet...', { ...args })

  // get requested item
  const snip = args.snip || await getProcessedSniplet(+args.seq)

  if (snip && await setClipboard(snip)) {
    // rebuild settings menu in case there was an update to counters
    if (snip.counters) {
      space.setCounters(snip.counters, true)
      saveSpace()
      $('settings').replaceChildren(...buildMenu())
    }

    // notify the user it worked
    toast(i18n('toast_copied'))
  } else {
    toast(i18n('error_sniplet_not_copied'), 'error')
    return
  }
}

async function pasteSniplet(args) {
  // console.log('Pasting sniplet...', { ...args })

  // get active tab info and confirm basic access
  const activeTab = await getCurrentTab()
  if (!activeTab?.url) {
    // check for all urls permission
    if (await chrome.permissions.contains({ origins: ['<all_urls>'] })) {
      // no scripting possible
      handleError({
        error: new ScriptingBlockedError(),
      })
      return
    } else {
      // no activeTab permission (toggled side panel), request all urls permission
      const errorResult = await handleError({
        error: new MissingPermissionsError({ origins: [] }),
      })
      if (!errorResult) return
    }
  } else if (isBlockedUrl(activeTab.url)) {
    // known site where scripting is not allowed (extension store)
    handleError({
      error: new ScriptingBlockedError(activeTab.url),
    })
    return
  }

  // set up target args
  args.pageUrl = activeTab.url
  args.target = { tabId: activeTab.id }
  args.spaceKey = space.storageKey

  // get requested item
  args.snip ||= await getProcessedSniplet(+args.seq)
  if (!args.snip) {
    await handleError(new SnipNotFoundError(space.storageKey, space.path, args.seq))
    return
  }

  // attempt to paste into a selected field
  const result = await runCommand('paste', args)
  if (result) handleFollowup({ action: 'paste', args: {
    ...args,
    ...result,
  } })
}

// Listen for updates on the fly in case of multiple popout windows
chrome.runtime.onMessage.addListener(async (message) => {
  console.log('Receiving message...', message)

  /** @type {{ to: chrome.runtime.ExtensionContext, subject: string, body: * }} */
  const { to, subject, body } = message

  const messageMap = new Map([
    ['updateSettings', async () => {
      await settings.load()
      // TODO: remove once space switcher implemented
      // make sure names are in sync
      if (settings.defaultSpace.name !== space.name) {
        await loadCurrentSpace()
      }
      loadSniplets()
    }],
    ['updateSpace', async () => {
      // check for an updated currentSpace
      const currentSpace = await KeyStore.currentSpace.get()
      if (currentSpace?.name !== space.name) {
        await loadCurrentSpace()
        loadSniplets()
      }

      const { name, synced, timestamp } = body
      if (name === space.name && synced === space.synced && timestamp > space.data.timestamp) {
        await space.reload()
        loadSniplets()
      }
    }],
    ['followup', () => {
      if (!to || to.documentUrl === location.href) handleFollowup(body)
    }],
  ])

  const messageMapFunc = messageMap.get(subject)
  if (typeof messageMapFunc === 'function') messageMapFunc()
})

/** Will run on DOMContentLoaded */
const loadPopup = async () => {
  // accessibility
  document.documentElement.lang = locale
  document.title = i18n('app_name')

  // load up settings with sanitation check for sideloaded versions
  if (!(await settings.load())) {
    // console.warn('No settings found, reinitializing...')
    settings.init()
    settings.save()
  }

  // load parameters
  window.params = Object.fromEntries(new URLSearchParams(location.search))

  // check if opened as popup and set style accordingly
  if (window.params.view === chrome.runtime.ContextType.POPUP) {
    document.body.style.width = '370px' // column flex collapses width unless set
    document.body.style.height = '560px'
  }

  // set up listeners
  document.body.addEventListener('mousedown', handleMouseDown, false)
  document.body.addEventListener('dragstart', handleDragDrop, false)
  document.body.addEventListener('click', handleClick, false)
  document.body.addEventListener('mouseup', handleMouseUp, false)
  document.body.addEventListener('keydown', handleKeydown, false)
  document.body.addEventListener('keyup', handleKeyup, false)
  document.body.addEventListener('focusin', handleFocusIn, false)
  document.body.addEventListener('input', handleInput, false)
  document.body.addEventListener('change', handleChange, false)
  document.body.addEventListener('focusout', handleFocusOut, false)

  // set up ResizeObserver to handle path and editor reflows
  onResize.observe($('sniplets'))

  // check for any notice that needs to be posted
  const notice = await KeyStore.notice.get()
  if (notice) {
    await showAbout(notice)
    KeyStore.notice.clear()
  }

  // Fetch requests from session storage set using the `setFollowup()` function
  const followup = await KeyStore.followup.get()
  if (followup) {
    console.log(followup)
    KeyStore.followup.clear()
    handleFollowup(followup)

    // stop here to avoid clashes with followups expecting to handle sniplet loading themselves
    return
  }

  // load up the current space
  if (!(await loadCurrentSpace())) {
    if (await confirmAction(i18n('warning_space_corrupt'), i18n('action_reinitialize'))) {
      await space.init(settings.defaultSpace)
      saveSpace()
    } else {
      window.close()
      return
    }
  }

  // update path if needed
  if (window.params.path) {
    space.path = parseStringPath(window.params.path)
    if (settings.view.rememberPath) setCurrentSpace()
  }

  // load sniplets
  loadSniplets()

  // check and action URL parameters accordingly
  if (window.params.action?.length) handleAction(window.params)
}
document.addEventListener('DOMContentLoaded', loadPopup, false)

/**
 * Helper for grouping tree items by type
 * @param {(Folder|Sniplet)[]} list
 * @param {'type'|'color'|'src'} by - accepts 'type' to group by class name, or a field name
 * @returns {{folder?:Folder[], sniplet?:Sniplet[], color?:(Folder|Sniplet)[], src?:(Folder|Sniplet)[]}}
 * @example
 * // itemGroups will have separate properties .folder & . containing only
 * // subfolders of the space.children root folder
 * const itemGroups = groupItems(space.children, 'type');
 */
const groupItems = (list, by = settings.sort.groupBy) => list.reduce((groups, item) => {
  groups.all ||= []
  groups.all.push(item)
  if (!by) return groups

  const group = (by === 'type')
    ? item.constructor.name.toLowerCase()
    : item[by]
  groups[group] ||= []
  groups[group].push(item)
  return groups
}, {})

/**
 * Helper for only grabbing subfolders
 * @param {*[]} folder
 * @returns {Folder[]}
 */
const getSubFolders = folder => groupItems(folder, 'type').folder

function setHeaderPath() {
  // console.log(`Setting header path`);
  // get list of path names (should always include space name)
  const pathNames = space.getPathNames()
  const pathNode = $('path')

  // add root
  pathNode.replaceChildren(
    buildNode('li', {
      id: 'folder-up',
      classList: ['folder'],
      style: { display: 'none' }, // only display when out of room
      dataset: { path: '' },
      children: [buildActionIcon('Back', 'path-back', {
        action: 'open-folder',
        target: '',
      })],
    }),
    buildNode('li', {
      classList: ['folder'],
      dataset: { path: 'root' },
      children: [buildNode('button', {
        type: 'button',
        dataset: {
          action: 'open-folder',
          target: '',
        },
        children: [buildNode('h1', {
          textContent: pathNames.shift(),
        })],
      })],
    }),
  )
  // console.log(`Adding additional path names`, pathNames);
  const separator = buildSvg(i18n('path_separator'), 'path-separator')
  separator.setAttribute('class', 'chevron')
  pathNames.forEach((name, i) => pathNode.append(buildNode('li', {
    classList: ['folder'],
    dataset: {
      seq: space.path.slice(i, i + 1),
      path: space.path.slice(0, i),
    },
    children: [
      separator.cloneNode(true),
      // buildNode('h1', {textContent: `/`}),
      buildNode('button', {
        type: `button`,
        dataset: {
          action: `open-folder`,
          target: space.path.slice(0, i + 1),
        },
        children: [buildNode('h1', {
          textContent: name,
        })],
      }),
    ],
  })))
}

function buildMenu() {
  const { startVal, ...counters } = space.data.counters
  const customStartVal = (startVal > 1 || startVal < 0)
  return [
    buildSubMenu(i18n('menu_action'), 'settings-action', [
      buildMenuControl('radio', 'set-icon-action', 'popup', i18n('menu_set_view_action_popup'),
        settings.view.action === 'popup', { id: 'set-action-popup' }),
      buildMenuControl('radio', 'set-icon-action', 'panel', i18n('menu_set_view_action_panel'),
        settings.view.action === 'panel', { id: 'set-action-panel' }),
      buildMenuControl('radio', 'set-icon-action', 'panel-toggle', i18n('menu_set_view_action_panel_toggle'),
        settings.view.action === 'panel-toggle', { id: 'set-action-panel-toggle' }),
      // It's not currently possible to look up settings inside the action listener,
      // so windows must be opened using pop-out button
      // buildMenuControl('radio', 'set-icon-action', 'window', i18n('menu_set_view_action_window'),
      //   settings.view.action === 'window', { id: "set-action-window" }),
    ]),
    buildSubMenu(i18n('menu_view'), `settings-view`, [
      buildMenuControl('checkbox', `toggle-remember-path`, settings.view.rememberPath,
        i18n('menu_remember_path'), settings.view.rememberPath),
      buildMenuControl('checkbox', `toggle-folders-first`, settings.sort.foldersOnTop,
        i18n('menu_folders_first'), settings.sort.foldersOnTop),
      buildMenuSeparator(),
      buildMenuControl('checkbox', `toggle-adjust-editors`, settings.view.adjustTextArea,
        i18n('menu_adjust_textarea'), settings.view.adjustTextArea),
      buildMenuControl('checkbox', `toggle-collapse-editors`, settings.view.collapseEditors,
        i18n('menu_collapse_editors'), settings.view.collapseEditors),
      buildMenuControl('checkbox', `toggle-show-source`, settings.view.sourceURL,
        i18n('menu_show_src'), settings.view.sourceURL),
    ]),
    buildSubMenu(i18n('menu_snip'), `settings-snip`, [
      buildMenuControl('checkbox', `toggle-save-source`, settings.snipping.saveSource,
        i18n('menu_save_src'), settings.snipping.saveSource),
      buildMenuControl('checkbox', `toggle-save-tags`, settings.snipping.preserveTags,
        i18n('menu_save_tags'), settings.snipping.preserveTags),
    ]),
    buildSubMenu(i18n('menu_paste'), `settings-paste`, [
      buildMenuControl('checkbox', `toggle-rt-line-breaks`, settings.pasting.rtLineBreaks,
        i18n('menu_rt_br'), settings.pasting.rtLineBreaks),
      buildMenuControl('checkbox', `toggle-rt-link-urls`, settings.pasting.rtLinkURLs,
        i18n('menu_rt_url'), settings.pasting.rtLinkURLs),
      buildMenuControl('checkbox', `toggle-rt-link-emails`, settings.pasting.rtLinkEmails,
        i18n('menu_rt_email'), settings.pasting.rtLinkEmails),
    ]),
    buildSubMenu(i18n('menu_counters'), `settings-counters`, [
      buildSubMenu(i18n('menu_count_init'), `counter-init`, [
        buildMenuControl('radio', `set-counter-init`, '0',
          i18nNum(0), startVal === 0, { id: `counter-init-0` }),
        buildMenuControl('radio', 'set-counter-init', '1',
          i18nNum(1), startVal === 1, { id: `counter-init-1` }),
        buildMenuControl('radio', 'set-counter-init', startVal,
          `${i18n('menu_count_x')}${customStartVal ? ` (${i18nNum(startVal)})` : ''}…`, customStartVal, { id: `counter-init-x` }),
      ]),
      ...Object.keys(counters).length
        ? [buildMenuItem(`${i18n('menu_count_manage')}…`, `manage-counters`)]
        : [],
      ...Object.keys(counters).length
        ? [buildMenuItem(i18n('menu_count_clear'), `clear-counters`)]
        : [],
    ]),
    buildSubMenu(i18n('menu_data'), `settings-data`, [
      buildMenuControl('checkbox', `toggle-data-compression`, settings.data.compress,
        i18n('menu_data_compression'), settings.data.compress),
      buildMenuSeparator(),
      buildMenuItem(i18n('menu_clear_src'), `clear-src-urls`),
      // buildMenuItem(i18n("menu_clear_sync"), `clear-sync`),
      buildMenuItem(i18n('menu_reinit'), `initialize`),
    ]),
    buildSubMenu(i18n('menu_backups'), `settings-backup`, [
      buildMenuItem(i18n('menu_bak_data'), `backup-data`, `data`, { action: 'backup' }),
      buildMenuItem(i18n('menu_bak_full'), `backup-full`, `full`, { action: 'backup' }),
      buildMenuItem(i18n('menu_bak_clip'), `backup-clippings`, 'clippings', { action: 'backup' }),
      buildMenuSeparator(),
      buildMenuItem(i18n('menu_import'), 'import-data'),
      buildMenuItem(i18n('menu_restore'), 'restore'),
    ]),
    buildMenuItem(`${i18n('menu_about')}…`, 'about'),
  ]
}

function buildHeader() {
  // popover settings menu
  const settingsMenu = buildPopoverMenu('settings', i18n('menu_settings'), 'menu-settings', buildMenu())

  // add path navigation element
  const path = buildNode('nav', {
    children: [buildNode('ul', { id: 'path' })],
  })

  // quick actions
  const quickActionMenu = buildNode('div', {
    classList: ['quick-actions'],
    children: [
      buildActionIcon(
        space.synced ? i18n('action_stop_sync') : i18n('action_start_sync'),
        `icon-${getStorageArea(space.synced)}`, {
          action: 'toggle-sync',
        },
      ),
      buildPopoverMenu('add-new', i18n('menu_add_item'), 'menu-add-new', [
        buildMenuItem(i18n('action_add_folder'), 'new-folder'),
        buildMenuItem(i18n('action_add_sniplet'), 'new-sniplet'),
      ]),
      ...(window.params.view !== chrome.runtime.ContextType.TAB)
        ? [
            buildActionIcon(i18n('open_new_window'), 'menu-pop-out', {
              action: 'open-window',
            }),
          ]
        : [],
    ],
  })

  // put header together
  $('header').replaceChildren(
    settingsMenu,
    path,
    quickActionMenu,
  )

  // set path
  setHeaderPath()
}

/** Hide folder entries as needed */
function adjustPath() {
  const maxHeight = 33 // normal is 32, 33 allows for subpixels
  const upIcon = $('folder-up')
  if (!upIcon) return // path not generated yet
  const container = $('path')
  /** @type {HTMLElement[]} */
  const pathList = Array.from(container.getElementsByTagName('li'))
  if (container.offsetHeight > maxHeight & container.childElementCount > 2) {
    // show up icon
    upIcon.style.removeProperty('display')
    // hide parts of the folder path in case it's too long
    const folderList = pathList.slice(1, -1) // always show current folder name
    for (const folder of folderList) {
      if (maxHeight > container.offsetHeight) break
      folder.style.display = 'none'
      upIcon.dataset.path = folder.dataset.path
      upIcon.dataset.seq = folder.dataset.seq
      upIcon.querySelector('button').dataset.target = folder.querySelector('button').dataset.target
    }
  } else {
    // show parts of the folder path as space becomes available
    /** @type {HTMLElement[]} */
    const hiddenFolders = pathList.filter(e => e.style.display === 'none').reverse()
    if (hiddenFolders.at(0) === upIcon) return // folder-up hidden, we're fine
    let i = 1
    for (const folder of hiddenFolders) {
      folder.style.removeProperty('display')
      const isRoot = (hiddenFolders.length === i++ && folder.textContent === space.name)
      if (isRoot) upIcon.style.display = 'none'
      if (container.offsetHeight > maxHeight) {
        // revert last and stop unhiding folders when there's no more space
        folder.style.display = 'none'
        if (isRoot) upIcon.style.removeProperty('display')
        break
      }
    }
  }
}

function buildTree() {
  /**
   * Build folder tree for pop-out window (recursive function)
   * @param {Folder[]} folders
   * @param {int[]} path
   */
  function buildFolderList(folders, path) {
    const isRoot = folders.at(0) instanceof DataBucket

    // list container with initial drop zone for reordering
    const folderList = buildNode('ul', {
      id: `folder-${path}`,
      ...isRoot
        ? {}
        : { children: [
            buildNode('li', {
              dataset: { path: path, seq: '0.5' },
              classList: ['delimiter'],
            }),
          ] },
    })

    // add each folder with a following drop-zone for reordering
    for (const folder of folders) {
      // check for subfolders
      const subFolders = getSubFolders(folder.children)
      // create folder list item
      const folderItem = buildNode('li', {
        classList: ['folder'],
        dataset: {
          path: path,
          ...isRoot ? {} : { seq: folder.seq },
        },
      })
      // add folder details
      folderItem.append(buildTreeWidget(
        !!subFolders,
        folder.color,
        (isRoot) ? '' : path.concat([folder.seq]),
        (isRoot) ? space.name : folder.name,
      ))
      // add sub-list if subfolders were found
      if (subFolders) folderItem.append(
        buildFolderList(subFolders, (isRoot) ? [] : path.concat([folder.seq])),
      )
      // Add list item to list
      folderList.append(folderItem)
      // Insert dropzone after for reordering
      if (!isRoot) {
        folderList.append(buildNode('li', {
          dataset: { path: path, seq: String(folder.seq + 0.5) },
          classList: ['delimiter'],
        }))
      }
    }
    return folderList
  }
  // start building from the root
  $('tree').replaceChildren(buildFolderList([space.data], ['root']))
}

function buildList() {
  // shorthands
  const container = $('sniplets')
  const scroll = container.scrollTop
  const { path } = space
  const fot = settings.sort.foldersOnTop

  // clear current list and get info
  container.replaceChildren(buildNode('div', { classList: ['sizer'] }))
  const folder = space.getItem(path).children || []
  const groupedItems = fot && groupItems(folder, 'type')

  if (fot && groupedItems.folder) { // group folders at top if set
    container.append(buildNode('div', {
      classList: ['card'],
      children: [buildNode('ul', {
        classList: ['folder-list'],
        children: [
          buildNode('li', { // leading dropzone
            classList: ['delimiter'],
            dataset: {
              seq: 0.5,
              path: path,
            },
          }),
        ].concat(groupedItems.folder.flatMap((folder, i, a) => [
          buildNode('li', { // folder item
            classList: ['folder'],
            dataset: {
              seq: folder.seq,
              path: path,
            },
            children: [buildItemWidget(folder, groupedItems.folder, path, settings)],
          }),
          buildNode('li', { // trailing dropzone
            classList: [(i < a.length - 1) ? 'separator' : 'delimiter'],
            dataset: {
              seq: String(folder.seq + 0.5),
              path: path,
            },
            children: (i < a.length - 1) && [buildNode('hr')],
          }),
        ])),
      })],
    }))
    container.append(buildNode('hr'))
  }

  // list sniplets, including folders if not grouped at top
  const items = fot ? groupedItems.sniplet : folder
  if (items) {
    container.append(buildNode('ul', {
      id: 'sniplet-list',
      children: [
        buildNode('li', {
          classList: ['delimiter'],
          dataset: {
            seq: 0.5,
            path: path,
          },
        }),
      ].concat(items.flatMap(item => [
        buildNode('li', {
          classList: [item.constructor.name.toLowerCase()],
          dataset: {
            seq: item.seq,
            path: path,
          },
          children: [buildNode('div', {
            classList: ['card', 'drag'],
            draggable: 'true',
            children: [buildItemWidget(item, items, path, settings)],
          })],
        }),
        buildNode('li', {
          classList: ['delimiter'],
          dataset: {
            seq: item.seq + 0.5,
            path: path,
          },
        }),
      ])),
    }))

    // set textarea height as appropriate
    for (const textarea of container.getElementsByTagName('textarea')) {
      adjustTextArea(textarea)
    }
  }

  // maintain scroll position as much as possible
  container.scrollTop = scroll
}

/** Load the app (header, folder tree and list which can also be built separately) */
function loadSniplets() {
  buildHeader()
  buildTree()
  buildList()
}

/** auto-adjust the heights of input text areas
 * @implNote Setting height to auto and measuring scrollHeight causes issues when collapsing
 * the TextArea causes the list scroll bar to be hidden, and thus the width to expand allowing
 * for more text on one line. Instead, the current number of lines is measured and the height
 * set directly without the style height auto step. Only if the field shrinks will it be
 * possible for a line to disappear on losing a scroll bar. This is both rare and preferable.
 * @param {HTMLTextAreaElement} target The TextArea to adjust
 * @param {number} maxLines The maximum number of lines to show when adjusting (0 = infinite)
 */
function adjustTextArea(target, maxLines = settings.view.maxEditorLines) {
  if (target.nodeName !== 'TEXTAREA') return

  // focus set on focusin and removed on focusout before running this function
  const { focused } = target.dataset

  // get number of lines from wrapped text using FormData
  const formData = new FormData(target.closest('form'))
  const lineCount = formData.get('content').split('\n').length

  // set line count to actual or appropriate max
  const lineLimit = !focused && settings.view.adjustTextArea ? maxLines || lineCount : lineCount
  const targetLines = lineCount < maxLines ? lineCount : lineLimit

  // get lineHeight & padding for computation
  const lineHeight = target.computedStyleMap().get('line-height')?.value
  const padding = target.computedStyleMap().get('padding')?.value

  // don't shrink if focused (user may have resized manually for more room)
  if (focused && target.clientHeight >= (targetLines * lineHeight) + (2 * padding)) return

  // set hight based on lines
  target.style.height = `${targetLines * lineHeight}px`
}

/**
 * MouseDown handler
 * @param {MouseEvent} event
 */
function handleMouseDown(event) {
  // prevent focus pull on buttons but handle & indicate action
  const target = event.target.closest('[data-action]')
  if (target?.type === 'button' && target.dataset?.action !== 'open-folder') {
    event.stopPropagation()
    event.preventDefault()
    target.style.boxShadow = 'none'
    window.clicked = target // for releasing click
  }
}

function handleMouseUp() {
  if (window.clicked) {
    window.clicked.style.removeProperty('box-shadow')
    delete window.clicked
  }
}

/** Click handler
 * @param {MouseEvent} event
 */
function handleClick(event) {
  // console.log('Handling click...', event, event.target)

  /** @type {HTMLButtonElement|HTMLInputElement} */
  const button = event.target.closest('[type="button"]')

  // ignore hidden input clicks as handled by labels and changes
  if (!button && event.target.nodeName === 'INPUT') return

  // Don't close menu if an input control label in it was clicked
  /** @type {HTMLInputElement} */
  const input = event.target.closest('label')?.control

  // close menus & modals as needed
  for (const popover of document.querySelectorAll('.popover')) {
    if (
      !(button || input)
      || !(
        popover.contains(input)
        || button?.dataset.target === popover.id
        || (popover.contains(button) && button.dataset.action === 'open-submenu')
      )
    ) {
      // hide if no button/input, or a different menu was clicked
      popover.classList.add('hidden')
    }
  }

  // Only handle buttons as other inputs will be handled with change event
  if (button) handleAction(button)
}

/**
 * Keydown handler
 * @param {KeyboardEvent} event
 */
function handleKeydown(event) {
  // console.log(event);
  if (event.target.nodeName === 'LABEL' && event.key === ' ') {
    // prevent scroll behaviour when a label is 'clicked' with a spacebar
    event.preventDefault()
  } else if (event.target.name === 'name' && event.key === 'Enter') {
    event.target.blur()
  }
}

/**
 * Keyup handler
 * @param {KeyboardEvent} event
 */
function handleKeyup(event) {
  // console.log(event);
  if (event.target.nodeName === 'LABEL' && event.key === ' ') {
    // accept spacebar input on label as if it was clicked
    event.target.click()
  }
}

function handleFocusIn(event) {
  // console.log(event)
  /** @type {{target:Element}} */
  const { target } = event

  const expandTextArea = () => {
    target.dataset.focused = 'true'
    adjustTextArea(target, 0)
  }

  const labelMap = new Map([
    [i18n('label_sniplet_content'), expandTextArea],
  ])
  const labelFunc = labelMap.get(target.ariaLabel)
  if (typeof labelFunc === 'function') labelFunc(target)
}

function handleInput(event) {
  // console.log(event)
  /** @type {{target:Element}} */
  const { target } = event

  const expandTextArea = () => {
    adjustTextArea(target, 0)
  }

  const labelMap = new Map([
    [i18n('label_sniplet_content'), expandTextArea],
  ])
  const labelFunc = labelMap.get(target.ariaLabel)
  if (typeof labelFunc === 'function') labelFunc(target)
}

/**
 * Input change handler
 * @param {Event} event
 */
function handleChange(event) {
  // console.log(event)
  // helpers
  /** @type {{target:Element}} */
  const { target } = event
  const { dataset } = target
  dataset.action ||= target.name

  // Handle attached action
  handleAction(target)

  // update menu if needed
  if (dataset.field === 'color') {
    // update svg color
    const color = dataset.value || target.value
    /** @type {SVGElement} */
    const svgTag = target.closest('.menu')?.querySelector('svg')
    if (svgTag) {
      svgTag.setAttribute('class', color)
    }

    // update moreColors target color (with safety check)
    target.closest('.menu-list')?.querySelector('[name="toggle-more-colors"]')
      ?.setAttribute('data-color', color)
    // update color of underline & expander for widgets
    target.closest('.sniplet')?.querySelector('hr')
      ?.setAttribute('class', color)
    target.closest('.sniplet')?.querySelector('.content-collapser span')
      ?.setAttribute('class', color)
  }
}

function handleFocusOut(event) {
  /** @type {{target:HTMLElement}} */
  const { target } = event

  // return folder open button after rename
  const setFolderButton = () => {
    target.type = 'button'
    target.dataset.action = 'open-folder'
  }

  // adjust sniplet textAreas
  const shrinkTextArea = () => {
    delete target.dataset.focused
    adjustTextArea(target)
  }

  const labelMap = new Map([
    [i18n('label_folder_name'), setFolderButton],
    [i18n('label_sniplet_content'), shrinkTextArea],
  ])
  const labelFunc = labelMap.get(target.ariaLabel)
  if (typeof labelFunc === 'function') labelFunc(target)
}

/**
 * drag and drop reordering of sniplets so they can be put in folders
 * @param {DragEvent} event
 */
function handleDragDrop(event) {
  // ignore text drags
  if (
    ['input', 'textarea'].includes(event.target.nodeName?.toLowerCase())
    && event.target.dataset?.action !== 'open-folder'
  ) {
    event.stopPropagation()
    event.preventDefault()
    return
  }

  // only allow moves
  event.dataTransfer.effectAllowed = 'move'

  // picked up item
  const item = event.target.closest('li')
  const list = item.parentElement
  event.dataTransfer.setData('text/html', item.toString())
  let dropTarget = item
  const dropClasses = [`folder-highlight`, `move-above`, `move-below`]

  // wait for browser to pick up the item with a nice outline before hiding anything
  setTimeout(() => {
    // turn picked up item into a placeholder
    for (const child of item.children) {
      child.style.display = `none`
    }
    item.classList.add(`placeholder`)

    // remove textarea elements and hrs to facilitate reordering sniplets
    for (const element of list.getElementsByClassName('snip-content'))
      element.style.display = `none`
    for (const element of list.getElementsByTagName('HR'))
      element.style.display = `none`

    // enable drop targets around folders
    for (const element of list.getElementsByClassName('delimiter'))
      element.style.display = `block`
  }, 0)

  const dragEnter = function (event) {
    // make sure there's another list item to drop on
    let { target } = event
    while (target && target.nodeName !== 'LI')
      target = target.parentElement
    if (target)
      event.preventDefault()
  }

  const dragOver = function (event) {
    // make sure there's another list item to drop on
    let { target } = event
    while (target && target.nodeName !== 'LI')
      target = target.parentElement
    if (target) {
      // check if we're in a new place
      if (target !== dropTarget) {
        // clear previous styling
        if (dropTarget)
          dropTarget.classList.remove(...dropClasses)
        dropTarget = target
        // highlight folders and mark drop positions
        if (target.classList.contains(`folder`)) {
          target.classList.add('folder-highlight')
        } else if (target.parentElement === list) {
          if ([...list.children].indexOf(target) > [...list.children].indexOf(item)) {
            target.classList.add('move-below')
          } else if ([...list.children].indexOf(target) < [...list.children].indexOf(item)) {
            target.classList.add('move-above')
          } else {
            target.classList.add('folder-highlight')
          }
        }
      }
      // console.log(event);
      event.preventDefault()
    } else if (dropTarget) {
      dropTarget.classList.remove(...dropClasses)
      dropTarget = null
      // console.log(event);
      event.preventDefault()
    }
  }

  const drop = async function (event) {
    // place the contents in a folder or swap positions
    const target = event.target.closest('li')
    if (target) {
      // make sure we went somewhere
      if (JSON.stringify(target.dataset) === JSON.stringify(item.dataset)) return dragEnd()

      // data for moving item
      const moveFrom = {
        path: item.dataset.path ? parseStringPath(item.dataset.path) : [],
        seq: item.dataset.seq && +item.dataset.seq,
      }
      const moveTo = {
        path: target.dataset.path ? parseStringPath(target.dataset.path) : [],
        seq: target.dataset.seq && +target.dataset.seq,
      }
      if (target.classList.contains('folder')) {
        // no need to push seq for root
        if (target.dataset.path === 'root') {
          moveTo.path = []
        } else {
          moveTo.path.push(moveTo.seq)
          moveTo.seq = undefined
        }
        // make sure we're not trying to put a folder inside its child
        if (
          moveTo.path.length > moveFrom.path.length
          && moveTo.path.slice(0, moveFrom.path.length + 1).join() === moveFrom.path.concat([moveFrom.seq]).join()
        ) {
          showAlert(i18n('error_folder_to_child'))
          return dragEnd()
        }
      } else {
        // adjust re-sort based on position
        if ((moveTo.seq % 1) !== 0)
          moveTo.seq = Math.trunc(moveTo.seq) + ((moveTo.seq > moveFrom.seq) ? 0 : 1)
        // make sure we're not sorting to self in a folder list
        if (moveFrom.seq === moveTo.seq)
          return dragEnd()
      }
      const movedItem = space.moveItem(moveFrom, moveTo)
      space.sort(settings.sort)
      await saveSpace()
      // console.log(event);
      event.preventDefault()
      dragEnd()
      buildList()
      if (movedItem instanceof Folder) buildTree()
    }
  }

  function dragEnd() {
    // clean up styling
    if (dropTarget) dropTarget.classList.remove(...dropClasses)

    // reenable textarea elements and hrs
    if (list) {
      for (const element of list.getElementsByClassName('snip-content'))
        element.removeAttribute('style')
      for (const element of list.getElementsByTagName('HR'))
        element.removeAttribute('style')
    }

    // disable drop targets around folders
    for (const element of list.getElementsByClassName('delimiter'))
      element.removeAttribute('style')

    // put item text back if it still exists
    if (item) {
      for (const child of item.children) {
        child.style.removeProperty('display')
      }
      item.classList.remove('placeholder')
    }

    // clean up listeners
    document.removeEventListener('dragenter', dragEnter)
    document.removeEventListener('dragover', dragOver)
    document.removeEventListener('drop', drop)
    document.removeEventListener('dragend', dragEnd)
  }

  document.addEventListener('dragenter', dragEnter, false)
  document.addEventListener('dragover', dragOver, false)
  document.addEventListener('drop', drop, false)
  document.addEventListener('dragend', dragEnd, false)
}

/** Action handler for various inputs
 * @param {HTMLElement} target
 */
async function handleAction(target) {
  // console.log('Handling action...', target, target.dataset, target.action)
  const dataset = target.dataset || target
  dataset.action ||= target.name

  // handle change events first if needed (buttons do not pull focus)
  const ae = document.activeElement
  if (target.nodeName === `BUTTON` && [`INPUT`, `TEXTAREA`].includes(ae?.nodeName)) {
    if (target.dataset.seq === ae.dataset.seq) {
      await handleAction(ae)
    } else {
      ae.blur()
    }
  }

  // expand/collapse content editors
  const toggleContent = () => {
    // get elements
    const contentDiv = target.closest('form').querySelector('.snip-content')
    const span = target.firstChild

    if (contentDiv.classList.contains('collapsed')) {
      // remove class that hides content
      contentDiv.classList.remove('collapsed')
      // allow for collapse button
      contentDiv.style.paddingBottom = '10px'
      // flip arrow
      span.textContent = '╱╲'
      // readjust textArea just in case
      const textArea = target.closest('form').querySelector('textarea')
      adjustTextArea(textArea)
    } else {
      // flip arrow
      span.textContent = '╲╱'
      // add class that hides content
      contentDiv.classList.add('collapsed')
      // remove extra space for collapse button
      contentDiv.style.paddingBottom = '0'
    }
  }

  const getBackupFileData = async () => {
    // TODO: accept other Clippings export filetypes (html, csv... rdf?)
    // get file handle for JSON backup
    /** @type {FileSystemFileHandle[]} */
    const [fileHandle] = await window.showOpenFilePicker({ types: [{
      description: i18n('file_save_type'),
      accept: { 'application/json': '.json' },
    }] }).catch(e => [e]) || []
    // console.log(fileHandle)
    if (!fileHandle || fileHandle instanceof Error) return

    // Read the file
    const file = await fileHandle.getFile().catch(e => e)
    if (!file || file instanceof Error) return
    const fileData = await file.text().catch(e => e)
    if (!fileData || fileData instanceof Error) return

    // Try to parse and return the backup data
    return JSON.parse(fileData)
  }

  const importData = async () => {
    const fileData = await getBackupFileData().catch(e => e)
    if (!fileData || fileData instanceof Error) {
      toast(i18n('toast_import_cancelled'), 'warning')
      return
    }

    const importFileData = async (data) => {
      const bucket = new DataBucket(data)

      // parse for import
      if (!(await bucket.parse())) {
        toast(i18n('toast_import_failed'))
        return
      }

      // add items to current space
      for (const item of bucket.children) {
        space.addItem(item, [])
      }
    }

    // import based on where the data is
    if (fileData.userClippingsRoot) {
      // Clippings data
      await importFileData({ children: fileData.userClippingsRoot })
    } else if (fileData.data) {
      // Simple data backup
      await importFileData(fileData.data)
    } else if (fileData.space) {
      // Full data backup (not currently used)
      await importFileData(fileData.space.data)
    } else if (fileData.spaces) {
      // Complete backup, multiple spaces possible
      for (const { data } of fileData.spaces) {
        await importFileData(data)
      }
    }

    saveSpace()
    loadSniplets()
  }

  const restoreData = async () => {
    if (space.data.children?.length && !(await confirmAction(
      i18n('warning_restore_bak'),
      i18n('action_restore'),
    ))) return

    // request a backup file
    const fileData = await getBackupFileData().catch(e => e)
    // console.log('got backup file', fileData)
    if (!fileData || fileData instanceof Error) {
      toast(i18n('toast_restore_cancelled'), 'warning')
      return
    }

    // check for settings
    if (fileData.settings) {
      settings.init({
        ...settings.entries,
        ...fileData.settings,
      })
      settings.save()
      toast(i18n('toast_settings_restored'))
    }

    const restoreFileData = async (backupSpace) => {
      // TODO: restore other spaces once switcher implemented
      // const isCurrent = (backupSpace.name === space.name)
      // const restoreSpace = isCurrent ? space : new Space()

      // attempt to reinitialize the space with the backup data
      // if (!(await space.init(backupSpace))) {
      //   toast(i18n('toast_restore_failed'), 'error')

      //   // rollback just in case
      //   loadCurrentSpace()
      //   return
      // }

      const backupData = new DataBucket(backupSpace.data)
      if (!(await backupData.parse())) return
      space.data = backupData

      // resort based on current settings
      space.sort(settings.sort)

      // make sure synced spaces are syncable and fall back otherwise to avoid failing
      if (space.synced && !(await space.isSyncable(settings.data.compress))) {
        space.synced = false
      }

      if (!(await saveSpace())) return

      // update current space in case synced was flipped
      await setCurrentSpace()

      // check for existing data to remove
      const altSpaceStorage = new StorageKey(space.name, !space.synced)
      altSpaceStorage.clear()
    }

    // restore based on where the data is
    if (fileData.userClippingsRoot) {
      // Clippings data
      await restoreFileData({
        name: space.name,
        synced: space.synced,
        data: { children: fileData.userClippingsRoot },
      })
    } else if (fileData.data) {
      // Simple data backup
      await restoreFileData({
        name: space.name,
        synced: space.synced,
        data: fileData.data,
      })
    } else if (fileData.space) {
      // Full data backup (not currently used)
      await restoreFileData(fileData.space)
    } else if (fileData.spaces) {
      // Complete backup, multiple spaces possible (current backups will only have one)
      for (const subspace of fileData.spaces) {
        await restoreFileData(subspace)
        // TODO: update currentSpace once switcher implemented
        // if (subspace.name === fileData.currentSpace.name) {
        //   KeyStore.currentSpace.set({
        //     name: subspace.name,
        //     synced: subspace.synced,
        //     path: subspace.path || [],
        //   })
        // }
      }
    }

    // reload sniplets
    loadSniplets()
  }

  // regular synchronous actions that don't require await
  const actionMap = new Map([
    ['toggle-content', toggleContent],
  ])

  const actionFunc = actionMap.get(dataset.action)
  if (typeof actionFunc === 'function') {
    actionFunc()
    return
  }

  // async actions
  const asyncActionMap = new Map([
    ['import-data', importData],
    ['restore', restoreData],
  ])

  const asyncActionFunc = asyncActionMap.get(dataset.action)
  if (typeof asyncActionFunc === 'function') {
    await asyncActionFunc()
    return
  }
  switch (dataset.action) {
    // window open action
    case 'focus':
      dataset.field ||= 'content'
      target = q$(`#sniplets [data-field="${dataset.field}"][data-seq="${dataset.seq}"]`)
      // console.log("Focusing field", target, `#sniplets [data-field="${dataset.field || `content`}"][data-seq="${dataset.seq}"]`);
      if (!target) break
      // check for folder renaming
      if (target.type === 'button' && dataset.field === 'name') {
        target.parentElement.querySelector('[action="rename"]').click()
      } else {
        target.focus()
        // if editing content, set cursor at the end, otherwise select all
        if (dataset.field === 'content' && window.getSelection()) {
          target.selectionStart = target.selectionEnd = target.value.length
        } else {
          target.select()
        }
      }
      // scroll entire card into view (timeout handles transition)
      setTimeout(() => (target.closest('li')?.scrollIntoView({ behavior: 'smooth' })), 150)
      break

    // open menus
    case 'open-popover':
    case 'open-submenu': {
      const t = $(dataset.target)
      // clean up submenus
      const topMenu = target.closest('.popover') || t
      for (const submenu of topMenu.querySelectorAll('.menu-list')) {
        if (!(submenu.contains(t) || submenu === t)) {
          // console.log('Hiding submenu...', submenu, submenu === t)
          submenu.classList.add('hidden')
        }
      }
      // open menu or submenu
      if (t.classList.contains('hidden')) {
        t.classList.remove('hidden')
      } else {
        t.classList.add('hidden')
      }
      break }

    // backup/restore/clear data
    case 'initialize':
      if (!(await confirmAction(i18n('warning_clear_data'), i18n('action_clear_all_data')))) break
      // deployed crx may cause service worker to run in parallel, delay doesn't help so recovery logic can't be done in backend
      await chrome.storage.session.clear()
      await chrome.storage.local.clear()
      await chrome.storage.sync.clear()
      // reinitialize
      settings.init()
      await settings.save()
      await space.init(settings.defaultSpace)
      await saveSpace()
      await setCurrentSpace()
      loadPopup()
      break

    case 'backup': {
      const appName = i18n('app_name')
      const now = new Date()
      let backup = {}
      let filename = `backup-${now.toISOString().slice(0, 16)}.json`
      switch (target.value) {
        case 'clippings':
          filename = `clippings-${filename}`
          backup = space.data.toClippings()
          break

        case 'data':
          filename = `${space.name}-${filename}`
          backup.version = '1.0'
          backup.createdBy = appName
          backup.data = structuredClone(space.data)
          break

        case 'full':
          filename = `${appName}-${filename}`
          backup.version = '1.0'
          backup.createdBy = appName
          backup.spaces = [structuredClone(space)]
          delete backup.spaces.at(0).path
          backup.currentSpace = {
            name: space.name,
            synced: space.synced,
            ...(settings.view.rememberPath ? { path: this.path } : {}),
          }
          backup.settings = settings
          break

        case 'space':
        default:
          // not currently used
          filename = `${appName}-${space.name}-${filename}`
          backup.version = '1.0'
          backup.createdBy = appName
          backup.space = structuredClone(space)
          delete backup.space.path
          backup.currentSpace = {
            name: space.name,
            synced: space.synced,
            ...(settings.view.rememberPath ? { path: this.path } : {}),
          }
          break
      }
      try {
        const f = await window.showSaveFilePicker({
          suggestedName: filename,
          types: [{
            description: i18n('file_save_type'),
            accept: { 'application/json': ['.json'] },
          }],
        })
        const ws = await f.createWritable()
        await ws.write(JSON.stringify(backup, null, 2)) // pretty print
        await ws.close()
      } catch { /* assume cancelled */ }
      break }

    // copy processed sniplet
    case 'copy':
      copySniplet({ ...dataset })
      break

    // paste processed sniplet
    case 'paste':
      pasteSniplet({ ...dataset })
      break

    // settings
    case 'set-icon-action':
      if (!['popup', 'panel', 'panel-toggle', 'window'].includes(target.value)) break
      settings.view.action = target.value
      await settings.save()
      break

    case 'toggle-remember-path':
      settings.view.rememberPath = !settings.view.rememberPath
      settings.save()
      setCurrentSpace()
      break

    case 'toggle-folders-first':
    // swap folders first or not
      settings.sort.foldersOnTop = !settings.sort.foldersOnTop
      settings.save()
      if (settings.sort.foldersOnTop)
        space.sort(settings.sort)
      saveSpace()
      buildList()
      break

    case 'toggle-collapse-editors':
      settings.view.collapseEditors = !settings.view.collapseEditors
      settings.save()
      buildList()
      break

    case 'toggle-adjust-editors':
      settings.view.adjustTextArea = !settings.view.adjustTextArea
      settings.save()
      adjustEditors()
      break

    case 'toggle-show-source':
      settings.view.sourceURL = !settings.view.sourceURL
      settings.save()
      buildList()
      break

    case 'toggle-more-colors': {
      settings.data.moreColors = !settings.data.moreColors
      settings.save()
      // Update color menu
      const colorMenu = target.closest('fieldset')
      const newColorMenu = buildColorMenu({ seq: +dataset.seq, color: dataset.color }, settings.data.moreColors)
      colorMenu.replaceWith(newColorMenu)
      // keep the menu open (mimics keyboard navigation)
      newColorMenu.querySelector('.menu-list')?.classList.remove('hidden')
      break }

    case 'toggle-data-compression':
      settings.data.compress = !settings.data.compress
      settings.save()
      saveSpace()
      break

    case 'toggle-sync': {
      // check for sync size constraints
      if (!space.synced && !(await space.isSyncable(settings.data))) {
        alert(i18n('error_sync_full'))
        return false
      }

      // check if data already exists
      const targetData = await getStorageData(space.name, getStorageArea(!space.synced))
      console.log(targetData, space.name, !space.synced, structuredClone(space))
      console.log(await chrome.storage.sync.get(null))
      if (targetData) {
        console.log('confirming')
        // confirm what to do with existing data
        const response = await confirmSelection(i18n('warning_sync_overwrite'), [
          { title: i18n('action_keep_local'), value: 'local' },
          { title: i18n('action_keep_sync'), value: 'sync' },
        ], i18n('action_start_sync'))
        console.log(response)
        if (response === 'sync') {
          // replace live with sync data before moving, set to false since it'll be reset after
          try {
            await space.init({ name: space.name, synced: false, data: targetData })
          } catch {
            alert(i18n('error_shift_failed'))
            return
          }
        } else if (response === 'local') {
          // do nothing (ignore the synced data)
        } else {
          // action cancelled
          return
        }
      }

      // attempt to move the space
      space.synced = !space.synced
      if (await saveSpace()) {
        setCurrentSpace()
        removeStorageData(space.name, getStorageArea(!space.synced))
        loadSniplets()
      } else {
        // revert change
        space.synced = !space.synced
        alert(i18n('error_shift_failed'))
        return
      }
      break }

    case 'clear-src-urls':
      if (await confirmAction(i18n('warning_clear_src'), i18n('action_clear_srcs'))) {
        space.data.removeSources()
        saveSpace()
        if (settings.view.sourceURL) buildList()
      }
      break

    case 'toggle-save-source':
      settings.snipping.saveSource = !settings.snipping.saveSource
      settings.save()
      if (
        (!settings.snipping.saveSource)
        && (await confirmAction(i18n('option_clear_srcs'), i18n('action_clear_srcs'), i18n('action_leave_srcs')))
      ) {
        space.data.removeSources()
        saveSpace()
        if (settings.view.sourceURL) buildList()
      }
      break

    case 'toggle-save-tags':
      settings.snipping.preserveTags = !settings.snipping.preserveTags
      settings.save()
      break

    case 'toggle-rt-line-breaks':
      settings.pasting.rtLineBreaks = !settings.pasting.rtLineBreaks
      settings.save()
      break

    case 'toggle-rt-link-urls':
      settings.pasting.rtLinkURLs = !settings.pasting.rtLinkURLs
      settings.save()
      break

    case 'toggle-rt-link-emails':
      settings.pasting.rtLinkEmails = !settings.pasting.rtLinkEmails
      settings.save()
      break

      // counters
    case 'set-counter-init': {
      let startVal = +target.value
      if (target.id === `counter-init-x`) {
      // custom starting value, show modal
        const val = await showModal({
          title: i18n('title_counter_init'),
          fields: [{
            type: `number`,
            name: `start-val`,
            label: i18n('label_counter_init_val'),
            value: startVal,
          }],
          buttons: [{
            title: i18n('submit'),
            value: startVal,
            id: `submitCounterDefaults`,
          }],
        }, ({ target }) => {
          const submitButton = target.closest('dialog').querySelector('#submitCounterDefaults')
          submitButton.value = target.value
        })
        if (!val) break // modal cancelled
        if (!isNaN(val) && (parseInt(val) === Math.abs(+val))) startVal = +val
      }
      space.data.counters.startVal = startVal
      saveSpace()
      $('settings').replaceChildren(...buildMenu())
      break }

    case 'manage-counters': {
      // eslint-disable-next-line no-unused-vars
      const { startVal, ...counters } = space.data.counters
      const values = await showModal({
        title: i18n('title_counter_manage'),
        fields: Object.entries(counters).sort((a, b) => a - b).map(([key, value], i) => ({
          type: `number`,
          name: i,
          label: key,
          value: value,
        })),
        buttons: [{
          title: i18n('submit'),
          value: `{}`,
          id: `submitCounters`,
        }],
      }, ({ target }) => {
        const button = target.closest('dialog').querySelector('#submitCounters')
        const changes = JSON.parse(button.value)
        const val = +target.value
        if (!isNaN(val) && (parseInt(val) === Math.abs(val))) changes[target.title] = val
        button.value = JSON.stringify(changes)
      })
      if (!values) break // modal cancelled
      const changes = JSON.parse(values)
      for (const key in changes) space.data.counters[key] = changes[key]
      saveSpace()
      toast(i18n('toast_updated_counters'))
      break }

    case 'clear-counters': {
      const { startVal } = space.data.counters
      space.data.counters = { startVal: startVal }
      saveSpace()
      $('settings').replaceChildren(...buildMenu())
      break }

    // add/edit/delete items
    case 'new-sniplet': {
      const { seq } = space.addItem(new Sniplet())
      space.sort(settings.sort)
      saveSpace()
      loadAndFocus(seq)
      break }

    case 'new-folder': {
      const newFolder = space.addItem(new Folder())
      space.sort(settings.sort)
      saveSpace()
      buildList()
      buildTree()
      setHeaderPath()
      handleAction({ action: 'rename', seq: newFolder.seq, field: 'name' })
      break }

    case 'delete':
      if (await confirmAction(i18n('warning_delete_sniplet'), i18n('action_delete'))) {
        const deletedItem = space.deleteItem(+dataset.seq)
        space.sort(settings.sort)
        saveSpace()

        // remove item element from list to avoid rebuilding
        const listItem = target.closest('li')
        if (deletedItem instanceof Folder) {
          const list = listItem.closest('ul.folder-list')

          if (list && list.querySelectorAll('li.folder').length < 2) {
            // last folder, remove separated grouped folder list if in one
            const fotCard = list.closest('.card')
            fotCard.nextElementSibling.remove()
            fotCard.remove()
          } else if (list) {
            // update delimiters if bottom item in grouped folder list
            const itemDropPre = listItem.previousElementSibling
            const itemDropPost = listItem.nextElementSibling
            if (itemDropPost.classList.value === 'delimiter') {
              itemDropPre.classList.value = 'delimiter'
            }
          }

          // rebuild the tree
          buildTree()
        }

        // remove the item and following delimiter/drop zone
        listItem.nextElementSibling.remove()
        listItem.remove()
      }
      break

    case 'rename': {
      // change input type to text if needed and enable+focus
      const input = q$(`input[data-seq="${dataset.seq}"][data-field="name"]`)
      input.type = `text`
      input.dataset.action = `edit`
      input.focus()
      input.select()
      break }

    case 'edit': {
      const field = dataset.field || target.name
      const value = dataset.value || target.value
      // console.log('Editing field...', field, value, dataset, target, typeof target.value)
      const item = space.editItem(
        +dataset.seq,
        field,
        value,
      )
      // update tree if changes were made to a folder
      if (item instanceof Folder) buildTree()
      // make sure the space is saved before exiting
      await saveSpace()
      break }

    case 'move':
      if (target.value) {
        const movedItem = space.moveItem(
          { seq: +dataset.seq },
          { seq: +target.value },
        )
        saveSpace()
        buildList()
        if (movedItem instanceof Folder) buildTree()
      }
      break

      // interface controls
    case 'open-window': {
      openWindow(new URL(location.href))
      window.close()
      break }

    case 'open-folder': {
      // update url for ease of navigating
      const url = new URL(location.href)

      // clear any action info
      url.searchParams.delete('action')
      url.searchParams.delete('field')
      url.searchParams.delete('seq')
      url.searchParams.delete('reason')

      // Update url path
      if (dataset.target) url.searchParams.set('path', dataset.target)
      else url.searchParams.delete('path')

      // push updated url to history
      if (!(url.href === location.href)) history.pushState(null, '', url.href)

      // update the path
      space.path = parseStringPath(dataset.target)
      if (settings.view.rememberPath) setCurrentSpace()

      // console.log(`setting path`);
      setHeaderPath()
      // console.log(`building list`);
      buildList()
      // console.log(`Done!`);
      break }

    case 'collapse':
      target.closest('li').querySelector('ul').classList.add('hidden')
      setSvgSprite(target, 'icon-folder-expand')
      dataset.action = 'expand'
      break

    case 'expand':
      target.closest('li').querySelector('ul').classList.remove('hidden')
      setSvgSprite(target, 'icon-folder-collapse')
      dataset.action = 'collapse'
      break

    case 'about':
      showAbout()
      break

    default:
      break
  }
}
