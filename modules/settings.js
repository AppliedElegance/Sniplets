import { StorageKey, KeyStore } from '/modules/storage.js'

/** Settings object for persisting as session global */
export default class Settings {
  static View = class View {
    constructor({
      action = 'popup',
      rememberPath = false,
      sourceURL = false,
      adjustTextArea = true,
      collapseEditors = false,
    } = {}) {
      this.action = action
      this.rememberPath = rememberPath
      this.sourceURL = sourceURL
      this.maxEditorLines = 7 // currently not configurable
      this.adjustTextArea = adjustTextArea
      this.collapseEditors = collapseEditors
    }
  }

  static Sort = class Sort {
    constructor({
      by = 'seq',
      groupBy = '',
      foldersOnTop = true,
    } = {}) {
      this.by = by
      this.groupBy = groupBy
      this.foldersOnTop = foldersOnTop
    }
  }

  static Snipping = class Snipping {
    constructor({
      saveSource = false,
      preserveTags = false,
    } = {}) {
      this.saveSource = saveSource
      this.preserveTags = preserveTags
    }
  }

  static Pasting = class Pasting {
    constructor({
      rtLineBreaks = true,
      rtLinkEmails = true,
      rtLinkURLs = true,
    } = {}) {
      this.rtLineBreaks = rtLineBreaks
      this.rtLinkEmails = rtLinkEmails
      this.rtLinkURLs = rtLinkURLs
    }
  }

  static Data = class Data {
    constructor({
      compress = true,
      moreColors = false,
    } = {}) {
      this.compress = compress
      this.moreColors = moreColors
    }
  }

  static #defaultSpace = KeyStore.defaultSpace
  static get defaultSpace() { return Settings.#defaultSpace }
  static set defaultSpace({ key, area, name, synced } = KeyStore.defaultSpace) {
    Settings.#defaultSpace = new StorageKey(key || name, area || synced)
  }

  static #view = new Settings.View()
  static get view() { return Settings.#view }
  static set view(settings) {
    Settings.#view = new Settings.View(settings)
  }

  static #sort = new Settings.Sort()
  static get sort() { return Settings.#sort }
  static set sort(settings) {
    Settings.#sort = new Settings.Sort(settings)
  }

  static #snipping = new Settings.Snipping()
  static get snipping() { return Settings.#snipping }
  static set snipping(settings) {
    Settings.#snipping = new Settings.Snipping(settings)
  }

  static #pasting = new Settings.Pasting()
  static get pasting() { return Settings.#pasting }
  static set pasting(settings) {
    Settings.#pasting = new Settings.Pasting(settings)
  }

  static #data = new Settings.Data()
  static get data() { return Settings.#data }
  static set data(settings) {
    Settings.#data = new Settings.Data(settings)
  }

  /** Optionally take provided settings and initialize the remaining settings
   * @param {Settings} [settings] Settings object with legacy checks
   */
  static init({ defaultSpace, view, sort, snipping, pasting, data, control, foldersOnTop } = {}) {
    Settings.defaultSpace = defaultSpace
    Settings.view = view
    Settings.sort = {
      foldersOnTop: foldersOnTop, // legacy check
      ...(sort || {}),
    }
    Settings.snipping = {
      ...(control || {}), // legacy
      ...(snipping || {}),
    }
    Settings.pasting = {
      ...(control || {}), // legacy
      ...(pasting || {}),
    }
    Settings.data = data

    return this
  }

  /** Load settings from sync storage */
  static async load() {
    const settings = await KeyStore.settings.get()
    if (!settings) return

    // upgrade settings object as needed
    return this.init(settings)
  }

  /** Retrieve a serializable object */
  static get entries() {
    const entries = {}
    for (const [key, descriptors] of Object.entries(Object.getOwnPropertyDescriptors(Settings))) {
      if (descriptors.get && key !== 'entries') entries[key] = descriptors.get()
    }
    return entries
  }

  /** Save settings to sync storage */
  static async save() {
    return KeyStore.settings.set(this.entries)
  }
}
