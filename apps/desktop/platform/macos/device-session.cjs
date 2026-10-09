const { randomBytes } = require('node:crypto')
const { setTimeout: delay } = require('node:timers/promises')

module.exports = function deviceSession(window, config, dependencies = {}) {
  const { session } = dependencies.electron ?? require('electron')
  if (
    dependencies.onSessionInstalled !== undefined &&
    typeof dependencies.onSessionInstalled !== 'function'
  )
    throw new Error('Invalid local session observer')
  let initial
  try {
    initial = new URL(config.url)
  } catch {
    throw new Error('Invalid local session destination')
  }
  const origin = initial.origin
  if (
    !/^http:\/\/127\.0\.0\.1:\d+$/.test(origin) ||
    initial.username ||
    initial.password ||
    initial.search ||
    initial.hash ||
    !['/home', '/desktop/setup', '/desktop/personal'].includes(
      initial.pathname
    ) ||
    ![config.transportKey, config.brokerToken].every(
      (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
    )
  )
    throw new Error('Invalid local session destination')
  const coordinator = session.fromPartition(
    'device-session-' + randomBytes(16).toString('hex')
  )
  const localURL = (address) => {
    try {
      if (typeof address !== 'string') return null
      const url = new URL(address)
      return url.origin === origin &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash
        ? url
        : null
    } catch {
      return null
    }
  }
  const allowed = (details) =>
    details.method === 'POST' &&
    localURL(details.url)?.pathname === '/desktop/open'
  coordinator.setPermissionRequestHandler?.(
    (_contents, _permission, callback) => callback(false)
  )
  coordinator.webRequest.onBeforeRequest((details, callback) =>
    callback({ cancel: !allowed(details) })
  )
  coordinator.webRequest.onBeforeSendHeaders((details, callback) => {
    if (!allowed(details)) return callback({ cancel: true })
    const headers = Object.fromEntries(
      Object.entries(details.requestHeaders ?? {}).filter(
        ([name]) =>
          ![
            'x-desktop-transport',
            'x-desktop-broker',
            'origin',
            'cookie',
            'authorization'
          ].includes(name.toLowerCase())
      )
    )
    callback({
      requestHeaders: {
        ...headers,
        origin,
        'x-desktop-transport': config.transportKey,
        'x-desktop-broker': config.brokerToken
      }
    })
  })
  let pending,
    suppressSetupOnce = false,
    activeAbort,
    fallbackPending,
    closed = false
  window.once?.('closed', () => {
    closed = true
    activeAbort?.abort()
  })
  const open = () =>
    (pending ??= (async () => {
      const { projectDeviceSession, readDeviceSessionJSON } =
        await import('./device-session.mjs')
      if (closed) throw new Error()
      activeAbort = new AbortController()
      const signal = AbortSignal.any([
        activeAbort.signal,
        AbortSignal.timeout(30000)
      ])
      let body
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await coordinator.fetch(origin + '/desktop/open', {
          method: 'POST',
          credentials: 'omit',
          headers: {
            origin,
            'x-desktop-transport': config.transportKey,
            'x-desktop-broker': config.brokerToken
          },
          redirect: 'error',
          signal
        })
        body = await readDeviceSessionJSON(response)
        signal.throwIfAborted()
        if (response.status === 409) {
          if (body.code === 'WORKSPACE_OPENING' && attempt === 0) {
            await delay(100, undefined, { signal })
            continue
          }
          return false
        }
        if (!response.ok)
          throw new Error(
            'The local workspace could not open. Try reopening the app.'
          )
        break
      }
      if (!['/home', '/desktop/personal'].includes(body.destination))
        throw new Error('Invalid local session')
      const grant = projectDeviceSession(body.session)
      const value =
        'base64-' + Buffer.from(JSON.stringify(grant)).toString('base64url')
      const chunks = value.match(/.{1,3000}/g)
      if (value.length > 48000 || chunks.length > 16)
        throw new Error('Invalid local session')
      const cookies = window.webContents.session.cookies
      for (const cookie of await cookies.get({ url: origin }))
        if (/^tacticus-auth-token(?:\.\d+)?$/.test(cookie.name))
          await cookies.remove(origin, cookie.name)
      try {
        for (let i = 0; i < chunks.length; i++) {
          signal.throwIfAborted()
          await cookies.set({
            url: origin,
            name:
              chunks.length === 1
                ? 'tacticus-auth-token'
                : `tacticus-auth-token.${i}`,
            value: chunks[i],
            path: '/',
            httpOnly: false,
            secure: false,
            sameSite: 'lax',
            expirationDate: Date.now() / 1000 + 7 * 86400
          })
        }
        signal.throwIfAborted()
        // This synchronous notification marks the cookie boundary, before any
        // recovered renderer navigation. A failure follows cookie cleanup.
        dependencies.onSessionInstalled?.()
      } catch {
        for (const cookie of await cookies.get({ url: origin }))
          if (/^tacticus-auth-token(?:\.\d+)?$/.test(cookie.name))
            await cookies.remove(origin, cookie.name)
        throw new Error('Local session cookies could not be installed')
      }
      await window.loadURL(origin + body.destination)
      return true
    })()
      .catch(() => {
        throw new Error(
          'The local workspace could not open. Try reopening the app.'
        )
      })
      .finally(() => {
        activeAbort = undefined
        pending = undefined
      }))
  const fallback = () =>
    (fallbackPending ??= (async () => {
      if (closed) return
      suppressSetupOnce = true
      try {
        await window.loadURL(origin + '/desktop/setup')
      } catch {
        suppressSetupOnce = false
        throw new Error()
      }
    })().finally(() => {
      fallbackPending = undefined
    }))
  window.webContents.on('will-navigate', (event, address) => {
    if (localURL(address)?.pathname !== '/desktop/setup') return
    event.preventDefault()
    void open()
      .then(
        (opened) => opened || fallback(),
        () => fallback()
      )
      .catch(() => {})
  })
  window.webContents.on('did-navigate', (_event, address) => {
    if (localURL(address)?.pathname !== '/desktop/setup') return
    if (suppressSetupOnce) {
      suppressSetupOnce = false
      return
    }
    void open().catch(() => {})
  })
  return { open }
}
