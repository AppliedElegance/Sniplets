import { i18n, locale, i18nOrd, Colors } from '/modules/refs.js'
import { StorageKey, KeyStore } from '/modules/storage.js'
import settings from '/modules/settings.js'
import { ParseError } from '/modules/errors.js'

/** Converts a boolean value (`synced`) to a `chrome.storage` area name
 * @param {boolean} synced `true` for `'sync'` and `false` for `'local'`
 * @returns {'sync'|'local'} The appropriate area name
 */
const getStorageArea = synced => synced ? 'sync' : 'local'

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
      name: this.name,
      synced: this.synced,
      ...(rememberPath ? { path: this.path } : {}),
    })
  }

  /** load last used space or fall back to default */
  async loadCurrent() {
    const currentSpace = await KeyStore.currentSpace.get()
    if (!(await this.load(currentSpace))) {
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
  async save({ compress = true }) {
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
   * @param {{
   *   name: string
   *   synced: boolean
   *   path: number[]
   * }} args - Name & storage bucket location (reloads current space if empty)
   */
  async load({ name = this.name, synced = this.synced, path = [] } = {}) {
    // console.log('Loading space...', name, synced, path)
    if (!name) return false
    const data = await (new StorageKey(name, synced)).get()
    // console.log('Confirming data...', data)
    if (!data) return
    await this.init({
      name: name,
      synced: synced,
      data: data,
      path: path,
    })
    return true
  }

  /** Get an array of all the path names up to and including a specific folder seq
   * @param {number[]} path
   */
  getPathNames(path = this.path) {
    const pathNames = [this.name]
    let item = this.data
    for (const seq of path) {
      item = item.children.find(i => i.seq == seq)
      if (!item?.children) {
        console.error(`The requested path sequence ${path} doesn't exist. Reached: ${pathNames.join('/')}`)
        return
      }
      pathNames.push(item.name)
    }
    return pathNames
  }

  /** Get the item found at a specific path sequence
   * @param {number[]} path - Full path to the tree item
   * @returns {TreeItem|Folder|Sniplet|void}
   */
  getItem(path = this.path) {
    let item = this.data
    for (const seq of path) {
      item = item.children?.find(o => (o.seq === +seq))
      if (!item) {
        console.error(`The requested item path sequence ${path} doesn't exist. The last item reached: ${item}`)
        return
      }
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
    // console.log('Editing item...', seq, field, value, folderPath, structuredClone(item))

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

  /** Process placeholders and rich text options of a sniplet and return the result
   * @param {number} seq
   * @param {number[]} path
   * @returns {Promise<{sniplet:Sniplet,customFields?:Map<string,string>,counters?:Map<string,number>}>}
   */
  async getProcessedSniplet(seq, path = this.path) {
    // console.log("Getting item...");
    const item = this.getItem(path.concat(seq))
    // console.log(item);
    if (!item) return
    // avoid touching space
    const sniplet = new Sniplet(item)
    // Skip if there's nothing to process
    if (!sniplet.content) return { sniplet: sniplet }

    // skip processing if Clippings [NOSUBST] flag is prepended to the name
    if (sniplet.name.slice(0, 9).toUpperCase() === '[NOSUBST]') {
      sniplet.nosubst = true
      return {
        sniplet: sniplet,
      }
    }

    // process counters, kept track internally to allow use across multiple sniplets
    const counters = new Map()
    sniplet.content = sniplet.content.replaceAll(/#\[(.+?)(?:\((.+?)\))?\]/g, (match, p1, p2) => {
      // add new counters to DataBucket
      if (!(p1 in this.data.counters)) {
        this.data.counters[p1] = this.data.counters.startVal
      }
      // allow for rollback in case paste fails
      const val = this.data.counters[p1]
      if (!counters.has(p1)) counters.set(p1, val)
      // replace and increment
      this.data.counters[p1] += isNaN(p2) ? 1 : +p2
      return val
    })
    // save space if counters were used and thus incremented
    if (counters.size) await this.save()

    // placeholders
    // console.log("Processing placeholders...");
    const customFields = new Map()
    sniplet.content = sniplet.content.replaceAll(/\$\[(.+?)(?:\((.+?)\))?(?:\{(.+?)\})?\]/g, (match, placeholder, format, defaultValue) => {
      if (defaultValue?.includes('|')) defaultValue = defaultValue.split('|')
      const now = new Date()

      /** Full custom date/time format string replacement (compatible with Clippings)
       * @param {string} dateString
       * @param {*} date
       */
      const formattedDateTime = (dateString, date) => {
        // helper for setting up date objects
        const datePartsToObject = (obj, item) =>
          (item.type === 'literal') ? obj : (obj[item.type] = item.value, obj)

        // generate localized replacement objects for full replacement support
        const longDate = new Intl.DateTimeFormat(locale, {
          hourCycle: 'h12',
          weekday: 'long', day: 'numeric', month: 'long',
          hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3,
          dayPeriod: 'long', timeZoneName: 'long', era: 'long',
        }).formatToParts(date).reduce(datePartsToObject, {})
        const shortDate = new Intl.DateTimeFormat(locale, {
          hourCycle: 'h12',
          weekday: 'short', day: 'numeric', month: 'short',
          hour: 'numeric', minute: 'numeric', second: 'numeric', fractionalSecondDigits: 1,
          timeZoneName: 'short', era: 'short',
        }).formatToParts(date).reduce(datePartsToObject, {})
        const paddedDate = new Intl.DateTimeFormat(locale, {
          hourCycle: 'h23',
          year: '2-digit', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 2,
          timeZoneName: 'longOffset',
        }).formatToParts(date).reduce(datePartsToObject, {})
        // numeric date/times will only not be padded if loaded individually
        const numericDate = new Intl.DateTimeFormat(locale, {
          hourCycle: 'h23', year: 'numeric', hour: 'numeric',
        }).formatToParts(date).concat(new Intl.DateTimeFormat(locale, {
          month: 'numeric', minute: 'numeric',
        }).formatToParts(date).concat(new Intl.DateTimeFormat(locale, {
          day: 'numeric', second: 'numeric', fractionalSecondDigits: 3,
        }).formatToParts(date))).reduce(datePartsToObject, {})
        // fix numeric 24 hours still being padded for some locals no matter how generated
        if (numericDate.hour.length === 2) numericDate.hour = numericDate.hour.replace(/^0/, '')

        // replace each part of format string
        dateString = dateString.replaceAll(/([a-zA-Z]*)(\.s+)?/g, (match, p1, p2) => {
          // split seconds
          if (p2) {
            let seconds = ''
            switch (p1) {
              case 's':
                seconds += numericDate.second
                break

              case 'ss':
                seconds += paddedDate.second
                break

              default:
                seconds += p1
                break
            }
            switch (p2) {
              case '.s':
                seconds += `.${shortDate.fractionalSecond}`
                break

              case '.ss':
                seconds += `.${paddedDate.fractionalSecond}`
                break

              case '.sss':
                seconds += `.${longDate.fractionalSecond}`
                break

              default:
                seconds += p2
                break
            }
            return seconds
          }
          // case sensitive matches
          switch (match) {
            case 'm':
              return numericDate.minute
            case 'mm':
              return paddedDate.minute
            case 'M':
              return numericDate.month
            case 'MM':
              return paddedDate.month
            case 'h':
              return shortDate.hour
            case 'hh':
              return longDate.hour
            case 'H':
              return numericDate.hour
            case 'HH':
              return paddedDate.hour
            case 'a':
              return shortDate.dayPeriod
            case 'A':
              return shortDate.dayPeriod.toUpperCase()
            default:
              break
          }
          // case insensitive matches required for clippings compatibility
          switch (match.toUpperCase()) {
            case 'D':
              return numericDate.day
            case 'DD':
              return paddedDate.day
            case 'DDD':
              return shortDate.weekday
            case 'DDDD':
              return longDate.weekday
            case 'DO':
              return i18nOrd(numericDate.day)
            case 'MMM':
              return shortDate.month
            case 'MMMM':
              return longDate.month
            case 'Y':
              return paddedDate.slice(-1)
            case 'YY':
              return paddedDate.year
            case 'YYY':
              return numericDate.year.slice(-3)
            case 'YYYY':
              return numericDate.year
            case 'GG':
              return shortDate.era
            case 'S':
              return numericDate.second
            case 'SS':
              return paddedDate.second
            case 'Z':
              return paddedDate.timeZoneName
            case 'ZZ':
              return paddedDate.timeZoneName.replaceAll(/[^+\-\d]/g, '')
            default:
              break
          }
          return match
        })
        return dateString
      }
      const UA = navigator.userAgent
      let host
      switch (placeholder.toUpperCase()) {
        case 'DATE':
          if (format) {
            // shorthand date options
            if (format.toUpperCase() === 'FULL') return new Intl.DateTimeFormat(locale, {
              dateStyle: 'full',
            }).format(now)
            if (format.toUpperCase() === 'LONG') return new Intl.DateTimeFormat(locale, {
              dateStyle: 'long',
            }).format(now)
            if (format.toUpperCase() === 'MEDIUM') return new Intl.DateTimeFormat(locale, {
              dateStyle: 'medium',
            }).format(now)
            if (format.toUpperCase() === 'SHORT') return new Intl.DateTimeFormat(locale, {
              dateStyle: 'short',
            }).format(now)

            return formattedDateTime(format, now)
          }
          return now.toLocaleDateString()

        case 'TIME':
          if (format) {
            if (format === 'full') return new Intl.DateTimeFormat(locale, {
              timeStyle: 'full',
            }).format(now)
            if (format === 'long') return new Intl.DateTimeFormat(locale, {
              timeStyle: 'long',
            }).format(now)
            if (format === 'medium') return new Intl.DateTimeFormat(locale, {
              timeStyle: 'medium',
            }).format(now)
            if (format === 'short') return new Intl.DateTimeFormat(locale, {
              timeStyle: 'short',
            }).format(now)

            return formattedDateTime(format, now)
          }
          return now.toLocaleTimeString()

        case 'HOSTAPP':
          host = UA.match(/Edg\/([0-9.]+)/)
          if (host) return `Edge ${host[1]}`
          host = UA.match(/Chrome\/([0-9.]+)/)
          if (host) return `Chrome ${host[1]}`
          return match

        case 'UA':
          return UA

        case 'NAME':
          return sniplet.name

        case 'FOLDER':
          return this.getPathNames(path).pop()

        case 'PATH':
          return this.getPathNames(path).join(format || `/`)

        default:
          // custom field, save for future processing
          if (!customFields.has(placeholder)) {
            if (Array.isArray(defaultValue)) {
              customFields.set(placeholder, {
                type: 'select',
                value: defaultValue.at(0) || '',
                options: defaultValue,
              })
            } else {
              customFields.set(placeholder, {
                type: format || 'text',
                value: defaultValue || '',
              })
            }
          }
          return match
      }
    })

    // console.log(snip, customFields);
    return {
      sniplet: sniplet,
      ...customFields.size ? { customFields: customFields } : {},
      ...counters.size ? { counters: counters } : {},
    }
  }

  /** Update the value of several counters at once
   * @param {Map<string,number>} counters
   */
  setCounters(counters) {
    if (!counters?.size) return
    for (const [counter, value] of counters) {
      this.data.counters[counter] = value
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
    // console.log('Initializing space...', name, synced, data, path)
    // check defaults if either name or synced are blank
    if (!name || !synced) await settings.load()

    // make sure data is parsed correctly
    if (!(data instanceof DataBucket)) {
      data = new DataBucket(data)
      await data.parse()
    }

    // make sure path is correct or reset otherwise
    if (typeof path === 'string') path = path.split('-').filter(v => !isNaN(v))
    if (!Array.isArray(path)) path = []

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
  '',
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
  /<a.+?\/a>|<[^>]*?>|((?<![.+@a-zA-Z0-9])(?:(https?|ftp|chrome|edge|about|file):\/+)?(?:(?:[a-zA-Z0-9]+\.)+[a-z]+|(?:[0-9]+\.){3}[0-9]+)(?::[0-9]+)?(?:\/(?:[a-zA-Z0-9!$&'()*+,-./:;=?@_~#]|%\d{2})*)?)/gi,
  (match, p1, p2) => {
    // console.log(match, p1, p2);
    // skip anchors and tag attributes
    if (!p1) return match
    // skip IP addresses with no protocol
    if (match.match(/^\d+\.\d+\.\d+\.\d+$/)) return match
    // ensure what was picked up evaluates to a proper url (just in case)
    const matchURL = new URL(((!p2) ? `http://${match}` : match))
    // console.log(matchURL);
    return (matchURL) ? `<a href="${matchURL.href}">${match}</a>` : match
  },
)

/** Process and return snip contents according to rich text settings
 * @param {{content:string,nosubst:boolean}} snip
 */
const getRichText = async (snip) => {
  // don't process flagged sniplets
  if (snip.nosubst) return snip.content
  // work on string copy
  let text = snip.content
  // check what processing has been enabled
  await settings.load()
  const { rtLineBreaks, rtLinkEmails, rtLinkURLs } = settings.pasting
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
  getRichText,
}
