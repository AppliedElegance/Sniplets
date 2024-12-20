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
const i18nOrd = i =>
  i18n(`ordinal_${new Intl.PluralRules(locale).select(i)}`, i)

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

class Color {
  /**
   * @param {string} label An internationalized name for the color
   * @param {string} value A valid css color
   * @param {{[name:string]:string}} icons
   */
  constructor(label, value, icons) {
    this.label = label
    this.value = value
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

/** Available colours based on the Windows heart emoji spectrum rather than named css colors */
class Colors {
  // Enum based on heart colors on Windows: ❤️🩷🧡💛💚💙🩵💜🤎🖤🤍🩶
  static get RED() { return 'oklch(63.38% 0.2310 27.51)' }
  static get PINK() { return 'oklch(72.46% 0.1866 0.08)' }
  static get ORANGE() { return 'oklch(70.08% 0.1978 41.49)' }
  static get YELLOW() { return 'oklch(88.59% 0.1641 94.67)' }
  static get GREEN() { return 'oklch(75.34% 0.2006 151.44)' }
  static get BLUE() { return 'oklch(53.93% 0.1398 246.4)' }
  static get LIGHTBLUE() { return 'oklch(81.37% 0.1038 240.72)' }
  static get PURPLE() { return 'oklch(58.64% 0.1462 301.27)' }
  static get BROWN() { return 'oklch(43.57% 0.0616 43.74)' }
  static get BLACK() { return 'oklch(22.64% 0 0)' }
  static get WHITE() { return 'oklch(97.02% 0 0)' }
  static get GREY() { return 'oklch(69.27% 0 0)' }

  // All colors have hearts, all but pink & lightblue have squares and circles, some have books
  static #map = new Map([
    ['red', new Color(i18n('color_red'), this.RED, {
      heart: '❤️', square: '🟥', circle: '🔴', book: '📕',
    })],
    ['pink', new Color(i18n('color_pink'), this.PINK, {
      heart: '🩷',
    })],
    ['orange', new Color(i18n('color_orange'), this.ORANGE, {
      heart: '🧡', square: '🟧', circle: '🟠', book: '📙',
    })],
    ['yellow', new Color(i18n('color_yellow'), this.YELLOW, {
      heart: '💛', square: '🟨', circle: '🟡', book: '📒',
    })],
    ['green', new Color(i18n('color_green'), this.GREEN, {
      heart: '💚', square: '🟩', circle: '🟢', book: '📗',
    })],
    ['blue', new Color(i18n('color_blue'), this.BLUE, {
      heart: '💙', square: '🟦', circle: '🔵', book: '📘',
    })],
    ['lightblue', new Color(i18n('color_lightblue'), this.LIGHTBLUE, {
      heart: '🩵',
    })],
    ['purple', new Color(i18n('color_purple'), this.PURPLE, {
      heart: '💜', square: '🟪', circle: '🟣',
    })],
    ['brown', new Color(i18n('color_brown'), this.BROWN, {
      heart: '🤎', square: '🟫', circle: '🟤',
    })],
    ['black', new Color(i18n('color_black'), this.BLACK, {
      heart: '🖤', square: '⬛️', circle: '⚫️',
    })],
    ['white', new Color(i18n('color_white'), this.WHITE, {
      heart: '🤍', square: '⬜️', circle: '⚪️',
    })],
    ['gray', new Color(i18n('color_gray'), this.GREY, {
      heart: '🩶', square: '🌫️', circle: '🪨',
    })],
  ])

  /** Retrieve properties of a color
   * @param {string=} color The internal name of the color. If left blank, a default color object will be returned
   * @returns {Color}
   */
  static get(color) {
    return Colors.#map.get(color) || new Color(i18n('color_default'), '', {
      folder: '📁', sniplet: '📝',
    })
  }

  /** Retrieve a color with a given translucency value
   * @param {string=} color The internal name of the color.
   * @param {number} alpha The opacity level between 0 and 1
   */
  static getWithAlpha(color, alpha) {
    const { value } = this.get(color)
    return `${value.slice(0, -1)} / ${alpha})`
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
