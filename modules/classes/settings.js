import { i18n } from "../refs.js";
import { setStorageData, getStorageData } from "../storage.js";


/** Settings object for persisting as window global */
class Settings {
  /** @param {Settings} settings */
  constructor(settings) {
    if (settings) this.init(settings);
  }

  /** Optionally take provided settings and initialize the remaining settings
   * @param {Settings} [settings] 
   */
  init({ defaultSpace, sort, view, control, data } = {}) {
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
    /** @type {{by:('seq'|'name'),groupBy:(''|'color'|'src'),foldersOnTop:boolean}} */
    this.sort = setSort(sort);
    const setView = ({ adjustTextArea = true, sourceURL = false, rememberPath = false, action = 'popup' } = {}) => ({
      adjustTextArea: adjustTextArea,
      sourceURL: sourceURL,
      rememberPath: rememberPath,
      action: action,
    });
    /** @type {{adjustTextArea:boolean,sourceURL:boolean,rememberPath:boolean,action:('popup'|'panel'|'window')}} */
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
  }

  /** Load settings from sync storage */
  async load() {
    const { settings } = await getStorageData('settings', true);
    if (!settings) return;

    // legacy check
    if (settings.foldersOnTop) {
      settings.sort = { foldersOnTop: settings.foldersOnTop };
      delete settings.foldersOnTop;
    }

    // upgrade settings object as needed and return the object
    this.init(settings);
    return this;
  }

  /** Save settings to sync storage */
  async save() {
    return await setStorageData({ settings: this }, true);
  }
}

export {
  Settings,
};