import { i18n, uiLocale, i18nOrd } from "../refs.js";
import { StorageKey, keyStore, getStorageData } from "../storage.js";
import { Settings } from "./settings.js";


/** Converts a boolean value (`synced`) to a `chrome.storage` area name
 * @param {boolean} synced `true` for `'sync'` and `false` for `'local'`
 * @returns {'sync'|'local'} The appropriate area name
 */
const getStorageArea = (synced) => synced ? 'sync' : 'local';

/** Base constructor for folders, sniplets and any future items */
class TreeItem {
  constructor({ name = i18n('title_new_generic'), seq, color } = {}) {
    /** @type {string} */
    this.name = name;
    /** @type {number} */
    this.seq = seq;

    /** legacy colorMap for upgrading to newest version (these values are deprecated but may be in backup files) */
    const legacyColors = new Map()
    .set('Red','red')
    .set('Orange','orange')
    .set('Yellow','yellow')
    .set('Green','green')
    .set('Blue','blue')
    .set('Purple','purple')
    .set('Grey','gray');

    /** @type {string} */
    this.color = legacyColors.get(color) || color; // legacy color mapping check
  }
}
/** Folders contain tree items and can be nested. */
class Folder extends TreeItem {
  constructor({ name = i18n('title_new_folder'), seq, children, color, label } = {}) {
    super({
      name: name,
      seq: seq,
      color: color || label, // clippings uses the label field
    });
    /** @type {(TreeItem|Folder|Snip)[]} */
    this.children = children || [];
  }
}
/** Sniplets are basic text blocks that can be pasted */
class Sniplet extends TreeItem {
  constructor({ name, seq, color, label, shortcut, sourceURL, content = "", nosubst = false } = {}) {
    // generate name from content if provided
    if (!name && content) {
      // create sniplet title from first line of text
      name = content.match(/^.*/)[0];
      const maxLength = 27;
      if (name.length > maxLength) {
        // cut down to size, then chuck trailing text if possible so no words are cut off
        name = name.slice(0, maxLength + 1);
        name = `${name.includes(' ')
             ? name.slice(0, name.lastIndexOf(' '))
             : name.slice(0, maxLength)}…`;
      }
    }
    super({
      name: name || i18n('title_new_sniplet'),
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
/** Basic sniplets data bucket */
class DataBucket {
  constructor({ version = "1.0", children = [], counters = {} } = {}) {
    /** @type {string} */
    this.version = version;
    /** @type {number} */
    this.timestamp = Date.now();
    /** @type {(TreeItem|Folder|Sniplet)[]|string} */
    this.children = children;
    const { startVal, ...encounters } = counters;
    /** @type {{[name:string]:number}} */
    this.counters = encounters || {};
    this.counters.startVal = +startVal || 0;
  }

  /** Compress root folder (children) using browser gzip compression */
  async compress() {
    // check if already compressed
    if (typeof this.children === 'string') {
      // confirm the compressed string is valid
      const testBucket = new DataBucket(this);
      if (!(await testBucket.parse())) return false;
      return true;
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

  /** Cast an tree item to its appropriate class
   * @param {(TreeItem | Folder | Sniplet)} item 
   */
  cast(item) {
    if (!item) return;
    if (Object.hasOwn(item, "children")) return new Folder(item);
    if (Object.hasOwn(item, "content")) return new Sniplet(item);
    return new TreeItem(item);
  }

  /** Cast an array of tree items to their appropriate class
   * @param {(TreeItem | Folder | Sniplet)[]} [folder=this.children] 
   */
  restructure(folder = this.children) {
    const items = [];
    folder.forEach((item) => {
      if (Array.isArray(item.children) && item.children.length) {
        item.children = this.restructure(item.children);
      }
      items.push(this.cast(item));
    });
    return items;
  }

  /** Decompress root folder (children) and cast objects as their appropriate TreeItem */
  async parse() {
    // check if compressed and otherwise just cast contents appropriately
    if (Array.isArray(this.children)) {
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

    try {
      // create stream for decompression
      const stream = new Blob([gzipData], { type: "application/json" })
        .stream().pipeThrough(new DecompressionStream("gzip"));
      // read the decompressed stream
      const dataBlob = await new Response(stream).blob();
      // return decompressed and deserialized text
      this.children = this.restructure(JSON.parse(await dataBlob.text()));
      return this;
    } catch (e) {
      console.error(e);
      return;
    }
  }

  /** process data into a clippings compatible object */
  toClippings() {
    /** @param {(TreeItem|Folder|Sniplet)[]} folder */
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

  /** Removes all saved sourceURLs recursively
   * @param {(TreeItem|Folder|Sniplet)} folder 
   */
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
/** Space object stores sniplet groupings in buckets. */
class Space {
  /** Construct a Space object
   * @param {{
   *   name: string
   *   synced: boolean
   *   data: DataBucket
   *   path: number[]|string
   * }} details
   */
  constructor({ name = i18n('default_space_name'), synced = false, data = new DataBucket(), path = [] } = {}) {
    this.name = name;
    this.synced = synced;
    this.data = data;
    this.path = path;
  }

  get storage() {
    return new StorageKey(this.name, getStorageArea(this.synced));
  }

  async isSyncable({ compress = true }) {
    const testData = new DataBucket(this.data);
    if (compress) await testData.compress();
    const { size } = new Blob([JSON.stringify({ [this.name]: testData })]);
    return (size <= chrome.storage.sync.QUOTA_BYTES_PER_ITEM);
  }

  /** Set this space as the current space in the local browser
   * @param {boolean} rememberPath 
   */
  async setAsCurrent(rememberPath) {
    return keyStore.currentSpace.set({
      name: this.name,
      synced: this.synced,
      ...(rememberPath ? { path: this.path } : {}),
    });
  }

  /** load last used space or fall back to default */
  async loadCurrent() {
    const currentSpace = await keyStore.currentSpace.get();
    if (!(await this.load(currentSpace))) {
      const settings = new Settings();
      await settings.load();
      if (await this.load(settings.defaultSpace)) {
        this.setAsCurrent(settings.view.rememberPath);
        return true;
      } else {
        // should never happen unless memory is corrupt
        return;
      }
    }
    return true;
  }

  /** Save the space's DataBucket into the appropriate storage
   * @param {{compress:boolean}} options External save options
   */
  async save({ compress = true }) {
    // make sure the space has been initialized
    if (!this.name?.length) return;

    // ensure synced space is syncable
    if (this.synced && !(await this.isSyncable(compress))) return;

    const dataBucket = new DataBucket(this.data);
    // gzip compression adds about 8x more storage space, but can be toggled
    if (compress) await dataBucket.compress();

    // update local timestamp and store data
    this.data.timestamp = dataBucket.timestamp;
    
    return this.storage.set(dataBucket);
  }

  /** Load a stored DataBucket into the space
   * @param {{
   *   name: string
   *   synced: boolean
   *   path: number[]
   * }} args - Name & storage bucket location (reloads current space if empty)
   */
  async load({ name = this.name, synced = this.synced, path = [] } = {}) {
    if (!name) return false;
    // console.log("Loading space...", name, synced, typeof synced, path, getStorageArea(synced));
    const data = await getStorageData(name, getStorageArea(synced));
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

  /** Get an array of all the path names up to and including a specific folder seq
   * @param {number[]} path 
   */
  getPathNames(path = this.path) {
    const pathNames = [this.name];
    let item = this.data;
    for (const seq of path) {
      item = item.children.find((i) => i.seq == seq);
      if (!item?.children) {
        console.error(`The requested path sequence ${path} doesn't exist. Reached: ${pathNames.join('/')}`);
        return;
      }
      pathNames.push(item.name);
    }
    return pathNames;
  }

  /** Get the item found at a specific path sequence
   * @param {number[]} path - Full path to the tree item
   * @returns {TreeItem|Folder|Sniplet|void}
   */
  getItem(path = this.path) {
    let item = this.data;
    for (const seq of path) {
      item = item.children?.find((o) => (o.seq === +seq));
      if (!item) {
        console.error(`The requested item path sequence ${path} doesn't exist. The last item reached: ${item}`);
        return;
      }
    }
    return item;
  }

  /** Add tree item to data bucket
   * @param {TreeItem|Folder|Sniplet} item 
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
      console.error(e);
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

  /** Process placeholders and rich text options of a sniplet and return the result
   * @param {number} seq 
   * @param {number[]} path 
   * @returns {Promise<{snip:Sniplet,customFields?:Map<string,string>,counters?:Map<string,number>}
   */
  async getProcessedSniplet(seq, path = this.path) {
    // console.log("Getting item...");
    const item = this.getItem(path.concat(seq));
    // console.log(item);
    if (!item) return;
    // avoid touching space
    const snip = new Sniplet(item);
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

    // process counters, kept track internally to allow use across multiple sniplets
    const counters = new Map();
    snip.content = snip.content.replaceAll(/#\[(.+?)(?:\((.+?)\))?\]/g, (match, p1, p2) => {
      // add new counters to DataBucket
      if (!(p1 in this.data.counters)) {
        this.data.counters[p1] = this.data.counters.startVal;
      }
      // allow for rollback in case paste fails
      const val = this.data.counters[p1];
      if (!counters.has(p1)) counters.set(p1, val);
      // replace and increment
      this.data.counters[p1] += isNaN(p2) ? 1 : +p2;
      return val;
    });
    // save space if counters were used and thus incremented
    if (counters.size) await this.save();
  
    // placeholders
    // console.log("Processing placeholders...");
    const customFields = new Map();
    snip.content = snip.content.replaceAll(/\$\[(.+?)(?:\((.+?)\))?(?:\{(.+?)\})?\]/g, (match, placeholder, format, defaultValue) => {
      if (defaultValue?.includes('|')) defaultValue = defaultValue.split('|');
      const now = new Date();
  
      /** Full custom date/time format string replacement (compatible with Clippings)
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
      ...customFields.size ? { customFields: customFields } : {},
      ...counters.size ? { counters: counters }: {},
    };
  }

  /** Update the value of several counters at once
   * @param {Map<string,number>} counters
   */
  setCounters(counters) {
    if (!counters?.size) return;
    for (const [counter, value] of counters) {
      this.data.counters[counter] = value;
    }
  }

  /** Sort tree items according to sort rules */
  sort({ by = 'seq', foldersOnTop = true, reverse = false, folderPath = ['all'] } = {}) {
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

  /** Update the seq of items in a folder after it's been sorted
   * @param {Folder} folder 
   */
  sequence(folder) {
    if (folder.children) {
      let i = folder.children.length;
      while (i--) {
        folder.children[i].seq = i + 1;
      }
    }
    return this;
  }

  /** Reuse the space object
   * @param {{
   *   name: string
   *   synced: boolean
   *   data: DataBucket
   *   path: number[]|string
   * }} details
   */
  async init({ name, synced, data, path } = {}) {
    // console.log(name, synced, data, path);
    // check defaults if either name or synced are blank
    const settings = new Settings();
    if (!name || !synced) await settings.load();
    
    // make sure data is parsed correctly
    if (!(data instanceof DataBucket)) {
      data = new DataBucket(data);
      if (!(await data.parse())) {
        throw new Error(`Unable to parse data, cancelling initialization...\n${data}`);
      }
    }

    // make sure path is correct or reset otherwise
    if (typeof path === 'string') path = path.split('-').filter(v => !isNaN(v));
    if (!Array.isArray(path)) path = [];

    // update properties
    this.name = name || settings.defaultSpace.name;
    this.synced = (typeof synced === 'boolean') ? synced : settings.defaultSpace.synced;
    this.data = data;
    this.path = path;

    return this;
  }
}

export {
  getStorageArea,
  DataBucket,
  Folder,
  Sniplet,
  Space,
};