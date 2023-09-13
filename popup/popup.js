// selector shorthand
const $ = id => document.getElementById(id);
// const i18n = (id, subs = []) => chrome.i18n.getMessage(id, subs);
const setIcon = (action, attribute, value) =>
  document.querySelector('[data-action="' + action + '"] use').setAttribute(attribute, value);

// globals for settings and keeping track of the current folder
const settings = new Settings();
const space = new Space();
const spritesheet = "sprites.svg#";

// init
const loadPopup = async function() {
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

// escape function for displaying values
function escapeText(text) {
  let escaper = document.createElement('div');
  escaper.textContent = text.replaceAll('"', '&quot;');
  return escaper.innerHTML;
}

async function loadSnippets({ buildTree = true, buildList = true, action = null, seq = null } = {}) {

  /* update menu items to match settings */
  // Title
  $('ext-title').textContent = space.name;
  // Sync toggle icon
  setIcon('toggle-sync', 'fill', (space.synced ? "green" : "grey"));
  // View settings
  setIcon('toggle-save-path', 'href', spritesheet + (settings.view.rememberPath
    ? "control-checked"
    : "control-unchecked"));
  setIcon('toggle-show-source', 'href', spritesheet + (settings.view.sourceURL
    ? "control-checked"
    : "control-unchecked"));
  // Sort settings
  setIcon('toggle-folders-first', 'href', spritesheet + (settings.sort.foldersOnTop
    ? "control-checked"
    : "control-unchecked"));

  if (buildTree) {
    // build folder tree for pop-out window (recursive function)
    let buildFolderTree = function (folders, level) {
      // helper for tree builder
      const hasSubfolders = folder => Array.isArray(folder)
                          ? (folder.reduce((or, c) => or + (c instanceof Folder ? 1 : 0), 0) > 0)
                          : false;
      const isRoot = level.join('-') === 'root';
      return `
        <ul id="folder-${ level.join('-') }">${ (!isRoot) ? `
          <li data-seq=".5" data-path="${ level.join(',') }" class="delimiter"></li>` : `` }${
  folders.map(folder => {
    const collapsible = hasSubfolders(folder.children);
    return `
          <li class="folder" data-path="${ level.join(',') }" data-seq="${ (isRoot) ? `` : folder.seq }">
            <div class="title"${ (isRoot) ? `` : `draggable="true"` }>
              <${ collapsible ? `button type="button" data-action="collapse"` : `figure` } class="icon prefix">
                <svg role="img" focusable="false">
                  <title>Folder</title>
                  <use href="sprites.svg#icon-folder${ collapsible ? `-collapse` : `` }" fill="${ folder.label ? folder.label : `inherit` }"/>
                </svg>
              </${ collapsible ? `button` : `figure` }>
              <button type="button" class="name" data-action="open-folder" data-folder="${ (isRoot) ? `` : level.concat([folder.seq]).join(',') }">
                <h2>${ (isRoot) ? space.name : escapeText(folder.name) }</h2>
              </button>
            </div>${ collapsible ? buildFolderTree(folder.children.filter(folder => folder.children), (isRoot) ? [] : level.concat([folder.seq])) : `` }
          </li>${ (isRoot) ? `` : `
          <li data-seq="${ (folder.seq + .5) }" data-path="${ level.join(',') }" class="delimiter"></li>` }`;
  }).join(``) }
        </ul>`;
    }
    $('tree').innerHTML = buildFolderTree([space.data], ['root']);
  }

  if (buildList) {
    // pull data from current folder for displaying snippets
    let path = space.path;
    if (path.length) {
      $('folder-up').querySelector('li').dataset.path = path.slice(0, -2).join(',');
      $('folder-up').querySelector('li').dataset.seq = path.slice(-2, -1).join(',');
      $('folder-up').querySelector('button').dataset.folder = path.slice(0, -1).join(',');
      $('folder-up').style.display = "block";
    } else {
      $('folder-up').style.display = "none";
    }

    // settings
    const foldersOnTop = settings.sort.foldersOnTop;
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

    const list = space.getItem(path).children;
    if (!list.length) {
      $('snippets').innerHTML = ``;
    } else {
      let topSnippet = foldersOnTop
                     ? space.getFolderCount() + 1
                     : 1;
      let contentMarkup = item => {
        const isFolder = item instanceof Folder;
        return `<div class="title" draggable="true">
          <div class="menu">
            <button data-action="menu" data-dropdown="snipmenu${ item.seq }"><figure type="button" class="icon prefix" data-action="menu" data-dropdown="${ (isFolder ? `folder` : `snippet`) }-${ path.concat([item.seq]).join('-') }" data-seq="${item.seq}">
              <svg role="img" focusable="false">
                <title>Snippet</title>
                <use href="sprites.svg#icon-${ isFolder ? `folder` : `snippet` }" fill="${ item.label ? item.label : `inherit` }"/>
              </svg>
            </figure></button>
            <ul class="card dropdown" id="snipmenu${ item.seq }">
              <li class="menu-item submenu"><h3>Colour…</h3>
                <ul class="card" id="view">${ colors.map(color => `
                  <li class="menu-item"><button type="button" data-action="edit" data-seq="${ item.seq }" data-field="label" data-value="${ color.value }">
                    <figure class="control"><svg role="img" focusable="false">
                      <title>${ color.value }</title>
                      <use href="sprites.svg#control-${ ((color.value === item.label) || (!item.label && (color.name === "Default"))) ? `selected` : `unselected` }"/>
                    </svg></figure>
                    <h3>${ color.name }</h3>
                  </button></li>`).join(``) }
                </ul>
              </li>${ list.length > 1 ? `
              <li class="menu-item submenu"><h3>Move…</h3>
                <ul class="card" id="view">${ (isFolder ? (item.seq > 1) : (item.seq > topSnippet)) ? `
                  <li class="menu-item"><button type="button" data-action="move" data-seq="${ item.seq }" data-target="${ isFolder ? 1 : topSnippet }"><h3>To Top</h3></button></li>
                  <li class="menu-item"><button type="button" data-action="move" data-seq="${ item.seq }" data-target="${ item.seq - 1 }"><h3>Up</h3></button></li>` : `` }${ (item.seq < ((isFolder && foldersOnTop) ? topSnippet - 1 : list.length)) ? `
                  <li class="menu-item"><button type="button" data-action="move" data-seq="${ item.seq }" data-target="${ item.seq + 1 }"><h3>Down</h3></button></li>
                  <li class="menu-item"><button type="button" data-action="move" data-seq="${ item.seq }" data-target="${ (isFolder && foldersOnTop) ? topSnippet - 1 : list.length }"><h3>To Bottom</h3></button></li>` : `` }
                </ul>
              </li>` : `` }
            </ul>
          </div>
          <${ isFolder ? `button type="button" data-action="open-folder" data-folder="${ path.concat([item.seq]).join(',') }" data-seq="${item.seq}"` : `div`} class="name">
            <h2 data-seq="${ item.seq }">${ escapeText(item.name) }</h2>
          </${ isFolder ? `button` : `div` }>
          <input type="text" data-seq="${ item.seq }" data-action="edit" data-field="name" value="${item.name}">
          <button type="button" class="icon" data-action="rename" data-seq="${item.seq}">
            <svg role="img" focusable="false">
              <title>Rename</title>
              <use href="sprites.svg#icon-rename"/>
            </svg>
          </button>
          <button type="button" class="icon" data-action="delete" data-name="${ escapeText(item.name) }" data-seq="${item.seq}">
            <svg role="img" focusable="false">
              <title>Delete</title>
              <use href="sprites.svg#icon-delete"/>
            </svg>
          </button>
        </div>${isFolder ? `` : `
        <hr>
        <div class="snip-content">
          <textarea data-seq="${ item.seq }" data-action="edit" data-field="content">${ item.content.replaceAll('</textarea', '&lt;/textarea') }</textarea>
        </div>${ settings.view.sourceURL ? `
        <div class="source-url">
          <label>Source:</label>
          <input type="text" data-seq="${ item.seq }" data-action="edit" data-field="sourceURL" placeholder="unknown..." value="${ item.sourceURL }">
        </div>` : `` }`}`;
      }
      
      // build list of snippets with folders first if set
      $('snippets').innerHTML = `
          <div class="sizer"></div>${ (foldersOnTop && (list.reduce((or, c) => or + (c instanceof Folder ? 1 : 0), 0) > 0)) ? `
    
          <div class="card">
            <ul id="folder-list">
              <li data-seq=".5" data-path="${ path.join(',') }" class="delimiter">${list.map(item => item instanceof Folder ? `</li>
              <li class="folder" data-seq="${item.seq}" data-path="${ path.join(',') }">
                ${ contentMarkup(item) }
              </li>
              <li data-seq="${ (item.seq + .5) }" data-path="${ path.join(',') }"` : null).filter(x => x ? true : false).join(` class="separator"><hr>`) } class="delimiter"></li>
            </ul>
          </div>
    
          <hr>` : ``}
    
          <ul id="snippet-list">${list.map(item => { 
            const isFolder = item instanceof Folder;
            return (isFolder && foldersOnTop) ? null : `${ isFolder ? `
            <li data-seq="${ item.seq - .5 }" data-path="${ path.join(',') }" class="delimiter">` : `` }
            <li class="${isFolder ? `folder` : `snippet`}" data-seq="${item.seq}" data-path="${ path.join(',') }">
              <div class="card" data-seq="${item.seq}">
                ${ contentMarkup(item) }
              </div>
            </li>${ isFolder ? `
            <li data-seq="${ item.seq + .5 }" data-path="${ path.join(',') }" class="delimiter">` : `` }` }).filter(x => x ? true : false).join(``)}
          </ul>
    `;
      for (let textarea of $('snippets').getElementsByTagName('textarea'))
        adjustTextArea(textarea, 160);
    }
  }

  // check for requested actions
  switch (action) {
  case 'edit': {
    let editArea = $('snippets').querySelector('textarea[data-seq="' + parseInt(seq) + '"]');
    if (editArea) {
      editArea.focus();
      editArea.selectionStart = editArea.selectionEnd = editArea.value.length;
    }
    break;
  }
  case 'rename': {
    let renameButton = $('snippets').querySelector('button[data-action="rename"][data-seq="' + parseInt(seq) + '"]');
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
  let setCurrentSpace = async function () {
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
    if (params.folder.length) {
      url.searchParams.set('folderPath', params.folder);
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
    if (params.folder.length) {
      space.path.push(...params.folder.split(','));
    }
    setCurrentSpace();
    loadSnippets();
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

  case 'toggle-sync': {
    if (await space.shift({ synced: !space.synced })) {
      // update current/default spaces if necessary
      if (settings.defaultSpace.name === space.name) {
        settings.defaultSpace.synced = space.synced;
        settings.save();
      }
    }
    setCurrentSpace();
    loadSnippets({ buildTree: false, buildList: false });
    break; }

  case 'toggle-save-path': {
    settings.view.rememberPath = !settings.view.rememberPath;
    settings.save();
    setCurrentSpace();
    loadSnippets({ buildTree: false, buildList: false });
    break; }

  case 'toggle-show-source': {
    settings.view.sourceURL = !settings.view.sourceURL;
    settings.save();
    loadSnippets({ buildTree: false });
    break; }
  
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
  
  case 'delete': {
    if(confirm("You’re about to delete “" + params.name + "”… Please confirm.")) {
      space.deleteItem(params.seq);
      space.save();
      loadSnippets();
    }
    break; }
  
  case 'rename': {
    // swap display and input elements so name can be updated
    pq('.title').draggable = false;
    pq('.name').style.display = 'none';
    pq('input').style.display = 'block';
    pq('input').focus();
    pq('input').select();
    break; }

  case 'edit': {
    space.editItem({
      seq: params.seq,
      field: params.field,
      value: params.value,
    })
    space.save();
    loadSnippets();
    break; }

  case 'move': {
    space.moveItem({
      fromSeq: params.seq,
      toSeq: params.target,
    })
    space.save();
    loadSnippets();
    break; }
  
  case 'pop-out': {
    chrome.windows.create({
      url: chrome.runtime.getURL("popup/popup.html"),
      type: "popup",
      width: 867,
      height: 540
    });
    window.close();
    break; }
  
  case 'collapse': {
    pq('ul').style.display = 'none';
    target.getElementsByTagName('use')[0].href = 'sprites.svg#icon-folder-expand';
    target.dataset.action = 'expand';
    break; }
  
  case 'expand': {
    pq('ul').style.removeProperty('display');
    target.getElementsByTagName('use')[0].href = 'sprites.svg#icon-folder-collapse';
    target.dataset.action = 'collapse';
    break; }
  
  case 'toggle-folders-first': {
    // swap folders first or not
    settings.sort.foldersOnTop = !settings.sort.foldersOnTop;
    settings.save();
    if (settings.sort.foldersOnTop)
      space.sort(settings.sort);
    space.save();
    loadSnippets();
    break; }
  
  default: {
    alert("Sorry, that button doesn't do anything yet");
    break; }
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

// drag and drop reordering of snippets so they can be put in folders
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
  const dropClasses = ['folder-highlight', 'move-above', 'move-below'];

  // wait for browser to pick up the item with a nice outline before hiding anything
  setTimeout(() => {
    // turned picked up item into a placeholder
    for (let child of item.children) {
      child.style.display = 'none';
    }
    item.classList.add('placeholder');

    // remove textarea elements and hrs to facilitate reordering snippets
    for (let element of list.getElementsByClassName('snip-content'))
      element.style.display = "none";
    for (let element of list.getElementsByTagName('HR'))
      element.style.display = "none";

    // enable drop targets around folders
    for (let element of list.getElementsByClassName('delimiter'))
      element.style.display = 'block';
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
        if (target.classList.contains('folder')) {
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