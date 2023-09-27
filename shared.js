/* All shared functions. */
/* global CompressionStream DecompressionStream */
/* eslint-disable no-unused-vars */

/**
 * chrome.i18n helper to pull strings from _locales/[locale]/messages.json
 * @param {string} message 
 * @returns {string}
 * @example
 * // returns "Snippet"
 * i18n("app_name")
 */
const i18n = (message) => chrome.i18n.getMessage(message);

// Storage helpers. Sync must be explicitly enabled.
/**
 * Safely stores data to chrome.storage.local (default) or .sync.
 * @param {Object.<string, *>} data - a { key: value } object to store
 * @param {boolean} [synced=false] - Whether to store the data in local (false, default) or sync (true).
 * @example
 * // Saves data in sync storage under the name stored in the string variable: key
 * await setStorageData({ [key]: value }, true);
 */
const setStorageData = (data, synced = false) => {
  let bucket = synced ? chrome.storage.sync : chrome.storage.local;
  return new Promise((resolve, reject) =>
  bucket.set(data, () =>
    chrome.runtime.lastError
    ? reject(chrome.runtime.lastError)
    : resolve()
  ));
}
/**
 * Safely retrieves storage data from chrome.storage.local (default) or .sync.
 * @param {string} key - The key name for the stored data.
 * @param {boolean} [synced=false] - Whether to look in local (false, default) or sync (true).
 * @returns {Promise<Object.<string, *>>} Found data is returned as a { key: value } object.
 * @example
 * // returns { key: value } from local
 * await getStorageData('key');
 * @example
 * // stores the value of the storage object in the key variable
 * const { key } = await getStorageData('key', true);
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
/**
 * Safely removes storage data from chrome.storage.local (default) or .sync.
 * @param {string} key - The key name for the stored data.
 * @param {boolean} [synced=false] - Whether to look in local (false, default) or sync (true).
 * @example
 * // removes the { key: value } data from local storage
 * await removeStorageData('key');
 */
const removeStorageData = (key, synced = false) => {
  let bucket = synced ? chrome.storage.sync : chrome.storage.local;
  return new Promise((resolve, reject) =>
  bucket.remove(key, () =>
    chrome.runtime.lastError
    ? reject(chrome.runtime.lastError)
    : resolve()
  ));
}

/**
 * Ensure script injection errors including permission blocks are always handled gracefully.
 * Requires the ["scripting"] permission.
 * @param {Object} src - The details of the script to inject.
 * @param {InjectionTarget} [src.target] - Details specifying the target into which to inject the script.
 * @param {string[]} [src.files] - The path of the JS or CSS files to inject, relative to the extension's root directory. Exactly one of files and func must be specified.
 * @param {void} [src.func] - A JavaScript function to inject. This function will be serialized, and then deserialized for injection. This means that any bound parameters and execution context will be lost. Exactly one of files and func must be specified.
 * @param {*[]} [src.args] - The arguments to carry into a provided function. This is only valid if the func parameter is specified. These arguments must be JSON-serializable.
 * @param {boolean} [src.injectImmediately] - Whether the injection should be triggered in the target as soon as possible. Note that this is not a guarantee that injection will occur prior to page load, as the page may have already loaded by the time the script reaches the target.
 * @param {ExecutionWorld} [src.world] - The JavaScript "world" to run the script in. Defaults to ISOLATED.
 * @returns {Promise<InjectionResult[]>|boolean}
 */
const injectScript = async (src) => {
  return chrome.scripting.executeScript(src)
  .catch((e) => { return false; });
}

/**
 * Injection script workaround for full selectionText with line breaks
 */
const getFullSelection = () => {
  return window.getSelection().toString();
}

/**
 * Injection script for pasting. Pasting will be done as rich text in contenteditable fields.
 */
const pasteSnippet = async ({ text, nosubst = false }) => {
  // get clicked element
  const selNode = document.activeElement;

  // set up paste code
  const paste = (text) => {
    // setup rich text for pasting or updating the clipboard if needed
    let richText = text;

    // execCommand is deprecated but insertText is still supported in chrome as wontfix
    // and produces the most desirable result. See par. 3 in:
    // https://developer.mozilla.org/en-US/docs/Web/API/Document/execCommand
    let pasted = false
    if (selNode.value !== undefined) {
      // paste plaintext into inputs and textareas
      pasted = document.execCommand('insertText', false, text);
      // forward-compatible alt code, kills the undo stack
      if (!pasted) {
        const selVal = selNode.value;
        const selStart = selNode.selectionStart;
        selNode.value = selVal.slice(0, selStart) + text + selVal.slice(selNode.selectionEnd);
        selNode.selectionStart = selNode.selectionEnd = selStart + text.length;
        pasted = true;
      }
    } else { // contenteditable
      // process newlines & unlinked text when not set to plain-text
      if (selNode.contentEditable === "true") {
        /**
         * email parser regex breakdown with an added check to ensure it isn't already linked:
         * 
         * * (?<!<[^>]*) - ignore emails inside tag defs
         * * (?:[a-zA-Z0-9!#$%&'*+\-/=?^_`{|}~] - allowable starting characters
         * * [a-zA-Z0-9!#$%&'*+\-/=?^_`{|}~.]* - allowable characters
         * * [a-zA-Z0-9!#$%&'*+\-/=?^_`{|}~] - allowable ending characters
         * * |[a-zA-Z0-9!#$%&'*+\-/=?^_`{|}~]) - allowable single character
         * * @ - defining email character
         * * (?:(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]+) - url
         * * (?!(?!<a).*?<\/a>) - ignore emails that are inside an anchor tag
         */
        const rxEmail = /(?<!<[^>]*)(?:[a-zA-Z0-9!#$%&'*+\-/=?^_`{|}~][a-zA-Z0-9!#$%&'*+\-/=?^_`{|}~.]*[a-zA-Z0-9!#$%&'*+\-/=?^_`{|}~]|[a-zA-Z0-9!#$%&'*+\-/=?^_`{|}~])@(?:(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]+)(?!(?!<a).*?<\/a>)/ig;
        richText = richText.replaceAll(rxEmail, (match) => {
          return `<a href="mailto:${ match }">${ match }</a>`;
        })
        /**
         * url parser regex breakdown with an added check to ensure it isn't already linked:
         * 
         * * (?<!<[^>]*| - ignore urls inside tag defs
         * * [.+@a-zA-Z0-9]) - ignore emails pt1
         * * (?:(?:https?|ftp|chrome|edge|about|file\/):\/\/)? - only match openable urls if a protocol is included (file has one more slash indicating the root folder)
         * * (?:(?:(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]+)|(?:[0-9]+\.){3}[0-9]+) - find url sequences or ipv4 addresses (ipv6 is too complicated for a single line regex)
         * * (?::[0-9]+)? - include port references
         * * (?:\/[a-zA-Z0-9-._~:/?#[\]@!$&'()*+,;=%]*)? - include allowed characters in subfolders
         * * (?![.+@a-zA-Z0-9]| - ignore emails pt2
         * * (?!<a).*?<\/a>) - ignore urls that are inside an anchor tag
         */
        const rxURL = /(?<!href="[^"]*|[.+@a-zA-Z0-9])(?:(?:https?|ftp|chrome|edge|about|file\/):\/\/)?(?:(?:(?:[a-zA-Z0-9]+\.)+[a-zA-Z]+)|(?:[0-9]+\.){3}[0-9]+)(?::[0-9]+)?(?:\/[a-zA-Z0-9-._~:/?#[\]@!$&'()*+,;=%]*)?(?![.+@a-zA-Z0-9]|(?!<a).*?<\/a>)/ig;
        richText = richText.replaceAll(rxURL, (match) => {
          // ensure what was picked up evaluates to a proper url (just in case)
          const matchURL = new URL((!match.match(/(?:https?|ftp|chrome|edge|about|file\/):\/\//)) ? "http://" + match : match);
          return (matchURL) ? `<a href="${ matchURL.href }">${ match }</a>` : match;
        })
        /**
         * newline parser Regex breakdown ignoring those after a block level tag:
         * 
         * * (?<!<\/? - don't match if specific tags are found before a newline
         * * (?!a|span|strong|em|b|i|q|mark|input|button)[a-zA-Z]+? - inline tags are okay to add breaks after
         * * (?:>| .*>)) - allow for opening tags with options
         * * (?:\r\n|\r|\n) - match newlines no matter how formatted (should always be \n, but just in case)
         */
        const rxNewline = /(?<!<\/?(?!a|span|strong|em|b|i|q|mark|input|button)[a-zA-Z]+?(?:>| .*>))(?:\r\n|\r|\n)/g;
        richText = richText.replaceAll(rxNewline, (match) => {
          return "<br>" + match;
        });
      }

      // ckeditor does not allow any 3rd party programatic inputs in contenteditable fields but fails silently
      if (!selNode.classList.contains("ck")) {
        pasted = document.execCommand('insertHTML', false, richText);
        // forward-compatible alt code, kills the undo stack
        if (!pasted) {
          const sel = window.getSelection();
          const selRng = sel.getRangeAt(0);
          console.log(sel, selRng);
          selRng.deleteContents();
          selRng.insertNode(document.createTextNode(richText));
          sel.collapseToEnd();
          pasted = true;
        }
      }
    }

    // event dispatch for editors that handle their own undo stack like stackoverflow
    if (pasted) {
      const keyEvent = {
        bubbles: true,
        cancelable: true,
        composed: true,
      };
      selNode.dispatchEvent(new KeyboardEvent('keydown', keyEvent));
      selNode.dispatchEvent(new InputEvent('input'), {
        bubbles: true,
        composed: true,
        inputType: "inputFromPaste",
        data: richText,
      })
      selNode.dispatchEvent(new KeyboardEvent('keyup', keyEvent));
    }

    return {
      pasted: pasted,
      text: text,
      richText: richText,
    };
  }

  // TODO: replace modal with popup so the selection won't lose focus
  // // process custom fields
  // const params = {};
  // // get custom parameters, all builtins should already be replaced
  // for (let match of text.matchAll(/\$\[(.+?)(?:\{(.+?)\})?\]/g)) {
  //   if (match[1] in params) continue;
  //   if (match[2]) {
  //     const defs = match[2].split("|");
  //     params[match[1]] = defs;
  //   } else {
  //     params[match[1]] = [""];
  //   }
  // }
  // if (!nosubst && (params !== {})) {
  //   // generate modal for getting values
  //   const modal = document.createElement("div");
  //   modal.style.zIndex = "9999";
  //   modal.style.position = "fixed";
  //   modal.style.top = "0";
  //   modal.style.left = "0";
  //   modal.style.width = "100vw";
  //   modal.style.height = "100vh";
  //   modal.style.transition = "all 0.3s ease";
  //   modal.style.display = "flex";
  //   modal.style.alignItems = "center";
  //   modal.style.justifyContent = "center";
  //   const modalBg = document.createElement("div");
  //   modalBg.style.cssText = "position: absolute; width: 100%; height: 100%; background: black;";
  //   modal.appendChild(modalBg);
  //   const modalCard = document.createElement("div");
  //   modalCard.style.cssText = "position: relative; border-radius: 10px; background: #fff; padding: 30px;";
  //   const modalParams = [];
  //   for (let param in params) {
  //     const modalParam = document.createElement("div");
  //     const modalLabel = document.createElement("label");
  //     modalLabel.htmlFor = "snippets-" + param;
  //     modalLabel.appendChild(document.createTextNode(param));
  //     modalLabel.style.display = "inline-block";
  //     modalLabel.style.width = "100px";
  //     modalParam.appendChild(modalLabel);
  //     let modalInput;
  //     if (params[param].length > 1) {
  //       modalInput = document.createElement("select");
  //       params[param].forEach((value) => {
  //         modalInput.add(new Option(value, value));
  //       })
  //     } else {
  //       modalInput = document.createElement("input");
  //       modalInput.value = params[param][0] || "";
  //     }
  //     modalInput.name = "snippets-" + param;
  //     modalInput.id = "snippets-" + param;
  //     modalInput.style.width = "300px";
  //     modalParam.appendChild(modalInput);
  //     modalCard.appendChild(modalParam);
  //     // save for retrieving values
  //     modalParams.push(modalParam);
  //   }
  //   const modalActions = document.createElement("div");
  //   modalActions.style.textAlign = "right";
  //   const modalCancel = document.createElement("button");
  //   modalCancel.appendChild(document.createTextNode("Cancel"));
  //   modalCancel.style.width = "100px";
  //   modalCancel.addEventListener('click', () => {
  //     modal.remove();
  //   });
  //   modalActions.appendChild(modalCancel);
  //   modalActions.appendChild(document.createTextNode(" "));
  //   const modalSubmit = document.createElement("button");
  //   modalSubmit.appendChild(document.createTextNode("Submit"));
  //   modalSubmit.style.width = "100px";
  //   modalSubmit.addEventListener('click', () => {
  //     // retrieve values
  //     modalParams.forEach((element) => {
  //       const input = element.lastChild;
  //       params[input.id.slice(9)] = input.value;
  //     });
  //     text = text.replaceAll(/\$\[(.+?)(?:\{.+?\})?\]/g, (match, p1) => {
  //       return params[p1];
  //     });
  //     // complete paste action and remove modal
  //     paste(text);
  //     modal.remove();
  //   });
  //   modalActions.appendChild(modalSubmit);
  //   modalCard.appendChild(modalActions);
  //   modal.appendChild(modalCard);
  //   document.body.appendChild(modal);
  //   return;
  // }

  return paste(text);
}

// Request permissions when necessary for cross-origin iframes
const requestFrames = async (action, src) => {
  const getFrameOrigins = () => {
    const origins = [window.location.origin + "/*"]
    // add src of all iframes on page so user only needs to request permission once
    Array.from(document.getElementsByTagName("IFRAME")).forEach((frame) => {
      if (frame.src) origins.push((new URL(frame.src).origin) + "/*");
    });
    return origins;
  };
  const origins = await injectScript({
    target: { tabId: src.target.tabId },
    func: getFrameOrigins,
  });
  // return script injection error if top level is blocked too
  if (!origins) return origins;
  // popup required to request permission
  await setStorageData({ origins: origins[0].result });
  // pass requested script in case successfull; note that functions can't be passed
  src.func = action;
  await setStorageData({ src: src });
  const requestor = await chrome.windows.create({
    url: chrome.runtime.getURL("popups/permissions.html"),
    type: "popup",
    width: 480,
    height: 300
  });
  return requestor;
}

/**
 * Base constructor for folders, snippets and any future items
 */
class TreeItem {
  constructor({ name, seq, label } = {}) {
    this.name = name || "New Tree Item";
    this.seq = seq || 1;
    this.label = label;
  }
}
/**
 * Folders contain tree items and can be nested.
 */
class Folder extends TreeItem {
  constructor({ name, seq, children, label } = {}) {
    super({
      name: name || "New Folder",
      seq: seq || 1,
      label: label,
    });
    this.children = children || [];
  }
}
/**
 * Snippets are basic text blocks that can be pasted
 */
class Snippet extends TreeItem {
  constructor({ name, seq, content, label, shortcut, sourceURL } = {}) {
    super({
      name: name || "New Snippet",
      seq: seq || 1,
      label: label,
    });
    this.content = content || "";
    this.shortcut = shortcut;
    this.sourceURL = sourceURL;
  }
}
// Basic snippets data bucket
class DataBucket {
  constructor({ version, timestamp, children, counters } = {}) {
    this.version = version || "1.0";
    this.timestamp = timestamp || Date.now();
    this.children = children || [];
    this.counters = counters || { startVal: 0 };

    // in case a restored backup is corrupt, ensure a startVal is available
    if (this.counters.startVal === undefined) this.counters.startVal = 0;
  }

  /**
   * Compress root folder (children) using browser gzip compression
   */
  async compress() {
    // check if already compressed
    if (typeof this.children === 'string') {
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

  #cast(item) {
    if (Object.hasOwn(item, "children")) {
      return new Folder(item);
    } else if (Object.hasOwn(item, "content")) {
      return new Snippet(item);
    }
    return item;
  }

  restructure(folder = this.children) {
    const items = [];
    folder.forEach((item) => {
      if (Object.hasOwn(item, "children")) {
        item.children = this.restructure(item.children);
      }
      items.push(this.#cast(item));
    });
    return items;
  }

  /**
   * Decompress root folder (children) and cast objects as their appropriate TreeItem
   */
  async parse() {
    // check if already compressed and otherwise just cast contents appropriately
    if (typeof this.children !== 'string') {
      this.children = this.restructure();
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
    this.children = this.restructure(JSON.parse(await dataBlob.text()));
    return true;
  }

  /**
   * Check if the data is small enough to fit in a sync storage bucket with the given key name.
   * @param {string} name Key that will be used for retrieving the data (factored into the browser's storage limits)
   * @returns 
   */
  syncable(name) {
    const size = new Blob([JSON.stringify({ [name]: this.data })]).size;
    const maxSize = chrome.storage.sync.QUOTA_BYTES_PER_ITEM;
    return (size <= maxSize);
  }
}

/**
 * Space object stores snippet groupings in buckets.
 */
class Space {
  /**
   * @param {{ name: string, synced: boolean, data: DataBucket }} params
   */
  constructor({ name, synced, data } = {}) {
    this.synced = synced || false;
    this.name = name || "Snippets";
    this.data = data || new DataBucket();
    this.path = [];
  }

  getPathNames() {
    const pathNames = [];
    let item = this.data;
    for (let seq of this.path) {
      item = item.children.find((i) => i.seq == seq);
      pathNames.push(item.name);
    }
    return pathNames;
  }

  async load() {
    // check for and load data if found
    const data = await getStorageData(this.name, this.synced);
    if (!data[this.name]) return;
    this.data = new DataBucket(data[this.name]);
    await this.data.parse();
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
    await setStorageData({ [this.name]: dataBucket }, this.synced);
    return true;
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

  getItem(path) {
    try {
      let item = this.data;
      for (let seq of path) {
        item = item.children.find((i) => i.seq == seq);
      }
      return item;
    } catch (e) {
      console.error("The path requested does not exist.", path, e);
      return;
    }
  }

  async getProcessedSnippet(path) {
    const locale = navigator.language;
    const snip = this.getItem(path);
    const folder = this.getItem(path.slice(0,-1))
    let snipText = snip.content;
    const result = {
      text: snipText,
      richText: snipText,
      nosubst: true,
    }
    
    // skip processing if Clippings [NOSUBST] flag is in the name
    if (snip.name.slice(0,9) === "[NOSUBST]") return result;

    // process counters, kept track internally to allow use across multiple snippets
    let counterUse = false;
    snipText = snipText.replaceAll(/#\[(.+?)\]/g, (match, p1) => {
      if (!counterUse) counterUse = true;
      if (p1 in this.data.counters === false) {
        this.data.counters[p1] = this.data.counters.startVal;
      }
      return this.data.counters[p1]++;
    });
    // save space if counters were used and thus incremented
    if (counterUse) await this.save();
  
    // process placeholders
    snipText = snipText.replaceAll(/\$\[(.+?)(?:\((.+?)\))?(?:\{(.+?)\})?\]/g, (match, p1, p2, p3) => {
      if (p3) p3 = p3.split('|');
      const now = new Date();
  
      // function for full date/time format string replacement (compatible with Clippings)
      const formattedDateTime = (dateString, date) => {
        // required for ordinal suffixes as not part of Intl yet
        const pr = new Intl.PluralRules(locale, { type: "ordinal" });
        const suffixes = {
          "en": { "one": "st", "two": "nd", "few": "rd", "other": "th" }
        }
        const datePartsToObject = (obj, item) =>
          (item.type === "literal") ? obj : (obj[item.type] = item.value, obj);
  
        // generate localized replacement objects for full replacement support
        const longDate = new Intl.DateTimeFormat(locale, {
          hourCycle: "h12",
          weekday: "long", day: "numeric", month: "long",
          hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3,
          dayPeriod: "long", timeZoneName: "long", era: "long",
        }).formatToParts(date).reduce(datePartsToObject, {});
        const shortDate = new Intl.DateTimeFormat(locale, {
          hourCycle: "h12",
          weekday: "short", day: "numeric", month: "short",
          hour: "numeric", minute: "numeric", second: "numeric", fractionalSecondDigits: 1,
          timeZoneName: "short", era: "short",
        }).formatToParts(date).reduce(datePartsToObject, {});
        const paddedDate = new Intl.DateTimeFormat(locale, {
          hourCycle: "h23",
          year: "2-digit", month: "2-digit", day: "2-digit",
          hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 2,
          timeZoneName: "longOffset",
        }).formatToParts(date).reduce(datePartsToObject, {});
        // numeric date/times will only not be padded if loaded individually
        const numericDate = new Intl.DateTimeFormat(locale, {
          hourCycle: "h23", year: "numeric", hour: "numeric",
        }).formatToParts(date).concat(new Intl.DateTimeFormat(locale, {
          month: "numeric", minute: "numeric",
        }).formatToParts(date).concat(new Intl.DateTimeFormat(locale, {
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
                seconds += "." + shortDate.fractionalSecond;
                break;
            
              case ".ss":
                seconds += "." + paddedDate.fractionalSecond;
                break;
            
              case ".sss":
                seconds += "." + longDate.fractionalSecond;
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
            return numericDate.day + (suffixes[locale.slice(0,2)][pr.select(parseInt(numericDate.day))] || "");
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
      }
      const UA = navigator.userAgent;
      let host;
      switch (p1.toUpperCase()) {
        case "DATE":
          if (p2) {
            // shorthand date options
            if (p2.toUpperCase() === "FULL") return new Intl.DateTimeFormat(locale, {
              dateStyle: "full",
            }).format(now);
            if (p2.toUpperCase() === "LONG") return new Intl.DateTimeFormat(locale, {
              dateStyle: "long"
            }).format(now);
            if (p2.toUpperCase() === "MEDIUM") return new Intl.DateTimeFormat(locale, {
              dateStyle: "medium"
            }).format(now);
            if (p2.toUpperCase() === "SHORT") return new Intl.DateTimeFormat(locale, {
              dateStyle: "short"
            }).format(now);
  
            return formattedDateTime(p2, now);
          }
          return now.toLocaleDateString();
  
        case "TIME":
          if (p2) {
            if (p2 === "full") return new Intl.DateTimeFormat(locale, {
              timeStyle: "full"
            }).format(now);
            if (p2 === "long") return new Intl.DateTimeFormat(locale, {
              timeStyle: "long"
            }).format(now);
            if (p2 === "medium") return new Intl.DateTimeFormat(locale, {
              timeStyle: "medium"
            }).format(now);
            if (p2 === "short") return new Intl.DateTimeFormat(locale, {
              timeStyle: "short"
            }).format(now);
  
            return formattedDateTime(p2, now);
          }
          return now.toLocaleTimeString();
  
        case "HOSTAPP":
          host = UA.match(/Edg\/([0-9.]+)/);
          if (host) return "Edge " + host[1];
          host = UA.match(/Chrome\/([0-9.]+)/);
          if (host) return "Chrome " + host[1];
          return match;
  
        case "UA":
          return UA;
  
        case "NAME":
          return snip.name;
  
        case "FOLDER":
          return folder.name;
      
        default:
          // TODO: popup requesting input values
          return match;
      }
    });

    return result;
  }

  getFolderCount(folderPath = this.path) {
    let folder = this.getItem(folderPath);
    return folder.children.filter(item => item.children).length;
  }

  sort({ by = 'seq', foldersOnTop = true, reverse = false, folderPath = ['all'], } = {}) {
    // recursive function in case everything needs to be sorted
    let sortFolder = (data, recursive, by, foldersOnTop, reverse) => {
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
    await dataBucket.compress();

    if (synced && !dataBucket.syncable(this.name)) {
      alert("The current snippets data is too large to sync.");
      return false;
    }
    const oldName = this.name,
        oldSynced = this.synced;
    this.name = name;
    this.synced = synced;
    let success = await this.save();
    if (success) {
      // remove old data
      removeStorageData(oldName, oldSynced);
    }
    return success;
  }

  async pivot({ name, synced, data, path }) {
    this.name = name;
    this.synced = synced;
    this.data = data ? new DataBucket(data).parse() : new DataBucket();
    this.path = path || [];
    return await this.load();
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
const saveToFile = (filename, text) => {
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
const buildContextMenus = async (space) => {
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
    let buildFolder = async function(folder, parentData) {
      let menuItem = {
        "contexts": ["editable"],
        "parentId": JSON.stringify(parentData),
      };
      // clone parent object to avoid polluting it
      let menuData = structuredClone(parentData);
      if (folder.length) {
        folder.forEach(item => {
          menuData.path = parentData.path.concat([item.seq]) ?? [item.seq];
          menuItem.id = JSON.stringify(menuData);
          // using emojis for ease of parsing, && escaping, nbsp needed for chrome bug
          menuItem.title = ((item instanceof Folder)
                         ? "📁 "
                         : "📝 ")
                         + item.name.replace("&", "&&")
                         + "\xA0\xA0\xA0\xA0";
          chrome.contextMenus.create(menuItem);
          if (item instanceof Folder)
            buildFolder(item.children, menuData);
        });
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