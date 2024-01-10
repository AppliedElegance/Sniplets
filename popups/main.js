// selector shorthands
/**
 * Shorthand for document.getElementById(id)
 * @param {string} id 
 * @returns {HTMLElement}
 */
const $ = (id) => document.getElementById(id);
/**
 * Shorthand for document.querySelector(id)
 * @param {string} query 
 * @returns {HTMLElement}
 */
const q$ = (query) => document.querySelector(query);
// const i18n = (id, substitutions = []) => chrome.i18n.getMessage(id, substitutions);

// for handling resize of header path
const resizing = new ResizeObserver(adjustPath);

// globals for settings and keeping track of the current folder
const settings = new Settings();
const space = new Space();

// Update currently viewed space
function setCurrentSpace() {
  const currentSpace = {
    name: space.name,
    synced: space.synced,
  };
  // save path as well if requested
  if (settings.view.rememberPath) currentSpace.path = space.path;
  setStorageData({ currentSpace: currentSpace }, false);
  return currentSpace;
}

/**
 * handler for blocked paste
 * @param {string} reason 
 * @param {Snippet} snip 
 */
function pasteBlocked(snip) {
  loadSnippets();
  alert(`Sorry, either the page is no longer available or this extension `
      + `is blocked on this site by your browser. Please check and try again `
      + `or copy the selected snippet using the clipboard feature and paste `
      + `it in manually.`);
  handleAction({ action: 'focus', seq: snip.seq, field: 'copy' });
}

function requestSitePermissions({ action, target, data, snip, origins }) {
  // console.log(action, target, data, snip, origins);
  const modal = buildModal({
    message: `This field requires additional permissions for context menus and `
    + `shortcuts to work. To continue, please press the appropriate button and `
    + `accept the request.`,
    buttons: [
      {
        value: JSON.stringify(origins),
        children: [buildNode('h2', { children: [
          document.createTextNode(`Allow full access on `),
          buildNode('em', { textContent: `this` }),
          document.createTextNode(` site`),
        ] })],
      },
      {
        value: `["<all_urls>"]`,
        children: [buildNode('h2', { children: [
          document.createTextNode(`Allow full access on `),
          buildNode('em', { textContent: `all` }),
          document.createTextNode(` sites`),
        ] })],
      },
    ],
  });
  document.body.append(modal);
  // console.log(modal);
  modal.showModal();
  modal.addEventListener('close', async () => {
    // console.log(event, modal.returnValue, request, this);
    const granted = await chrome.permissions.request({
      origins: JSON.parse(modal.returnValue),
    }).catch(e => e);
    // console.log(granted);
    switch (action) {
      case 'snip':
        if (granted) {
          // Try again
          snip = await snipSelection(target);
          if (!snip) return alert("Sorry, something went wrong and the selection could not be snipped. Please make sure the page is still active and try again.");

          // Add snip to space
          if (settings.control.saveSource) snip.sourceURL = data.pageUrl;
          snip = space.addItem(snip);
          await space.save();

          // Load for editing
          loadSnippets();
          handleAction({ action: 'focus', seq: snip.seq, field: 'name' });
        } else {
          loadSnippets();
          alert("Permissions were not granted. Please copy and add the snippet manually.");
        }
        break;

      case 'paste':
        if (granted) {
          // try again
          if (snip.customFields) {
            // permissions always handled first, but don't forget about custom fields
            const finalSnip = await getCustomFields(snip);
            if (finalSnip?.content) snip = finalSnip;
          }
          snip.richText = getRichText(snip.content, settings.control);
          // console.log(snip);
          const result = await pasteSnippet(target, snip);
          if (!result?.pasted) pasteBlocked(snip);
        } else {
          // load for copying
          pasteBlocked(snip);
        }
        break;
    
      default:
        break;
    }
  });
}

/**
 * get custom fields when processing
 * @param {{content:string,customFields?:{[key:string]:*}[]}} snip 
 */
function getCustomFields(snip) {
  // console.log(snip);
  const { customFields } = snip;
  //build modal
  const modal = buildModal({
    title: `Custom Placeholders`,
    fields: customFields.map((field, i) => {
      return {
        type: field.type,
        name: `custom-field${i}`,
        label: field.name,
        value: field.value,
        options: field.options,
      };
    }),
    buttons: [
      {
        id: `confirmFields`,
        value: JSON.stringify(snip),
        children: [buildNode('h2', { textContent: `Confirm` })],
      },
    ],
  });
  document.body.append(modal);
  modal.addEventListener('change', (event) => {
    /** @type {HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement} */
    const input = event.target;
    /** @type {HTMLButtonElement} */
    const button = modal.querySelector('#confirmFields');
    // console.log(button);
    let snip = JSON.parse(button.value);
    console.log(input, button, snip, snip.customFields[parseInt(input.name)]);
    snip.customFields[parseInt(input.name)].value = input.value;
    button.value = JSON.stringify(snip);
  }, false);
  modal.showModal();
  return new Promise((resolve, reject) => modal.addEventListener('close', () => {
    if (modal.returnValue === 'Cancel') reject(null);
    const snip = JSON.parse(modal.returnValue);
    snip.content = replaceFields(snip.content, snip.customFields);
    delete snip.customFields;
    resolve(snip);
  }, false)).catch(e => e);
}

// init
async function loadPopup() {
  // load up settings with sanitation check for sideloaded versions
  if (!await settings.load()) {
    settings.init();
    settings.save();
  }
  // console.log("Settings loaded...", settings);

  // load up the current space or fall back to default
  // console.log("Retrieving current space...");
  const { currentSpace } = await getStorageData('currentSpace');
  // console.log("Loading current space...", currentSpace, settings.defaultSpace);
  if (!await space.load(currentSpace || settings.defaultSpace)) {
    await space.init();
    space.save();
  }
  // console.log("Updating current space if necessary...", structuredClone(space));
  if (!currentSpace) setCurrentSpace();

  // load parameters
  const params = new URLSearchParams(location.search);
  // console.log("Processing parameters...", params);

  // check if opened as popup and set style accordingly
  const popout = params.get('popout');
  // console.log(popout);
  if (popout) {
    window.popout = popout; // for building header
    document.body.style.width = "400px"; // column flex collapses width unless set
    document.body.style.height = "550px";
  }

  // update path if needed
  if (params.get('path')) {
    space.path = params.get('path')?.split('-').map(v => +v).filter(v => v);
    if (settings.view.rememberPath) setCurrentSpace();
  }

  document.documentElement.lang = navigator.language; // accesibility

  // set up listeners
  document.addEventListener('mousedown', handleMouseDown, false);
  document.addEventListener('dragstart', handleDragDrop, false);
  document.addEventListener('click', handleClick, false);
  document.addEventListener('mouseup', handleMouseUp, false);
  document.addEventListener('keydown', handleKeydown, false);
  document.addEventListener('keyup', handleKeyup, false);
  document.addEventListener('change', handleChange, false);
  document.addEventListener('focusout', handleFocusOut, false);
  // textarea adjustments
  document.addEventListener('focusin', adjustTextArea, false);
  document.addEventListener('input', adjustTextArea, false);
  document.addEventListener('focusout', adjustTextArea, false);
  // keep an eye on the path and hide path names as necessary
  resizing.observe($('header'));

  // check for requests and remove immediately to prevent handling more than once
  const { request } = await chrome.storage.session.get('request').catch(() => false);
  chrome.storage.session.remove('request').catch(e => (console.log(e), false));
  // console.log(request);
  if (request?.type === 'permissions') {
    requestSitePermissions(request);
  } else if (request?.type === 'placeholders') {
    // requested from context menu, make sure we have permissions first
    if (!(await testAccess(request.target))) {
      const results = await injectScript({
        target: { tabId: request.target.tabId },
        func: getFrameOrigins,
      });
      const origins = results[0]?.result;
      if (!origins) return pasteBlocked(request.snip);
      return requestSitePermissions({ origins: origins, ...request });
    }
    let snip = request.snip;
    if (snip.customFields) {
      const finalSnip = await getCustomFields(snip);
      if (finalSnip?.content) snip = finalSnip;
    }
    snip.richText = getRichText(snip.content, settings.control);
    // console.log(snip);
    const result = await pasteSnippet(request.target, snip);
    if (!result?.pasted) pasteBlocked(snip);
  } else {
    // console.log("Loading snippets", space);
    loadSnippets();
  
    // check and action URL parameters accordingly
    const urlParams = Object.fromEntries(params);
    if (urlParams.action?.length) handleAction(urlParams);
    if (urlParams.reason === 'blocked') {
      if (urlParams.field === 'copy') {
        alert(`Sorry, pasting directly into this page is blocked by your browser. `
        + `Please copy the selected snippet to the clipboard and paste it in manually.`);
      }
    }
  }
}
document.addEventListener('DOMContentLoaded', loadPopup, false);

/**
 * Helper for grouping tree items by type
 * @param {(Folder|Snippet)[]} list 
 * @param {string} type - accepts 'all' or the specific type of TreeItem
 * @returns {Object}
 * @example
 * // itemGroups will have separate properties .folder & . containing only
 * // subfolders of the space.children root folder
 * const itemGroups = groupItems(space.children, 'type');
 */
const groupItems = (list, by = settings.sort.groupBy) => list.reduce((groups, item) => {
  if (!by?.length) {
    (groups.all ||= []).push(item);
  }
  const group = by === 'type'
  ? item.constructor.name.toLowerCase()
  : item[by];
  (groups[group] ||= []).push(item);
  return groups;
}, {});

/**
 * Helper for only grabbing subfolders
 * @param {*[]} folder 
 * @returns {Folder[]}
 */
const getSubFolders = (folder) => groupItems(folder, 'type').folder;

function setHeaderPath() {
  // console.log(`Setting header path`);
  // get list of path names (should always include space name)
  const pathNames = space.getPathNames();
  const pathNode = $('path');
  // console.log(pathNames, pathNode.outerHTML);
  // add root
  pathNode.replaceChildren(
    buildNode('li', {
      id: `folder-up`,
      classList: [`folder`],
      style: { display: `none` }, // only display when out of room
      dataset: { path: `` },
      children: [buildActionIcon(`Back`, `icon-back`, `inherit`, {
        action: 'open-folder',
        target: ``,
      })],
    }),
    buildNode('li', {
      id: `folder-root`,
      classList: [`folder`],
      dataset: { path: `root` },
      children: [buildNode('button', {
        type: `button`,
        dataset: {
          action: `open-folder`,
          target: ``,
        },
        children: [buildNode('h1', {
          textContent: pathNames.shift(),
        })],
      })],
    }),
  );
  // console.log(`Adding additional path names`, pathNames);
  pathNames.forEach((name, i) => pathNode.append(buildNode('li', {
    classList: [`folder`],
    dataset: {
      seq: space.path.slice(i,i+1),
      path: space.path.slice(0,i).join('-'),
    },
    children: [
      buildNode('h1', { textContent: `/` }),
      buildNode('button', {
        type: `button`,
        dataset: {
          action: `open-folder`,
          target: space.path.slice(0,i+1).join('-'),
        },
        children: [buildNode('h1', {
          textContent: name,
        })],
      }),
    ],
  })));
  // console.log(`Done!`);
}

function buildMenu() {
  const { startVal, ...counters } = space.data.counters;
  const customStartVal = (startVal > 1 || startVal < 0);
  // console.log(startVal, counters);
  return [
    buildSubMenu(`View`, `settings-view`, [
      buildMenuControl('checkbox', `toggle-remember-path`,
      `Remember last open folder`, settings.view.rememberPath),
      buildMenuControl('checkbox', `toggle-folders-first`,
      `Group folders at top`, settings.sort.foldersOnTop),
    ]),
    buildSubMenu(`Source URLs`, `settings-snip`, [
      buildMenuControl('checkbox', `toggle-show-source`,
      `Show field in list`, settings.view.sourceURL),
      buildMenuControl('checkbox', `toggle-save-source`,
      `Save automatically`, settings.control.saveSource),
      buildMenuItem(`Clear saved data`, `clear-source-urls`),
    ]),
    buildSubMenu(`Counters`, `settings-counters`, [
      buildSubMenu(`Initial Value`, `counter-init`, [
        buildMenuControl('radio', `set-counter-init`,
        `0`, startVal === 0, { id: `counter-init-0` }),
        buildMenuControl('radio', 'set-counter-init',
        `1`, startVal === 1, { id: `counter-init-1` }),
        buildMenuControl('radio', 'set-counter-init',
        startVal, customStartVal, { id: `counter-init-x`,
          title: `Custom${customStartVal ? ` (${startVal})` : `` }…`,
        }),
      ]),
      Object.keys(counters).length && buildMenuItem(`Manage…`, `manage-counters`),
      Object.keys(counters).length && buildMenuItem(`Clear All…`, `clear-counters`),
    ]),
    buildSubMenu(`Rich Text`, `settings-rt`, [
      // buildMenuControl('checkbox', `toggle-preserve-tags`,
      // `Snip with formatting`, settings.control.preserveTags),
      // buildMenuSeparator(),
      buildMenuControl('checkbox', `toggle-rt-line-breaks`,
      `Auto-tag line breaks`, settings.control.rtLineBreaks),
      buildMenuControl('checkbox', `toggle-rt-link-urls`,
      `Auto-link URLs`, settings.control.rtLinkURLs),
      buildMenuControl('checkbox', `toggle-rt-link-emails`,
      `Auto-link emails`, settings.control.rtLinkEmails),
    ]),
    buildSubMenu('Backups', `settings-backup`, [
      buildMenuItem(`Data Backup`, `backup`, `data` ),
      buildMenuItem(`Full Backup`, `backup`, `full`),
      buildMenuItem(`Clippings Backup`, `backup`, `clippings61`),
      buildMenuSeparator(),
      buildMenuItem(`Restore`, `restore`),
      buildMenuItem(`Clear All Data`, `clear-data-all`),
    ]),
    buildMenuItem(`About…`, `about`),
  ];
}

function buildHeader() {
  // popover settings menu
  const settingsMenu = buildPopoverMenu(`settings`, `icon-settings`, `inherit`, buildMenu());

  // add path navigation element
  const path = buildNode('nav', {
    children: [buildNode('ul', { id: `path` })],
  });

  // quick actions
  const quickActionMenu = buildNode('div', {
    id: `quick-actions`,
    children: [
      buildActionIcon(
        space.synced ? `Stop Syncing.` : `Start Syncing`,
        `icon-${ space.synced ? `sync` : `local` }`,
        `inherit`, {
        action: `toggle-sync`,
      }),
      buildActionIcon(`New Folder`, `icon-add-folder`, `inherit`, {
        action: `new-folder`,
      }),
      buildActionIcon(`New Snippet`, `icon-add-snippet`, `inherit`, {
        action: `new-snippet`,
      }),
      window.popout && buildActionIcon(`Pop Out`, `icon-pop-out`, `inherit`, {
        action: `pop-out`,
      }),
    ],
  });

  // put header together
  $('header').replaceChildren(
    settingsMenu,
    path,
    quickActionMenu,
  );

  // set path
  setHeaderPath();
}

/**
 * Hide folder entries as needed
 * @param {ResizeObserverEntry[]} entries 
 */
function adjustPath() {
  // console.log(entries);
  const s = $('folder-up');
  if (!s) return; // path not generated yet
  const t = $('path');
  const sb = s.querySelector('button');
  // console.log(entries, t, s, sb, t.offsetHeight, t.childElementCount);
  if (t.offsetHeight > 32 & t.childElementCount > 2) {
    // hide parts of the folder path in case it's too long
    s.style.removeProperty('display');
    /** @type {HTMLElement} */
    let f = s.nextSibling;
    while (t.offsetHeight > 33) {
      if (!f.nextSibling) break; // always leave the last one
      f.style.display = `none`;
      s.dataset.path = f.dataset.path;
      s.dataset.seq = f.dataset.seq;
      // console.log(f, f.querySelector('button'), f.querySelector('button').target);
      sb.dataset.target = f.querySelector('button').dataset.target || ``;
      f = f.nextSibling;
    }
  } else {
    // show parts of the folder path as space becomes available
    /** @type {HTMLElement[]} */
    const ps = Array.from(t.getElementsByTagName('li')).filter(e => e.style.display === `none`).reverse();
    if (ps[0] === s) return;
    let i = 1;
    for (const p of ps) {
      p.style.removeProperty('display');
      const isRoot = (ps.length === i++ && p.textContent === space.name);
      if (isRoot) s.style.display = `none`;
      if (t.offsetHeight > 32) {
        p.style.display = `none`;
        if (isRoot) s.style.removeProperty('display');
        break;
      }
    }
  }
}

function buildTree() {
  /**
   * Build folder tree for pop-out window (recursive function)
   * @param {Folder[]} folders 
   * @param {int[]} level 
   */
  function buildFolderList(folders, level) {
    const isRoot = folders[0] instanceof DataBucket;
    const path = level.join('-');

    // list container with initial drop zone for reordering
    const folderList = buildNode('ul', {
      id: `folder-${ path }`,
      children: !isRoot && [buildNode('li', {
        dataset: { path: path, seq: `.5` },
        classList: [`delimiter`],
      })],
    });

    // add each folder with a following drop-zone for reordering
    for (let folder of folders) {
      // check for subfolders
      const subFolders = getSubFolders(folder.children);
      // create folder list item
      const folderItem = buildNode('li', {
        dataset: {
          path: path,
          seq: (isRoot) ? `` : String(folder.seq),
        },
      });
      // add folder details
      folderItem.append(buildTreeWidget(
        !!subFolders,
        colors[folder.color]?.value || `inherit`,
        (isRoot) ? `` : level.concat([folder.seq]).join('-'),
        (isRoot) ? space.name : folder.name,
      ));
      // add sublist if subfolders were found
      if (subFolders) folderItem.append(
        buildFolderList(subFolders, (isRoot) ? [] : level.concat([folder.seq])),
      );
      // Add list item to list
      folderList.append(folderItem);
      // Insert dropzone after for reordering
      if (!isRoot) {
        folderList.append(buildNode('li', {
          dataset: { path: path, seq: String(folder.seq + .5) },
          classList: [`delimiter`],
        }));
      }
    }
    return folderList;
  }
  // start building from the root
  $('tree').replaceChildren(buildFolderList([space.data], ['root']));
}

function buildList() {
  // shorthands
  const path = space.path;
  const fot = settings.sort.foldersOnTop;
  
  // clear current list and get info
  $('snippets').replaceChildren(buildNode('div', { classList: [`sizer`] }));
  const folder = space.getItem(path).children || [];
  const groupedItems = fot && groupItems(folder, 'type');

  if (fot && groupedItems.folder) { // group folders at top if set
    $('snippets').append(buildNode('div', {
      classList: [`card`],
      children: [buildNode('ul', {
        classList: [`folder-list`],
        children: [
          buildNode('li', { // leading dropzone
            classList: [`delimiter`],
            dataset: {
              seq: `.5`,
              path: path,
            },
          }),
        ].concat(groupedItems.folder.flatMap((folder, i, a) => [
            buildNode('li', { // folder item
              classList: [`folder`],
              dataset: {
                seq: folder.seq,
                path: path,
              },
              children: buildItemWidget(folder, groupedItems.folder, path, settings),
            }),
            buildNode('li', { // trailing dropzone
              classList: [(i < a.length - 1) ? `separator` : `delimiter`],
              dataset: {
                seq: String(folder.seq + .5),
                path: path,
              },
              children: (i < a.length - 1) && [buildNode('hr')],
            }),
        ])),
      })],
    }));
    $('snippets').append(buildNode('hr'));
  }

  // list snippets, including folders if not grouped at top
  const items = fot ? groupedItems.snippet : folder;
  if (items) {
    $('snippets').append(buildNode('ul', {
      id: `snippet-list`,
      children: [
        buildNode('li', {
          classList: [`delimiter`],
          dataset: {
            seq: .5,
            path: path,
          },
        }),
      ].concat(items.flatMap((item) => [
        buildNode('li', {
          classList: [item.constructor.name.toLowerCase()],
          dataset: {
            seq: item.seq,
            path: path,
          },
          children: [buildNode('div', {
            classList: [`card`, `drag`],
            draggable: `true`,
            children: buildItemWidget(item, items, path, settings),
          })],
        }),
        buildNode('li', {
          classList: [`delimiter`],
          dataset: {
            seq: item.seq + .5,
            path: path,
          },
        }),
      ])),
    }));

    // keep items to a reasonable height
    for (let textarea of $('snippets').getElementsByTagName('textarea'))
      adjustTextArea(textarea, 0);
  }
}

function loadSnippets() {
  buildHeader();
  buildTree();
  buildList();
}

/** auto-adjust the heights of input textareas
 * @param {Event|FocusEvent|HTMLTextAreaElement} target 
 * @param {number} [maxHeight] - pass 0 for default
 */
function adjustTextArea(target, maxHeight) {
  const padding = 2 * 5; // 5px top & bottom padding
  const minHeight = 4 * 19; // 19px line height
  const overflowHeight = 7 * 19 + 5; // Add bottom padding to max 7 lines
  // console.log(target, maxHeight, overflowHeight);

  /** @type {HTMLTextAreaElement} set target for events */
  const textarea = target.target || target;
  if (textarea.tagName !== 'TEXTAREA') return;
  const focusout = target.type === 'focusout';
  // console.log(maxHeight);
  if (maxHeight === 0 || (!maxHeight && focusout)) maxHeight = overflowHeight;

  // save current scroll position
  let scrollTop = $('snippets').scrollTop;

  // disable animation while inputting
  if (target.type === 'input') textarea.style.transition = `none`;

  // calculate current content height
  let scrollHeight = textarea.scrollHeight - padding;
  if (focusout || parseInt(textarea.style.height) === scrollHeight) {
    // check and update actual scroll height to allow shrinking
    textarea.style.height = `auto`;
    scrollHeight = textarea.scrollHeight - padding;
  }
  if (scrollHeight < minHeight) scrollHeight = minHeight;
  // console.log(textarea.style.height, scrollHeight);

  // set max height to actual in case no limit set
  maxHeight ||= scrollHeight;

  // console.log(maxHeight, textarea.clientHeight);
  // update if needed
  if (maxHeight !== textarea.clientHeight) {
    const targetHeight = scrollHeight > maxHeight ? maxHeight : scrollHeight;
    textarea.style.height = `${targetHeight}px`;
    if (focusout) {
      textarea.style.removeProperty('transition'); // reenable animations
      
      // preserve scroll position
      $('snippets').scrollTop = scrollTop + targetHeight - scrollHeight;
    }
  }
}

/**
 * MouseDown handler
 * @param {MouseEvent} event 
 */
function handleMouseDown(event) {
  // prevent focus pull on buttons but handle & indicate action
  const target = event.target.closest('[data-action]');
  if (target?.type === `button`) {
    event.stopPropagation();
    event.preventDefault();
    target.style.boxShadow = `none`;
    window.clicked = target; // for releasing click
  }
}

/**
 * MouseUp handler
 * @param {MouseEvent} event 
 */
function handleMouseUp() {
  if (window.clicked) {
    window.clicked.style.removeProperty('box-shadow');
    delete window.clicked;
  }
}

/**
 * Click handler
 * @param {MouseEvent} event 
 */
async function handleClick(event) {
  // console.log(event);
  // ignore labels (handled on inputs)
  if (event.target.tagName === 'LABEL') return;

  /** @type {HTMLElement} */
  const target = event.target.closest('[data-action]');

  // close menus & modals as needed
  for (let popover of document.querySelectorAll('.popover')) {
    if (!target
    || !popover.parentElement.contains(target)
    || ![`open-popover`, `open-submenu`].includes(target.dataset.action)) {
      popover.classList.add(`hidden`);
    }
  }

  // end here if the clicked node doesn't have an action or isn't a button
  // (will be handled with onchange instead)
  if (!target || target.type !== 'button') return;

  // handle the action
  handleAction(target);
}

/**
 * Keydown handler
 * @param {KeyboardEvent} event 
 */
function handleKeydown(event) {
  // console.log(event);
  if (event.target.tagName === 'LABEL' && event.key === ' ') {
    // prevent scroll behaviour when a label is 'clicked' with a spacebar
    event.preventDefault();
  } else if (event.target.name === 'name' && event.key === 'Enter') {
    event.target.blur();
  }
}

/**
 * Keyup handler
 * @param {KeyboardEvent} event 
 */
function handleKeyup(event) {
  // console.log(event);
  if (event.target.tagName === 'LABEL' && event.key === ' ') {
    // accept spacebar input on label as if it was clicked
    event.target.click();
  }
}

/**
 * Input change handler
 * @param {Event} event 
 */
function handleChange(event) {
  // console.log(event);
  // helpers
  const target = event.target;
  const dataset = target.dataset;

  // handle action
  handleAction(target);
  
  // update menu if needed
  // console.log("Checking type", dataset.type);
  if (target.type === 'checkbox') {
    // console.log("Toggling checkbox");
    toggleChecked(target.parentElement.querySelector('use'));
  } else if (target.type === 'radio') {
    // console.log("Toggling radio");
    const controls = target.closest('fieldset').querySelectorAll('.control');
    for (let control of controls) {
      toggleChecked(control.querySelector('use'), control.querySelector('input').checked);
    }
  }
  if (dataset.field === 'color') {
    setSvgFill(
      target.closest('.menu'),
      colors[dataset.value || target.value].value,
    );
  }
}

function handleFocusOut(event) {
  /** @type {Element} */
  const target = event.target;
  if (target.ariaLabel === 'Folder Name') {
    // set back as button
    target.type = `button`;
    target.dataset.action = `open-folder`;
  }
}

/**
 * drag and drop reordering of snippets so they can be put in folders
 * @param {DragEvent} event 
 */
function handleDragDrop(event) {
  // console.log(event);
  // ignore text drags
  if (['input', 'textarea'].includes(event.target.tagName.toLowerCase())) {
    event.stopPropagation();
    event.preventDefault();
    return;
  }
  // only allow moves
  event.dataTransfer.effectAllowed = "move";
  // picked up item
  var item = event.target;
  while (item && item.tagName !== 'LI') {
    item = item.parentElement;
  }
  var list = item.parentElement;
  event.dataTransfer.setData("text/html", item.toString());
  var dropTarget = item;
  const dropClasses = [`folder-highlight`, `move-above`, `move-below`];

  // wait for browser to pick up the item with a nice outline before hiding anything
  setTimeout(() => {
    // turned picked up item into a placeholder
    for (let child of item.children) {
      child.style.display = `none`;
    }
    item.classList.add(`placeholder`);

    // remove textarea elements and hrs to facilitate reordering snippets
    for (let element of list.getElementsByClassName('snip-content'))
      element.style.display = `none`;
    for (let element of list.getElementsByTagName('HR'))
      element.style.display = `none`;

    // enable drop targets around folders
    for (let element of list.getElementsByClassName('delimiter'))
      element.style.display = `block`;
  }, 0);

  let dragEnter = function (event) {
    // make sure there's another list item to drop on
    let target = event.target;
    while (target && target.tagName !== 'LI')
      target = target.parentElement;
    if (target)
      event.preventDefault();
  };

  let dragOver = function (event) {
    // make sure there's another list item to drop on
    let target = event.target;
    while (target && target.tagName !== 'LI')
      target = target.parentElement;
    if (target) {
      // check if we're in a new place
      if (target !== dropTarget) {
        // clear previous styling 
        if (dropTarget)
          dropTarget.classList.remove(...dropClasses);
        dropTarget = target;
        // highlight folders and mark drop positions
        if (target.classList.contains(`folder`)) {
          target.classList.add('folder-highlight');
        } else if (target.parentElement === list) {
          if ([...list.children].indexOf(target) > [...list.children].indexOf(item)) {
            target.classList.add('move-below');
          } else if ([...list.children].indexOf(target) < [...list.children].indexOf(item)) {
            target.classList.add('move-above');
          } else {
            target.classList.add('folder-highlight');
          }
        }
      }
      // console.log(event);
      event.preventDefault();
    } else if (dropTarget) {
      dropTarget.classList.remove(...dropClasses);
      dropTarget = null;
      // console.log(event);
      event.preventDefault();
    }
  };

  let drop = async function (event) {
    // place the contents in a folder or swap positions
    let target = event.target;
    while (target && target.tagName !== 'LI')
      target = target.parentElement;
    if (target) {
      // make sure we went somewhere
      if (JSON.stringify(target.dataset) === JSON.stringify(item.dataset))
        return dragEnd();
      // data for moving item
      let mover = {
        fromPath: item.dataset.path.length ? item.dataset.path.split('-') : [],
        fromSeq: item.dataset.seq,
        toPath: target.dataset.path.length ? target.dataset.path.split('-') : [],
        toSeq: target.dataset.seq,
      };
      if (target.classList.contains('folder')) {
        // no need to push seq for root
        if (mover.toPath[0] === "root") {
          mover.toPath = [];
        } else {
          mover.toPath.push(mover.toSeq);
        }
        //make sure we're not trying to put a folder inside its child
        if (mover.toPath.length > mover.fromPath.length
        && mover.toPath.slice(0, mover.fromPath.length + 1).join() === mover.fromPath.concat([mover.fromSeq]).join()) {
          alert("Sorry, you can't put a folder inside its child folder.");
          return dragEnd();
        } else {
          mover.toSeq = '';
        }
      } else {
        // adjust resort based on position
        if ((mover.toSeq % 1) !== 0)
          mover.toSeq = Math.trunc(mover.toSeq)
                      + ((mover.toSeq > mover.fromSeq)
                      ? 0
                      : 1);
        // make sure we're not sorting to self in a folder list
        if (mover.fromSeq === mover.toSeq)
          return dragEnd();
      }
      const movedItem = space.moveItem(mover);
      space.sort(settings.sort);
      space.save();
      // console.log(event);
      event.preventDefault();
      dragEnd();
      buildList();
      if (movedItem instanceof Folder) buildTree();
    }
  };

  function dragEnd() {
    // clean up styling
    if (dropTarget) dropTarget.classList.remove(...dropClasses);

    // reenable textarea elements and hrs
    if (list) {
      for (let element of list.getElementsByClassName('snip-content'))
        element.removeAttribute('style');
      for (let element of list.getElementsByTagName('HR'))
        element.removeAttribute('style');
    }

    // disable drop targets around folders
    for (let element of list.getElementsByClassName('delimiter'))
      element.removeAttribute('style');

    // put item text back if it still exists
    if (item) {
      for (let child of item.children) {
        child.style.removeProperty('display');
      }
      item.classList.remove('placeholder');
    }
  
    // allow for garbage collection
    list = null;
    item = null;
    dropTarget = null;

    // clean up listeners
    document.removeEventListener('dragenter', dragEnter);
    document.removeEventListener('dragover', dragOver);
    document.removeEventListener('drop', drop);
    document.removeEventListener('dragend', dragEnd);
  }

  document.addEventListener('dragenter', dragEnter, false);
  document.addEventListener('dragover', dragOver, false);
  document.addEventListener('drop', drop, false);
  document.addEventListener('dragend', dragEnd, false);
}

/**
 * Action handler for various inputs
 * @param {HTMLElement|Object} target 
 * @returns 
 */
async function handleAction(target) {
  console.log(target, target.dataset, target.action);
  const dataset = target.dataset || target;
  dataset.action ||= target.name;

  // handle changes first if needed (buttons do not pull focus)
  const ae = document.activeElement;
  console.log(ae, target, ae == target, ae === target);
  if (target.tagName === `BUTTON` && [`INPUT`,`TEXTAREA`].includes(ae?.tagName)) {
    if (target.dataset.seq === ae.dataset.seq) {
      await handleAction(ae);
    } else {
      ae.blur();
    }
  }

  switch (dataset.action) {
    // window open action
    case 'focus':
      target = q$(`#snippets [data-field=${ dataset.field || `"content"` }][data-seq="${ dataset.seq }"]`);
      // console.log("Focusing field", target, `#snippets [data-field="${ dataset.field || `content` }"][data-seq="${ dataset.seq }"]`);
      if (!target) break;
      // check for folder renaming
      if (target.type === 'button' && dataset.field === 'name') {
        target.parentElement.querySelector('[action="rename"]').click();
      } else {
        target.focus();
        // set cursor at the end
        if (window.getSelection) target.selectionStart = target.selectionEnd = target.value.length;
      }
      break;

    // open menus
    case 'open-popover': 
    case 'open-submenu': {
      const t = $(dataset.target);
      // clean up submenus
      const topMenu = target.closest('.popover') || t;
      for (let submenu of topMenu.querySelectorAll('.menu-list')) {
        if (!(submenu === t || submenu.contains(t))) {
          submenu.classList.add(`hidden`);
        }
      }
      // open/close menu or submenu
      if (t.classList.contains(`hidden`)) {
        t.classList.remove(`hidden`);
      } else {
        t.classList.add(`hidden`);
      }
      break; }
    
    // backup/restore/clear all data
    case 'clear-data-all':
      if (!confirm("This action will clear all data and can't be undone. Are you sure you wish to do so?")) break;
      await chrome.storage.local.clear();
      await chrome.storage.sync.clear();
      // reinitialize
      settings.init();
      await settings.save();
      space.init(settings.defaultSpace);
      await space.save();
      loadPopup();
      break;

    case 'backup': {
      const appName = i18n('app_name');
      const now = new Date;
      let backup = {};
      let filename = `backup-${ now.toISOString().slice(0,16) }.json`;
      if (dataset.target === 'clippings61') {
        filename = `clippings-${filename}`;
        backup = space.data.toClippings();
      } else if (dataset.target === 'data') {
        filename = `${space.name}-${filename}`;
        backup.version = "1.0";
        backup.createdBy = appName;
        backup.data = structuredClone(space.data);
      } else if (dataset.target === 'space') {
        filename = `${space.name}-${filename}`;
        backup.version = "1.0";
        backup.createdBy = appName;
        backup.space = structuredClone(space);
        delete backup.space.path;
        backup.currentSpace = setCurrentSpace();
      } else if (dataset.target === 'full') {
        filename = `${appName}-${filename}`;
        backup.version = "1.0";
        backup.createdBy = appName;
        backup.spaces = [structuredClone(space)];
        delete backup.spaces[0].path;
        backup.currentSpace = setCurrentSpace();
        backup.settings = settings;
      }
      try {
        const f = await window.showSaveFilePicker({
          suggestedName: filename,
          types: [{
            description: "Backup File",
            accept: { "application/json": [".json"] },
          }],
        });
        const ws = await f.createWritable();
        await ws.write(JSON.stringify(backup));
        await ws.close();
      } catch { /* assume cancelled */ }
      break; }
    
    case 'restore': {
      console.log("Checking current data", space.data);
      if (space.data.children.length && !confirm("Careful, this may overwrite your current data and cannot be undone. Continue?"))
        break;
      try {
        // console.log("Getting file...");
        const failAlert = () => alert("The data could not be restored, please check the file and try again.");

        // get file
        const [fileHandle] = await window.showOpenFilePicker({ types: [{
          description: "Snippets or Clippings Backup",
          accept: { "application/json": ".json" },
        }] });
        console.log('Grabbed file', fileHandle);
        const fileData = await fileHandle.getFile();
        console.log('Grabbed data', fileData);
        const fileContents = await fileData.text();
        console.log('Grabbed contents', fileContents);
        const backup = JSON.parse(fileContents);
        console.log('Parsed data', backup);

        // restore current space and settings if present
        console.log("Starting restore...");
        space.path.length = 0;
        console.log("Checking data", structuredClone(space), structuredClone(backup));
        if (backup.currentSpace) setStorageData({ currentSpace: backup.currentSpace });
        if (backup.settings) {
          settings.init(settings);
          settings.save();
          // alert("Settings have been restored.");
        }
        if (backup.userClippingsRoot) { // check for clippings data
          console.log("Creating new DataBucket...");
          const newData = new DataBucket({ children: backup.userClippingsRoot });
          console.log("Parsing data...", structuredClone(newData), newData);
          if (await newData.parse()) {
            console.log("Updated data", space.data);
            space.data = newData;
            space.sort();
            space.save();
          } else {
            failAlert();
            break;
          }
        } else if (backup.data) {
          const data = new DataBucket(backup.data);
          space.data = await data.parse();
          // console.log("Saving space info", space);
          space.save();
        } else if (backup.space) {
          // console.log("Resetting current space info", data.space);
          await space.init(backup.space);
          space.sort();
          // console.log("Saving space info", space);
          space.save();
          setCurrentSpace();
        } else if (backup.spaces) {
          // console.log("Resetting current space info", data.spaces);
          for (let s of backup.spaces) {
            // console.log("loading space", s);
            const sp = new Space();
            await sp.init(s);
            // console.log("saving space", sp);
            await sp.save();
          }
          await space.load(backup.currentSpace || settings.defaultSpace);
        } else {
          failAlert();
          break;
        }
        // console.log("Loading snippets...");
        loadSnippets();
      } catch { /* assume cancelled */ }
      break; }

    // copy processed snippet
    case 'copy': {
      // get requested item
      let snip = await space.getProcessedSnippet(dataset.seq);
      console.log(snip);
      if (!snip) break;
      // rebuild settings menu in case there was an update to counters
      if (snip.counters) $('settings').replaceChildren(...buildMenu());
      // get custom fields if necessary
      if (snip.customFields) {
        // pass off to modal
        const finalSnip = await getCustomFields(snip);
        if (finalSnip?.content) snip = finalSnip;
      }
      // copy result text to clipboard
      setClipboard(snip.content, !snip.nosubst && getRichText(snip.content, settings.control));
      alert(`The snippet has been copied to the clipboard.`);
      break; }
  
    // settings
    case 'toggle-remember-path':
      settings.view.rememberPath = !settings.view.rememberPath;
      settings.save();
      setCurrentSpace();
      break;
  
    case 'toggle-show-source':
      settings.view.sourceURL = !settings.view.sourceURL;
      settings.save();
      buildList();
      break;
    
    case 'toggle-folders-first':
      // swap folders first or not
      settings.sort.foldersOnTop = !settings.sort.foldersOnTop;
      settings.save();
      if (settings.sort.foldersOnTop)
        space.sort(settings.sort);
      space.save();
      buildList();
      break;
    
    case 'toggle-save-source':
      settings.control.saveSource = !settings.control.saveSource;
      // TODO: confirm whether to delete existing sources
      settings.save();
      break;
    
    case 'toggle-preserve-tags':
      settings.control.preserveTags = !settings.control.preserveTags;
      settings.save();
      break;
    
    case 'toggle-rt-line-breaks':
      settings.control.rtLineBreaks = !settings.control.rtLineBreaks;
      settings.save();
      break;
    
    case 'toggle-rt-link-urls':
      settings.control.rtLinkURLs = !settings.control.rtLinkURLs;
      settings.save();
      break;
    
    case 'toggle-rt-link-emails':
      settings.control.rtLinkEmails = !settings.control.rtLinkEmails;
      settings.save();
      break;

    case 'toggle-sync':
      // // Check for existing sync data
      // if (!space.synced) {
      //   const syncData = getStorageData(space.name, true);
      //   if (syncData[space.name] && confirm(`It looks like there is previously synced data available. Would you like to overwrite that data with your current local data (Yes) or delete you local copy (No)?`)) {

      //   }
      // }
      // console.log(`Shifting...`, space);
      if (await space.shift({ synced: !space.synced })) {
        // update current/default spaces if necessary
        // if (settings.defaultSpace.name === space.name) {
        //   // console.log(`Updating default space...`);
        //   settings.defaultSpace.synced = space.synced;
        //   settings.save();
        // }
        // console.log(`Updating current space...`);
        setCurrentSpace();
        // console.log(`rebuilding header`);
        buildHeader();
      }
      break;

    // counters
    case 'set-counter-init': {
      console.log(target.value);
      let startVal = +target.value;
      if (target.id === `counter-init-x`) {
        // custom startval, show modal
        const modal = buildModal({
          title: `Counter Defaults`,
          fields: [{
            type: `number`,
            name: `start-val`,
            label: `Starting Value`,
            value: startVal,
          }],
          buttons: [{
            id: `submitCounterDefaults`,
            value: startVal,
            children: [buildNode('h2', { textContent: `Submit` })],
          }],
        }, true);
        document.body.append(modal);
        modal.addEventListener('change', event => {
          const button = modal.querySelector('#submitCounterDefaults');
          button.value = event.target.value;
        });
        modal.showModal();
        startVal = await new Promise((resolve, reject) =>
        modal.addEventListener('close', () =>
        isNaN(modal.returnValue) ? reject(0) : resolve(+modal.returnValue)));
      }
      space.data.counters.startVal = startVal;
      space.save();
      $('settings').replaceChildren(...buildMenu());
      break; }

    case 'manage-counters': {
      // eslint-disable-next-line no-unused-vars
      const { startVal, ...counters } = space.data.counters;
      const modal = buildModal({
        title: `Counters`,
        fields: Object.entries(counters).sort((a, b) => a - b).map(([key, value], i) => {
          return {
            type: `number`,
            name: i,
            label: key,
            value: value,
          };
        }),
        buttons: [
          {
            id: `submitCounters`,
            value: `{}`,
            children: [buildNode('h2', { textContent: `Submit` })],
          },
        ],
      }, true);
      document.body.append(modal);
      modal.addEventListener('change', event => {
        const button = modal.querySelector('#submitCounters');
        const changes = JSON.parse(button.value);
        changes[event.target.title] = +event.target.value;
        button.value = JSON.stringify(changes);
      });
      modal.showModal();
      modal.addEventListener('close', () => {
        const changes = JSON.parse(modal.returnValue);
        for (let key in changes) space.data.counters[key] = changes[key];
        space.save();
      });
      break; }

    case 'clear-counters': {
      const { startVal } = space.data.counters;
      space.data.counters = { startVal: startVal };
      space.save();
      $('settings').replaceChildren(...buildMenu());
      break; }
    
    // add/edit/delete items
    case 'new-snippet': {
      const newSnippet = space.addItem(new Snippet());
      space.save();
      buildList();
      handleAction({ action: 'focus', seq: newSnippet.seq, field: 'name' });
      break; }
    
    case 'new-folder': {
      const newFolder = space.addItem(new Folder());
      if (settings.sort.foldersOnTop) space.sort(settings.sort);
      space.save();
      buildList();
      buildTree();
      setHeaderPath();
      handleAction({ action: 'rename', seq: newFolder.seq, field: 'name' });
      break; }
    
    case 'delete':
      if(confirm("Would you would like to delete this snippet? This action cannot be undone.")) {
        const deletedItem = space.deleteItem(dataset.seq);
        // console.log(deletedItem, deletedItem instanceof Folder);
        space.save();
        buildList();
        // console.log("should I build the tree");
        if (deletedItem instanceof Folder) {
          // console.log("Yes, build the tree.");
          buildTree();
        }
      }
      break;
    
    case 'rename': {
      // change input type to text if needed and enable+focus
      const input = q$(`input[data-seq="${dataset.seq}"][data-field="name"]`);
      input.type = `text`;
      input.dataset.action = `edit`;
      input.focus();
      input.select();
      break; }
  
    case 'edit': {
      const field = dataset.field || target.name;
      const value = dataset.value || target.value;
      // handle defaults
      const edit = {
        seq: dataset.seq,
        field: field,
        value: value,
      };
      if (['Default', '', null].includes(value)
      && ['color', 'shortcut', 'sourceURL'].includes(field)) {
        delete edit.value;
      }
      const item = space.editItem(edit);
      // console.log(item, dataset);
      space.save();
      // update tree if changes were made to a folder
      if (item instanceof Folder) {
        const treeItem = $('tree').querySelector(`li[data-path="${ dataset.path || space.path }"][data-seq="${ dataset.seq }"]`);
        if (treeItem) {
          treeItem.replaceChildren(buildTreeWidget(
            !!getSubFolders(item.children),
            colors[item.color]?.value || `inherit`,
            space.path.concat(item.seq).join('-'),
            item.name,
          ));
        }
      }
      break; }
  
    case 'move': {
      const movedItem = space.moveItem({
        fromSeq: dataset.seq,
        toSeq: dataset.target,
      });
      space.save();
      buildList();
      if (movedItem instanceof Folder) buildTree();
      break; }
    
    // interface controls
    case 'pop-out': {
      const url = new URL(location.href);
      url.searchParams.delete('popout');
      chrome.windows.create({
        url: url.href,
        type: "popup",
        width: 867,
        height: 540,
      });
      window.close();
      break; }
    
    case 'open-folder': {
      // update url for ease of navigating
      const url = new URL(location.href);
      // console.log(`Setting path...`, url, dataset, dataset.target.length);
      if (dataset.target.length) {
        url.searchParams.set('path', dataset.target);
      } else {
        url.searchParams.delete('path');
      }
      // clear any action info
      url.searchParams.delete('action');
      url.searchParams.delete('field');
      url.searchParams.delete('seq');
      url.searchParams.delete('reason');
      // push new url location to history
      history.pushState(null, '', url.href);
      // console.log(`Updating path...`, space, dataset.target);
      space.path.length = 0;
      if (dataset.target.length) {
        // console.log(structuredClone(space.path));
        space.path.push(...dataset.target.split('-').map(v => +v));
        // console.log(structuredClone(space.path));
      }
      // console.log(`setting space`, space, settings);
      if (settings.view.rememberPath) setCurrentSpace();
      // console.log(`setting path`);
      setHeaderPath();
      // console.log(`building list`);
      buildList();
      // console.log(`Done!`);
      break; }
    
    case 'collapse':
      target.closest('li').querySelector('ul').classList.add(`hidden`);
      setSvgSprite(target, 'icon-folder-expand');
      dataset.action = 'expand';
      break;
    
    case 'expand':
      target.closest('li').querySelector('ul').classList.remove(`hidden`);
      setSvgSprite(target, 'icon-folder-collapse');
      dataset.action = 'collapse';
      break;

    case 'about': {
      const modal = buildModal({
        content: [
          buildNode('div', {
            classList: [`title`],
            children: [
              buildNode('img', {
                src: `../icons/snip128.png`,
                classList: [`logo`],
              }),
              buildNode('h1', {
                children: [
                  document.createTextNode(`Snippets `),
                  buildNode('span', {
                    classList: [`tinytype`],
                    textContent: `v${chrome.runtime.getManifest().version}`,
                  }),
                ],
              }),
            ],
          }),
          buildNode('p', {
            textContent: i18n('app_description'),
          }),
          buildNode('hr'),
          buildNode('a', { href: `https://github.com/jpc-ae/Snippets/issues/`, textContent: `Report an issue` }),
          document.createTextNode(` | `),
          buildNode('a', { href: `https://github.com/sponsors/jpc-ae`, textContent: `Donate` }),
        ],
        buttons: [{ id: `close`,
          children: [buildNode('h2', { textContent: `OK` })] },
        ],
      });
      document.body.append(modal);
      modal.showModal();
      break; }
  
    default:
      break;
  }
}