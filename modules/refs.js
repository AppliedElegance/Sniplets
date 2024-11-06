import { Settings } from "./classes/settings.js";


/** chrome.i18n helper to pull strings from _locales/[locale]/messages.json
 * @param {string} messageName 
 * @param {string|string[]} substitutions
 * @example
 * // returns "Sniplets"
 * i18n("app_name")
 */
const i18n = (messageName, substitutions) => chrome.i18n.getMessage(messageName, substitutions);
/** @type {string} */
const uiLocale = i18n('@@ui_locale').replace('_', '-');
const i18nNum = (i, options = { useGrouping: false }) =>
  new Intl.NumberFormat(uiLocale, options).format(i);
const i18nOrd = (i) =>
  i18n(`ordinal_${new Intl.PluralRules(uiLocale).select(i)}`, i);

const defaultColor = 'default';

/** Map of default colours
 * @type {Map<string,{value:string,label:string,square:string,circle:string,heart:string,book?:string,folder:string,sniplet:string}>}
 */
const colors = new Map()
.set(defaultColor, { value: "inherit", label: i18n('color_default'), square: "⬛️", circle: "⚫️", heart: "🖤",             folder: "📁",                       sniplet: "📝" })
.set('red',     { value: "#D0312D", label: i18n('color_red'),     square: "🟥", circle: "🔴", heart: "❤️", book: "📕", get folder() {return this.book;},   get sniplet() {return this.circle;} })
.set('orange',  { value: "#FFA500", label: i18n('color_orange'),  square: "🟧", circle: "🟠", heart: "🧡", book: "📙", get folder() {return this.book;},   get sniplet() {return this.circle;} })
.set('yellow',  { value: "#FFD700", label: i18n('color_yellow'),  square: "🟨", circle: "🟡", heart: "💛", book: "📒", get folder() {return this.book;},   get sniplet() {return this.circle;} })
.set('green',   { value: "#3CB043", label: i18n('color_green'),   square: "🟩", circle: "🟢", heart: "💚", book: "📗", get folder() {return this.book;},   get sniplet() {return this.circle;} })
.set('blue',    { value: "#3457D5", label: i18n('color_blue'),    square: "🟦", circle: "🔵", heart: "💙", book: "📘", get folder() {return this.book;},   get sniplet() {return this.circle;} })
.set('purple',  { value: "#A32CC4", label: i18n('color_purple'),  square: "🟪", circle: "🟣", heart: "💜",             get folder() {return this.square;}, get sniplet() {return this.circle;} })
.set('gray',    { value: "#808080", label: i18n('color_gray'),    square: "⬜️", circle: "⚪️", heart: "🤍", book: "📓", get folder() {return this.book;},   get sniplet() {return this.circle;} });

/** Safe getter for the colors that will return a default value if not available
 * @param {string} [color] 
 */
const getColor = color => colors.get(colors.has(color) ? color : defaultColor);

/** Add HTML line break tags where appropriate and remove newlines to avoid unwanted spaces
 * @param {string} text
 */
const tagNewlines = text => text.replaceAll(
  /(?<!<\/(?!a|span|strong|em|b|i|q|mark|input|button)[a-zA-Z0-9]+?>\s*?)(?:\r\n|\r|\n)/g,
  () => '<br>',
).replaceAll(
  /\r\n|\r|\n/g,
  '',
);

/** Place anchor tags around emails if not already linked
 * @param {string} text
 */
const linkEmails = text => text.replaceAll(
  /(?<!<[^>]*)(?:[a-zA-Z0-9!#$%&'*+\-/=?^_`{|}~][a-zA-Z0-9!#$%&'*+\-/=?^_`{|}~.]*[a-zA-Z0-9!#$%&'*+\-/=?^_`{|}~]|[a-zA-Z0-9!#$%&'*+\-/=?^_`{|}~])@(?:(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]+)(?!(?!<a).*?<\/a>)/ig,
  (match) => `<a href="mailto:${match}">${match}</a>`,
);

/** Place anchor tags around urls if not already linked
 * @param {string} text
 */
const linkURLs = text => text.replaceAll(
  /<a.+?\/a>|<[^>]*?>|((?<![.+@a-zA-Z0-9])(?:(https?|ftp|chrome|edge|about|file):\/+)?(?:(?:[a-zA-Z0-9]+\.)+[a-z]+|(?:[0-9]+\.){3}[0-9]+)(?::[0-9]+)?(?:\/(?:[a-zA-Z0-9!$&'()*+,-./:;=?@_~#]|%\d{2})*)?)/gi,
  (match, p1, p2) => {
    // console.log(match, p1, p2);
    // skip anchors and tag attributes
    if (!p1) return match;
    // skip IP addresses with no protocol
    if (match.match(/^\d+\.\d+\.\d+\.\d+$/)) return match;
    // ensure what was picked up evaluates to a proper url (just in case)
    const matchURL = new URL(((!p2) ? `http://${match}` : match));
    // console.log(matchURL);
    return (matchURL) ? `<a href="${matchURL.href}">${match}</a>` : match;
  },
);

/** Process and return snip contents according to rich text settings
 * @param {{content:string,nosubst:boolean}} snip 
 */
const getRichText = async (snip) => {
  // don't process flagged sniplets
  if (snip.nosubst) return snip.content;
  // work on string copy
  let text = snip.content;
  // check what processing has been enabled
  const settings = new Settings();
  await settings.load();
  const { rtLineBreaks, rtLinkEmails, rtLinkURLs } = settings.control;
  // process according to settings
  if (rtLineBreaks) text = tagNewlines(text);
  if (rtLinkEmails) text = linkEmails(text);
  if (rtLinkURLs) text = linkURLs(text);
  return text;
};

export {
  i18n,
  uiLocale,
  i18nNum,
  i18nOrd,
  defaultColor,
  colors,
  getColor,
  getRichText,
};