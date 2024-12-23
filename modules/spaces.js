import { i18n, locale, i18nOrd, Colors } from '/modules/refs.js'
import { StorageKey, KeyStore } from '/modules/storage.js'
import settings from '/modules/settings.js'
import { ParseError } from '/modules/errors.js'

/** Converts a boolean value (`synced`) to a `chrome.storage` area name
 * @param {boolean} synced `true` for `'sync'` and `false` for `'local'`
 * @returns {'sync'|'local'} The appropriate area name
 */
const getStorageArea = synced => synced ? 'sync' : 'local'

/** Return an array of numbers from a string path
 * @param {string} path (path in the form of '#,#,...' as when setting an array directly to an attribute)
 */
const parseStringPath = path => (path && (path !== 'root')) ? path.split(',').map(Number) : []

/** Base constructor for folders, sniplets and any future items */
class TreeItem {
  constructor({ name = i18n('title_new_generic'), seq, color } = {}) {
    /** @type {string} */
    this.name = name
    /** @type {number} */
    this.seq = seq

    /** legacy colorMap for upgrading to newest version (these values are deprecated but may be in backup files) */
    const legacyColors = new Map([
      ['Red', 'red'],
      ['Orange', 'orange'],
      ['Yellow', 'yellow'],
      ['Green', 'green'],
      ['Blue', 'blue'],
      ['Purple', 'purple'],
      ['Grey', 'gray'],
    ])

    /** @type {string} */
    this.color = legacyColors.get(color) || color // legacy color mapping check
  }
}
/** Folders contain tree items and can be nested. */
class Folder extends TreeItem {
  constructor({ name = i18n('title_new_folder'), seq, children, color, label } = {}) {
    super({
      name: name,
      seq: seq,
      color: color || label, // clippings uses the label field
    })
    /** @type {(TreeItem|Folder|Sniplet)[]} */
    this.children = children || []
  }
}
/** Sniplets are basic text blocks that can be pasted */
class Sniplet extends TreeItem {
  constructor({ name, seq, color, label, shortcut, sourceURL, content = '', nosubst = false } = {}) {
    // generate name from content if provided
    if (!name && content) {
      // create sniplet title from first line of text
      name = content.match(/^.*/).at(0)
      const maxLength = 27
      if (name.length > maxLength) {
        // cut down to size, then chuck trailing text if possible so no words are cut off
        name = name.slice(0, maxLength + 1)
        name = `${name.includes(' ')
          ? name.slice(0, name.lastIndexOf(' '))
          : name.slice(0, maxLength)}…`
      }
    }
    super({
      name: name || i18n('title_new_sniplet'),
      seq: seq || 1,
      color: color || label,
    })
    /** @type {string} */
    this.content = content
    /** @type {boolean} */
    this.nosubst = nosubst
    /** @type {string} */
    this.shortcut = shortcut
    /** @type {string} */
    this.sourceURL = sourceURL
  }
}
/** Basic sniplets data bucket */
class DataBucket {
  constructor({ version = '1.0', children = [], counters = {} } = {}) {
    /** @type {string} */
    this.version = version
    /** @type {number} */
    this.timestamp = Date.now()
    /** @type {(TreeItem|Folder|Sniplet)[]|string} */
    this.children = children
    const { startVal, ...encounters } = counters
    /** @type {{[name:string]:number}} */
    this.counters = encounters || {}
    this.counters.startVal = +startVal || 0
  }

  /** Compress root folder (children) using browser gzip compression */
  async compress() {
    // check if already compressed
    if (typeof this.children === 'string') {
      // confirm the compressed string is valid
      const testBucket = new DataBucket(this)
      if (!(await testBucket.parse())) return false
      return true
    }

    // create a compression stream
    const stream = new Blob([JSON.stringify(this.children)], { type: 'application/json' })
      .stream().pipeThrough(new CompressionStream('gzip'))
    // read the compressed stream and convert to b64
    const blob = await new Response(stream).blob()
    const buffer = await blob.arrayBuffer()
    this.children = btoa(String.fromCharCode(...new Uint8Array(buffer)))
    return true
  }

  /** Cast an tree item to its appropriate class
   * @param {(TreeItem | Folder | Sniplet)} item
   */
  cast(item) {
    if (!item) return
    if (Object.hasOwn(item, 'children')) return new Folder(item)
    if (Object.hasOwn(item, 'content')) return new Sniplet(item)
    return new TreeItem(item)
  }

  /** Cast an array of tree items to their appropriate class
   * @param {(TreeItem | Folder | Sniplet)[]=} folder
   */
  restructure(folder = this.children) {
    const items = []
    folder.forEach((item) => {
      if (Array.isArray(item.children) && item.children.length) {
        item.children = this.restructure(item.children)
      }
      items.push(this.cast(item))
    })
    return items
  }

  /** Decompress root folder (children) and cast objects as their appropriate TreeItem */
  async parse() {
    // check if compressed and otherwise just cast contents appropriately
    if (Array.isArray(this.children)) {
      this.children = this.restructure()
      return this
    }

    // decode base64 to gzip binary
    const binData = atob(this.children)
    const len = binData.length
    const gzipData = new Uint8Array(new ArrayBuffer(len))
    for (let i = 0; i < len; i++) {
      gzipData[i] = binData.charCodeAt(i)
    }

    try {
      // create stream for decompression
      const stream = new Blob([gzipData], { type: 'application/json' })
        .stream().pipeThrough(new DecompressionStream('gzip'))
      // read the decompressed stream
      const dataBlob = await new Response(stream).blob()
      const dataText = await dataBlob.text()
      // return decompressed and deserialized text
      this.children = this.restructure(JSON.parse(dataText))
      return this
    } catch (e) {
      throw new ParseError(this.children, e)
    }
  }

  /** Find an item based on text
   * @param {string} q The search string to use
   * @param {{field?:'name'|'content'|'shortcut',maxItems:number,matchCase:boolean,exactMatch:boolean}} [options] The optional field to constrain by and whether to match case
   */
  findItems(q, { field, maxItems, matchCase = false, exactMatch = false } = {}) {
    const results = []
    const queryString = matchCase ? q : q.toLowerCase()

    /** Recursive search through folders
     * @param {(Folder|Sniplet)[]} folder
     * @param {number[]} path
     * @param {'name'|'content'} loc
     */
    const pushFound = (folder, path, loc) => {
      const subfolders = []
      for (const item of folder) {
        if (maxItems > 0 && results.length === maxItems) return
        if (item instanceof Folder) subfolders.push(item)

        // add the path in case further processing needed and test query
        item.path = path
        const text = matchCase ? item[loc] : item[loc].toLowerCase()
        if (exactMatch && text === queryString) results.push(item)
        else if (text.includes(queryString)) results.push(item)
      }
      for (const subfolder of subfolders) pushFound(subfolder.children, path.concat(subfolder.seq), loc)
    }

    if (['name', 'content'].includes(field)) pushFound(this.children, [], field)
    else for (const loc of ['name', 'content']) pushFound(this.children, [], loc)
    return results
  }

  /** Retrieve a specific item using a path
   * @param {number[]} path
   */
  getItem(path) {
    // console.log('Getting item...', path)
    let item = this
    for (const seq of path) {
      if (!(item.children)) return // path broken
      item = item.children.find(v => v.seq === seq)
    }
    return item
  }

  /** Retrieve a specific item using a path
   * @param {number[]} path
   */
  getPathNames(path) {
    const pathNames = []
    let item = this
    for (const seq of path) {
      if (!(item.children)) return // path broken
      item = item.children.find(v => v.seq === seq)
      if (item) pathNames.push(item.name)
      else return
    }
    return pathNames
  }

  /** process data into a clippings compatible object */
  toClippings() {
    /** @param {(TreeItem|Folder|Sniplet)[]} folder */
    const mapData = folder => folder.map(o =>
      o instanceof Folder
        ? {
            name: o.name || '',
            children: mapData(o.children) || [],
            seq: o.seq - 1,
          }
        : {
            name: o.name || '',
            content: o.content || '',
            shortcutKey: o.shortcutKey || '',
            sourceURL: o.sourceURL || '',
            label: o.color,
            seq: o.seq - 1,
          })
    return {
      version: '6.1',
      createdBy: 'Clippings/wx',
      userClippingsRoot: mapData(this.children),
    }
  }

  /** Removes all saved sourceURLs recursively
   * @param {(TreeItem|Folder|Sniplet)} folder
   */
  removeSources(folder = this.children) {
    for (const item of folder) {
      if (item.children?.length) {
        this.removeSources(item.children)
      } else {
        item.sourceURL = undefined
      }
    }
  }
}

/** Space object stores sniplet groupings in buckets. */
class Space {
  /** Construct a Space object
   * @param {{
   *   name: string
   *   synced: boolean
   *   data: DataBucket
   *   path: number[]|string
   * }} details
   */
  constructor({ name = i18n('default_space_name'), synced = false, data = new DataBucket(), path = [] } = {}) {
    this.name = name
    this.synced = synced
    this.data = data
    this.path = path
  }

  // helper for storage handling
  get storageKey() {
    return new StorageKey(this.name, getStorageArea(this.synced))
  }

  async isSyncable({ compress = true }) {
    const testData = new DataBucket(this.data)
    if (compress) await testData.compress()
    const { size } = new Blob([JSON.stringify({ [this.name]: testData })])
    return (size <= chrome.storage.sync.QUOTA_BYTES_PER_ITEM)
  }

  /** Set this space as the current space in the local browser
   * @param {boolean} rememberPath
   */
  async setAsCurrent(rememberPath) {
    return KeyStore.currentSpace.set({
      ...this.storageKey,
      ...(rememberPath ? { path: this.path } : {}),
    })
  }

  /** load last used space or fall back to default */
  async loadCurrent() {
    const { path, ...key } = await KeyStore.currentSpace.get()
    if (!(await this.load(key, path))) {
      await settings.load()
      if (!(await this.load(settings.defaultSpace))) {
        // should never happen unless memory is corrupt
        return
      } else {
        this.setAsCurrent(settings.view.rememberPath)
      }
    }
    return true
  }

  /** Save the space's DataBucket into the appropriate storage
   * @param {{compress:boolean}} options External save options
   */
  async save({ compress = true } = {}) {
    // make sure the space has been initialized
    if (!this.name?.length) return

    // ensure synced space is syncable
    if (this.synced && !(await this.isSyncable(compress))) return

    const dataBucket = new DataBucket(this.data)
    // gzip compression adds about 8x more storage space, but can be toggled
    if (compress) await dataBucket.compress()

    // update local timestamp and store data
    this.data.timestamp = dataBucket.timestamp

    return this.storageKey.set(dataBucket)
  }

  /** Load a stored DataBucket into the space
   * @param {StorageKey} [key] Name (key) and area (synced?) of the space to load, reloads if omitted
   * @param {number[]} [path] Optional folder path
   */
  async load(key, path = []) {
    // make sure the storage key is typed
    const spaceLocker = new StorageKey(
      key?.key || key?.name || this.name,
      key?.area || key?.synced || this.synced,
    )
    if (!spaceLocker.name) return false
    const data = await spaceLocker.get()
    // console.log('Confirming data...', data)
    if (!data) return
    await this.init({
      name: spaceLocker.name,
      synced: spaceLocker.synced,
      data: data,
      path: path,
    })
    return true
  }

  /** Get an array of all the path names up to and including a specific folder seq
   * @param {number[]} path
   */
  getPathNames(path = this.path) {
    const folderNames = this.data.getPathNames(path)
    if (!folderNames) {
      console.error(`The requested path sequence ${path} doesn't exist.`, structuredClone(this))
      return
    }
    return [this.name].concat(folderNames)
  }

  /** Get the item found at a specific path sequence
   * @param {number[]} path - Full path to the tree item
   * @returns {TreeItem|Folder|Sniplet|void}
   */
  getItem(path = this.path) {
    const item = this.data.getItem(path)
    if (!item) {
      console.error(`The requested item path sequence ${path} doesn't exist. The last item reached: ${item}`)
      return
    }
    return item
  }

  /** Add tree item to data bucket
   * @param {TreeItem|Folder|Sniplet} item
   * @param {number[]} [folderPath]
   */
  addItem(item, folderPath = this.path) {
    const folder = this.getItem(folderPath).children
    item.seq = folder.length + 1
    folder.push(item)
    return item
  }

  /** Edit tree item
   * @param {number} seq
   * @param {string} field
   * @param {string} value
   * @param {number[]} [folderPath]
   */
  editItem(seq, field, value, folderPath = this.path) {
    const item = this.getItem(folderPath.concat([seq]))

    // validations for optional fields
    switch (field) {
      case 'color':
        item.color = Colors.list.includes(value)
          ? value
          : void 0
        break

      case 'shortcut':
        item.shortcut = (value.length === 1)
          ? value
          : void 0
        break

      case 'sourceURL':
        item.sourceURL = (value.length > 0)
          ? value
          : void 0
        break

      default:
        item[field] = value
        break
    }

    return item
  }

  /** Move tree item
   * @param {{path:number[],seq:number}} from
   * @param {{path:number[],seq:number}} to
   */
  moveItem(from, to) {
    // console.log(from, to);
    if (!from || !to || isNaN(from.seq)) return
    if (!Array.isArray(from.path)) from.path = this.path
    if (!Array.isArray(to.path)) to.path = this.path
    if (JSON.stringify(to) === JSON.stringify(from)) return
    const fromItem = this.getItem(from.path?.concat([from.seq]))
    if (!fromItem) return
    /** @type {Folder} */
    const fromFolder = this.getItem(from.path)
    /** @type {Folder} */
    const toFolder = this.getItem(to.path)
    const fromArraySeq = fromFolder.children.indexOf(fromItem)
    const toArraySeq = isNaN(to.seq)
      ? toFolder.children.length + 1
      : toFolder.children.indexOf(this.getItem(to.path.concat([to.seq])))
    try {
      toFolder.children.splice(toArraySeq, 0,
        fromFolder.children.splice(fromArraySeq, 1).at(0))
      this.sequence(toFolder)
      if (JSON.stringify(from.path) !== JSON.stringify(to.path))
        this.sequence(fromFolder)
    } catch (e) {
      console.error(e)
    }
    return fromItem
  }

  /** Remove tree item
   * @param {number} seq
   * @param {number[]} [folderPath]
   */
  deleteItem(seq, folderPath = this.path) {
    /** @type {*[]} */
    const folder = this.getItem(folderPath).children
    const i = folder.findIndex(o => o.seq === +seq)
    const removedItem = folder.splice(i, 1).at(0)
    return removedItem
  }

  // eslint-disable-next-line jsdoc/require-returns-check
  /** Process placeholders and rich text options of a sniplet and return the result
   * @param {number} seq The sniplet seq value
   * @param {number[]} path The folder path to look in
   * @param {string[]} embeds Embed chain to avoid endless loops
   * @returns {{content:string,richText:string,nosubst?:boolean,customFields?:[string,string][],counters?:[string,number][]}}
   */
  getProcessedSniplet(seq, path = this.path, embeds = []) {
    // get a copy of the requested sniplet
    const item = this.getItem(path.concat([seq]))
    if (!(item instanceof Sniplet)) return
    const sniplet = structuredClone(item)

    // Skip if there's nothing to process ('' is falsy)
    if (!sniplet.content) return sniplet

    // skip processing if Clippings [NOSUBST] flag is prepended to the name
    if (sniplet.name.slice(0, 9).toUpperCase() === '[NOSUBST]') {
      sniplet.nosubst = true
      return sniplet
    }

    // Set up maps for post-processes
    const counters = new Map()
    const customFields = new Map()

    // add current sniplet to embeds list to avoid infinite loops
    embeds.push(sniplet.name)

    const rxInlineSniplets = /\$\[(CLIPPING|SNIPLET)(?:\((.+?)\))?(?:\{(.+?)\})?\]/g
    /** Handle embedded sniplets first per Clippings, but allow for preprocessing
     * @param {string} match Entire string match
     * @param {'CLIPPING'|'SNIPLET'} placeholder The placeholder keyword
     * @param {string} preName The name of a sniplet to inline prior to processing (Clippings style)
     * @param {string} postName The name of a sniplet to inline after processing standard placeholders first
     */
    const processInlineSniplet = (match, placeholder, preName, postName) => {
      if ((!preName && !postName) || (preName && postName && preName !== postName)) return match

      // Get a copy of the sniplet to inline
      const inlineSniplet = structuredClone(this.data.findItems(preName || postName, {
        field: 'name', maxItems: 1, matchCase: true, exactMatch: true,
      }).at(0))
      if (!inlineSniplet || embeds.includes(inlineSniplet.name)) return match // avoid endless loops

      if (placeholder === 'SNIPLET' && preName) {
        embeds.push(inlineSniplet.name)
        inlineSniplet.content = inlineSniplet.content.replaceAll(rxInlineSniplets, processInlineSniplet)
        embeds.pop()
      } else if (placeholder === 'SNIPLET' && postName) {
        // not clippings compatible, but allows processing standard placeholders before embedding
        embeds.push(inlineSniplet.name)
        const snip = this.getProcessedSniplet(inlineSniplet.seq, inlineSniplet.path, embeds)
        embeds.pop()
        inlineSniplet.content = snip.content

        // update counters as needed, but ignore custom placeholders as they'll be rechecked
        if (snip.counters)
          for (const [key, value] of snip.counters)
            counters.set(key, (counters.get(key) || 0) + value)
      }

      return inlineSniplet.content
    }
    sniplet.content = sniplet.content.replaceAll(rxInlineSniplets, processInlineSniplet)

    const rxCounters = /#\[(.+?)(?:\((.+?)\))?\]/g
    /** Process counters and keep track of difference in case update is needed
     * @param {string} match
     * @param {string} counter
     * @param {string} increment
     */
    const processCounter = (match, counter, increment) => {
      const value = this.data.counters[counter] || this.data.counters.startVal
      const i = counters.get(counter) || 0

      // add the increment to the counters tracker so it can be updated when successfully used
      counters.set(counter, i + (increment ? +increment : 1))

      return value + i
    }
    sniplet.content = sniplet.content.replaceAll(rxCounters, processCounter)

    /** Process remaining placeholders and save custom ones for later processing
     * @param {string} match
     * @param {string} placeholder
     * @param {string} format
     * @param {string} defaultValue
     */
    const processPlaceholder = (match, placeholder, format, defaultValue) => {
      const now = new Date()
      const UA = navigator.userAgent
      if (defaultValue?.includes('|')) defaultValue = defaultValue.split('|')

      /** Full custom date/time format string replacement (compatible with Clippings) */
      const formatTimestamp = () => {
        // helper for setting up date objects
        const datePartsToObject = (obj, item) =>
          (item.type === 'literal') ? obj : (obj[item.type] = item.value, obj)

        // generate localized replacement objects for full replacement support
        const longDate = new Intl.DateTimeFormat(locale, {
          hourCycle: 'h12',
          weekday: 'long', day: 'numeric', month: 'long',
          hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3,
          dayPeriod: 'long', timeZoneName: 'long', era: 'long',
        }).formatToParts(now).reduce(datePartsToObject, {})
        const shortDate = new Intl.DateTimeFormat(locale, {
          hourCycle: 'h12',
          weekday: 'short', day: 'numeric', month: 'short',
          hour: 'numeric', minute: 'numeric', second: 'numeric', fractionalSecondDigits: 1,
          timeZoneName: 'short', era: 'short',
        }).formatToParts(now).reduce(datePartsToObject, {})
        const paddedDate = new Intl.DateTimeFormat(locale, {
          hourCycle: 'h23',
          year: '2-digit', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 2,
        }).formatToParts(now).reduce(datePartsToObject, {})

        // numeric date/times must be loaded individually to avoid extra padding
        const numericDate = new Intl.DateTimeFormat(locale, {
          year: 'numeric', hour: 'numeric', hourCycle: 'h23',
        }).formatToParts(now).concat(new Intl.DateTimeFormat(locale, {
          month: 'numeric', minute: 'numeric',
        }).formatToParts(now).concat(new Intl.DateTimeFormat(locale, {
          day: 'numeric', second: 'numeric', fractionalSecondDigits: 3, timeZoneName: 'longOffset',
        }).formatToParts(now))).reduce(datePartsToObject, {})
        // fix numeric 24 hours still being padded for some locals no matter how generated
        if (numericDate.hour.length === 2) numericDate.hour = numericDate.hour.replace(/^0/, '')
        // remove text from timezone offset
        numericDate.timeZoneName = numericDate.timeZoneName.replaceAll(/[^+\-\d]/g, '') || '+0000'
        console.log(numericDate, paddedDate, shortDate, longDate)

        // Replacer for each part of format string following Clippings &
        // https://docs.oracle.com/javase/8/docs/api/java/text/SimpleDateFormat.html
        const datetimeMap = new Map([
          ['d', numericDate.day],
          ['dd', paddedDate.day],
          ['do', i18nOrd(numericDate.day)],
          ['ddd', shortDate.weekday],
          ['dddd', longDate.weekday],
          ['M', numericDate.month], // m/mm = minutes
          ['MM', paddedDate.month],
          ['mmm', shortDate.month],
          ['mmmm', longDate.month],
          ['y', numericDate.year.slice(-1)],
          ['yy', numericDate.year.slice(-2)],
          ['yyy', numericDate.year.slice(-3)],
          ['yyyy', numericDate.year],
          ['g', shortDate.era],
          ['gg', shortDate.era],
          ['ggg', longDate.era],
          ['h', shortDate.hour],
          ['hh', longDate.hour],
          ['H', numericDate.hour],
          ['HH', paddedDate.hour],
          ['m', numericDate.minute],
          ['mm', paddedDate.minute],
          ['s', numericDate.second],
          ['ss', paddedDate.second],
          ['.s', `.${shortDate.fractionalSecond}`],
          ['.ss', `.${paddedDate.fractionalSecond}`],
          ['.sss', `.${longDate.fractionalSecond}`],
          ['a', shortDate.dayPeriod],
          ['A', shortDate.dayPeriod.toUpperCase()],
          ['z', shortDate.timeZoneName],
          ['zz', numericDate.timeZoneName], // Clippings style
          ['zzz', longDate.timeZoneName],
        ])

        // Replace DO (ordinal date) or letter patterns (allows strings like YYYYMMDDHHmmSS)
        return format.replaceAll(/D[oO]|\.?s+|([a-zA-Z])\1*/g, (match) => {
          console.log(match, match.toLowerCase(), datetimeMap.get(match), datetimeMap.get(match.toLowerCase()))
          return datetimeMap.get(match) // case sensitive matches
            || datetimeMap.get(match.toLowerCase()) // case insensitive matches
            || match // unknown character strings}
        })
      }

      const getDate = () => {
        const dateMap = new Map([
          ['full', Intl.DateTimeFormat(locale, { dateStyle: 'full' }).format(now)],
          ['long', Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(now)],
          ['medium', Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(now)],
          ['short', Intl.DateTimeFormat(locale, { dateStyle: 'short' }).format(now)],
        ])

        return format ? dateMap.get(format.toLowerCase()) || formatTimestamp() : now.toLocaleDateString()
      }

      const getTime = () => {
        const timeMap = new Map([
          ['full', Intl.DateTimeFormat(locale, { timeStyle: 'full' }).format(now)],
          ['long', Intl.DateTimeFormat(locale, { timeStyle: 'long' }).format(now)],
          ['medium', Intl.DateTimeFormat(locale, { timeStyle: 'medium' }).format(now)],
          ['short', Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(now)],
        ])

        return format ? timeMap.get(format.toLowerCase()) || formatTimestamp() : now.toLocaleTimeString()
      }

      // provide functions for consistency and so nothing's generated unless needed
      const placeholderMap = new Map([
        ['NAME', () => sniplet.name],
        ['FOLDER', () => this.getPathNames(path).pop()],
        ['PATH', () => this.getPathNames(path).join(typeof format === 'string' ? format : '/')],
        ['DATE', getDate],
        ['TIME', getTime],
        ['HOSTAPP', () =>
          UA.match(/Edg\/([0-9.]+)/)?.at(1).replace(/^/, 'Edge ')
          || UA.match(/Chrome\/([0-9.]+)/)?.at(1).replace(/^/, 'Chrome ')
          || match,
        ],
        ['UA', () => UA],
        ['CLIPPING', () => match],
        ['SNIPLET', () => match],
      ])

      // Handle default placeholders
      const placeholderValue = placeholderMap.get(placeholder)
      if (typeof placeholderValue === 'function') return placeholderValue()

      // Add custom placeholders for followup
      if (placeholder) {
        if (!customFields.has(placeholder)) {
          if (Array.isArray(defaultValue)) {
            customFields.set(placeholder, {
              type: 'select',
              value: defaultValue.at(0),
              options: defaultValue,
            })
          } else {
            customFields.set(placeholder, {
              type: format || 'text',
              value: defaultValue || '',
            })
          }
        }
      }
      return match
    }
    const rxPlaceholders = /\$\[(.+?)(?:\((.+?)\))?(?:\{(.+?)\})?\]/g
    sniplet.content = sniplet.content.replaceAll(rxPlaceholders, processPlaceholder)
    console.log('Content replaced', { ...sniplet })

    sniplet.richText = getRichText(sniplet)
    console.log('Added richText', { ...sniplet })

    const snip = {
      ...sniplet,
      ...customFields.size ? { customFields: Array.from(customFields) } : {},
      ...counters.size ? { counters: Array.from(counters) } : {},
    }

    console.log(structuredClone(snip), customFields, counters)

    return snip
  }

  /** Update the value of several counters at once
   * @param {[string,number][]} counters - new counter values
   * @param {boolean} deltas - whether to treat the values as deltas and increment rather than set
   */
  setCounters(counters, deltas = false) {
    for (const [key, value] of counters) {
      if (deltas) {
        // add new counters to DataBucket before incrementing
        if (!(key in this.data.counters)) {
          this.data.counters[key] = this.data.counters.startVal
        }
        this.data.counters[key] += value
      } else this.data.counters[key] = value
    }
  }

  /** Sort tree items according to sort rules
   * @param {{by?:('seq'|'color'|'name'), foldersOnTop?:boolean, reverse?:boolean, folderPath?:(string|number)[]}} options
   */
  sort({ by = 'seq', foldersOnTop = true, reverse = false, folderPath = ['all'] } = {}) {
    // recursive function in case everything needs to be sorted
    const sortFolder = (data, recursive, by, foldersOnTop, reverse) => {
      if (!data.children)
        return
      data.children.sort((a, b) => {
        let result = a[by] > b[by]
        if (foldersOnTop)
          result = (a instanceof Folder)
            ? ((b instanceof Folder) ? result : false)
            : ((b instanceof Folder) ? true : result)
        if (reverse)
          result = !result
        return result ? 1 : -1
      })
      this.sequence(data)
      if (recursive) {
        for (const child of data.children) {
          if (child.children?.length)
            sortFolder(child, recursive, by, foldersOnTop, reverse)
        }
      }
    }
    if (folderPath.at(0) === 'all') {
      sortFolder(this.data, true, by, foldersOnTop, reverse)
    } else {
      sortFolder(this.getItem(folderPath), false, by, foldersOnTop, reverse)
    }
    return this
  }

  /** Update the seq of items in a folder after it's been sorted
   * @param {Folder} folder
   */
  sequence(folder) {
    if (folder.children) {
      let i = folder.children.length
      while (i--) {
        folder.children[i].seq = i + 1
      }
    }
    return this
  }

  /** Reuse the space object
   * @param {{
   *   name: string
   *   synced: boolean
   *   data: DataBucket
   *   path: number[]|string
   * }} details
   */
  async init({ name, synced, data, path } = {}) {
    // check defaults if either name or synced are blank
    if (!name || !synced) await settings.load()

    // make sure data is parsed correctly
    if (!(data instanceof DataBucket)) data = new DataBucket(data)
    await data.parse()

    // make sure path is correct or reset otherwise
    if (typeof path === 'string') path = parseStringPath(path)
    if (!Array.isArray(path)) path = []
    if (!(data.getItem(path) instanceof Folder)) path = []

    // update properties
    this.name = name || settings.defaultSpace.name
    this.synced = (typeof synced === 'boolean') ? synced : settings.defaultSpace.synced
    this.data = data
    this.path = path

    return this
  }
}

/** Add HTML line break tags where appropriate and remove newlines to avoid unwanted spaces
 * @param {string} text
 */
const tagNewlines = text => text.replaceAll(
  /(?<!<\/(?!a|span|strong|em|b|i|q|mark|input|button)[a-zA-Z0-9]+?>\s*?)(?:\r\n|\r|\n)/g,
  () => '<br>',
).replaceAll(
  /\r\n|\r|\n/g,
  '', // clears newline-introduced whitespace (chromium does the same on manual copy from selection)
)

/** Place anchor tags around emails if not already linked
 * @param {string} text
 */
const linkEmails = text => text.replaceAll(
  /(?<!<[^>]*)(?:[a-zA-Z0-9!#$%&'*+\-/=?^_`{|}~][a-zA-Z0-9!#$%&'*+\-/=?^_`{|}~.]*[a-zA-Z0-9!#$%&'*+\-/=?^_`{|}~]|[a-zA-Z0-9!#$%&'*+\-/=?^_`{|}~])@(?:(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]+)(?!(?!<a).*?<\/a>)/ig,
  match => `<a href="mailto:${match}">${match}</a>`,
)

/** Place anchor tags around urls if not already linked
 * @param {string} text
 */
const linkURLs = text => text.replaceAll(
  /<a.+?\/a>|<[^>]*?>|((?:\b(https?|ftp|chrome|edge|about|file):\/+)(?:(?:[a-zA-Z0-9]+\.)+[a-z]+|(?:[0-9]+\.){3}[0-9]+)(?::[0-9]+)?(?:\/(?:[a-zA-Z0-9!$&'()*+,-./:;=?@_~#]|%\d{2})*)?|www.?\.(?:[a-zA-Z0-9]+\.)+[a-z]+|(?<=\s|^|[>])(?:[a-zA-Z0-9]+\.)+(?:com|org|net|int|edu|gov|biz|io|co(?:\.[a-z]+)?|us|jp|eu|nu))/gi,
  (match, p1, p2) => {
    // skip anchors and tag attributes
    if (!p1) return match
    // ensure what was picked up evaluates to a proper url (just in case)
    const matchURL = new URL(((!p2) ? `http://${match}` : match))
    return (matchURL) ? `<a href="${matchURL.href}">${match}</a>` : match
  },
)

/** Process and return snip contents according to rich text settings
 * @param {{content:string,nosubst:boolean}} snip A processed sniplet
 * @param {{rtLineBreaks:boolean,rtLinkEmails:boolean,rtLinkURLs:boolean}} rtOptions Snipping settings (use `settings.snipping`)
 */
const getRichText = (snip, { rtLineBreaks = true, rtLinkEmails = true, rtLinkURLs = true } = {}) => {
  // don't process flagged sniplets
  if (snip.nosubst) return snip.content
  // work on string copy
  let text = snip.content
  // process according to settings
  if (rtLineBreaks) text = tagNewlines(text)
  if (rtLinkEmails) text = linkEmails(text)
  if (rtLinkURLs) text = linkURLs(text)
  return text
}

export {
  getStorageArea,
  DataBucket,
  Folder,
  Sniplet,
  Space,
  parseStringPath,
  getRichText,
}
