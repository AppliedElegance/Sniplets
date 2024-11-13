class NotImplemented extends Error {
  constructor(feature = 'requested', ...args) {
    super(`The ${feature} feature has not yet been implemented.`, ...args)
    Error.captureStackTrace(this, this.constructor)
  }
}

class MissingPermissions extends Error {
  constructor({ permissions, origins } = {}, ...args) {
    super(`The following${
      permissions ? `permissions are missing: ${permissions.map(permission => `\n  ${permission}`)}` : ''
    }${permissions && origins ? '\nand the following ' : ''}${
      origins ? `host permissions are missing: ${origins.map(origin => `\n  ${origin}`)}` : ''
    }`, ...args)
    this.permissions = permissions
    this.origins = origins
    Error.captureStackTrace(this, this.constructor)
  }
}

class ScriptingBlocked extends Error {
  constructor(funcName = '', ...args) {
    super(funcName ? `The ${funcName} function could not be injected.` : funcName, ...args)
    Error.captureStackTrace(this, this.constructor)
  }
}

export {
  NotImplemented,
  MissingPermissions,
  ScriptingBlocked,
}
