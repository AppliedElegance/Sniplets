/**
 * Shorthand for document.getElementById(id)
 * @param {string} id 
 * @returns {HTMLElement}
 */
const $ = id => document.getElementById(id);
/**
 * Shorthand for document.querySelector(query)
 * @param {string} query 
 * @returns {HTMLElement}
 */
const q$ = query => document.querySelector(query);

// globals for settings and keeping track of the current folder
const settings = new Settings();
const space = new Space();

/** Update currently viewed space */
const setCurrentSpace = () => space.setAsCurrent(settings.view.rememberPath);

// for handling resize of header path
const resizing = new ResizeObserver(adjustPath);

// Listen for updates on the fly in case of multiple popout windows
chrome.runtime.onMessage.addListener(async ({type, args}) => {
  if (type === 'updateSpace') {
    const {timestamp} = args;
    if (timestamp > space.data.timestamp) {
      await space.loadCurrent();
      loadSnippets();
    }
  }
});

// reusable onDOMContentLoaded
const loadPopup = async () => {
  // accessibility
  document.documentElement.lang = uiLocale;
  document.title = i18n('app_name');

  // load up settings with sanitation check for sideloaded versions
  if (!await settings.load()) {
    settings.init();
    settings.save();
  }
  // console.log("Settings loaded...", settings);

  // load parameters
  const params = Object.fromEntries(new URLSearchParams(location.search));
  // console.log("Processing parameters...", params);

  // check if opened as popup and set style accordingly
  if (params.popout) {
    window.popout = params.popout; // for building header
    document.body.style.width = "400px"; // column flex collapses width unless set
    document.body.style.height = "550px";
  }

  // check for followups before loading
  const followup = await fetchFollowup();
  if (followup) {
    /** @type {{type:string,args:{[key:string]:*}}} */
    const {type, args} = followup;
    const mergeAndPaste = async () => {
      const {snip, target} = args;
      const customFields = new Map(args.customFields || []);
      // console.log(target, snip, customFields);
      if (customFields.size) {
        const text = await mergeCustomFields(snip.content, customFields);
        // console.log(text);
        if (!text) return; // modal cancelled
        snip.content = text;
      }
      // await since window.close will cancel unresolved promises
      await insertSnip(target, snip);
      window.close();
    };
    switch (type) {
    case 'alert':
      await showAlert(args.message, args.title);
      break;
    
    case 'permissions': {
      if (await requestOrigins(args.origins)) {
        switch (args.action) {
        case 'snip': 
          snipSelection(args.target, args.actionSpace);
          window.close(); // in popup, happens automatically after this function completes
          return;
      
        case 'paste':
          await mergeAndPaste();
          window.close(); // in popup, happens automatically after this function completes
          return;
          
        default:
          window.close(); // in popup, happens automatically after this function completes
          return;
        }
      }
      break; }
      
    case 'placeholders':
      if (args.action === 'paste') await mergeAndPaste(); // should always be true
      break;

    case 'unsync': {
      args.actionSpace.synced = (await confirmAction(i18n('warning_sync_stopped'), i18n('action_keep_syncing'), i18n('action_use_local'))) || false;
      if (await space.init(args.actionSpace) && await space.save()) {
        await space.setAsCurrent();
      } else {
        showAlert(i18n('error_data_corrupt'));
        break;
      }
      break; }
    
    default:
      break;
    } // end switch(type)
  } // end followup

  // load up the current space
  if (!await space.loadCurrent()) {
    // should hopefully never happen
    if (await confirmAction(i18n('warning_space_corrupt'), i18n('action_reinitialize'))) {
      await space.init(settings.defaultSpace);
      space.save();
    } else {
      window.close();
      return;
    }
  }

  // update path if needed
  if (params.path) {
    space.path = params.path.split('-').map(v => +v).filter(v => v);
    if (settings.view.rememberPath) setCurrentSpace();
  }

  loadSnippets();

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

  // check and action URL parameters accordingly
  if (params.action?.length) handleAction(params);
};
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
      style: {display: `none`}, // only display when out of room
      dataset: {path: ``},
      children: [buildActionIcon(`Back`, `icon-back`, `inherit`, {
        action: 'open-folder',
        target: ``,
      })],
    }),
    buildNode('li', {
      classList: [`folder`],
      dataset: {path: `root`},
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
      buildNode('h1', {textContent: `/`}),
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
  const {startVal, ...counters} = space.data.counters;
  const customStartVal = (startVal > 1 || startVal < 0);
  // console.log(startVal, counters);
  return [
    buildSubMenu(i18n("menu_view"), `settings-view`, [
      buildMenuControl('checkbox', `toggle-folders-first`,
        i18n("menu_folders_first"), settings.sort.foldersOnTop),
        buildMenuControl('checkbox', `toggle-adjust-editors`,
          i18n("menu_adjust_textarea"), settings.view.adjustTextArea),
      buildMenuControl('checkbox', `toggle-show-source`,
        i18n("menu_show_src"), settings.view.sourceURL),
        buildMenuControl('checkbox', `toggle-remember-path`,
          i18n("menu_remember_path"), settings.view.rememberPath),
    ]),
    buildSubMenu(i18n("menu_data"), `settings-data`, [
      buildMenuControl('checkbox', `toggle-data-compression`,
        i18n("menu_data_compression"), settings.data.compress),
      buildMenuSeparator(),
      buildMenuItem(i18n("menu_clear_src"), `clear-src-urls`),
      // buildMenuItem(i18n("menu_clear_sync"), `clear-sync`),
      buildMenuItem(i18n("menu_reinit"), `initialize`),
    ]),
    buildSubMenu(i18n("menu_snip"), `settings-snip`, [
      buildMenuControl('checkbox', `toggle-save-source`,
        i18n("menu_save_src"), settings.control.saveSource),
      buildMenuControl('checkbox', `toggle-save-tags`,
        i18n("menu_save_tags"), settings.control.preserveTags),
    ]),
    buildSubMenu(i18n("menu_paste"), `settings-paste`, [
      buildMenuControl('checkbox', `toggle-rt-line-breaks`,
        i18n("menu_rt_br"), settings.control.rtLineBreaks),
      buildMenuControl('checkbox', `toggle-rt-link-urls`,
        i18n("menu_rt_url"), settings.control.rtLinkURLs),
      buildMenuControl('checkbox', `toggle-rt-link-emails`,
        i18n("menu_rt_email"), settings.control.rtLinkEmails),
    ]),
    buildSubMenu(i18n("menu_counters"), `settings-counters`, [
      buildSubMenu(i18n('menu_count_init'), `counter-init`, [
        buildMenuControl('radio', `set-counter-init`,
          i18nNum(0), startVal === 0, {id: `counter-init-0`}),
        buildMenuControl('radio', 'set-counter-init',
          i18nNum(1), startVal === 1, {id: `counter-init-1`}),
        buildMenuControl('radio', 'set-counter-init',
          startVal, customStartVal, { id: `counter-init-x`,
            title: i18n("menu_count_x") + (customStartVal ? ` (${i18nNum(startVal)})…` : `…`),
          }),
      ]),
      Object.keys(counters).length && buildMenuItem(`${i18n("menu_count_manage")}…`, `manage-counters`),
      Object.keys(counters).length && buildMenuItem(`${i18n("menu_count_clear")}…`, `clear-counters`),
    ]),
    buildSubMenu(i18n("menu_backups"), `settings-backup`, [
      buildMenuItem(i18n("menu_bak_data"), `backup-data`, `data`, {action: 'backup'}),
      buildMenuItem(i18n("menu_bak_full"), `backup-full`, `full`, {action: 'backup'}),
      buildMenuItem(i18n("menu_bak_clip"), `backup-clippings`, `clippings61`, {action: 'backup'}),
      buildMenuSeparator(),
      buildMenuItem(i18n("menu_restore"), `restore`),
    ]),
    buildMenuItem(`${i18n("menu_about")}…`, `about`),
  ];
}

function buildHeader() {
  // popover settings menu
  const settingsMenu = buildPopoverMenu(`settings`, `icon-settings`, `inherit`, buildMenu());

  // add path navigation element
  const path = buildNode('nav', {
    children: [buildNode('ul', {id: `path`})],
  });

  // quick actions
  const quickActionMenu = buildNode('div', {
    id: `quick-actions`,
    children: [
      buildActionIcon(
        space.synced ? i18n('action_stop_sync') : i18n('action_start_sync'),
        `icon-${space.synced ? `sync` : `local`}`,
        `inherit`, {
        action: `toggle-sync`,
      }),
      buildActionIcon(i18n('action_add_folder'), `icon-add-folder`, `inherit`, {
        action: `new-folder`,
      }),
      buildActionIcon(i18n('action_add_snippet'), `icon-add-snippet`, `inherit`, {
        action: `new-snippet`,
      }),
      window.popout && buildActionIcon(i18n('action_pop_out'), `icon-pop-out`, `inherit`, {
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
      id: `folder-${path}`,
      ...isRoot ? {} : {children: [
        buildNode('li', {
          dataset: {path: path, seq: `.5`},
          classList: [`delimiter`],
        }),
      ]},
    });

    // add each folder with a following drop-zone for reordering
    for (const folder of folders) {
      // check for subfolders
      const subFolders = getSubFolders(folder.children);
      // create folder list item
      const folderItem = buildNode('li', {
        classList: ['folder'],
        dataset: {
          path: path,
          ...isRoot ? {} : {seq: folder.seq},
        },
      });
      // add folder details
      folderItem.append(buildTreeWidget(
        !!subFolders,
        getColor(folder.color).value,
        (isRoot) ? `` : level.concat([folder.seq]).join('-'),
        (isRoot) ? space.name : folder.name,
      ));
      // add sub-list if subfolders were found
      if (subFolders) folderItem.append(
        buildFolderList(subFolders, (isRoot) ? [] : level.concat([folder.seq])),
      );
      // Add list item to list
      folderList.append(folderItem);
      // Insert dropzone after for reordering
      if (!isRoot) {
        folderList.append(buildNode('li', {
          dataset: {path: path, seq: String(folder.seq + .5)},
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
  const container = $('snippets');
  const scroll = container.scrollTop;
  const {path} = space;
  const fot = settings.sort.foldersOnTop;
  
  // clear current list and get info
  container.replaceChildren(buildNode('div', {classList: [`sizer`]}));
  const folder = space.getItem(path).children || [];
  const groupedItems = fot && groupItems(folder, 'type');

  if (fot && groupedItems.folder) { // group folders at top if set
    container.append(buildNode('div', {
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
    container.append(buildNode('hr'));
  }

  // list snippets, including folders if not grouped at top
  const items = fot ? groupedItems.snippet : folder;
  if (items) {
    container.append(buildNode('ul', {
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

    // set textarea height as appropriate
    for (const textarea of container.getElementsByTagName('textarea')) {
      adjustTextArea(textarea, 0);
    }
  }

  // maintain scroll position as much as possible
  container.scrollTop = scroll;
}

function loadSnippets() {
  buildHeader();
  buildTree();
  buildList();
}

/** auto-adjust the heights of input text areas
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
  const {scrollTop} = $('snippets');

  // disable animation while inputting
  if (target.type === 'input') textarea.style.transition = `none`;

  // calculate current content height
  let scrollHeight = textarea.scrollHeight - padding;
  // console.log(scrollHeight, textarea.scrollHeight, textarea.offsetHeight, textarea.style.height.replaceAll(/\D/g, ''));
  if (focusout || textarea.style.height.replaceAll(/\D/g, '') === scrollHeight) {
    // check and update actual scroll height to allow shrinking
    textarea.style.height = `auto`;
    scrollHeight = textarea.scrollHeight - padding;
  }
  if (scrollHeight < minHeight) scrollHeight = minHeight;
  // console.log(textarea.style.height, scrollHeight);

  // set max height to actual in case no limit set
  if (!settings.view.adjustTextArea || !maxHeight) maxHeight = scrollHeight;

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
  if (target?.type === `button` && target.dataset?.action !== 'open-folder') {
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
  // Only handle buttons as other inputs will be handled with change event
  /** @type {HTMLButtonElement|HTMLInputElement} */
  const target = event.target.closest('[type="button"]');

  // close menus & modals as needed
  for (const popover of document.querySelectorAll('.popover')) {
    if (!target
    || !popover.parentElement.contains(target)
    || ![`open-popover`, `open-submenu`].includes(target.dataset.action)) {
      // hide if no button, a different menu or a menu action was clicked
      popover.classList.add(`hidden`);
    }
  }
  
  if (target) handleAction(target);
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
  const {target} = event;
  const {dataset} = target;
  dataset.action ||= target.name;

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
    for (const control of controls) {
      toggleChecked(control.querySelector('use'), control.querySelector('input').checked);
    }
  }
  if (dataset.field === 'color') {
    setSvgFill(
      target.closest('.menu'),
      getColor(dataset.value || target.value).value,
    );
  }
}

function handleFocusOut(event) {
  /** @type {Element} */
  const {target} = event;
  if (target.ariaLabel === i18n('label_folder_name')) {
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
  // ignore text drags
  if (['input', 'textarea'].includes(event.target.tagName?.toLowerCase())
  && event.target.dataset?.action !== 'open-folder') {
    // console.log('stopping');
    event.stopPropagation();
    event.preventDefault();
    return;
  }
  // only allow moves
  event.dataTransfer.effectAllowed = "move";
  // picked up item
  const item = event.target.closest('li');
  const list = item.parentElement;
  event.dataTransfer.setData("text/html", item.toString());
  let dropTarget = item;
  const dropClasses = [`folder-highlight`, `move-above`, `move-below`];
  // console.log(item, list, dropTarget);

  // wait for browser to pick up the item with a nice outline before hiding anything
  setTimeout(() => {
    // turned picked up item into a placeholder
    for (const child of item.children) {
      child.style.display = `none`;
    }
    item.classList.add(`placeholder`);

    // remove textarea elements and hrs to facilitate reordering snippets
    for (const element of list.getElementsByClassName('snip-content'))
      element.style.display = `none`;
    for (const element of list.getElementsByTagName('HR'))
      element.style.display = `none`;

    // enable drop targets around folders
    for (const element of list.getElementsByClassName('delimiter'))
      element.style.display = `block`;
  }, 0);

  const dragEnter = function (event) {
    // make sure there's another list item to drop on
    let {target} = event;
    while (target && target.tagName !== 'LI')
      target = target.parentElement;
    if (target)
      event.preventDefault();
  };

  const dragOver = function (event) {
    // make sure there's another list item to drop on
    let {target} = event;
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

  const drop = async function (event) {
    // place the contents in a folder or swap positions
    const target = event.target.closest('li');
    if (target) {
      // make sure we went somewhere
      if (JSON.stringify(target.dataset) === JSON.stringify(item.dataset))
        return dragEnd();
      // data for moving item
      const moveFrom = {
        path: item.dataset.path?.length ? item.dataset.path.split('-') : [],
        seq: item.dataset.seq,
      };
      const moveTo = {
        path: target.dataset.path?.length ? target.dataset.path.split('-') : [],
        seq: target.dataset.seq,
      };
      if (target.classList.contains('folder')) {
        // no need to push seq for root
        if (moveTo.path.length && moveTo.path[0] === "root") {
          moveTo.path = [];
        } else {
          moveTo.path.push(moveTo.seq);
          moveTo.seq = undefined;
        }
        //make sure we're not trying to put a folder inside its child
        if (moveTo.path.length > moveFrom.path.length
        && moveTo.path.slice(0, moveFrom.path.length + 1).join() === moveFrom.path.concat([moveFrom.seq]).join()) {
          showAlert(i18n('error_folder_to_child'));
          return dragEnd();
        }
      } else {
        // adjust resort based on position
        if ((moveTo.seq % 1) !== 0)
          moveTo.seq = Math.trunc(moveTo.seq)
                      + ((moveTo.seq > moveFrom.seq)
                      ? 0
                      : 1);
        // make sure we're not sorting to self in a folder list
        if (moveFrom.seq === moveTo.seq)
          return dragEnd();
      }
      const movedItem = space.moveItem(moveFrom, moveTo);
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
      for (const element of list.getElementsByClassName('snip-content'))
        element.removeAttribute('style');
      for (const element of list.getElementsByTagName('HR'))
        element.removeAttribute('style');
    }

    // disable drop targets around folders
    for (const element of list.getElementsByClassName('delimiter'))
      element.removeAttribute('style');

    // put item text back if it still exists
    if (item) {
      for (const child of item.children) {
        child.style.removeProperty('display');
      }
      item.classList.remove('placeholder');
    }

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
  // console.log(target, target.dataset, target.action);
  const dataset = target.dataset || target;
  dataset.action ||= target.name;

  // handle changes first if needed (buttons do not pull focus)
  const ae = document.activeElement;
  // console.log(ae, target, ae == target, ae === target);
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
    target = q$(`#snippets [data-field=${dataset.field || `"content"`}][data-seq="${dataset.seq}"]`);
    // console.log("Focusing field", target, `#snippets [data-field="${dataset.field || `content`}"][data-seq="${dataset.seq}"]`);
    if (!target) break;
    // scroll entire card into view
    target.closest('li')?.scrollIntoView();
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
    for (const submenu of topMenu.querySelectorAll('.menu-list')) {
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
  
  // backup/restore/clear data
  case 'initialize':
    if (!await confirmAction(i18n('warning_clear_data'), i18n('action_clear_all_data'))) break;
    // clear each in order to ensure service worker knows what's going on
    await chrome.storage.session.clear();
    await chrome.storage.local.clear();
    await chrome.storage.sync.clear();
    // reinitialize
    settings.init();
    // console.log(settings);
    settings.save();
    await space.init(settings.defaultSpace);
    // console.log(space);
    space.save();
    loadPopup();
    break;

  case 'backup': {
    const appName = i18n('app_name');
    const now = new Date;
    let backup = {};
    let filename = `backup-${now.toISOString().slice(0,16)}.json`;
    switch (target.value) {
    case 'clippings61':
      filename = `clippings-${filename}`;
      backup = space.data.toClippings();
      break;
  
    case 'data':
      filename = `${space.name}-${filename}`;
      backup.version = "1.0";
      backup.createdBy = appName;
      backup.data = structuredClone(space.data);
      break;
  
    case 'full':
      filename = `${appName}-${filename}`;
      backup.version = "1.0";
      backup.createdBy = appName;
      backup.spaces = [structuredClone(space)];
      delete backup.spaces[0].path;
      backup.currentSpace = await setCurrentSpace();
      backup.settings = settings;
      break;
  
    case 'space':
    default:
      filename = `${space.name}-${filename}`;
      backup.version = "1.0";
      backup.createdBy = appName;
      backup.space = structuredClone(space);
      delete backup.space.path;
      backup.currentSpace = await setCurrentSpace();
      break;
    }
    try {
      // console.log(backup);
      const f = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{
          description: i18n('file_save_type'),
          accept: {"application/json": [".json"]},
        }],
      });
      const ws = await f.createWritable();
      await ws.write(JSON.stringify(backup, null, 2)); // pretty print
      await ws.close();
    } catch {/* assume cancelled */}
    break; }
  
  case 'restore': {
    // console.log("Checking current data", space.data);
    if (space.data.children.length && !await confirmAction(i18n('warning_restore_bak', i18n('action_restore'))))
      break;
    try {
      // console.log("Getting file...");
      const failAlert = () => showAlert(i18n('error_restore_failed'));

      // get file
      const [fileHandle] = await window.showOpenFilePicker({ types: [{
        description: i18n('file_save_type'),
        accept: {"application/json": ".json"},
      }] });
      // console.log('Grabbed file', fileHandle);
      const fileData = await fileHandle.getFile();
      // console.log('Grabbed data', fileData);
      const fileContents = await fileData.text();
      // console.log('Grabbed contents', fileContents);
      const backup = JSON.parse(fileContents);
      // console.log('Parsed data', backup);

      // restore current space and settings if present
      // console.log("Starting restore...");
      space.path.length = 0;
      // console.log("Checking data", structuredClone(space), structuredClone(backup));
      if (backup.currentSpace) setStorageData({currentSpace: backup.currentSpace});
      if (backup.settings) {
        settings.init(settings);
        settings.save();
        // showAlert("Settings have been restored.");
      }
      // check for clippings data
      if (backup.userClippingsRoot) {
        // console.log("Creating new DataBucket...");
        const newData = new DataBucket({children: backup.userClippingsRoot});
        // console.log("Parsing data...", structuredClone(newData), newData);
        if (await newData.parse()) {
          // console.log("Updated data", space.data);
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
        for (const s of backup.spaces) {
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
    } catch {/* assume cancelled */}
    break; }

  // copy processed snippet
  case 'copy': {
    // get requested item
    const {snip, customFields} = await space.getProcessedSnippet(dataset.seq) || {};
    // console.log(snip);
    if (!snip) break;
    // rebuild settings menu in case there was an update to counters
    if (snip.counters) $('settings').replaceChildren(...buildMenu());
    // get custom fields if necessary
    if (customFields) {
      const content = await mergeCustomFields(customFields);
      if (!content) break; // modal cancelled
      snip.content = content;
    }
    // copy result text to clipboard
    if (await setClipboard(snip)) {
      showAlert(i18n('alert_copied'));
    }
    break; }

  // settings
  case 'toggle-remember-path':
    settings.view.rememberPath = !settings.view.rememberPath;
    settings.save();
    setCurrentSpace();
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

  case 'toggle-adjust-editors':
    settings.view.adjustTextArea = !settings.view.adjustTextArea;
    settings.save();
    buildList();
    break;

  case 'toggle-show-source':
    settings.view.sourceURL = !settings.view.sourceURL;
    settings.save();
    buildList();
    break;

  case 'toggle-data-compression':
    settings.data.compress = !settings.data.compress;
    settings.save();
    space.save();
    break;

  case 'toggle-sync': {
    // check for sync size constraints
    // console.log(space);
    if (!space.synced) {
      const testBucket = new DataBucket(this.data);
      // console.log(testBucket);
      if (settings.data.compress) await testBucket.compress();
      if (!testBucket.syncable(space.name)) {
        alert(i18n('error_sync_full'));
        return false;
      }
    }

    // check if data already exists
    const targetBucket = await getStorageData(space.name, !space.synced);
    // console.log(targetBucket);
    if (targetBucket && targetBucket[space.name]) {
      // console.log('Working on it');
      const response = await confirmSelection(i18n('warning_sync_overwrite'), [
        {title: i18n('action_keep_local'), value: 'local'},
        {title: i18n('action_keep_sync'), value: 'sync'},
      ], i18n('action_start_sync'));
      // console.log(response);
      switch (response) {
      case 'sync':
        // update local data before moving, set to false since it'll be reset after
        if (!await space.init({name: space.name, synced: false, data: targetBucket[space.name]})) {
          alert(i18n('error_shift_failed'));
          return false;
        }
        break;

      case 'local':
        // pretend there's no data
        break;
    
      default:
        return false;
      }
    }
    
    // attempt to move the space
    space.synced = !space.synced;
    if (await space.save()) {
      await space.setAsCurrent();
      removeStorageData(space.name, !space.synced);
      buildHeader();
      loadSnippets();
    } else {
      space.synced = !space.synced;
      alert(i18n('error_shift_failed'));
      return false;
    }
    break; }

  case 'clear-src-urls':
    if (await confirmAction(i18n('warning_clear_src'), i18n('action_clear_srcs'))) {
      const removeSources = folder => {
        for (const item of folder) {
          if (item.children?.length) {
            removeSources(item.children);
          } else {
            delete item.sourceURL;
          }
        }
      };
      removeSources(space.data.children);
      space.save();
      if (settings.view.sourceURL) buildList();
    }
    break;
  
  case 'toggle-save-source':
    settings.control.saveSource = !settings.control.saveSource;
    // TODO: confirm whether to delete existing sources
    settings.save();
    break;
  
  case 'toggle-save-tags':
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

  // counters
  case 'set-counter-init': {
    // console.log(target.value);
    let startVal = +target.value;
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
      }, ({target}) => {
        const submitButton = target.closest('dialog').querySelector('#submitCounterDefaults');
        submitButton.value = target.value;
      });
      if (!val) break; // modal cancelled
      if (!isNaN(val) && (parseInt(val) === Math.abs(+val))) startVal = +val;
    }
    space.data.counters.startVal = startVal;
    space.save();
    $('settings').replaceChildren(...buildMenu());
    break; }

  case 'manage-counters': {
    // eslint-disable-next-line no-unused-vars
    const {startVal, ...counters} = space.data.counters;
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
    }, ({target}) => {
      const button = target.closest('dialog').querySelector('#submitCounters');
      const changes = JSON.parse(button.value);
      const val = +target.value;
      if (!isNaN(val) && (parseInt(val) === Math.abs(val))) changes[target.title] = val;
      button.value = JSON.stringify(changes);
    });
    if (!values) break; // modal cancelled
    const changes = JSON.parse(values);
    for (const key in changes) space.data.counters[key] = changes[key];
    space.save();
    break; }

  case 'clear-counters': {
    const {startVal} = space.data.counters;
    space.data.counters = {startVal: startVal};
    space.save();
    $('settings').replaceChildren(...buildMenu());
    break; }
  
  // add/edit/delete items
  case 'new-snippet': {
    const newSnippet = space.addItem(new Snippet());
    space.save();
    buildList();
    handleAction({action: 'focus', seq: newSnippet.seq, field: 'name'});
    break; }
  
  case 'new-folder': {
    const newFolder = space.addItem(new Folder());
    if (settings.sort.foldersOnTop) space.sort(settings.sort);
    space.save();
    buildList();
    buildTree();
    setHeaderPath();
    handleAction({action: 'rename', seq: newFolder.seq, field: 'name'});
    break; }
  
  case 'delete':
    if(await confirmAction(i18n('warning_delete_snippet'), i18n('action_delete'))) {
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
    const item = space.editItem(
      dataset.seq,
      field,
      ((!value || value === 'Default') && ['color', 'shortcut', 'sourceURL'].includes(field))
      ? void 0 : value,
    );
    // console.log(item, dataset);
    space.save();
    // update tree if changes were made to a folder
    if (item instanceof Folder) {
      const treeItem = $('tree').querySelector(`li[data-path="${dataset.path || space.path}"][data-seq="${dataset.seq}"]`);
      if (treeItem) {
        treeItem.replaceChildren(buildTreeWidget(
          !!getSubFolders(item.children),
          getColor(item.color).value,
          space.path.concat(item.seq).join('-'),
          item.name,
        ));
      }
    }
    break; }

  case 'move': {
    // console.log(dataset);
    const movedItem = space.moveItem(
      {seq: dataset.seq},
      {seq: target.value},
    );
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

  case 'about':
    showAbout();
    break;

  default:
    break;
  }
}