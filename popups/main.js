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

// globals for settings and keeping track of the current folder
const settings = new Settings();
const space = new Space();
function setCurrentSpace() {
  const loc = {
    name: space.name,
    synced: space.synced,
  };
  // save path as well if requested
  if (settings.view.rememberPath) loc.path = space.path;
  setStorageData({ currentSpace: loc }, false);
  return loc;
}

// init
async function loadPopup() {
  // load up settings
  await settings.load();
  // console.log("Settings loaded...", settings);

  // load up the current space or fall back to default
  // console.log("Retrieving current space...");
  const { currentSpace } = await getStorageData('currentSpace');
  // console.log("Loading current space...", currentSpace, settings.defaultSpace);
  await space.load(currentSpace || settings.defaultSpace);
  // console.log("Updating current space if necessary...", structuredClone(space));
  if (!currentSpace) setCurrentSpace();


  // load the page
  const params = new URLSearchParams(location.search);
  // console.log("Processing parameters...", params);

  // update path if needed
  if (params.get('path')) {
    space.path = params.get('path')?.split('-').map(v => parseInt(v)).filter(v => v);
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
  document.addEventListener('focusin', adjustTextArea, false);
  document.addEventListener('input', adjustTextArea, false);
  document.addEventListener('focusout', adjustTextArea, false);

  // check for requests
  const { request } = await chrome.storage.session.get('request').catch(() => false);
  // console.log(request);
  if (request?.origins) {
    const modal = buildModal(`This site requires additional permissions `
    + `for context menus and shortcuts to work. If you would like to use `
    + `these features on this site, please press the appropriate button `
    + `and accept the request.`, {
      buttons: [
        {
          value: JSON.stringify(request.origins),
          children: [buildNode('h2', { children: [
            document.createTextNode(`Allow full access to `),
            buildNode('em', { textContent: `this` }),
            document.createTextNode(` site`),
          ] })],
        },
        {
          value: `["<all_urls>"]`,
          children: [buildNode('h2', { children: [
            document.createTextNode(`Allow full access to `),
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
      // console.log(event, modal.returnValue, request);
      const granted = await chrome.permissions.request({ origins: JSON.parse(modal.returnValue) }).catch(e => e);
      // console.log(granted);
      switch (request.action) {
        case 'snip':
          if (granted) {
            // Try again
            let snip = await getSnippet(request.target);
            if (!snip) return alert("Sorry, something went wrong and the selection could not be snipped. Please make sure the page is still active and try again.");

            // Add snip to space
            if (settings.control.saveSource) snip.sourceURL = request.data.pageUrl;
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
            //try again
            const result = await pasteSnippet(request.target, request.snip);
            if (!result?.pasted) alert("Sorry, something went wrong and the snip could not be pasted. Please make sure the page is still active and try again.");
            window.close();
          } else {
            // load for copying
            loadSnippets();
            alert("Permissions were not granted. Please copy the requested snippet and paste it manually.");
            handleAction({ action: 'focus', seq: request.snip.seq, field: 'copy' });
          }
          break;
      
        default:
          break;
      }
      chrome.storage.session.remove('request').catch(e => (console.log(e), false));
    });
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
  
    // keep an eye on the path and hide path names as necessary
    const resizing = new ResizeObserver(adjustPath);
    resizing.observe($('path'));
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
  // get list of path names (should always include space name)
  const pathNames = space.getPathNames();
  const pathNode = $('path');
  // console.log(pathNames, pathNode);
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
}

function buildHeader() {
  // check if popout button needed
  const params = new URLSearchParams(location.search);
  const popout = params.get('popout');

  // popover settings menu
  const settingsMenu = buildPopoverMenu(`settings`, `icon-settings`, `inherit`, [
    buildSubMenu(`View`, `settings-view`, [
      buildMenuControl('checkbox', `Remember last open folder`, {
        dataset: { action: `toggle-remember-path` },
        checked: settings.view.rememberPath,
      }),
      buildMenuControl('checkbox', `Show source URLs`, {
        dataset: { action: `toggle-show-source` },
        checked: settings.view.sourceURL,
      }),
    ]),
    buildSubMenu(`Sort`, `settings-sort`, [
      buildMenuControl('checkbox', `Group folders at top`, {
        dataset: { action: `toggle-folders-first` },
        checked: settings.sort.foldersOnTop,
      }),
    ]),
    buildSubMenu(`Snip Control`, `settings-snip`, [
      buildMenuControl('checkbox', `Save source URLs`, {
        dataset: { action: `toggle-save-source` },
        checked: settings.control.saveSource,
      }),
      // buildMenuControl('checkbox', `Preserve HTML Tags`, {
      //   dataset: { action: `toggle-preserve-tags` },
      //   checked: settings.control.preserveTags,
      // }),
    ]),
    buildSubMenu(`Rich Text`, `settings-paste`, [
      buildMenuControl('checkbox', `Add Line Breaks`, {
        dataset: { action: `toggle-rt-line-breaks` },
        checked: settings.control.rtLineBreaks,
      }),
      buildMenuControl('checkbox', `Link URLs`, {
        dataset: { action: `toggle-rt-link-urls` },
        checked: settings.control.rtLinkURLs,
      }),
      buildMenuControl('checkbox', `Link Emails`, {
        dataset: { action: `toggle-rt-link-emails` },
        checked: settings.control.rtLinkEmails,
      }),
    ]),
    buildSubMenu('Backups', `settings-backup`, [
      buildMenuItem(`Data Backup`, { action: `backup`, target: `space` }),
      buildMenuItem(`Full Backup`, { action: `backup`, target: `full` }),
      buildMenuItem(`Clippings Backup`, { action: `backup`, target: `clippings61` }),
      buildMenuSeparator(),
      buildMenuItem(`Restore`, { action: `restore` }),
      buildMenuItem(`Clear All Data`, { action: `clear-data-all` }),
    ]),
  ]);
  // add path navigation element
  const path = buildNode('nav', {
    children: [buildNode('ul', { id: `path` })],
  });
  // quick actions
  const quickActionMenu = buildNode('div', {
    id: `quick-actions`,
    children: [
      buildActionIcon(
        space.synced ? `Stop syncing.` : `Start syncing.`,
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
      popout && buildActionIcon(`Pop Out`, `icon-pop-out`, `inherit`, {
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
function adjustPath(entries) {
  const t = entries[0].target;
  const s = $('folder-up');
  const sb = s.querySelector('button');
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
      sb.dataset.target = f.querySelector('button').target || ``;
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
      adjustTextArea(textarea, editorHeight);
  }
}

function loadSnippets() {
  buildHeader();
  buildTree();
  buildList();
}

/** auto-adjust the heights of input textareas
 * @param {Event|FocusEvent|HTMLTextAreaElement} target 
 * @param {number} [maxHeight] 
 */
function adjustTextArea(target, maxHeight) {
  const padding = 2*4; // 4px top & bottom padding
  const minHeight = 2*19; // 19px line height
  // console.log(target, maxHeight);
  /** @type {HTMLTextAreaElement} set target for events */
  const textarea = target.target || target;
  if (textarea.tagName !== 'TEXTAREA') return;
  const focusout = target.type === 'focusout';
  let scrollTop = $('snippets').scrollTop; // save current scroll position
  // disable animation while inputting
  if (target.type === 'input') textarea.style.transition = `none`;

  // calculate current content height
  // textarea.style.scrollbarWidth = `0`; // disable scrollbar (only works in canary)
  let scrollHeight = textarea.scrollHeight - padding;
  if (focusout || parseInt(textarea.style.height) === scrollHeight) {
    // check and update actual scroll height to allow shrinking
    textarea.style.height = `auto`;
    scrollHeight = textarea.scrollHeight - padding;
  }
  if (scrollHeight < minHeight) scrollHeight = minHeight;
  // textarea.style.removeProperty('scrollbar-width'); // show scrollbar
  // console.log(textarea.style.height, scrollHeight);

  // set max height to actual or limit if set
  maxHeight ||= (focusout) ? editorHeight : scrollHeight;
  // console.log(maxHeight, textarea.clientHeight);
  // update if needed
  if (maxHeight !== textarea.clientHeight) {
    const targetHeight = scrollHeight > maxHeight ? maxHeight : scrollHeight;
    textarea.style.height = `${targetHeight}px`;
    if (focusout) {
      textarea.style.removeProperty('transition'); // reenable animations
      textarea.style.removeProperty('overflow'); // reenable scrollbar
      
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
  // prevent focus pull on buttons but indicate action
  const target = event.target.closest('[data-action]');
  if (target?.type === `button`) {
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
  if (!dataset.action) return;
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
  } else if (dataset.field === 'name') {
    // console.log(dataset);
    if (dataset.target) {
      target.type = `button`;
      dataset.action = `open-folder`;
      target.blur();
    }
  }
}

/**
 * drag and drop reordering of snippets so they can be put in folders
 * @param {DragEvent} event 
 */
function handleDragDrop(event) {
  console.log(event);
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
  // console.log(target, target.dataset, target.action);
  const dataset = target.dataset || target;
  const value = dataset.value || target.value;

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
      } else if (dataset.target === 'space') {
        filename = `${space.name}-${filename}`;
        backup.version = "1.0";
        backup.createdBy = appName;
        backup.space = structuredClone(space);
        delete backup.space.path;
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
      // console.log("Checking current data", space.data);
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
        // console.log('Grabbed file', fileHandle);
        const fileData = await fileHandle.getFile();
        // console.log('Grabbed data', fileData);
        const fileContents = await fileData.text();
        // console.log('Grabbed contents', fileContents);
        const data = JSON.parse(fileContents);
        // console.log('Parsed data', data);

        // restore current space and settings if present
        // console.log("Starting restore...");
        space.path.length = 0;
        // console.log("Checking data", structuredClone(space), structuredClone(data));
        if (data.currentSpace) setStorageData({ currentSpace: data.currentSpace });
        if (data.settings) {
          settings.init(settings);
          settings.save();
          // alert("Settings have been restored.");
        }
        if (data.userClippingsRoot) { // check for clippings data
          const newData = new DataBucket({ children: data.userClippingsRoot });
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
        } else if (data.space) {
          // console.log("Resetting current space info", data.space);
          await space.init(data.space);
          space.sort();
          // console.log("Saving space info", space);
          space.save();
          setCurrentSpace();
        } else if (data.spaces) {
          // console.log("Resetting current space info", data.spaces);
          for (let s of data.spaces) {
            // console.log("loading space", s);
            const sp = new Space();
            await sp.init(s);
            // console.log("saving space", sp);
            await sp.save();
          }
          await space.load(data.currentSpace || settings.defaultSpace);
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
      const snip = await space.getProcessedSnippet(dataset.seq);
      if (!snip) break;
      // if (snip.hasCustomFields) {
      //   // pass off to popup
      //   window.snip = snip;
      //   chrome.windows.create({
      //     url: chrome.runtime.getURL("popups/placeholders.html"),
      //     type: "popup",
      //     width: 700,
      //     height: 500,
      //   });
      //   break;
      // }
      // copy result text to clipboard for manual paste
      // console.log(`Copying to clipboard...`, snip);
      await navigator.clipboard.write([new ClipboardItem({
        ["text/plain"]: new Blob([snip.content], { type: "text/plain" }),
        ["text/html"]: new Blob([snip.richText], { type: "text/html" }),
      })]).catch(() => alert(`Sorry, copying automatically to the clipboard is blocked. `
      + `If you would like to use the copy fuction, please reset this site's permissions `
      + `in your browser's settings.`));
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
    
    // add/edit/delete items
    case 'new-snippet': {
      const newSnippet = space.addItem(new Snippet());
      space.save();
      loadSnippets();
      handleAction({ action: 'focus', seq: newSnippet.seq, field: 'name' });
      break; }
    
    case 'new-folder': {
      const newFolder = space.addItem(new Folder());
      if (settings.sort.foldersOnTop) space.sort(settings.sort);
      space.save();
      loadSnippets();
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
      // handle defaults
      const edit = {
        seq: dataset.seq,
        field: dataset.field,
        value: value,
      };
      if (['Default', '', null].includes(value)
      && ['color', 'shortcut', 'sourceURL'].includes(dataset.field)) {
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
      history.pushState({}, '', url);
      // load new folder
      // console.log(`Updating path...`, space, dataset.target);
      space.path.length = 0;
      if (dataset.target.length) {
        // console.log(structuredClone(space.path));
        space.path.push(...dataset.target.split('-').map(v => parseInt(v)));
        // console.log(structuredClone(space.path));
      }
      if (settings.view.rememberPath) setCurrentSpace();
      setHeaderPath();
      buildList();
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
  
    default:
      break;
  }
}