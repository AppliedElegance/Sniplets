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
async function setCurrentSpace() {
  // current and default space must be synced if they have the same name
  const loc = {
    name: space.name,
    synced: space.synced,
  };
  if (loc.name === settings.defaultSpace.name) {
    settings.defaultSpace = loc;
    settings.save();
  }
  return await setStorageData({ currentSpace: loc }, false);
}

// init
async function loadPopup() {
  // load up settings
  await settings.load();

  // load up the current space or fall back to default
  let { currentSpace } = await getStorageData('currentSpace');
  await space.load(currentSpace || settings.defaultSpace);
  if (!currentSpace) setCurrentSpace();

  // set up listeners
  document.addEventListener('click', handleClick, false);
  document.addEventListener('keydown', handleKeydown, false);
  document.addEventListener('keyup', handleKeyup, false);
  document.addEventListener('change', handleChange, false);
  // document.addEventListener('focusin', adjustTextArea, false);
  // document.addEventListener('input', adjustTextArea, false);
  // document.addEventListener('focusout', inputActions, false);
  document.addEventListener('dragstart', handleDragDrop, false);

  // check for url parameters and load snippets accordingly
  const urlParams = new URLSearchParams(location.search);
  space.path = urlParams.get('path')?.split(',') || [];
  loadSnippets({ action: urlParams.get('action'), seq: urlParams.get('seq') });
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
  if (!by) {
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

function buildHeader() {
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
    buildSubMenu(`Behaviour`, `settings-behaviour`, [
      buildMenuControl('checkbox', `Save source URLs`, {
        dataset: { action: `toggle-save-source` },
        checked: settings.control.saveSource,
      }),
    ]),
    buildSubMenu('Backups', `settings-backup`, [
      buildMenuItem(`Full Backup`, { action: `backup`, target: `space` }),
      buildMenuItem(`Backup for Clippings`, { action: `backup`, target: `clippings61` }),
      buildMenuSeparator(),
      buildMenuItem(`Restore`, { action: `restore` }),
      buildMenuItem(`Clear All Data`, { action: `clear-data-all` }),
    ]),
  ]);
  // path navigation (filled in properly when a folder is loaded)
  const path = buildNode('nav', {
    children: [buildNode('ul', {
    id: `path`,
      children: [buildNode('li', { textContent: `Snippets` })],
    })],
  });
  // quick actions
  const quickActionMenu = buildNode('div', {
    id: `quick-actions`,
    children: [
      buildActionIcon(
        space.synced ? `Stop syncing` : `Start syncing`,
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
      buildActionIcon(`Pop Out`, `icon-pop-out`, `inherit`, {
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
}

function buildTree() {
  /**
   * Build folder tree for pop-out window (recursive function)
   * @param {Folder[]} folders 
   * @param {int[]} level 
   */
  function buildFolderList(folders, level) {
    const isRoot = folders[0] instanceof DataBucket;
    const path = level.join(',');

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
        (isRoot) ? `` : level.concat([folder.seq]).join(','),
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
  const pathHeader = $('path');
  const fot = settings.sort.foldersOnTop;

  // set path in header
  if (path.length) {
    const pathNames = space.getPathNames();
    pathHeader.replaceChildren(
      buildNode('li', {
        id: `folder-up`,
        classList: [`folder`],
        dataset: {
          seq: path.slice(-2, -1).join(','),
          path: path.slice(0, -2).join(','),
        },
        children: [buildActionIcon(`Back`, `icon-back`, `inherit`, {
          action: 'open-folder',
          target: path.slice(0, -1).join(','),
        })],
      }),
      buildNode('li', {
        children: [
          buildNode('h1', {
            textContent: `/`,
          }),
          buildNode('h1', {
            textContent: pathNames.pop(),
          }),
        ],
      }),
    );
    // add as many parent folders as possible
    const folderUpItem = $('folder-up');
    const folderUpButton = q$('#folder-up button');
    let fullPath = true;
    while (pathNames.length) {
      const i = pathNames.length;
      const pathName = pathNames.pop();
      const folderSeq = path.slice(i-1, i).join(',');
      const path = path.slice(0, i-1).join(',');
      const folderTarget = path.slice(0, i).join(',');

      const pathItem = buildNode('li', {
        classList: [`folder`],
        dataset: {
          seq: folderSeq,
          path: path,
        },
        children: [
          buildNode('h1', {
            textContent: `/`,
          }),
          buildNode('button', {
            type: `button`,
            dataset: {
              action: 'open-folder',
              target: folderTarget,
            },
            children: [buildNode('h1', {
              textContent: pathName,
            })],
          }),
        ],
      });
      folderUpItem.after(pathItem);
      // undo last append if maximum length is reached and stop
      if (pathHeader.offsetHeight > 32) {
        pathItem.remove();
        folderUpItem.dataset.seq = ``;
        folderUpItem.dataset.path = `root`;
        folderUpButton.dataset.target = folderTarget;
        fullPath = false;
        break;
      }
    }
    // Include the space name if possible
    if (fullPath) {
      folderUpItem.style.display = `none`;
      const pathSpace = buildNode('li', {
        classList: [`folder`],
        dataset: {
          seq: ``,
          path: `root`,
        },
        children: [
          buildNode('button', {
            type: `button`,
            dataset: {
              action: 'open-folder',
              target: ``,
            },
            children: [buildNode('h1', {
              textContent: space.name,
            })],
          }),
        ],
      });
      folderUpItem.after(pathSpace);
      // undo last append if maximum length is reached
      if (pathHeader.offsetHeight > 32) {
        pathSpace.remove();
        folderUpItem.style.removeProperty('display');
        folderUpItem.dataset.seq = ``;
        folderUpItem.dataset.path = `root`;
        folderUpButton.dataset.target = ``;
      }
    }
  } else {
    pathHeader.replaceChildren(buildNode('li', {
      children: [buildNode('h1', {
        textContent: space.name,
      })],
    }));
  }
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
            classList: [`card`],
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
      adjustTextArea(textarea, 160);
  }
}

function loadSnippets({ action = null, seq = null } = {}) {
  buildHeader();
  buildTree();
  buildList();

  // check for requested actions
  switch (action) {
  case 'copy':
  case 'edit': {
    const editArea = q$('#snippets textarea[data-seq="' + parseInt(seq) + '"]');
    if (editArea) {
      editArea.focus();
      editArea.selectionStart = editArea.selectionEnd = editArea.value.length;
    }
    break;
  }
  case 'rename': {
    const renameButton = q$('#snippets button[data-action="rename"][data-seq="' + parseInt(seq) + '"]');
    if (renameButton) {
      renameButton.click();
    } else { // not a folder
      const nameInput = q$('#snippets input[data-field="name"][data-seq="' + parseInt(seq) + '"]');
      if (nameInput) {
        nameInput.focus();
        nameInput.select();
      }
    }
    break;
  }
  default:
    // do nothing
  }
}

// auto-adjust the heights of input textareas
function adjustTextArea(textarea, limit = false) {
  textarea = textarea.target ?? textarea; // get target for events
  if (textarea.tagName.toLowerCase() === 'textarea') {
    let ch = parseInt(textarea.clientHeight, 10) ?? 0;
    let sh = textarea.scrollHeight;
    // only expand or collapse as necessary
    if (ch < sh || limit) {
      textarea.style.height = 'auto'; // reset height
      sh = textarea.scrollHeight; // check new scroll height
      limit = limit ? (limit === true ? 160 : limit) : sh; // set default collapsible limit
      textarea.style.height = (sh > limit ? limit : sh) + 'px';
    }
  }
}

/**
 * Click handler
 * @param {Event} event 
 */
async function handleClick(event) {
  // ignore labels (handled on inputs)
  if (event.target.tagName === 'LABEL') return;

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
 * @param {Event} event 
 */
function handleKeydown(event) {
  if (event.target.tagName === 'LABEL' && event.key === ' ') {
    // prevent scroll behaviour when a label is 'clicked' with a spacebar
    event.preventDefault();
  }
}

/**
 * Keyup handler
 * @param {Event} event 
 */
function handleKeyup(event) {
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
  // helpers
  const target = event.target;
  const dataset = target.dataset;

  // handle action
  if (!dataset.action) return;
  handleAction(target);
  
  // update menu if needed
  if (dataset.action === 'edit') {
    if (target.type === 'checkbox') {
      toggleChecked(target.parentElement.querySelector('use'));
    } else if (target.type === 'radio') {
      const controls = target.closest('fieldset').querySelectorAll('.control');
      for (let control of controls) {
        toggleChecked(control.querySelector('use'), control.querySelector('input').checked);
      }
    }
    if (dataset.field === 'color') {
      const icon = target.closest('.menu').querySelector('use');
      icon.setAttribute('fill', colors[dataset.value || target.value].value);
    } else if (dataset.field === 'name') {
      if (dataset.target) {
        target.type = `button`;
        dataset.action = `open-folder`;
        target.blur();
      }
    }
  }
}

// // focusout event helper
// function inputActions(event) {
//   // helpers
//   const target = event.target;
//   const item = target.closest('li');

//   const pq = q => item.querySelector(q);
//   // actions as the field loses focus
//   if (['INPUT', 'TEXTAREA'].includes(target.tagName)) {
//     switch (target.dataset.field) {
//     case 'name':
//       // put back title
//       target.style.display = 'none';
//       if (!item) break;
//       pq('.name h2').textContent = target.value;
//       pq('.name').style.display = 'block';
//       pq('.title').draggable = true;
//       // reload folder tree if necessary
//       if (item.classList.contains('folder')) loadSnippets({ list: false });
//       break;

//     case 'content':
//       adjustTextArea(target, true);
//       break;
  
//     default:
//       break;
//     }
//   }
// }

/**
 * drag and drop reordering of snippets so they can be put in folders
 * @param {DragEvent} event 
 */
function handleDragDrop(event) {
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
      event.preventDefault();
    } else if (dropTarget) {
      dropTarget.classList.remove(...dropClasses);
      dropTarget = null;
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
        fromPath: item.dataset.path.length ? item.dataset.path.split(',') : [],
        fromSeq: item.dataset.seq,
        toPath: target.dataset.path.length ? target.dataset.path.split(',') : [],
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
 * @param {HTMLElement} target 
 * @returns 
 */
async function handleAction(target) {
  const dataset = target.dataset;
  const value = dataset.value || target.value;

  switch (dataset.action) {
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
      space.pivot(new Space(settings.defaultSpace));
      await space.save();
      loadPopup();
      break;

    case 'backup': {
      const backup = {};
      if (dataset.target === 'clippings61') {
        backup.version = "6.1";
        backup.createdBy = "Clippings/wx";
        backup.userClippingsRoot = JSON.stringify(space.data.children);
        backup.userClippingsRoot.replaceAll(/"color":"(.*?)"/u, (match, p1) => `"label":"${ colors[p1].clippings }"`);
      } else if (dataset.target === 'space') {
        backup.version = "1.0";
        backup.createdBy = "Snippets";
        backup.space = JSON.stringify(space);
      }
      const now = new Date;
      try {
        const f = await window.showSaveFilePicker({
          suggestedName: `snippets-backup-${ now.toISOString().slice(0,16) }.json`,
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
      if (space.data.children.length && !confirm("Careful, this will completely replace whatever snippets you already have."))
        break;
      try {
        const [fileHandle] = await window.showOpenFilePicker({ types: [{
          description: "Snippets or Clippings JSON backup",
          accept: { "application/jason": ".json" },
        }] });
        const fileData = await fileHandle.getFile();
        const fileContents = await fileData.text();
        const data = JSON.parse(fileContents);
        if (data.userClippingsRoot) { // check for clippings data
          space.data = new DataBucket({ children: data.userClippingsRoot });
        } else if (data.space) {
          await space.pivot(data.space);
          space.save();
        } else {
          alert("The data could not be restored, please check the file and try again.");
          break;
        }
        loadSnippets();
        setCurrentSpace();
      } catch { /* assume cancelled */ }
      break; }
  
    // settings
    case 'toggle-remember-path':
      settings.view.rememberPath = !settings.view.rememberPath;
      settings.save();
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
      // swap saving source on snip actions or not
      settings.control.saveSource = !settings.control.saveSource;
      // TODO: confirm whether to delete existing sources
      settings.save();
      break;

    case 'toggle-sync':
      if (await space.shift({ synced: !space.synced })) {
        // update current/default spaces if necessary
        if (settings.defaultSpace.name === space.name) {
          settings.defaultSpace.synced = space.synced;
          settings.save();
        }
      }
      // setCurrentSpace();
      loadSnippets();
      break;
    
    // add/edit/delete items
    case 'new-snippet': {
      const newSnippet = space.addItem(new Snippet());
      space.save();
      loadSnippets({ action: 'rename', seq: newSnippet.seq });
      break; }
    
    case 'new-folder': {
      const newFolder = space.addItem(new Folder());
      if (settings.sort.foldersOnTop) space.sort(settings.sort);
      space.save();
      loadSnippets({ action: 'rename', seq: newFolder.seq });
      break; }
    
    case 'delete':
      if(confirm("You’re about to delete “" + dataset.name + "”… Please confirm.")) {
        const deletedItem = space.deleteItem(dataset.seq);
        space.save();
        buildList();
        if (deletedItem instanceof Folder) buildTree();
      }
      break;
    
    case 'rename': {
      // change button inputs to text if needed and enable/focus
      const input = target.closest('li').querySelector('input[data-field="name"]');
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
      console.log(item, dataset);
      space.save();
      // update tree if changes were made to a folder
      if (item instanceof Folder) {
        const treeItem = $('tree').querySelector(`li[data-path="${ dataset.path || space.path }"][data-seq="${ dataset.seq }"]`);
        if (treeItem) {
          treeItem.replaceChildren(buildTreeWidget(
            !!getSubFolders(item.children),
            colors[item.color]?.value || `inherit`,
            space.path.concat(item.seq).join(','),
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
    case 'pop-out':
      chrome.windows.create({
        url: location.href,
        type: "popup",
        width: 867,
        height: 540,
      });
      window.close();
      break;
    
    case 'open-folder': {
      // update url for ease of navigating
      const url = new URL(location.href);
      if (dataset.target.length) {
        url.searchParams.set('path', dataset.target);
      } else {
        url.searchParams.delete('path');
      }
      // clear any action info
      url.searchParams.delete('action');
      url.searchParams.delete('seq');
      // push new url location to history
      history.pushState({}, '', url);
      // load new folder
      space.path.length = 0;
      if (dataset.target.length) {
        space.path.push(...dataset.target.split(','));
      }
      // setCurrentSpace();
      buildList();
      break; }
    
    case 'collapse':
      target.closest('li').querySelector('ul').classList.add(`hidden`);
      target.querySelector('use').setAttribute('href', `sprites.svg#icon-folder-expand`);
      dataset.action = 'expand';
      break;
    
    case 'expand':
      target.closest('li').querySelector('ul').classList.remove(`hidden`);
      target.querySelector('use').setAttribute('href', `sprites.svg#icon-folder-collapse`);
      dataset.action = 'collapse';
      break;
  
    default:
      break;
  }
}