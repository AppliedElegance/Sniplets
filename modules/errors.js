class NotImplementedError extends Error {
  name = 'NotImplementedError'
  constructor(feature, lastError) {
    super(`The ${feature || 'requested'} feature has not yet been implemented.`, { cause: lastError })
    Error.captureStackTrace(this, this.constructor)
  }
}

class MissingPermissionsError extends Error {
  name = 'MissingPermissionsError'
  constructor({ permissions, origins }, injection, info, lastError) {
    super(`The following ${
      permissions ? `permissions are missing:${permissions.map(permission => `\n${permission}`)}` : ''
    }${permissions && origins ? '\nand the following ' : ''}${
      origins ? `host permissions are missing:${origins.map(origin => `\n${origin}`)}` : ''
    }`, { cause: {
      permissions: permissions,
      origins: origins,
      injection: injection,
      info: info,
      lastError: lastError,
    } })
    Error.captureStackTrace(this, this.constructor)
  }
}

class ScriptingBlockedError extends Error {
  name = 'ScriptingBlockedError'
  constructor(url, lastError) {
    super(`Scripting on this page is blocked.\nURL: ${url}`, { cause: {
      url: url,
      lastError: lastError,
    } })
    Error.captureStackTrace(this, this.constructor)
  }
}

class CrossOriginError extends Error {
  name = 'CrossOriginError'
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
  name = 'SnipNotFoundError'
  constructor(space, seq, lastError) {
    super(`The requested sniplet could not be found\n  Space: ${space.name}\n  Path: ${space.path}\n  Seq: ${seq}`, { cause: {
      ...space,
      seq: seq,
      lastError: lastError,
    } })
    Error.captureStackTrace(this, this.constructor)
  }
}

class CustomPlaceholderError extends Error {
  name = 'CustomPlaceholderError'
  constructor(snip, lastError) {
    super(`Custom placeholders were found. The fields will need to be confirmed before inserting the sniplet\n  content: ${snip.content}\n  Placeholders: ${snip.placeholders.keys.join(', ')}`, { cause: {
      snip: snip,
      lastError: lastError,
    } })
    Error.captureStackTrace(this, this.constructor)
  }
}

class ParseError extends Error {
  name = 'ParseError'
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
