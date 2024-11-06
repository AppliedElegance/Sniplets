import { i18n } from "../refs.js";
import { StorageKey, keyStore } from "../storage.js";


/** Settings object for persisting as window global */
class Settings {
  /** @param {Settings} settings Settings object for init, normally omitted in favour of load() */
  constructor(settings) {
    if (settings) this.init(settings);
  }

  /** Optionally take provided settings and initialize the remaining settings
   * @param {Settings} [settings] Settings object with legacy checks
   */
  init({ defaultSpace, sort, view, control, data, foldersOnTop } = {}) {
    // console.log(defaultSpace, sort, view, control, data);

    const setDefaultSpace = ({ name = i18n('default_space_name'), synced = true } = {}) => ({
      name: name,
      synced: synced,
    });
    /** @type {{name:string,synced:boolean}} */
    this.defaultSpace = setDefaultSpace(defaultSpace);

    const setSort = ({ by = 'seq', groupBy = '', foldersOnTop = true } = {}) => ({
      by: by,
      groupBy: groupBy,
      foldersOnTop: foldersOnTop,
    });
    // legacy check
    sort ||= {};
    sort.foldersOnTop ||= foldersOnTop;
    /** @type {{by:('seq'|'name'),groupBy:(''|'color'|'src'),foldersOnTop:boolean}} */
    this.sort = setSort(sort);

    const setView = ({ adjustTextArea = true, sourceURL = false, rememberPath = false, action = 'popup' } = {}) => ({
      adjustTextArea: adjustTextArea,
      sourceURL: sourceURL,
      rememberPath: rememberPath,
      action: action,
    });
    /** @type {{adjustTextArea:boolean,sourceURL:boolean,rememberPath:boolean,action:('popup'|'panel'|'panel-toggle'|'window')}} */
    this.view = setView(view);

    const setControl = ({ saveSource = false, preserveTags = false, rtLineBreaks = true, rtLinkEmails = true, rtLinkURLs = true } = {}) => ({
      saveSource: saveSource,
      preserveTags: preserveTags,
      rtLineBreaks: rtLineBreaks,
      rtLinkEmails: rtLinkEmails,
      rtLinkURLs: rtLinkURLs,
    });
    /** @type {{saveSource:boolean,preserveTags:boolean,rtLineBreaks:boolean,rtLinkEmails:boolean,rtLinkURLs:boolean}} */
    this.control = setControl(control);

    const setData = ({ compress = true } = {}) => ({
      compress: compress,
    });
    /** @type {{compress:boolean}} */
    this.data = setData(data);

    return this;
  }

  /** Load settings from sync storage */
  async load() {
    const legacyKey = new StorageKey('settings', 'sync');
    const settings = await keyStore.settings.get()
                  || await legacyKey.get();
    if (!settings) return;

    // upgrade settings object as needed and return the object
    return this.init(settings);
  }

  /** Save settings to sync storage */
  async save() {
    return keyStore.settings.set(this);
  }
}


export {
  Settings,
};