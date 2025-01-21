import { i18n } from '/modules/refs.js'

class NotImplementedError extends Error {
  name = this.constructor.name
  constructor(feature, lastError) {
    super(`The ${feature || 'requested'} feature has not yet been implemented.`, { cause: lastError })
    Error.captureStackTrace(this, this.constructor)
  }
}

class MissingPermissionsError extends Error {
  name = this.constructor.name
  constructor({ permissions, origins }, lastError) {
    super(`The following ${
      permissions ? `permissions are missing:${permissions.map(permission => `\n${permission}`)}` : ''
    }${permissions && origins ? '\nand the following ' : ''}${
      origins ? `host permissions are missing:${origins.map(origin => `\n${origin}`)}` : ''
    }`, { cause: {
      permissions: permissions,
      origins: origins,
      lastError: lastError,
    } })
    Error.captureStackTrace(this, this.constructor)
  }
}

class ScriptingBlockedError extends Error {
  name = this.constructor.name
  constructor(url, lastError) {
    url ||= i18n('error_blocked_url')
    super(`Scripting on this page is blocked.\nURL: ${url}`, { cause: {
      url: url,
      lastError: lastError,
    } })
    Error.captureStackTrace(this, this.constructor)
  }
}

class CrossOriginError extends Error {
  name = this.constructor.name
  constructor(pageSrc, frameSrc, lastError) {
    super(`Scripting was blocked by a cross-origin policy...\nPage URL: ${pageSrc}\nFrame URL: ${frameSrc}`, { cause: {
      pageSrc: pageSrc,
      frameSrc: frameSrc,
      lastError: lastError,
    } })
    Error.captureStackTrace(this, this.constructor)
  }
}

class SnipNotFoundError extends Error {
  name = this.constructor.name
  constructor(spaceKey, path, seq, lastError) {
    super(`The requested sniplet could not be found\n  Space: ${spaceKey.name}\n  Path: ${path}\n  Seq: ${seq}`, { cause: {
      spaceKey: spaceKey,
      path: path,
      seq: seq,
      lastError: lastError,
    } })
    Error.captureStackTrace(this, this.constructor)
  }
}

class CustomPlaceholderError extends Error {
  name = this.constructor.name
  constructor(snip, lastError) {
    super(`Custom placeholders were found. The fields will need to be confirmed before inserting the sniplet\n  content: ${snip.content}\n  Placeholders: ${snip.customFields.map(v => v.at(0)).join(', ')}`, { cause: {
      snip: snip,
      lastError: lastError,
    } })
    Error.captureStackTrace(this, this.constructor)
  }
}

class ParseError extends Error {
  name = this.constructor.name
  constructor(data, lastError) {
    super(`Unable to parse the data, cancelling initialization...\n${data}`, { cause: {
      data: data,
      lastError: lastError,
    } })
    Error.captureStackTrace(this, this.constructor)
  }
}

export {
  NotImplementedError,
  MissingPermissionsError,
  ScriptingBlockedError,
  CrossOriginError,
  SnipNotFoundError,
  CustomPlaceholderError,
  ParseError,
}
