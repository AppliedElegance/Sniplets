/* All shared functions. */
/* eslint-disable no-unused-vars */

// Object classes for storing snippets in folders
class Space {
  constructor({
    name = '',
    synced = false,
    data = {
      version: "0.9",
      timestamp: Date.now(),
      children: [],
    },
  } = {}) {
    this.name = name;
    this.synced = synced;
    this.data = data;
    this.path = [];
    this.siblings = [];
  }

  async load() {
    if (!this.name.length) {
      console.error("Tried to load an unnamed space.");
      return;
    }
    let data = await getStorageData(this.name, this.synced);
    if (!data[this.name])
      return;
    this.data = data[this.name];
    let siblings = await getStorageData('spaces', this.synced);
    if (Array.isArray(siblings['spaces']))
      this.siblings = siblings['spaces'];
    return this.data;
  }

  async save() {
    if (!this.name.length) {
      console.error("Tried to save an unnamed space.");
      return;
    }
    try {
      if (this.synced) {
        // check for sync size constraints, max 8192 per item, 102400 total
        if (new Blob([JSON.stringify(this.data)]).size > 8192) {
          if (confirm("The current snippets data is too large to sync. The save will fail unless switched to local storage. Please confirm you would like to switch.")) {
            return this.shift({ synced: false });
          }
          console.error("The current snippets data is too large to sync.");
          return false;
        }
      }
      setStorageData({ [this.name]: this.data }, this.synced);
      if (!this.siblings.includes(this.name))
        this.siblings.push(this.name);
      setStorageData({ spaces: this.siblings }, this.synced);
    } catch (e) {
      console.error("Something broke and the data failed to save.", e);
      return false;
    }
    return true;
  }

  getItem(path) {
    try {
      let item = this.data;
      for (let y of path) {
        for (let x of item.children) {
          if (x.seq == y) {
            item = x;
            break;
          }
        }
      }
      return item;
    } catch (e) {
      console.error("The path requested does not exist.", path, e);
      return;
    }
  }

  getFolderCount(folderPath = this.path) {
    let folder = this.getItem(folderPath);
    return folder.children.filter(item => item.children).length;
  }

  addItem(item, folderPath = this.path) {
    let folder = this.getItem(folderPath).children;
    item.seq = folder.length + 1;
    folder.push(item);
    return item;
  }

  editItem({ seq, field, value, folderPath = this.path }) {
    let item = this.getItem(folderPath.concat([seq]));
    item[field] = value;
    return item;
  }

  deleteItem(seq, folderPath = this.path) {
    let folder = this.getItem(folderPath).children;
    let item = this.getItem(folderPath.concat([seq]));
    folder.splice(folder.indexOf(item), 1);
    return folder;
  }

  moveItem({ fromPath = this.path, fromSeq, toPath = this.path, toSeq }) {
    let fromFolder = this.getItem(fromPath);
    let fromItem = this.getItem(fromPath.concat([fromSeq]));
    fromSeq = fromFolder.children.indexOf(fromItem);
    let toFolder = this.getItem(toPath);
    if (toSeq) {
      let toItem = this.getItem(toPath.concat([toSeq]));
      toSeq = toFolder.children.indexOf(toItem);
      // if (toSeq > fromSeq) toSeq++;
    } else {
      toSeq = toFolder.children.length;
    }
    try {
      toFolder.children.splice(toSeq, 0,
        fromFolder.children.splice(fromSeq, 1)[0]);
      this.sequence(toFolder);
      if(JSON.stringify(fromPath) !== JSON.stringify(toPath))
        this.sequence(fromFolder);
    } catch (error) {
      console.error(error);
    }
    return fromItem;
  }

  sort({ by = 'seq', foldersOnTop = true, reverse = false, folderPath = ['all'], } = {}) {
    // recursive function in case everything needs to be sorted
    let sortFolder = (data, recursive, by, foldersOnTop, reverse) => {
      if (!data.children || !data.children.length)
        return;
      data.children.sort((a, b) => {
        let result = a[by] > b[by];
        if (foldersOnTop)
          result = a.children
                 ? (b.children ? result : false)
                 : (b.children ? true : result);
        if (reverse)
          result = !result;
        return result ? 1 : -1;
      });
      this.sequence(data);
      if (recursive) {
        for (let child of data.children) {
          if (child.children && child.children.length)
            sortFolder(child, recursive, by, foldersOnTop, reverse);
        }
      }
    }
    if (folderPath[0] === 'all') {
      sortFolder(this.data, true, by, foldersOnTop, reverse);
    } else {
      sortFolder(this.getItem(folderPath), false, by, foldersOnTop, reverse)
    }
    return this;
  }

  sequence(folder) {
    if (folder.children) {
      let i = folder.children.length;
      while (i--) {
        folder.children[i].seq = i + 1;
      }
    }
    return this;
  }

  async shift({ name = this.name, synced = this.synced }) {
    // if wanting to sync, check for sync size constraints, max 8192 per item, 102400 total
    if (synced && (new Blob([JSON.stringify(this.data)]).size > 8192)) {
      alert("The current snippets data is too large to sync.");
      return false;
    }
    let oldName = this.name,
        oldSynced = this.synced,
        oldSiblings = this.siblings;
    this.name = name;
    this.synced = synced;
    let success = await this.save();
    if (success) {
      // remove old data
      removeStorageData(oldName, oldSynced);
      if (oldSynced === synced)
        oldSiblings = this.siblings;
      if (oldSiblings.includes(oldName)) {
        oldSiblings.splice(oldSiblings.indexOf(oldName), 1);
        setStorageData({ spaces: oldSiblings }, oldSynced);
      }
    }
    return success;
  }

  pivot({ name, synced, data = null, path = null, }) {
    this.name = name;
    this.synced = synced;
    if (data) this.data = data;
    if (path) this.path = path;
  }
}
class TreeItem {
  constructor(name = "", seq = 1, type = "", color = "") {
    this.name = name;
    this.seq = seq;
    this.type = type;
    this.color = color;
  }
}
class Folder extends TreeItem {
  constructor({ name = "New Folder", seq = 1, color = "", children = [] } = {}) {
    super(name, seq, 'folder', color);
    this.children = children;
  }
}
class Snippet extends TreeItem {
  constructor({ name = "New Snippet", seq = 1, color = "", content = "", shortcut = "", sourceURL = "" } = {}) {
    super(name, seq, 'snippet', color);
    this.content = content;
    this.shortcut = shortcut;
    this.sourceURL = sourceURL;
  }
}
class Settings {
  constructor() {
    this.init();
  }

  init({
    defaultSpace = { name: "Snippets", synced: false },
    view = {
      rememberPath: false,
      sourceURL: false,
    },
    sort = {
      by: 'seq',
      foldersOnTop: true,
    },
    control = {
      saveSource: true,
    },
  } = {}) {
    this.defaultSpace = defaultSpace;
    this.sort = sort;
    this.view = view;
    this.control = control;
  }

  async load() {
    let { settings } = await getStorageData('settings', true);
    if (settings) {
      // legacy checks
      if (settings.foldersOnTop) {
        settings.sort = { foldersOnTop: settings.foldersOnTop };
        delete settings.foldersOnTop;
      }
      this.init(settings);
    }
  }

  async save() {
    setStorageData({ settings: this }, true);
  }
}

// Storage helpers. Sync must be explicitly enabled.
/**
 * Safely retrieves storage data from chrome.storage.local (default) or .sync.
 * @function getStorageData
 * @param {String} key - The key name for the stored data.
 * @param {Boolean} synced - Whether to look in sync (true) or local (false).
 * @returns {Promise} Stored data is returned as a { key: data } object.
 * @example
 * // returns { data: storedData } from local
 * await getStorageData('data');
 * @example
 * // returns storedData from sync
 * const { data } = await getStorageData('data', true);
 */
const getStorageData = (key, synced = false) =>
  synced
  ? new Promise((resolve, reject) =>
    chrome.storage.sync.get(key, result =>
      chrome.runtime.lastError
        ? reject(Error(chrome.runtime.lastError.message))
        : resolve(result)
    ))
  : new Promise((resolve, reject) =>
    chrome.storage.local.get(key, result =>
      chrome.runtime.lastError
        ? reject(Error(chrome.runtime.lastError.message))
        : resolve(result)
    ));
// Example:
// await setStorageData({ data: [someData] }, true);
const setStorageData = (data, synced = false) =>
  synced
  ? new Promise((resolve, reject) =>
    chrome.storage.sync.set(data, () =>
      chrome.runtime.lastError
        ? reject(Error(chrome.runtime.lastError.message))
        : resolve()
    ))
  : new Promise((resolve, reject) =>
    chrome.storage.local.set(data, () =>
      chrome.runtime.lastError
        ? reject(Error(chrome.runtime.lastError.message))
        : resolve()
    ));
// Example:
// await removeStorageData('data', true);
const removeStorageData = (key, synced = false) =>
  synced
  ? new Promise((resolve, reject) =>
    chrome.storage.sync.get(key, result =>
      chrome.runtime.lastError
        ? reject(Error(chrome.runtime.lastError.message))
        : resolve(result)
    ))
  : new Promise((resolve, reject) =>
    chrome.storage.local.get(key, result =>
      chrome.runtime.lastError
        ? reject(Error(chrome.runtime.lastError.message))
        : resolve(result)
    ));

// create backup file
function saveToFile(filename, text) {
  // create URI encoded file link
  let fileAnchor = document.createElement('a');
  fileAnchor.href = 'data:text/plain;charset=utf-8,' + encodeURIComponent(text);
  fileAnchor.download = filename;
  fileAnchor.style.display = 'none';

  // initiate download
  document.body.appendChild(fileAnchor);
  fileAnchor.click();

  // clean up
  fileAnchor.remove();
}

// (re)build context menu for snipping and pasting
async function buildContextMenus(space) {
  // clear current
  await chrome.contextMenus.removeAll();
  let menuData = {
    space: {
      name: space.name,
      synced: space.synced,
    },
    action: 'snip',
  };

  // create snipper for selected text
  chrome.contextMenus.create({
    "id": JSON.stringify(menuData),
    "title": "Snip selection...",
    "contexts": ["selection"],
  });

  // build paster for saved snippets
  if (space.data) {
    // set root menu item
    menuData.path = [];
    delete menuData.action;
    chrome.contextMenus.create({
      "id": JSON.stringify(menuData),
      "title": "Paste Snippet",
      "contexts": ["editable"],
    });
    // recursive function for snippet tree
    let buildFolder = function(folder, parentData) {
      let menuItem = {
        "contexts": ["editable"],
        "parentId": JSON.stringify(parentData),
      };
      let menuData = JSON.parse(JSON.stringify(parentData));
      menuData.action = 'paste';
      if (folder.length) {
        for (let i = 0; i < folder.length; i++) {
          menuData.path = parentData.path.concat([folder[i].seq]) ?? [folder[i].seq];
          menuItem.id = JSON.stringify(menuData);
          menuItem.title = (folder[i].children
                         ? "📁 "
                         : "📝 ")
                         + folder[i].name;
          chrome.contextMenus.create(menuItem);
          if (folder[i].children)
            buildFolder(folder[i].children, menuData);
        }
      } else {
        menuData.path = parentData.path.concat(['empty']);
        menuItem.id = JSON.stringify(menuData);
        menuItem.title = "Empty…";
        menuItem.enabled = false;
        chrome.contextMenus.create(menuItem);
      }
    }
    // build paste snippet menu tree
    if (space.data.children)
      buildFolder(space.data.children, menuData);
  }
}