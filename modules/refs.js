// currently unable to import styles using with keyword in web worker

/** chrome.i18n helper to pull strings from _locales/[locale]/messages.json
 * @param {string} messageName
 * @param {string|string[]} substitutions
 * @example
 * // returns "Sniplets"
 * i18n("app_name")
 */
const i18n = (messageName, substitutions) => chrome.i18n.getMessage(messageName, substitutions)
const locale = i18n('@@ui_locale').replace('_', '-')
const i18nNum = (i, options = { useGrouping: false }) =>
  new Intl.NumberFormat(locale, options).format(i)
const i18nOrd = i => i18n(`ordinal_${new Intl.PluralRules(locale, { type: 'ordinal' }).select(i)}`, i)

// see https://developer.chrome.com/docs/extensions/reference/api/runtime#type-ContextType
class Contexts {
  // Copy over enum as shorthand
  static get TAB() { return chrome.runtime.ContextType.TAB }
  static get POPUP() { return chrome.runtime.ContextType.POPUP }
  static get BACKGROUND() { return chrome.runtime.ContextType.BACKGROUND }
  static get OFFSCREEN_DOCUMENT() { return chrome.runtime.ContextType.OFFSCREEN_DOCUMENT }
  static get SIDE_PANEL() { return chrome.runtime.ContextType.SIDE_PANEL }

  static #views = new Map([
    ['popup', this.POPUP],
    ['panel', this.SIDE_PANEL],
    ['panel-toggle', this.SIDE_PANEL],
    ['window', this.TAB],
  ])

  static get(view) { return Contexts.#views.get(view) }
}

class Tasks {
  static get SNIP() { return 'snip' }
  static get PASTE() { return 'paste' }
}

class ColorIconSet {
  /**
   * @param {string} label An internationalized name for the color
   * @param {{[name:string]:string}} icons
   */
  constructor(label, icons) {
    this.label = label
    Object.assign(this, icons)
  }

  // special handling for folder icons
  /** @type {string} */
  #folder
  get folder() { return this.#folder || this.book || this.square || this.heart }
  set folder(folder) { this.#folder = folder }

  // special handling for sniplet icons
  /** @type {string} */
  #sniplet
  get sniplet() { return this.#sniplet || this.circle || this.heart }
  set sniplet(sniplet) { this.#sniplet = sniplet }
}

/** Available colours based on the Windows heart emoji spectrum rather than named css colors
 * ❤️🩷🧡💛💚💙🩵💜🤎🖤🤍🩶
 * See the css ':root' variables for actual values
 */
class Colors {
  // All colors have hearts, all but pink & lightblue have squares and circles, some have books
  static #map = new Map([
    ['red', new ColorIconSet(i18n('color_red'), {
      heart: '❤️', square: '🟥', circle: '🔴', book: '📕',
    })],
    ['pink', new ColorIconSet(i18n('color_pink'), {
      heart: '🩷',
    })],
    ['orange', new ColorIconSet(i18n('color_orange'), {
      heart: '🧡', square: '🟧', circle: '🟠', book: '📙',
    })],
    ['yellow', new ColorIconSet(i18n('color_yellow'), {
      heart: '💛', square: '🟨', circle: '🟡', book: '📒',
    })],
    ['green', new ColorIconSet(i18n('color_green'), {
      heart: '💚', square: '🟩', circle: '🟢', book: '📗',
    })],
    ['lightblue', new ColorIconSet(i18n('color_lightblue'), {
      heart: '🩵',
    })],
    ['blue', new ColorIconSet(i18n('color_blue'), {
      heart: '💙', square: '🟦', circle: '🔵', book: '📘',
    })],
    ['purple', new ColorIconSet(i18n('color_purple'), {
      heart: '💜', square: '🟪', circle: '🟣',
    })],
    ['brown', new ColorIconSet(i18n('color_brown'), {
      heart: '🤎', square: '🟫', circle: '🟤',
    })],
    ['black', new ColorIconSet(i18n('color_black'), {
      heart: '🖤', square: '⬛️', circle: '⚫️',
    })],
    ['white', new ColorIconSet(i18n('color_white'), {
      heart: '🤍', square: '⬜️', circle: '⚪️',
    })],
    ['gray', new ColorIconSet(i18n('color_gray'), {
      heart: '🩶', square: '🌫️', circle: '🪨',
    })],
  ])

  /** Retrieve properties of a color
   * @param {string=} color The internal name of the color. If left blank, a default color object will be returned
   * @returns {ColorIconSet}
   */
  static get(color) {
    return Colors.#map.get(color) || new ColorIconSet(i18n('color_default'), '', {
      folder: '📁', sniplet: '📝',
    })
  }

  // full list of selectable colours
  static get list() {
    return Array.from(Colors.#map.keys())
  }

  // list of colours available in Clippings
  static get clippingsList() {
    return ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray']
  }
}

// taken from https://stackoverflow.com/a/73891404/3083215
async function replaceAllAsync(string, pattern, replacement) {
  const replacements = await Promise.all(Array.from(
    string.matchAll(pattern),
    match => replacement(...match),
  ))
  let i = 0
  return string.replace(pattern, () => replacements[i++])
}

export {
  i18n,
  locale,
  i18nNum,
  i18nOrd,
  Contexts,
  Tasks,
  Colors,
  replaceAllAsync,
}
