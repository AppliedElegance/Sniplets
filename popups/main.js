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
const colors = [
  { name: "Default", value: "", clippings: "" },
  { name: "Grey", value: "#808080", clippings: "gray" },
  { name: "Red", value: "#FF0000", clippings: "red" },
  { name: "Orange", value: "#FFA500", clippings: "orange" },
  { name: "Yellow", value: "#FFD700", clippings: "yellow" },
  { name: "Green", value: "#32CD32", clippings: "green" },
  { name: "Blue", value: "#0000FF", clippings: "blue" },
  { name: "Violet", value: "#EE82EE", clippings: "purple" },
];

// icons
const spritesheet = "sprites.svg#";
/**
 * Set icons for controls
 * @param {string} setting
 * @param {boolean} selected
 * @returns 
 */
const setControlIcon = (setting, selected) =>
  q$(`[data-action="toggle-${ setting }"] use`)
  .setAttribute('href', `${ spritesheet }control-${selected ? `checked` : `unchecked`}`);

// init
const loadPopup = async () => {
  // load up settings
  await settings.load();
  // load up the current space or fall back to default
  let { currentSpace } = await getStorageData('currentSpace');
  if (!currentSpace) currentSpace = settings.defaultSpace;
  await space.pivot(currentSpace);
  // set up listeners
  document.addEventListener('click', buttonClick, false);
  document.addEventListener('focusin', adjustTextArea, false);
  document.addEventListener('input', adjustTextArea, false);
  document.addEventListener('change', inputChange, false);
  document.addEventListener('focusout', inputActions, false);
  document.addEventListener('dragstart', handleDragDrop, false);
  // check for url parameters and load snippets
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.has('folderPath')) space.path = urlParams.get('folderPath').split(',') ?? [];
  loadSnippets({ action: urlParams.get('action') ?? null, seq: urlParams.get('seq') ?? null });
}
document.addEventListener('DOMContentLoaded', loadPopup, false);

async function loadSnippets({ buildTree = true, buildList = true, action = null, seq = null } = {}) {
  /**
   * Group tree items by type
   * @param {*[]} folder 
   * @returns {Object<string,*[]>}
   */
  const groupItems = (folder, type = 'all') => folder.reduce((folder, item) => {
    const all = type === 'all';
    if (item instanceof Folder && (all || type === 'folder')) {
      folder.folders.push(item);
    } else if (item instanceof Snippet && (all || type === 'snippet')) {
      folder.snippets.push(item);
    }
    return folder;
  }, {
    folders: [],
    snippets: [],
  });
  
  /**
   * Helper for only grabbing subfolders
   * @param {*[]} folder 
   * @returns {Folder[]}
   */
  const getSubFolders = (folder) => groupItems(folder, 'folder').folders;

  /**
   * Helper for element creation including sub-elements
   * @param {string} tagName 
   * @param {Object} attributes
   */
  const buildNode = (tagName, attributes) => {
    const element = document.createElement(tagName);
    for (let a in attributes) {
      if (!attributes[a]) continue; // ignores all falsy values (simplified for usage)
      switch (a) {
      case 'children':
        element.append(...attributes.children);
        break;
      
      case 'dataset':
        for (let data in attributes.dataset) {
          element.dataset[data] = attributes.dataset[data];
        }
        break;

      case 'classList':
        element.classList.add(...attributes.classList);
        break;

      case 'textContent':
        element.textContent = attributes.textContent;
        break;
      
      case 'events':
        for (let e of attributes.events) {
          element.addEventListener(e.type, e.listener, e.options || false);
        }
        break;
    
      default:
        element.setAttribute(a, attributes[a]);
      }
    }
    return element;
  }

  const buildSvg = (title, sprite, fill) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('role', `img`);
    svg.setAttribute('focusable', false);
    const svgTitle = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    svgTitle.textContent = title;
    svg.append(svgTitle);
    const svgUse = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    svgUse.setAttribute('href', `sprites.svg#${ sprite }`);
    if (fill) svgUse.setAttribute('fill', fill);
    svg.append(svgUse);
    return svg;
  }

  const buildControl = (type, { id, name, value, checked, dataset }) => buildNode('div', {
    classList: [`menu-item`, `control`],
    children: [
      buildNode('input', {
        type: type,
        id: id,
        name: name,
        value: value,
        checked: checked,
        dataset: dataset,
        visibility: `hidden`,
      }),
      buildNode('label', {
      for: id,
      children: [
        buildNode('div', {
          classList: [`icon`],
          children: [buildSvg(name, `control-${ type + (checked ? `-checked` : ``) }`)]
        }),
        buildNode('h3', { textContent: value }),
      ],
    })],
  });
  
  // Update sync icon and text
  q$(`[data-action="toggle-sync"] use`)
    .setAttribute('href', `${ spritesheet }icon-${space.synced ? `sync` : `local`}`);
  q$(`[data-action="toggle-sync"] title`)
    .textContent = `Turn sync ${space.synced ? `off` : `on`}`;
  // View settings
  setControlIcon('save-path', settings.view.rememberPath);
  setControlIcon('show-source', settings.view.sourceURL);
  // Sort settings
  const fot = settings.sort.foldersOnTop; // shorthand
  setControlIcon('folders-first', fot);
  
  // path shorthands
  let path = space.path;
  const pathHeader = $('path');

  // set path in header
  if (path.length) {
    const pathNames = space.getPathNames();
    pathHeader.replaceChildren(buildNode('li', {
      id: `folder-up`,
      classList: [`folder`],
      dataset: {
        seq: path.slice(-2, -1).join(','),
        path: path.slice(0, -2).join(','),
      },
      children: [buildNode('button', {
        type: `button`,
        classList: [`icon`],
        dataset: {
          action: 'open-folder',
          target: path.slice(0, -1).join(','),
        },
        children: [buildSvg(
          `Back`,
          `icon-back`
        )],
      })],
    }));
    pathHeader.append(buildNode('li', {
      children: [
        buildNode('h1', {
          textContent: `/`,
        }),
        buildNode('h1', {
          textContent: pathNames.pop(),
        }),
      ],
    }));
    // 
    const folderUpItem = $('folder-up');
    const folderUpButton = q$('#folder-up button')
    // add as many parent folders as possible
    let fullPath = true;
    while (pathNames.length) {
      const i = pathNames.length;
      const pathName = pathNames.pop();
      const folderSeq = path.slice(i-1, i).join(',');
      const folderPath = path.slice(0, i-1).join(',');
      const folderTarget = path.slice(0, i).join(',')

      const pathItem = buildNode('li', {
        classList: [`folder`],
        dataset: {
          seq: folderSeq,
          path: folderPath,
        },
        children: [
          buildNode('h1', {
            textContent: `/`
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
          })
        ],
      });
      console.log(i, pathName, pathItem);
      folderUpItem.after(pathItem);
      console.log(pathItem);
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
          })
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

  if (buildTree) {
    /**
     * Build folder tree for pop-out window (recursive function)
     * @param {Folder[]} folders 
     * @param {int[]} level 
     */
    const buildFolderTree = (folders, level) => {
      const isRoot = folders[0] instanceof DataBucket;
      const folderPath = level.join(',');

      // list container with initial drop zone for reordering
      const folderList = buildNode('ul', {
        id: `folder-${ folderPath }`,
        children: !isRoot && [buildNode('li', {
          dataset: { path: folderPath, seq: `.5`, },
          classList: [`delimiter`]
        })],
      });

      // add each folder with a following drop-zone for reordering
      for (let folder of folders) {
        // check for subfolders
        const subFolders = getSubFolders(folder.children);
        const expandable = subFolders.length;
        // create folder list item
        const folderItem = buildNode('li', {
          dataset: {
            path: folderPath,
            seq: (isRoot) ? `` : String(folder.seq),
          }
        });
        // add folder details
        folderItem.append(buildNode('div', {
          classList: [`title`],
          draggable: !isRoot, // TODO: allow root items to be dragged once multiple spaces is implimented
          children: [
            // expand/collapse button only needed if subfolders were found
            buildNode('button', {
              type: `button`,
              disabled: !expandable,
              dataset: expandable && { action: `collapse` },
              classList: [`icon`],
              children: [
                buildSvg(`Folder`, expandable ? `icon-folder-collapse` : `icon-folder`, folder.label)
              ],
            }),
            // folder name
            buildNode('button', {
              type: `button`,
              classList: [`name`],
              dataset: {
                action: `open-folder`,
                target: (isRoot) ? `` : level.concat([folder.seq]).join(',')
              },
              children: [
                buildNode('h2', {
                  textContent: (isRoot) ? space.name : folder.name
                })
              ],
            })
          ],
        }));
        // add sublist if subfolders were found
        if (expandable) folderItem.append(
          buildFolderTree(subFolders, (isRoot) ? [] : level.concat([folder.seq]))
        );
        // Add list item to list
        folderList.append(folderItem);
        // Insert dropzone after for reordering
        if (!isRoot) {
          folderList.append(buildNode('li', {
            dataset: { path: folderPath, seq: String(folder.seq + .5), },
            classList: [`delimiter`]
          }));
        }
      }
      return folderList;
    }
    // start building from the root
    $('tree').replaceChildren(buildFolderTree([space.data], ['root']));
  }

  if (buildList) {
    // clear current list and get info
    $('snippets').replaceChildren(buildNode('div', { classList: [`sizer`] }));
    const folder = space.getItem(path).children || [];
    const groups = fot && groupItems(folder);

    /**
     * Builder for listing items depending on their class
     * @param {TreeItem} item - Folder or Snippet
     * @param {TreeItem[]} list - list which includes `item`, for calculating dropzone targets
     * @returns {HTMLElement[]}
     */
    const buildNodesForItem = (item, list) => {
      const itemNodes = [];
      // only folders are clickable
      const titleNode = (item instanceof Folder)
        ? buildNode('button', {
          type: `button`,
          dataset: {
            action: `open-folder`,
            target: path.concat([item.seq]).join(','),
          },
        })
        : buildNode('div');
      titleNode.classList.add(`name`)
      titleNode.append(buildNode('h2', {
        seq: item.seq,
        textContent: item.name,
      }));

      // item settings and position
      const itemMenu = buildNode('ul', {
        id: `snipmenu${ item.seq }`,
        classList: [`card`, `dropdown`],
        children: [
          buildNode('li', { // Color options
            classList: [`menu-item`, `submenu`],
            children: [
              buildNode('h3', { textContent: `Colour…` }),
              buildNode('div', {
                classList: [`submenu`, `card`],
                children: colors.map((color) => buildControl('radio', {
                  id: `item${ item.seq }-color-${ color.name }`, 
                  name: `item${ item.seq }-color`,
                  value: color.name,
                  checked: ((color.name === item.label) || (!item.label && (color.name === "Default"))),
                  dataset: {
                    action: `edit`,
                    seq: item.seq,
                    field: `label`,
                    value: color.name,
                    label: item.label,
                    color: color.name,
                    item: JSON.stringify(item),
                    checked: ((color.name === item.label) || (!item.label && (color.name === "Default"))),
                  }
                })),
              }),
            ],
          }),
          buildNode('li', { // Move actions
            classList: [`menu-item`, `submenu`],
            children: [
              buildNode('h3', { textContent: `Move…` }),
              buildNode('ul', {
                classList: [`card`],
                children: ['top', 'up', 'down', 'bottom'].map((direction, i) => {
                  if ((i < 2 && item.seq === list[0].seq) || (i > 1 && item.seq === list[list.length - 1].seq)) {
                    return null;
                  }
                  return buildNode('li', {
                    classList: [`menu-item`],
                    children: [buildNode('button', {
                      type: `button`,
                      dataset: {
                        action: `move`,
                        seq: item.seq,
                        target: () => {
                          switch (direction) {
                            case 'top':
                              return list[0].seq;
                            case 'up':
                              return item.seq - 1;
                            case 'down':
                              return item.seq + 1;
                            case 'bottom':
                              return list[list.length - 1].seq;
                            default:
                              return ``;
                          }
                        }
                      },
                      children: [buildNode('h3', {
                        textContent: [`To Top`, `Up`, `Down`, `To Bottom`][i],
                      })],
                    })],
                  });
                }).filter(e => e),
              }),
            ],
          }),
        ],
      })

      // build header line
      const itemHead = buildNode('div', {
        classList: [`title`],
        draggable: true,
        children: [
          buildNode('div', {
            classList: [`menu`],
            children: [
              buildNode('button', {
                type: `button`,
                classList: [`icon`],
                dataset: {
                  action: `menu`,
                  dropdown: `snipmenu${ item.seq }`,
                },
                children: [buildSvg(`Menu`, `icon-${ item.constructor.name.toLowerCase() }`, colors[item.label])],
              }),
              itemMenu,
            ],
          }),
          titleNode,
          buildNode('input', {
            type: `text`,
            dataset: {
              action: `edit`,
              seq: item.seq,
              field: `name`,
            },
            value: item.name,
          }),
          buildNode('button', {
            type: `button`,
            classList: [`icon`],
            dataset: {
              action: `rename`,
              seq: item.seq,
            },
            children: [buildSvg(`Rename`, `icon-rename`)],
          }),
          buildNode('button', {
            type: `button`,
            classList: [`icon`],
            dataset: {
              action: `delete`,
              seq: item.seq,
              name: item.name,
            },
            children: [buildSvg(`Delete`, `icon-delete`)],
          }),
        ],
      });
      itemNodes.push(itemHead);
      if (item instanceof Snippet) { // include editor
        itemNodes.push(buildNode('hr'));
        itemNodes.push(buildNode('div', {
          classList: [`snip-content`],
          children: [buildNode('textarea', {
            dataset: {
              action: `edit`,
              seq: item.seq,
              field: `content`,
            },
            textContent: item.content,
          })],
        }));
        if (settings.view.sourceURL) itemNodes.push(buildNode('div', {
          classList: [`source-url`],
          children: [
            buildNode('label', { textContent: `Source: ` }),
            buildNode('input', {
              type: `text`,
              dataset: {
                action: `edit`,
                seq: item.seq,
                field: `sourceURL`,
              },
              placeholder: `unknown…`,
              value: item.sourceURL,
            }),
          ]
        }));
      }
      return itemNodes;
    }

    if (fot && groups.folders.length) { // group folders at top if set
      $('snippets').append(buildNode('div', {
        classList: [`card`],
        children: [buildNode('ul', {
          classList: [`folder-list`],
          children: [
            buildNode('li', { // leading dropzone
              classList: [`delimiter`],
              dataset: {
                seq: `.5`,
                path: path
              },
            }),
          ].concat(groups.folders.flatMap((folder, i, a) => [
              buildNode('li', { // folder item
                classList: [`folder`],
                dataset: {
                  seq: folder.seq,
                  path: path,
                },
                children: buildNodesForItem(folder, groups.folders),
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
    const items = fot ? groups.snippets : folder;
    if (items.length) {
      $('snippets').append(buildNode('ul', {
        id: `snippet-list`,
        children: [
          buildNode('li', {
            classList: [`delimiter`],
            dataset: {
              seq: .5,
              path: path,
            },
          })
        ].concat(items.flatMap((item) => [
          buildNode('li', {
            classList: [item.constructor.name.toLowerCase()],
            dataset: {
              seq: item.seq,
              path: path,
            },
            children: [buildNode('div', {
              classList: [`card`],
              children: buildNodesForItem(item, items),
            })],
          }),
          buildNode('li', {
            classList: [`delimiter`],
            dataset: {
              seq: item.seq + .5,
              path: path,
            },
          }),
        ]))
      }));

      // keep items to a reasonable height
      for (let textarea of $('snippets').getElementsByTagName('textarea'))
        adjustTextArea(textarea, 160);
    }
  }

  // check for requested actions
  switch (action) {
  case 'copy':
  case 'edit': {
    let editArea = q$('#snippets textarea[data-seq="' + parseInt(seq) + '"]');
    if (editArea) {
      editArea.focus();
      editArea.selectionStart = editArea.selectionEnd = editArea.value.length;
    }
    break;
  }
  case 'rename': {
    let renameButton = q$('#snippets button[data-action="rename"][data-seq="' + parseInt(seq) + '"]');
    if (renameButton)
      renameButton.click();
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

// button handling
async function buttonClick(event) {
  // cleanup function in case there are menu items open
  let clearMenus = function () {
    for (let menuItem of document.getElementsByClassName('dropdown'))
      menuItem.style.display = "none";
  }
  // find button or clean up
  let target = event.target;
  while (target && target.tagName.toLowerCase() !== 'button') {
    target = target.parentElement;
  }
  if (!target) {
    // make sure there are no straggler menus
    clearMenus();
    return;
  }
  // find parent item
  let item = target;
  while (item && (item.tagName !== 'LI')) {
    item = item.parentElement;
  }

  // helpers
  const pq = query => item.querySelector(query);
  if (document.activeElement !== document.body)
    document.activeElement.blur();
  const url = new URL(window.location);
  const params = target.dataset;
  const setCurrentSpace = async function () {
    const data = { currentSpace: {
      name: space.name,
      synced: space.synced
    }};
    if (settings.view.rememberPath) {
      data.currentSpace.path = space.path;
    }
    await setStorageData(data);
  }
  
  switch (params.action) {
  case 'menu': {
    if ($(params.dropdown).style.display === 'block') {
      clearMenus();
    } else {
      clearMenus();
      $(params.dropdown).style.display = 'block';
    }
    break; }
  
  case 'backup': {
    let backup = {};
    let now = new Date;
    if (params.target === 'clippings61') {
      backup = {
        version: "6.1",
        createdBy: "Clippings/wx",
        userClippingsRoot: backup.data.children
      }
    } else if (params.target === 'space') {
      backup = {
        createdBy: "Snippets",
        version: "0.9",
        space: space,
      }
      delete backup.space.path;
    }
    saveToFile('snippets-backup-' + now.toISOString().slice(0,16) + '.json', JSON.stringify(backup));
    break; }
  
  case 'restore': {
    if (space.data.children.length)
      if (!confirm("Careful, this will completely replace whatever snippets you already have."))
        break;
    $('file').dataset.action = 'restore';
    $('file').click();
    setCurrentSpace();
    break; }
  
  case 'open-folder': {
    // update url for ease of navigating
    if (params.target.length) {
      url.searchParams.set('folderPath', params.target);
    } else if (url.searchParams.has('folderPath')) {
      url.searchParams.delete('folderPath');
    }
    // clear any action info
    try {
      url.searchParams.delete('action');
      url.searchParams.delete('seq');
    } catch (e) {
      // ignore errors
    }
    // push new url location to history
    window.history.pushState({}, '', url);
    // load new folder
    space.path.length = 0;
    if (params.target.length) {
      space.path.push(...params.target.split(','));
    }
    setCurrentSpace();
    loadSnippets({buildTree: false});
    break; }

  case 'clear-data-all': {
    if (!confirm("This action will clear all data and can't be undone. Are you sure you wish to do so?")) break;
    await chrome.storage.local.clear();
    await chrome.storage.sync.clear();
    // reinitialize
    settings.init();
    await settings.save();
    await space.pivot(settings.defaultSpace);
    await space.save();
    loadPopup();
    break;
  }

  case 'toggle-sync':
    if (await space.shift({ synced: !space.synced })) {
      // update current/default spaces if necessary
      if (settings.defaultSpace.name === space.name) {
        settings.defaultSpace.synced = space.synced;
        settings.save();
      }
    }
    setCurrentSpace();
    loadSnippets({ buildTree: false, buildList: false });
    break;

  case 'toggle-save-path':
    settings.view.rememberPath = !settings.view.rememberPath;
    settings.save();
    setCurrentSpace();
    loadSnippets({ buildTree: false, buildList: false });
    break;

  case 'toggle-show-source':
    settings.view.sourceURL = !settings.view.sourceURL;
    settings.save();
    loadSnippets({ buildTree: false });
    break;
  
  case 'new-snippet': {
    let newSnippet = space.addItem(new Snippet());
    space.save();
    loadSnippets({ buildTree: false, action: 'rename', seq: newSnippet.seq });
    break; }
  
  case 'new-folder': {
    let newFolder = space.addItem(new Folder());
    if (settings.sort.foldersOnTop) space.sort(settings.sort);
    space.save();
    loadSnippets({ action: 'rename', seq: newFolder.seq });
    break; }
  
  case 'delete':
    if(confirm("You’re about to delete “" + params.name + "”… Please confirm.")) {
      space.deleteItem(params.seq);
      space.save();
      loadSnippets();
    }
    break;
  
  case 'rename':
    // swap display and input elements so name can be updated
    pq('.title').draggable = false;
    pq('.name').style.display = 'none';
    pq('input').style.display = 'block';
    pq('input').focus();
    pq('input').select();
    break;

  case 'edit':
    space.editItem({
      seq: params.seq,
      field: params.field,
      value: params.value,
    })
    space.save();
    loadSnippets();
    break;

  case 'move':
    space.moveItem({
      fromSeq: params.seq,
      toSeq: params.target,
    })
    space.save();
    loadSnippets();
    break;
  
  case 'pop-out':
    chrome.windows.create({
      url: window.location.href,
      type: "popup",
      width: 867,
      height: 540
    });
    window.close();
    break;
  
  case 'collapse':
    pq('ul').style.display = 'none';
    target.getElementsByTagName('use')[0].setAttribute('href', `sprites.svg#icon-folder-expand`);
    target.dataset.action = 'expand';
    break;
  
  case 'expand':
    pq('ul').style.removeProperty('display');
    target.getElementsByTagName('use')[0].setAttribute('href', `sprites.svg#icon-folder-collapse`);
    target.dataset.action = 'collapse';
    break;
  
  case 'toggle-folders-first':
    // swap folders first or not
    settings.sort.foldersOnTop = !settings.sort.foldersOnTop;
    settings.save();
    if (settings.sort.foldersOnTop)
      space.sort(settings.sort);
    space.save();
    loadSnippets();
    break;
  
  default:
    alert("Sorry, that button doesn't do anything yet");
    break;
  }

  if (params.action !== 'menu') {
    clearMenus();
  }
}

// input handling
function inputChange(event) {
  // helpers
  const target = event.target;
  const action = target.dataset.action;

  // for file inputs first
  if (target.type === 'file' && target.files.length) {
    const file = target.files[0];
    const reader = new FileReader();
    reader.onerror = function (e) {
      console.error(e);
      alert("Sorry, unable to load file." + "/n" + target.error.code);
    }
    reader.onload = async function () {
      switch (action) {
      case 'restore': {
        try {
          var obj = JSON.parse(reader.result);
          if (obj.createdBy.slice(0, 9) === "Clippings") {
            space.data.children = space.data.restructure(obj.userClippingsRoot);
          } else if (obj.createdBy === "Snippets") {
            switch (obj.version) {
            case "0.8":
              space.data = space.data.restructure(obj.data);
              break;

            case "0.9":
              await space.pivot(obj.space);
              break;
          
            default:
              break;
            }
          }
          space.sort(settings.sort);
          space.save();
          // space.path.length = 0;
          loadSnippets();
        } catch (e) {
          console.error(e);
          alert("Unsupported file…/n" + e);
        }
        break; }
      
      case 'import': {
        alert("That does nothing yet.");
        break; }

      default: {
        // do nothing
      }}
    }
    reader.readAsText(file);
  } else if (action === 'edit') {
    space.editItem({
      seq: target.dataset.seq,
      field: target.dataset.field,
      value: target.value,
    });
    space.save();
  }
}
function inputActions(event) {
  // helpers
  const target = event.target;
  let item = target;
  while (item && (item.tagName !== 'LI')) {
    item = item.parentElement;
  }
  const pq = q => item.querySelector(q);
  // actions as the field loses focus
  if (['INPUT', 'TEXTAREA'].includes(target.tagName)) {
    switch (target.dataset.field) {
    case 'name':
      // put back title
      target.style.display = 'none';
      if (!item) break;
      pq('.name h2').textContent = target.value;
      pq('.name').style.display = 'block';
      pq('.title').draggable = true;
      // reload folder tree if necessary
      if (item.classList.contains('folder')) loadSnippets({ buildList: false });
      break;

    case 'content':
      adjustTextArea(target, true);
      break;
  
    default:
      break;
    }
  }
}

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
  }

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
  }

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
      space.moveItem(mover);
      space.sort(settings.sort);
      space.save();
      event.preventDefault();
      dragEnd();
      loadSnippets();
    }
  }

  let dragEnd = function () {
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
      item.classList.remove('placeholder')
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