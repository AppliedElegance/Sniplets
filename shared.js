/* All shared functions. */
/* global CompressionStream, DecompressionStream */
/* eslint-disable no-unused-vars */

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
const getStorageData = (key, synced = false) => {
  let bucket = synced ? chrome.storage.sync : chrome.storage.local;
  return new Promise((resolve, reject) =>
    bucket.get(key, result =>
      chrome.runtime.lastError
      ? reject(chrome.runtime.lastError)
      : resolve(result)
    ));
}
// Example:
// await setStorageData({ [data]: [someData] }, true);
const setStorageData = (data, synced = false) => {
  let bucket = synced ? chrome.storage.sync : chrome.storage.local;
  return new Promise((resolve, reject) =>
  bucket.set(data, () =>
    chrome.runtime.lastError
    ? reject(chrome.runtime.lastError)
    : resolve()
  ));
}
// Example:
// await removeStorageData('data', true);
const removeStorageData = (key, synced = false) => {
  let bucket = synced ? chrome.storage.sync : chrome.storage.local;
  return new Promise((resolve, reject) =>
  bucket.remove(key, () =>
    chrome.runtime.lastError
    ? reject(chrome.runtime.lastError)
    : resolve()
  ));
}

// Ensure injected script errors are always caught
const injectScript = async (src) => {
  return chrome.scripting.executeScript(src)
  .catch((e) => { return Error(e); });
}

// Request permissions when necessary for cross-origin iframes
const requestFrames = async (tabID) => {
  const getFrames = () => {
    const frames = [window.location.origin + "/*"]
    // add src of all iframes on page so user only needs to request permission once
    Array.from(document.getElementsByTagName("IFRAME")).forEach((frame) => {
      if (frame.src) frames.push((new URL(frame.src).origin) + "/*");
    });
    return frames;
  };
  const origins = await injectScript({
    target: { tabId: tabID },
    func: getFrames,
  });
  // return script injection error if top level is blocked too
  if (!origins) return origins;
  // popup required to request permission
  await setStorageData({ origins: origins[0].result });
  const requestor = await chrome.windows.create({
    url: chrome.runtime.getURL("permissions.html"),
    type: "popup",
    width: 480,
    height: 300
  });
  return requestor;
}

class TreeItem {
  constructor({ name, seq, type } = {}) {
    this.name = name || "New Tree Item";
    this.seq = seq || 1;
    this.type = type || "item";
  }
}
class Folder extends TreeItem {
  constructor({ name, seq, children, color } = {}) {
    super({
      name: name || "New Folder",
      seq: seq || 1,
      type: "folder",
    });
    this.children = children || [];
    this.color = color || undefined;
  }
}
class Snippet extends TreeItem {
  constructor({ name, seq, content, color, shortcut, sourceURL } = {}) {
    super({
      name: name || "New Snippet",
      seq: seq || 1,
      type: "snippet",
    });
    this.content = content || "";
    this.color = color || undefined;
    this.shortcut = shortcut || undefined;
    this.sourceURL = sourceURL || undefined;
  }
}
// Basic snippets data bucket
class DataBucket {
  constructor({ version, timestamp, children } = {}) {
    this.version = version || "0.9";
    this.timestamp = timestamp || Date.now();
    this.children = children || [];
  }

  async compress() {
    // check if already compressed
    if (typeof this.children == 'string') {
      console.warn("Data is already in compressed form");
      return false;
    }

    // create a compression stream
    const stream = new Blob([JSON.stringify(this.children)], { type: 'application/json' })
      .stream().pipeThrough(new CompressionStream("gzip"));
    // read the compressed stream and convert to b64
    const blob = await new Response(stream).blob();
    const buffer = await blob.arrayBuffer();
    this.children = btoa(String.fromCharCode(...new Uint8Array(buffer)));
    return true;
  }

  #cast(treeItem) {
    switch (treeItem.type) {
      case "item":
        return new TreeItem(treeItem);

      case "folder":
        return new Folder(treeItem);

      case "snippet":
        return new Snippet(treeItem);

      default:
        return treeItem;
    }
  }

  #deserialize(folder) {
    for (let i in folder) {
      folder[i] = this.#cast(folder[i]);
      if (folder[i] instanceof Folder)
        folder[i].children = this.#deserialize(folder[i].children);
    }
    return folder;
  }

  async decompress() {
    // check if already compressed and just deserialize otherwise
    if (typeof this.children != 'string') {
      this.children = this.#deserialize(this.children);
      return false;
    }

    // decode base64 to gzip binary
    const binData = atob(this.children);
    const len = binData.length;
    const gzipData = new Uint8Array(new ArrayBuffer(len));
    for (let i = 0; i < len; i++) {
      gzipData[i] = binData.charCodeAt(i);
    }

    // create stream for decompression
    const stream = new Blob([gzipData], { type: "application/json" })
      .stream().pipeThrough(new DecompressionStream("gzip"));
    // read the decompressed stream
    const dataBlob = await new Response(stream).blob();
    // return decompressed and deserialized text
    this.children = this.#deserialize(JSON.parse(await dataBlob.text()));
    return true;
  }

  syncable(name) {
    const size = new Blob([JSON.stringify({ [name]: this.data })]).size;
    const maxSize = chrome.storage.sync.QUOTA_BYTES_PER_ITEM;
    console.log(size, maxSize);
    return (size <= maxSize);
  }
}

// Space object stores snippet groupings in buckets
class Space {
  // #siblings = [];

  constructor({ name, synced, data } = {}) {
    this.synced = synced || false;
    this.name = name || "Snippets";
    this.data = data || new DataBucket();
    this.path = [];
  }

  async load() {
    // make sure the space has been initialized
    // if (!this.name.length) return;

    // check for and load data if found
    const data = await getStorageData(this.name, this.synced);
    if (!data[this.name]) return;
    this.data = new DataBucket(data[this.name]);
    await this.data.decompress();

    // store copy of siblings
    // let siblings = await getStorageData('spaces', this.synced);
    // if (Array.isArray(siblings['spaces']))
    //   this.siblings = siblings['spaces'];

    return this.data;
  }

  async save() {
    // make sure the space has been initialized
    if (!this.name.length) return;

    // gzip compression adds about 8x more storage space
    const dataBucket = new DataBucket(this.data);
    await dataBucket.compress();

    // ensure synced spaces are syncable and offer to switch otherwise
    if (this.synced && !dataBucket.syncable(this.name)) {
      if (confirm("The current snippets data is too large to sync. Would you like to switch this space to local storage? If not, the last change will be rolled back.")) {
        return this.shift({ synced: false });
      }
      return false;
    }

    // store data
    await setStorageData({ [this.name]: dataBucket }, this.synced)
      .catch(function (err) { console.error(err); });
    // if (!this.siblings.includes(this.#name))
    //   this.siblings.push(this.#name);
    // setStorageData({ spaces: this.siblings }, this.#synced);
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
    // if wanting to sync, check for sync size constraints
    const dataBucket = new DataBucket(this.data);
    console.log(JSON.stringify(dataBucket));
    await dataBucket.compress();
    console.log(JSON.stringify(dataBucket));

    if (synced && !dataBucket.syncable(this.name)) {
      alert("The current snippets data is too large to sync.");
      return false;
    }
    const oldName = this.name,
        oldSynced = this.synced;
        // oldSiblings = this.siblings;
    this.name = name;
    this.synced = synced;
    let success = await this.save();
    if (success) {
      // remove old data
      removeStorageData(oldName, oldSynced);
      // if (oldSynced === synced)
      //   oldSiblings = this.siblings;
      // if (oldSiblings.includes(oldName)) {
      //   oldSiblings.splice(oldSiblings.indexOf(oldName), 1);
      //   setStorageData({ spaces: oldSiblings }, oldSynced)
      //   .catch(function (err) {
      //     console.error(err);
      //     console.error()
      //   });
      // }
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
    menuData.action = 'paste';
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
      // clone parent object to avoid polluting it
      let menuData = structuredClone(parentData);
      if (folder.length) {
        for (let i in folder) {
          menuData.path = parentData.path.concat([folder[i].seq]) ?? [folder[i].seq];
          menuItem.id = JSON.stringify(menuData);
          // using emojis for ease of parsing, nbsp needed for chrome bug
          menuItem.title = (folder[i].children
                         ? "📁 "
                         : "📝 ")
                         + folder[i].name
                         + "\xA0\xA0\xA0\xA0";
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