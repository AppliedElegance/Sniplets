import { getRichText } from "./refs.js";

/** Safely stores data to chrome.storage.local (default) or .sync.
 * @param {{[key:string]:*}} items - a {key: value} object to store
 * @param {boolean} [sync=false] - Whether to store the data in local (false, default) or sync (true).
 */
const setStorageData = async (items, sync = false) => {
  const bucket = sync ? chrome.storage.sync : chrome.storage.local;
  return bucket.set(items)
  .then(() => true)
  .catch((e) => (console.error(e), false));
};

/** Safely retrieves storage data from chrome.storage.local (default) or .sync.
 * @param {null|string|string[]|{[key:string]:*}} keys - The key name for the stored data.
 * @param {boolean} [sync=false] - Whether to look in local (false, default) or sync (true).
 */
const getStorageData = async (keys, sync = false) => {
  const bucket = sync ? chrome.storage.sync : chrome.storage.local;
  return bucket.get(keys)
  .catch((e) => (console.error(e), {}));
};

/** Safely removes storage data from chrome.storage.local (default) or .sync.
 * @param {string|string[]} keys - The key name for the stored data.
 * @param {boolean} [sync=false] - Whether to look in local (false, default) or sync (true).
 */
const removeStorageData = async (keys, sync = false) => {
  const bucket = sync ? chrome.storage.sync : chrome.storage.local;
  return bucket.remove(keys)
  .then(() => true)
  .catch((e) => (console.error(e), false));
};

/** Get details of saved current space
 * @returns {Promise<{name:string,synced:boolean,path?:number[]}>}
*/
const getCurrentSpace = async () => (await getStorageData('currentSpace'))?.currentSpace;

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

  // actions should be handled 
  chrome.tabs.query({}, (tabs) => {
    console.log(Array.from(tabs));
    
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
 * @returns {Promise<{type:string,message:*,args:Object}|void>}
 */
const fetchFollowup = async () => {
  const { followup } = await chrome.storage.session.get('followup')
  .catch(e => console.error(e));
  if (followup) chrome.storage.session.remove('followup')
  .catch(e => console.error(e));
  // console.log(followup);
  return followup;
};

/** Send text to clipboard
 * @param {{content:string,nosubst:boolean}} snip 
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
  getCurrentSpace,
  setFollowup,
  fetchFollowup,
  setClipboard,
};