import { getRichText } from "./refs.js";


/** Safely stores data in a chrome.storage bucket
 * @param {string} key The name of the storage bucket
 * @param {*} data Any JSON-serializable data
 * @param {['local', 'managed', 'session', 'sync']=} area - Which storage area to use (defaults to local)
 */
async function setStorageData(key, data, area = 'local') {
  /** @type {chrome.storage.StorageArea} */
  const bucket = chrome.storage[area];
  if (!bucket) return;
  return bucket.set({ [key]: data })
  .then(() => true)
  .catch((e) => (console.error(e)));
}

/** Safely retrieves storage data from a chrome.storage bucket
 * @param {string} key - The name of the storage bucket
 * @param {['local', 'managed', 'session', 'sync']=} area - Which storage area to look in (defaults to local)
 * @returns {Promise<*>} Any JSON serializable value or undefined
 */
async function getStorageData(key, area = 'local') {
  /** @type {chrome.storage.StorageArea} */
  const bucket = chrome.storage[area];
  if (!bucket) return;
  const result = await bucket.get(key)
  .catch((e) => (console.error(e), {}));
  return result[key];
}

/** Safely removes storage data from chrome.storage.local (default) or .sync.
 * @param {string} key - The name of the storage bucket
 * @param {['local', 'managed', 'session', 'sync']=} area - Which storage area to look in (defaults to local)
 */
async function removeStorageData(key, area = 'local') {
  /** @type {chrome.storage.StorageArea} */
  const bucket = chrome.storage[area];
  if (!bucket) return;
  return bucket.remove(key)
  .then(() => true)
  .catch((e) => (console.error(e)));
}

class StorageKey {
  /**
   * @param {string} key The name of the storage bucket
   * @param {['local', 'managed', 'session', 'sync']=} area Which storage area to use (defaults to 'local')
   */
  constructor (key, area = 'local') {
    this.key = key;
    this.area = area;
  }

  async set(data) {
    return setStorageData(this.key, data, this.area);
  }

  async get() {
    return getStorageData(this.key, this.area);
  }
}

const keyStore = {
  settings: new StorageKey('_Settings', 'sync'),
  currentSpace: new StorageKey('_CurrentSpace', 'local'),
  followup: new StorageKey('_Followup', 'session'),
  activeSessions: new StorageKey('_ActiveSessions', 'session'),
};

/** Stores data required for following up on a task and opens a window to action it
 * @param {string} type Action which needs handling in a popup window
 * @param {{[key:string]:*}} args Properties needed by the followup function
 */
const setFollowup = async (type, args) => {
  const followup = {
    type: type,
    args: args || {}, // default value for destructuring
  };

  // check if we're a window caller that can handle it directly
  if (typeof handleFollowup === 'function') {
    // eslint-disable-next-line no-undef
    handleFollowup(followup);
    return;
  }

  // alert any open windows that they should check for follow-ups or open a new one
  chrome.runtime.sendMessage({ type: 'followup', args: followup })
  .catch(() => chrome.action.openPopup());

  // actions should be handled 
  chrome.tabs.query({}, (tabs) => {
    console.log(Array.from(tabs));
    
    // TODO: send to the correct tab
    // let doFlag = true;
    // for (let i=tabs.length-1; i>=0; i--) {
    //   if (tabs[i].url === `chrome-extension://${chrome.i18n.getMessage("@@extension_id")}/feedback-panel.html`) {
    //     //your popup is alive
    //     doFlag = false;
    //     chrome.tabs.update(tabs[i].id, { active: true }); //focus it
    //     break;
    //   }
    // }
    // if (doFlag) { //it didn't found anything, so create it
    //   window.open('feedback-panel.html', 'Feedback', 'width=935, height=675');
    // }
  });
  
  // save followup for a window that can handle it
  // await chrome.storage.session.set({ followup: followup })
  // .catch((e) => console.error(e));
  // // alert any open windows that they should check for follow-ups or open a new one
  // chrome.runtime.sendMessage({ type: 'followup', args: followup })
  // .catch(() => openPopup());
  return;
};

/** Fetch requests from session storage set using the `setFollowup()` function
 * @returns {Promise<{type:string,message:*,args:*}|void>} Return object includes type, message and arguments
 */
const fetchFollowup = async () => {
  const followup = await keyStore.followup.get();
  if (followup) removeStorageData(keyStore.followup.key, keyStore.followup.area);
  return followup;
};

/** Send text to clipboard
 * @param {{content:string,nosubst:boolean}} snip The content of a snippet and whether to skip substitutions
 */
const setClipboard = async (snip) => {
  if(!snip.content) return;
  const items = {
    "text/plain":  new Blob([snip.content], { type: "text/plain" }),
  };
  if (!snip.nosubst) items["text/html"] = new Blob([await getRichText(snip)], { type: "text/html" });
  // console.log(`Copying to clipboard...`);
  return navigator.clipboard.write([new ClipboardItem(items)])
  .then(() => true)
  .catch((e) => console.error(e));
};

export {
  setStorageData,
  getStorageData,
  removeStorageData,
  StorageKey,
  keyStore,
  setFollowup,
  fetchFollowup,
  setClipboard,
};