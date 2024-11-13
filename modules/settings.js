import { StorageKey, KeyStore } from '/modules/storage.js'

/** Settings object for persisting as window global */
class Settings {
  static View = class View {
    constructor({
      adjustTextArea = true,
      sourceURL = false,
      rememberPath = false,
      action = 'popup',
    } = {}) {
      this.adjustTextArea = adjustTextArea
      this.sourceURL = sourceURL
      this.rememberPath = rememberPath
      this.action = action
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
      this.rtLinkUrls = rtLinkURLs
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

  constructor() {
    this.init()
  }

  #defaultSpace = KeyStore.defaultSpace
  get defaultSpace() { return this.#defaultSpace }
  set defaultSpace({ key, area, name, synced } = KeyStore.defaultSpace) {
    this.#defaultSpace = new StorageKey(key || name, area || synced)
  }

  #view = new Settings.View()
  get view() { return this.#view }
  set view(settings) {
    this.#view = new Settings.View({
      ...this.#view,
      ...settings,
    })
  }

  #sort = new Settings.Sort()
  get sort() { return this.#sort }
  set sort(settings) {
    this.#sort = new Settings.Sort({
      ...this.#sort,
      ...settings,
    })
  }

  #snipping = new Settings.Snipping()
  get snipping() { return this.#snipping }
  set snipping(settings) {
    this.#snipping = new Settings.Snipping({
      ...this.#snipping,
      ...settings,
    })
  }

  #pasting = new Settings.Pasting()
  get pasting() { return this.#pasting }
  set pasting(settings) {
    this.#pasting = new Settings.Pasting({
      ...this.#pasting,
      ...settings,
    })
  }

  #data = new Settings.Data()
  get data() { return this.#data }
  set data(settings) {
    this.#data = new Settings.Data({
      ...this.#data,
      ...settings,
    })
  }

  /** Optionally take provided settings and initialize the remaining settings
   * @param {Settings} [settings] Settings object with legacy checks
   */
  init({ defaultSpace, view, sort, snipping, pasting, data, control, foldersOnTop } = {}) {
    // console.log(defaultSpace, sort, view, control, data);

    this.defaultSpace = defaultSpace
    this.view = view
    this.sort = {
      foldersOnTop: foldersOnTop, // legacy check
      ...(sort || {}),
    }
    this.snipping = {
      ...(control || {}), // legacy
      ...(snipping || {}),
    }
    this.pasting = {
      ...(control || {}), // legacy
      ...(pasting || {}),
    }
    this.data = data

    return this
  }

  /** Load settings from sync storage */
  async load() {
    const legacyKey = new StorageKey('settings', 'sync')
    const settings = await KeyStore.settings.get() || await legacyKey.get()
    if (!settings) return

    // upgrade settings object as needed and return the object
    return this.init(settings)
  }

  /** Save settings to sync storage */
  async save() {
    return KeyStore.settings.set(this)
  }
}

export default new Settings()
