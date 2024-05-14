/* eslint-disable no-unused-vars */

/**
 * chrome.i18n helper to pull strings from _locales/[locale]/messages.json
 * @param {string} messageName 
 * @param {string|string[]} substitutions
 * @example
 * // returns "Sniplets"
 * i18n("app_name")
 */
const i18n = (messageName, substitutions) => chrome.i18n.getMessage(messageName, substitutions);
/** @type {string} */
const uiLocale = i18n('@@ui_locale').replace('_', '-');
const i18nNum = (i, options = {useGrouping: false}) =>
  new Intl.NumberFormat(uiLocale, options).format(i);
const i18nOrd = (i) =>
  i18n(`ordinal_${new Intl.PluralRules(uiLocale).select(i)}`, i);

const colors = new Map()
.set('default', {value: "inherit", label: i18n('color_default'), square: "\u2B1B\uFE0F", circle: "\u26AB\uFE0F", heart: "🖤",                       folder: "📁",                       snippet: "📝"})
.set('red',     {value: "#D0312D", label: i18n('color_red'),     square: "🟥",           circle: "🔴",           heart: "\u2764\uFE0F", book: "📕", get folder() {return this.book;},   get snippet() {return this.circle;}})
.set('orange',  {value: "#FFA500", label: i18n('color_orange'),  square: "🟧",           circle: "🟠",           heart: "🧡",           book: "📙", get folder() {return this.book;},   get snippet() {return this.circle;}})
.set('yellow',  {value: "#FFD700", label: i18n('color_yellow'),  square: "🟨",           circle: "🟡",           heart: "💛",           book: "📒", get folder() {return this.book;},   get snippet() {return this.circle;}})
.set('green',   {value: "#3CB043", label: i18n('color_green'),   square: "🟩",           circle: "🟢",           heart: "💚",           book: "📗", get folder() {return this.book;},   get snippet() {return this.circle;}})
.set('blue',    {value: "#3457D5", label: i18n('color_blue'),    square: "🟦",           circle: "🔵",           heart: "💙",           book: "📘", get folder() {return this.book;},   get snippet() {return this.circle;}})
.set('purple',  {value: "#A32CC4", label: i18n('color_purple'),  square: "🟪",           circle: "🟣",           heart: "💜",                       get folder() {return this.square;}, get snippet() {return this.circle;}})
.set('gray',    {value: "#808080", label: i18n('color_gray'),    square: "\u2B1C\uFE0F", circle: "\u26AA\uFE0F", heart: "🤍",           book: "📓", get folder() {return this.book;},   get snippet() {return this.circle;}});
/** Safe getter for the colors that will return a default value if not available
 * @param {string} [color] 
 * @returns {{value:string,label:string,square:string,circle:string,heart:string,book?:string,folder:string,snippet:string}}
 */
const getColor = color => colors.get(colors.has(color) ? color : 'default');
// legacy colorMap for upgrading to newest version (these values are deprecated but may be in backup files)
const legacyColors = new Map().set('Red','red').set('Orange','orange').set('Yellow','yellow')
.set('Green','green').set('Blue','blue').set('Purple','purple').set('Grey','gray');

/** Open a new popup window
 * @param {{[name:string]:string}} params
 */
function openPopup(params = {}) {
  const src = new URL(chrome.runtime.getURL("popup/main.html"));
  // console.log(src.href, params);
  for (const [name, value] of Object.entries(params)) {
    src.searchParams.append(name, value);
  }
  // console.log(src);
  return chrome.windows.create({
    url: src.href,
    type: "popup",
    width: 700, // 867 for screenshots
    height: 460, // 540 for screenshots
  }).then(() => true)
  .catch((e) => (console.warn(e), false));
}

/** Open a new window for editing a snippet
 * @param {number[]} path
 * @param {number} seq
 */
const openForEditing = (path, seq) => openPopup({
  action: 'focus',
  path: path.join('-'),
  seq: seq,
  field: 'name',
});

// Storage helpers. Sync must be explicitly enabled.
/**
 * Safely stores data to chrome.storage.local (default) or .sync.
 * @param {{[key:string]:*}} items - a {key: value} object to store
 * @param {boolean} [synced=false] - Whether to store the data in local (false, default) or sync (true).
 */
function setStorageData(items, synced = false) {
  const bucket = synced ? chrome.storage.sync : chrome.storage.local;
  return bucket.set(items)
  .then(() => true)
  .catch((e) => (console.warn(e), false));
}
/**
 * Safely retrieves storage data from chrome.storage.local (default) or .sync.
 * @param {null|string|string[]|{[key:string]:*}} keys - The key name for the stored data.
 * @param {boolean} [synced=false] - Whether to look in local (false, default) or sync (true).
 */
function getStorageData(keys, synced = false) {
  const bucket = synced ? chrome.storage.sync : chrome.storage.local;
  return bucket.get(keys)
  .catch((e) => (console.warn(e), {}));
}
/** Safely removes storage data from chrome.storage.local (default) or .sync.
 * @param {string|string[]} keys - The key name for the stored data.
 * @param {boolean} [synced=false] - Whether to look in local (false, default) or sync (true).
 */
function removeStorageData(keys, synced = false) {
  const bucket = synced ? chrome.storage.sync : chrome.storage.local;
  return bucket.remove(keys)
  .then(() => true)
  .catch((e) => (console.warn(e), false));
}

/** Get details of saved current space */
const getCurrentSpace = () => getStorageData('currentSpace')?.currentSpace;

/** Stores data required for following up on a task and opens a window to action it
 * @param {string} type Action which needs handling in a popup window
 * @param {{[key:string]:*}} args Properties needed by the followup function
 * @param {boolean} [popup=true] Open in the popup rather than a new window
 */
async function setFollowup(type, args, popup = true) {
  await chrome.storage.session.set({ followup: {
    type: type,
    args: args || {}, // default value for destructuring
  }}).catch((e) => console.warn(e));
  chrome.runtime.sendMessage({
    type: 'followup',
  }).catch((e) => {
    // likely no open windows
    console.warn(e);
    if (popup && chrome.action.openPopup) {
      // only available in dev/canary when there's an active window
      chrome.action.openPopup().catch((e) => {
        console.warn(e);
        openPopup();
      });
    } else {
      openPopup();
    }
  });
  return;
}
/** Fetch requests from session storage set using the `setFollowup()` function
 * @returns {Promise<{type:string,message:*,args:Object}|void>}
 */
async function fetchFollowup() {
  const {followup} = await chrome.storage.session.get('followup')
  .catch(e => console.warn(e));
  if (followup) chrome.storage.session.remove('followup')
  .catch(e => console.warn(e));
  // console.log(followup);
  return followup;
}

/**
 * Send text to clipboard
 * @param {{content:string,nosubst:boolean}} snip 
 */
async function setClipboard(snip) {
  if(!snip.content) return;
  const items = {
    "text/plain":  new Blob([snip.content], {type: "text/plain"}),
  };
  if (!snip.nosubst) items["text/html"] = new Blob([await getRichText(snip)], {type: "text/html"});
  // console.log(`Copying to clipboard...`);
  return navigator.clipboard.write([new ClipboardItem(items)])
  .then(() => true)
  .catch((e) => console.warn(e));
}

// RichText processors
/**
 * Remove newlines and add HTML line break tags where appropriate
 * 
 * * (?<!<\/(?!a|span|strong|em|b|i|q|mark|input|button)[a-zA-Z0-9]+?>\s*?) - don't match if non-inline ending tags are found just before a newline
 * * (?:\r\n|\n) - match newlines on Windows/non-Windows
 * 
 * @param {string} text
 */
const tagNewlines = text => text.replaceAll(
  /(?<!<\/(?!a|span|strong|em|b|i|q|mark|input|button)[a-zA-Z0-9]+?>\s*?)(?:\r\n|\n)/g,
  (match) => `<br>`,
).replaceAll(
  /(?:\r\n|\r|\n)/g,
  ``,
);
/**
 * Place anchor tags around emails if not already linked
 * 
 * * (?<!<[^>]*) - ignore emails inside tag defs
 * * (?:[a-zA-Z0-9!#$%&'*+\-/=?^_`{|}~] - allowable starting characters
 * * [a-zA-Z0-9!#$%&'*+\-/=?^_`{|}~.]* - allowable characters
 * * [a-zA-Z0-9!#$%&'*+\-/=?^_`{|}~] - allowable ending characters
 * * |[a-zA-Z0-9!#$%&'*+\-/=?^_`{|}~]) - allowable single character
 * * @ - defining email character
 * * (?:(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]+) - domain
 * * (?!(?!<a).*?<\/a>) - ignore emails that are inside an anchor tag
 * 
 * @param {string} text
 */
const linkEmails = text => text.replaceAll(
  /(?<!<[^>]*)(?:[a-zA-Z0-9!#$%&'*+\-/=?^_`{|}~][a-zA-Z0-9!#$%&'*+\-/=?^_`{|}~.]*[a-zA-Z0-9!#$%&'*+\-/=?^_`{|}~]|[a-zA-Z0-9!#$%&'*+\-/=?^_`{|}~])@(?:(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]+)(?!(?!<a).*?<\/a>)/ig,
  (match) => `<a href="mailto:${match}">${match}</a>`,
);
/**
 * Place anchor tags around urls if not already linked
 * 
 * * <a.+?\/a>| - ignore anchor tags
 * * <[^>]*?>| - ignore anything within tags
 * * ( - start url capture
 * * (?<![.+@a-zA-Z0-9]) - ignore emails and random text
 * * (?:(https?|ftp|chrome|edge|about|file):\/+)? - capture protocols if available
 * * (?: - start domain lookup
 * * (?:[a-zA-Z0-9-]+\.)+[a-zA-Z]+| - find url sequences
 * * (?:[0-9]+\.){3}[0-9]+ - find ipv4 addresses (ipv6 is too complicated for a single line regex)
 * * ) - end domain lookup
 * * (?::[0-9]+)? - include port numbers
 * * (?:\/(?:[a-zA-Z0-9!$&'()*+,-./:;=?@_~#]|%\d{2})*)? - include all allowed url characters after domain
 * * ) - end url capture
 * 
 * @param {string} text
 */
const linkURLs = text => text.replaceAll(
  /<a.+?\/a>|<[^>]*?>|((?<![.+@a-zA-Z0-9])(?:(https?|ftp|chrome|edge|about|file):\/+)?(?:(?:[a-zA-Z0-9]+\.)+[a-z]+|(?:[0-9]+\.){3}[0-9]+)(?::[0-9]+)?(?:\/(?:[a-zA-Z0-9!$&'()*+,-./:;=?@_~#]|%\d{2})*)?)/gi,
  (match, p1, p2) => {
    // console.log(match, p1, p2);
    // skip anchors and tag attributes
    if (!p1) return match;
    // skip IP addresses with no protocol
    if (match.match(/^\d+\.\d+\.\d+\.\d+$/)) return match;
    // ensure what was picked up evaluates to a proper url (just in case)
    const matchURL = new URL(((!p2) ? `http://${match}` : match));
    // console.log(matchURL);
    return (matchURL) ? `<a href="${matchURL.href}">${match}</a>` : match;
  },
);

/** Process and return snip contents according to rich text settings
 * @param {{content:string,nosubst:boolean}} snip 
 */
const getRichText = async (snip) => {
  // don't process flagged snippets
  if (snip.nosubst) return snip.content;
  // work on string copy
  let text = snip.content;
  // check what processing has been enabled
  const settings = new Settings();
  await settings.load();
  const {rtLineBreaks, rtLinkEmails, rtLinkURLs} = settings.control;
  // process according to settings
  if (rtLineBreaks) text = tagNewlines(text);
  if (rtLinkEmails) text = linkEmails(text);
  if (rtLinkURLs) text = linkURLs(text);
  return text;
};

/**
 * Settings object for persisting as window global
 */
class Settings {
  /**
   * @param {Settings} settings 
   */
  constructor(settings) {
    if (settings) this.init(settings);
  }

  /**
   * Take provided settings and initialize the remaining settings
   * @param {Settings} settings 
   */
  init({defaultSpace, sort, view, control, data} = {}) {
    // console.log(defaultSpace, sort, view, control, data);
    const setDefaultSpace = ({name = i18n('default_space_name'), synced = true} = {}) => ({
      name: name,
      synced: synced,
    });
    this.defaultSpace = setDefaultSpace(defaultSpace);
    const setSort = ({by = 'seq', groupBy = '', foldersOnTop = true} = {}) => ({
      by: by,
      groupBy: groupBy,
      foldersOnTop: foldersOnTop,
    });
    this.sort = setSort(sort);
    const setView = ({adjustTextArea = true, sourceURL = false, rememberPath = false} = {}) => ({
      adjustTextArea: adjustTextArea,
      sourceURL: sourceURL,
      rememberPath: rememberPath,
    });
    this.view = setView(view);
    const setControl = ({saveSource = false, preserveTags = false, rtLineBreaks = true, rtLinkEmails = true, rtLinkURLs = true} = {}) => ({
      saveSource: saveSource,
      preserveTags: preserveTags,
      rtLineBreaks: rtLineBreaks,
      rtLinkEmails: rtLinkEmails,
      rtLinkURLs: rtLinkURLs,
    });
    this.control = setControl(control);
    const setData = ({compress = true} = {}) => ({
      compress: compress,
    });
    this.data = setData(data);
  }

  async load() {
    const {settings} = await getStorageData('settings', true);
    if (!settings) return settings; // return errors as-is

    // legacy check
    if (settings.foldersOnTop) {
      settings.sort = {foldersOnTop: settings.foldersOnTop};
      delete settings.foldersOnTop;
    }

    // upgrade settings object as needed and return the object
    this.init(settings);
    return this;
  }

  async save() {
    setStorageData({settings: this}, true);
  }
}

/** Base constructor for folders, snippets and any future items */
class TreeItem {
  constructor({name = i18n('title_new_generic'), seq, color} = {}) {
    /** @type {string} */
    this.name = name;
    /** @type {number} */
    this.seq = seq;
    /** @type {string} */
    this.color = legacyColors.get(color) || color; // legacy color mapping check
  }
}
/** Folders contain tree items and can be nested. */
class Folder extends TreeItem {
  constructor({name = i18n('title_new_folder'), seq, children, color, label} = {}) {
    super({
      name: name,
      seq: seq,
      color: color || label, // clippings uses the label field
    });
    /** @type {(TreeItem|Folder|Snippet)[]} */
    this.children = children || [];
  }
}
/** Snippets are basic text blocks that can be pasted */
class Snippet extends TreeItem {
  constructor({name, seq, color, label, shortcut, sourceURL, content = "", nosubst = false} = {}) {
    // generate name from content if provided
    if (!name && content) {
      // create snippet title from first line of text
      name = content.match(/^.+/)[0];
      const maxLength = 27;
      if (content.length > maxLength) {
        // cut down to size, then chuck trailing text if possible so no words are cut off
        name = name.slice(0, maxLength + 1);
        name = `${name.includes(' ')
             ? name.slice(0, name.lastIndexOf(' '))
             : name.slice(0, maxLength)}…`;
      }
    }
    super({
      name: name || i18n('title_new_snippet'),
      seq: seq || 1,
      color: color || label,
    });
    /** @type {string} */
    this.content = content;
    /** @type {boolean} */
    this.nosubst = nosubst;
    /** @type {string} */
    this.shortcut = shortcut;
    /** @type {string} */
    this.sourceURL = sourceURL;
  }
}
/** Basic snippets data bucket */
class DataBucket {
  /**
   * @param {{version:string,children:(TreeItem|Folder|Snippet)[]|string,counters:number}} values 
   */
  constructor({version = "1.0", children = [], counters = {}} = {}) {
    /** @type {string} */
    this.version = version;
    /** @type {number} */
    this.timestamp = Date.now();
    /** @type {(TreeItem|Folder|Snippet)[]|string} */
    this.children = children;
    const {startVal, ...cs} = counters;
    /** @type {{[name:string]:number}} */
    this.counters = cs || {};
    this.counters.startVal = +startVal || 0;
  }

  /** Compress root folder (children) using browser gzip compression */
  async compress() {
    // check if already compressed
    if (typeof this.children === 'string') {
      // TODO: confirm the compressed string is valid
      // console.warn("Data is already in compressed form");
      return false;
    }

    // create a compression stream
    const stream = new Blob([JSON.stringify(this.children)], {type: 'application/json'})
      .stream().pipeThrough(new CompressionStream("gzip"));
    // read the compressed stream and convert to b64
    const blob = await new Response(stream).blob();
    const buffer = await blob.arrayBuffer();
    this.children = btoa(String.fromCharCode(...new Uint8Array(buffer)));
    return true;
  }

  #cast(item) {
    if (Object.hasOwn(item, "children")) {
      return new Folder(item);
    } else if (Object.hasOwn(item, "content")) {
      return new Snippet(item);
    }
    return item;
  }

  restructure(folder = this.children) {
    // console.log(folder);
    const items = [];
    folder.forEach((item) => {
      // console.log(item);
      if (Object.hasOwn(item, "children")) {
        item.children = this.restructure(item.children);
      }
      items.push(this.#cast(item));
    });
    // console.log(items);
    return items;
  }

  /**
   * Decompress root folder (children) and cast objects as their appropriate TreeItem
   */
  async parse() {
    // check if already compressed and otherwise just cast contents appropriately
    if (typeof this.children !== 'string') {
      this.children = this.restructure();
      return this;
    }

    // decode base64 to gzip binary
    const binData = atob(this.children);
    const len = binData.length;
    const gzipData = new Uint8Array(new ArrayBuffer(len));
    for (let i = 0; i < len; i++) {
      gzipData[i] = binData.charCodeAt(i);
    }

    // create stream for decompression
    const stream = new Blob([gzipData], {type: "application/json"})
      .stream().pipeThrough(new DecompressionStream("gzip"));
    // read the decompressed stream
    const dataBlob = await new Response(stream).blob();
    // return decompressed and deserialized text
    // console.log(dataBlob);
    this.children = this.restructure(JSON.parse(await dataBlob.text()));
    return this;
  }

  /**
   * Check if the data is small enough to fit in a sync storage bucket with the given key name.
   * @param {string} name Key that will be used for retrieving the data (factored into the browser's storage limits)
   * @returns 
   */
  syncable(name) {
    const {size} = new Blob([JSON.stringify({[name]: this.data})]);
    const maxSize = chrome.storage.sync.QUOTA_BYTES_PER_ITEM;
    return (size <= maxSize);
  }

  /** process data into a clippings compatible object */
  toClippings() {
    /** @param {(TreeItem|Folder|Snippet)[]} folder */
    const mapData = (folder) => folder.map(o =>
    o instanceof Folder ? {
      name: o.name || "",
      children: mapData(o.children) || [],
      seq: o.seq - 1,
    }
    : {
      name: o.name || "",
      content: o.content || "",
      shortcutKey: o.shortcutKey || "",
      sourceURL: o.sourceURL || "",
      label: o.color,
      seq: o.seq - 1,
    });
    return {
      version: "6.1",
      createdBy: "Clippings/wx",
      userClippingsRoot: mapData(this.children),
    };
  }

  removeSources(folder = this.children) {
    for (const item of folder) {
      if (item.children?.length) {
        this.removeSources(item.children);
      } else {
        item.sourceURL = undefined;
      }
    }
  }
}

/**
 * Space object stores snippet groupings in buckets.
 */
class Space {
  /**
   * @param {{
   *   name: string
   *   synced: boolean
   *   data: DataBucket
   *   path: number[]|string
   * }} details
   */
  constructor({name = i18n('default_space_name'), synced = false, data = new DataBucket(), path = []} = {}) {
    this.name = name;
    this.synced = synced;
    this.data = data;
    this.path = path;
  }

  /** Set this space as the current space in the local browser
   * @param {boolean} rememberPath 
   */
  async setAsCurrent(rememberPath) {
    /** @type {{name:string,synced:boolean,path?:number[]}} */
    const currentSpace = {
      name: this.name,
      synced: this.synced,
    };
    // save path as well if requested
    if (rememberPath) currentSpace.path = this.path;
    setStorageData({currentSpace: currentSpace});
    return currentSpace;
  }

  /** load last used space or fall back to default */
  async loadCurrent() {
    const currentSpace = await getCurrentSpace();
    if (!(await this.load(currentSpace))) {
      const settings = new Settings();
      await settings.load();
      if (await this.load(settings.defaultSpace)) {
        this.setAsCurrent();
        return true;
      } else {
        // should never happen unless memory is corrupt
        return;
      }
    }
    return true;
  }

  async save() {
    // make sure the space has been initialized
    if (!this.name?.length) return;

    const dataBucket = new DataBucket(this.data);
    // gzip compression adds about 8x more storage space, but can be toggled
    const settings = new Settings();
    await settings.load();
    if (settings.data.compress) await dataBucket.compress();

    // ensure synced spaces are syncable
    if (this.synced && !dataBucket.syncable(this.name)) return false;

    // update local timestamp and store data
    this.data.timestamp = dataBucket.timestamp;
    return setStorageData({[this.name]: dataBucket}, this.synced);
  }

  /** Load a stored DataBucket into the space
   * @param {{
   *   name: string
   *   synced: boolean
   *   path: number[]
   * }} args - Name & storage bucket location (reloads current space if empty)
   */
  async load({name = this.name, synced = this.synced, path = []} = {}) {
    if (!name) return false;
    // console.log("Loading space...", name, synced, typeof synced, path);
    const bucket = await getStorageData(name, synced);
    // console.log("Getting data from bucket...", bucket);
    const data = bucket[name];
    // console.log("Confirming data...", data);
    if (!data) return;
    await this.init({
      name: name,
      synced: synced,
      data: data,
      path: path,
    });
    return true;
  }

  /**
   * Return the fully named path represented by the seq array provided
   * @param {number[]} path 
   */
  getPathNames(path = this.path) {
    // console.log(this, this.name);
    /** @type {string[]} */
    const pathNames = [this.name];
    let item = this.data;
    // console.log(path[0], pathNames[0], path.length);
    for (const seq of path) {
      // console.log(seq);
      item = item.children.find((i) => i.seq == seq);
      if (!item) {
        // throw new Error("That path doesn't exist");
        return;
      }
      pathNames.push(item.name);
    }
    return pathNames;
  }

  /**
   * 
   * @param {number[]} path - Full path to the tree item
   * @returns {TreeItem|Folder|Snippet|void}
   */
  getItem(path) {
    // console.log(path);
    try {
      let item = this.data;
      for (const seq of path) {
        // console.log(seq, +seq);
        item = item.children.find((o) => (o.seq === +seq));
      }
      return item;
    } catch (e) {
      // console.error("The path requested does not exist.", path, e);
      return;
    }
  }

  /** Add tree item to data bucket
   * @param {TreeItem|Folder|Snippet} item 
   * @param {number[]} [folderPath] 
   */
  addItem(item, folderPath = this.path) {
    const folder = this.getItem(folderPath).children;
    item.seq = folder.length + 1;
    folder.push(item);
    return item;
  }

  /** Edit tree item
   * @param {number} seq 
   * @param {string} field 
   * @param {string} value
   * @param {number[]} [folderPath] 
   */
  editItem(seq, field, value, folderPath = this.path) {
    const item = this.getItem(folderPath.concat([seq]));
    item[field] = value;
    return item;
  }

  /** Move tree item
   * @param {{path:number[],seq:number}} from
   * @param {{path:number[],seq:number}} to
   */
  moveItem(from, to) {
    // console.log(from, to);
    if (!from || !to || isNaN(from.seq)) return;
    if (!Array.isArray(from.path)) from.path = this.path;
    if (!Array.isArray(to.path)) to.path = this.path;
    if (JSON.stringify(to) === JSON.stringify(from)) return;
    const toFolder = this.getItem(to.path);
    // console.log(toFolder, toFolder.children.length);
    const fromFolder = this.getItem(from.path);
    const fromItem = this.getItem(from.path?.concat([from.seq]));
    const fromArraySeq = fromFolder.children.indexOf(fromItem);
    // console.log(fromFolder, fromItem, fromArraySeq);
    if (!fromItem) return; //
    const toArraySeq = isNaN(to.seq)
                     ? toFolder.children.length + 1
                     : toFolder.children.indexOf(this.getItem(to.path.concat([to.seq])));
    try {
      toFolder.children.splice(toArraySeq, 0,
        fromFolder.children.splice(fromArraySeq, 1)[0]);
      this.sequence(toFolder);
      if (JSON.stringify(from.path) !== JSON.stringify(to.path))
        this.sequence(fromFolder);
    } catch (e) {
      console.warn(e);
    }
    return fromItem;
  }

  /** Remove tree item
   * @param {number} seq 
   * @param {number[]} [folderPath] 
   */
  deleteItem(seq, folderPath = this.path) {
    /** @type {*[]} */
    const folder = this.getItem(folderPath).children;
    const i = folder.findIndex(o => o.seq === +seq);
    const removedItem = folder.splice(i, 1)[0];
    return removedItem;
  }

  /**
   * Process placeholders and rich text options of a snippet and return the result
   * @param {number} seq 
   * @param {number[]} path 
   * @returns {Promise<{snip:Snippet,customFields?:Map}
   */
  async getProcessedSnippet(seq, path = this.path) {
    // console.log("Getting item...");
    const item = this.getItem(path.concat(seq));
    // console.log(item);
    if (!item) return;
    // avoid touching space
    const snip = new Snippet(item);
    if (!snip.content) return {
      // nothing to process
      snip: snip,
    };
    
    // skip processing if Clippings [NOSUBST] flag is prepended to the name
    if (snip.name.slice(0,9).toUpperCase() === "[NOSUBST]") {
      snip.nosubst = true;
      return {
        snip: snip,
      };
    }

    // process counters, kept track internally to allow use across multiple snippets
    let counters = false;
    snip.content = snip.content.replaceAll(/#\[(.+?)(?:\((.+?)\))?\]/g, (match, p1, p2) => {
      counters = true;
      // add new counters to tracking list
      if (!(p1 in this.data.counters)) {
        this.data.counters[p1] = this.data.counters.startVal;
      }
      const val = this.data.counters[p1];
      this.data.counters[p1] += isNaN(p2) ? 1 : +p2;
      return val;
    });
    // save space if counters were used and thus incremented
    if (counters) await this.save();
  
    // placeholders
    // console.log("Processing placeholders...");
    const customFields = new Map();
    snip.content = snip.content.replaceAll(/\$\[(.+?)(?:\((.+?)\))?(?:\{(.+?)\})?\]/g, (match, placeholder, format, defaultValue) => {
      if (defaultValue?.includes('|')) defaultValue = defaultValue.split('|');
      const now = new Date();
  
      /**
       * Full custom date/time format string replacement (compatible with Clippings)
       * @param {string} dateString 
       * @param {*} date 
       */
      const formattedDateTime = (dateString, date) => {
        // helper for setting up date objects
        const datePartsToObject = (obj, item) =>
          (item.type === "literal") ? obj : (obj[item.type] = item.value, obj);
  
        // generate localized replacement objects for full replacement support
        const longDate = new Intl.DateTimeFormat(uiLocale, {
          hourCycle: "h12",
          weekday: "long", day: "numeric", month: "long",
          hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3,
          dayPeriod: "long", timeZoneName: "long", era: "long",
        }).formatToParts(date).reduce(datePartsToObject, {});
        const shortDate = new Intl.DateTimeFormat(uiLocale, {
          hourCycle: "h12",
          weekday: "short", day: "numeric", month: "short",
          hour: "numeric", minute: "numeric", second: "numeric", fractionalSecondDigits: 1,
          timeZoneName: "short", era: "short",
        }).formatToParts(date).reduce(datePartsToObject, {});
        const paddedDate = new Intl.DateTimeFormat(uiLocale, {
          hourCycle: "h23",
          year: "2-digit", month: "2-digit", day: "2-digit",
          hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 2,
          timeZoneName: "longOffset",
        }).formatToParts(date).reduce(datePartsToObject, {});
        // numeric date/times will only not be padded if loaded individually
        const numericDate = new Intl.DateTimeFormat(uiLocale, {
          hourCycle: "h23", year: "numeric", hour: "numeric",
        }).formatToParts(date).concat(new Intl.DateTimeFormat(uiLocale, {
          month: "numeric", minute: "numeric",
        }).formatToParts(date).concat(new Intl.DateTimeFormat(uiLocale, {
          day: "numeric", second: "numeric", fractionalSecondDigits: 3,
        }).formatToParts(date))).reduce(datePartsToObject, {});
        // fix numeric 24 hours still being padded for some locals no matter how generated
        if (numericDate.hour.length === 2) numericDate.hour = numericDate.hour.replace(/^0/, "");
  
        // replace each part of format string
        dateString = dateString.replaceAll(/([a-zA-Z]*)(\.s+)?/g, (match, p1, p2) => {
          // split seconds
          if (p2) {
            let seconds = "";
            switch (p1) {
              case "s":
                seconds += numericDate.second;
                break;
            
              case "ss":
                seconds += paddedDate.second;
                break;
            
              default:
                seconds += p1;
                break;
            }
            switch (p2) {
              case ".s":
                seconds += `.${shortDate.fractionalSecond}`;
                break;
            
              case ".ss":
                seconds += `.${paddedDate.fractionalSecond}`;
                break;
            
              case ".sss":
                seconds += `.${longDate.fractionalSecond}`;
                break;
            
              default:
                seconds += p2;
                break;
            }
            return seconds;
          }
          // case sensitive matches
          switch (match) {
            case "m":
              return numericDate.minute;
            case "mm":
              return paddedDate.minute;
            case "M":
              return numericDate.month;
            case "MM":
              return paddedDate.month;
            case "h":
              return shortDate.hour;
            case "hh":
              return longDate.hour;
            case "H":
              return numericDate.hour;
            case "HH":
              return paddedDate.hour;
            case "a":
              return shortDate.dayPeriod;
            case "A":
              return shortDate.dayPeriod.toUpperCase();
            default:
              break;
            }
          // case insensitive matches required for clippings compatibility
          switch (match.toUpperCase()) {
          case "D":
            return numericDate.day;
          case "DD":
            return paddedDate.day;
          case "DDD":
            return shortDate.weekday;
          case "DDDD":
            return longDate.weekday;
          case "DO":
            return i18nOrd(numericDate.day);
          case "MMM":
            return shortDate.month;
          case "MMMM":
            return longDate.month;
          case "Y":
            return paddedDate.slice(-1);
          case "YY":
            return paddedDate.year;
          case "YYY":
            return numericDate.year.slice(-3);
          case "YYYY":
            return numericDate.year;
          case "GG":
            return shortDate.era;
          case "S":
            return numericDate.second;
          case "SS":
            return paddedDate.second;
          case "Z":
            return paddedDate.timeZoneName;
          case "ZZ":
            return paddedDate.timeZoneName.replaceAll(/[^+\-\d]/g, "");
          default:
            break;
          }
          return match;
        });
        return dateString;
      };
      const UA = navigator.userAgent;
      let host;
      switch (placeholder.toUpperCase()) {
        case "DATE":
          if (format) {
            // shorthand date options
            if (format.toUpperCase() === "FULL") return new Intl.DateTimeFormat(uiLocale, {
              dateStyle: "full",
            }).format(now);
            if (format.toUpperCase() === "LONG") return new Intl.DateTimeFormat(uiLocale, {
              dateStyle: "long",
            }).format(now);
            if (format.toUpperCase() === "MEDIUM") return new Intl.DateTimeFormat(uiLocale, {
              dateStyle: "medium",
            }).format(now);
            if (format.toUpperCase() === "SHORT") return new Intl.DateTimeFormat(uiLocale, {
              dateStyle: "short",
            }).format(now);
  
            return formattedDateTime(format, now);
          }
          return now.toLocaleDateString();
  
        case "TIME":
          if (format) {
            if (format === "full") return new Intl.DateTimeFormat(uiLocale, {
              timeStyle: "full",
            }).format(now);
            if (format === "long") return new Intl.DateTimeFormat(uiLocale, {
              timeStyle: "long",
            }).format(now);
            if (format === "medium") return new Intl.DateTimeFormat(uiLocale, {
              timeStyle: "medium",
            }).format(now);
            if (format === "short") return new Intl.DateTimeFormat(uiLocale, {
              timeStyle: "short",
            }).format(now);
  
            return formattedDateTime(format, now);
          }
          return now.toLocaleTimeString();
  
        case "HOSTAPP":
          host = UA.match(/Edg\/([0-9.]+)/);
          if (host) return `Edge ${host[1]}`;
          host = UA.match(/Chrome\/([0-9.]+)/);
          if (host) return `Chrome ${host[1]}`;
          return match;
  
        case "UA":
          return UA;
  
        case "NAME":
          return snip.name;
  
        case "FOLDER":
          return this.getPathNames(path).pop();
  
        case "PATH":
          return this.getPathNames(path).join(format || `/`);
      
        default:
          // custom field, save for future processing
          if (!customFields.has(placeholder)) {
            if (Array.isArray(defaultValue)) {
              customFields.set(placeholder,{
                type: 'select',
                value: defaultValue[0] || '',
                options: defaultValue,
              });
            } else {
              customFields.set(placeholder,{
                type: format || 'text',
                value: defaultValue || '',
              });
            }
          }
          return match;
      }
    });

    // console.log(snip, customFields);
    return {
      snip: snip,
      ...customFields.size ? {customFields: customFields} : {},
    };
  }

  sort({by = 'seq', foldersOnTop = true, reverse = false, folderPath = ['all']} = {}) {
    // recursive function in case everything needs to be sorted
    const sortFolder = (data, recursive, by, foldersOnTop, reverse) => {
      if (!data.children)
        return;
      data.children.sort((a, b) => {
        let result = a[by] > b[by];
        if (foldersOnTop)
          result = (a instanceof Folder)
                 ? ((b instanceof Folder) ? result : false)
                 : ((b instanceof Folder) ? true : result);
        if (reverse)
          result = !result;
        return result ? 1 : -1;
      });
      this.sequence(data);
      if (recursive) {
        for (const child of data.children) {
          if (child.children?.length)
            sortFolder(child, recursive, by, foldersOnTop, reverse);
        }
      }
    };
    if (folderPath[0] === 'all') {
      sortFolder(this.data, true, by, foldersOnTop, reverse);
    } else {
      sortFolder(this.getItem(folderPath), false, by, foldersOnTop, reverse);
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

  /**
   * Reuse the space object
   * @param {{
   *   name: string
   *   synced: boolean
   *   data: DataBucket
   *   path: number[]|string
   * }} details
   */
  async init({name, synced, data, path} = {}) {
    // console.log(name, synced, data, path);
    // check defaults if either name or synced are blank
    const settings = new Settings();
    if (!name || !synced) await settings.load();
    
    // make sure data is parsed correctly
    // console.log("Checking data integrity...", name, synced, data, path);
    if (!(data instanceof DataBucket)) {
      data = new DataBucket(data);
      // console.log("Parsing data...", data);
      if (!(await data.parse())) {
        throw new Error(`Unable to parse data, cancelling initialization...\n${data}`);
        // return;
      }
    }

    // make sure path is correct or reset otherwise
    if (typeof path === 'string') path = path.split('-').filter(v => !isNaN(v));
    if (!Array.isArray(path)) path = [];

    // update properties
    // console.log("Updating details...", name, synced, data, path);
    this.name = name || settings.defaultSpace.name;
    this.synced = (typeof synced === 'boolean') ? synced : settings.defaultSpace.synced;
    this.data = data;
    this.path = path;

    // console.log("Space initialized.", structuredClone(this));
    return true;
  }
}

/**
 * (Re)build context menu for snipping and pasting
 * @param {Space} space 
 */
async function buildContextMenus(space) {
  // console.log(space);
  // Since there's no way to poll current menu's, clear all first
  await new Promise((resolve, reject) =>
    chrome.contextMenus.removeAll(() =>
      (chrome.runtime.lastError)
      ? reject(chrome.runtime.lastError)
      : resolve()))
  .catch((e) => console.warn(e));
  if (!space?.name) return;

  const addMenu = (properties) =>
    new Promise((resolve, reject) =>
      chrome.contextMenus.create(properties, () =>
        (chrome.runtime.lastError)
        ? reject(chrome.runtime.lastError)
        : resolve()))
    .catch((e) => console.warn(e));
  
  /** @type {{action:string,path:number[],seq:number,menuSpace:{name:string,synced:boolean}}} */
  const menuData = {
    action: 'snip',
    menuSpace: {
      name: space.name,
      synced: space.synced,
      path: [],
    },
  };

  // create snipper for selected text
  addMenu({
    "id": JSON.stringify(menuData),
    "title": i18n('action_snip_selection'),
    "contexts": ["selection"],
  });

  // build paster for saved snippets
  // console.log(space);
  if (space.data?.children?.length) {
    // set root menu item
    menuData.action = 'paste';
    addMenu({
      "id": JSON.stringify(menuData),
      "title": i18n('action_paste'),
      "contexts": ["editable"],
    });

    /**
     * Recursive function for snippet tree
     * @param {(TreeItem|Folder|Snippet)[]} folder 
     * @param {*} parentData 
     */
    const buildFolder = async (folder, parentData) => {
      const menuItem = {
        "contexts": ["editable"],
        "parentId": JSON.stringify(parentData),
      };
      // clone parent object to avoid polluting it
      const menuData = structuredClone(parentData);
      // console.log(menuData, parentData);
      if (menuData.seq) menuData.menuSpace.path.push(menuData.seq);
      // list snippets in folder
      if (folder.length) {
        folder.forEach(item => {
          menuData.seq = item.seq;
          menuItem.id = JSON.stringify(menuData);
          // using emojis for ease of parsing, && escaping, nbsp needed for chrome bug
          const color = getColor(item.color);
          menuItem.title = `${(item instanceof Folder) ? color.folder : color.snippet}\xA0\xA0${item.name.replaceAll("&", "&&")}`;
          addMenu(menuItem);
          if (item instanceof Folder) buildFolder(item.children, menuData);
        });
      } else {
        menuData.seq = undefined;
        menuItem.id = JSON.stringify(menuData);
        menuItem.title = i18n('folder_empty');
        menuItem.enabled = false;
        addMenu(menuItem);
      }
    };
    // build paste snippet menu tree
    buildFolder(space.data.children, menuData);
  }
}