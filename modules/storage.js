import { i18n } from '/modules/refs.js'

/** Safely stores data in a chrome.storage bucket
 * @param {string} key The name of the storage bucket
 * @param {*} data Any JSON-serializable data
 * @param {'local'|'managed'|'session'|'sync'} [area] - Which storage area to look in (defaults to local)
 */
async function setStorageData(key, data, area = 'local') {
  // console.log('Storing data...', key, data)
  /** @type {chrome.storage.StorageArea} */
  const bucket = chrome.storage[area]
  if (!bucket) return
  return bucket.set({ [key]: data })
    .then(() => true).catch(e => (e, false))
}

/** Safely retrieves storage data from a chrome.storage bucket
 * @param {string} key - The name of the storage bucket
 * @param {'local'|'managed'|'session'|'sync'} [area] - Which storage area to look in (defaults to local)
 * @returns {Promise<*>} Any JSON serializable value or undefined
 */
async function getStorageData(key, area = 'local') {
  /** @type {chrome.storage.StorageArea} */
  const bucket = chrome.storage[area]
  if (!bucket) return
  const result = await bucket.get(key).catch(e => (e, {}))
  return result[key]
}

/** Safely removes storage data from chrome.storage.local (default) or .sync.
 * @param {string} key - The name of the storage bucket
 * @param {'local'|'managed'|'session'|'sync'} [area] - Which storage area to look in (defaults to local)
 */
async function removeStorageData(key, area = 'local') {
  /** @type {chrome.storage.StorageArea} */
  const bucket = chrome.storage[area]
  if (!bucket) return
  return bucket.remove(key)
    .then(() => true).catch(e => (e, false))
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

  // pseudonym for spaces
  get name() { return this.key }
  /** @param {string} name */
  set name(name) { this.key = name }

  // alternative to area name for sync/local
  get synced() { return this.area === 'sync' }
  /** @param {boolean} synced */
  set synced(synced) { this.area = synced ? 'sync' : 'local' }

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
  // local
  static get currentSpace() { return new StorageKey('_CurrentSpace', 'local') }
  static get notice() { return new StorageKey('_Notice', 'local') }

  // sync
  static get settings() { return new StorageKey('_Settings', 'sync') }
  static get defaultSpace() { return new StorageKey(i18n('app_name'), 'sync') }
  static get renameLog() { return new StorageKey('_RenameLog', 'sync') }

  // session
  static get followup() { return new StorageKey('_Followup', 'session') }

  // reserved keys
  static get reservedKeys() {
    return [
      this.settings,
      this.currentSpace,
      this.notice,
      this.followup,
      this.renameLog,
    ]
  }
}

/** Send text to clipboard
 * @param {{content:string,richText?:string}} snip a processed sniplet with optional rich text
 */
async function setClipboard(snip) {
  // console.log('Setting clipboard...', { ...snip })
  if (!snip?.content) return

  // set up items
  const items = {
    'text/plain': new Blob([snip.content], { type: 'text/plain' }),
    'text/html': new Blob([snip.richText || snip.content], { type: 'text/html' }),
  }
  // console.log(`Copying to clipboard...`);
  return navigator.clipboard.write([new ClipboardItem(items)])
    .then(() => true).catch(e => (e, false))
}

async function clearOldData() {
  // remove any spaces that are no longer current
  const storedData = {
    local: await chrome.storage.local.get(null),
    sync: await chrome.storage.sync.get(null),
  }
  const currentSpace = storedData?.[KeyStore.currentSpace.area]?.[KeyStore.currentSpace.key]
  for (const localKey in storedData.local) {
    if (!(KeyStore.reservedKeys.concat(currentSpace).find(
      v => (v.key === localKey && v.area === 'local'),
    ))) removeStorageData(localKey, 'local')
  }
  for (const syncKey in storedData.sync) {
    if (!(KeyStore.reservedKeys.concat(currentSpace).find(
      v => (v.key === syncKey && v.area === 'sync'),
    ))) removeStorageData(syncKey, 'sync')
  }
}

export {
  setStorageData,
  getStorageData,
  removeStorageData,
  StorageKey,
  KeyStore,
  setClipboard,
  clearOldData,
}
