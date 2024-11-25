import { i18n } from '/modules/refs.js'
import { getRichText } from '/modules/spaces.js'

/** Safely stores data in a chrome.storage bucket
 * @param {string} key The name of the storage bucket
 * @param {*} data Any JSON-serializable data
 * @param {['local', 'managed', 'session', 'sync']=} area - Which storage area to use (defaults to local)
 */
async function setStorageData(key, data, area = 'local') {
  // console.log('Storing data...', key, data)
  /** @type {chrome.storage.StorageArea} */
  const bucket = chrome.storage[area]
  if (!bucket) return
  return bucket.set({ [key]: data })
    .then(() => true)
    .catch(e => (console.error(e)))
}

/** Safely retrieves storage data from a chrome.storage bucket
 * @param {string} key - The name of the storage bucket
 * @param {['local', 'managed', 'session', 'sync']=} area - Which storage area to look in (defaults to local)
 * @returns {Promise<*>} Any JSON serializable value or undefined
 */
async function getStorageData(key, area = 'local') {
  /** @type {chrome.storage.StorageArea} */
  const bucket = chrome.storage[area]
  if (!bucket) return
  const result = await bucket.get(key)
    .catch(e => (console.error(e), {}))
  return result[key]
}

/** Safely removes storage data from chrome.storage.local (default) or .sync.
 * @param {string} key - The name of the storage bucket
 * @param {['local', 'managed', 'session', 'sync']=} area - Which storage area to look in (defaults to local)
 */
async function removeStorageData(key, area = 'local') {
  /** @type {chrome.storage.StorageArea} */
  const bucket = chrome.storage[area]
  if (!bucket) return
  return bucket.remove(key)
    .then(() => true)
    .catch(e => (console.error(e)))
}

class StorageKey {
  /**
   * @overload
   * @param {string} key The name of the storage bucket
   * @param {boolean} synced whether to use sync or local chrome storage area
   */
  /**
   * @overload
   * @param {string} key The name of the storage bucket
   * @param {'local'} area Which storage area to use (defaults to 'local')
   */
  /**
   * @overload
   * @param {string} key The name of the storage bucket
   * @param {'managed'} area Which storage area to use (defaults to 'local')
   */
  /**
   * @overload
   * @param {string} key The name of the storage bucket
   * @param {'session'} area Which storage area to use (defaults to 'local')
   */
  /**
   * @overload
   * @param {string} key The name of the storage bucket
   * @param {'sync'} area Which storage area to use (defaults to 'local')
   */
  /**
   * @param {string} key The name of the storage bucket
   * @param {(boolean|string)=} area Which storage area to use (defaults to 'local')
   */
  constructor(key, area) {
    this.key = key
    this.area = (['local', 'managed', 'session', 'sync'].includes(area)
      ? area
      : (area === true ? 'sync' : 'local'))
  }

  // pseudonyms for spaces
  get name() { return this.key }
  get synced() { return this.area === 'sync' }

  async set(data) {
    return setStorageData(this.key, data, this.area)
  }

  async get() {
    return getStorageData(this.key, this.area)
  }

  async clear() {
    return removeStorageData(this.key, this.area)
  }
}

class KeyStore {
  static get settings() { return new StorageKey('_Settings', 'sync') }
  static get currentSpace() { return new StorageKey('_CurrentSpace', 'local') }
  static get defaultSpace() { return new StorageKey(i18n('app_name'), 'sync') }
  static get followup() { return new StorageKey('_Followup', 'session') }
}

/** Send text to clipboard
 * @param {{content:string,nosubst:boolean}} snip The content of a snippet and whether to skip substitutions
 */
async function setClipboard(snip) {
  if (!snip.content) return
  const items = {
    'text/plain': new Blob([snip.content], { type: 'text/plain' }),
  }
  if (!snip.nosubst) items['text/html'] = new Blob([await getRichText(snip)], { type: 'text/html' })
  // console.log(`Copying to clipboard...`);
  return navigator.clipboard.write([new ClipboardItem(items)])
    .then(() => true)
    .catch(e => console.error(e))
}

export {
  setStorageData,
  getStorageData,
  removeStorageData,
  StorageKey,
  KeyStore,
  setClipboard,
}
