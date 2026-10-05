const { randomBytes } = require('node:crypto')

module.exports = function deviceSession(window, config, dependencies = {}) {
  const { session } = dependencies.electron ?? require('electron')
  const origin = new URL(config.url).origin
  if (
    !/^http:\/\/127\.0\.0\.1:\d+$/.test(origin) ||
    ![config.transportKey, config.brokerToken].every((value) =>
      /^[a-f0-9]{64}$/.test(value)
    )
  )
    throw new Error('Invalid local session destination')
  const coordinator = session.fromPartition(
    'device-session-' + randomBytes(16).toString('hex')
  )
  const allowed = (address) => {
    const url = new URL(address)
    return (
      url.origin === origin &&
      url.pathname === '/desktop/open' &&
      !url.search &&
      !url.hash &&
      !url.username &&
      !url.password
    )
  }
  coordinator.webRequest.onBeforeRequest((details, callback) =>
    callback({ cancel: !allowed(details.url) })
  )
  coordinator.webRequest.onBeforeSendHeaders((details, callback) =>
    callback(
      allowed(details.url)
        ? {
            requestHeaders: {
              ...details.requestHeaders,
              'x-desktop-transport': config.transportKey,
              'x-desktop-broker': config.brokerToken
            }
          }
        : { cancel: true }
    )
  )
  let pending
  const open = () =>
    (pending ??= (async () => {
      const response = await coordinator.fetch(origin + '/desktop/open', {
        method: 'POST',
        headers: { origin },
        redirect: 'error',
        signal: AbortSignal.timeout(30000)
      })
      if (response.status === 409) return false
      if (!response.ok)
        throw new Error(
          'The local workspace could not open. Try reopening the app.'
        )
      const { session: grant, destination } = await response.json()
      if (
        !['/home', '/desktop/connect'].includes(destination) ||
        !grant ||
        !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(
          grant.access_token
        ) ||
        typeof grant.refresh_token !== 'string'
      )
        throw new Error('Invalid local session')
      const value =
        'base64-' + Buffer.from(JSON.stringify(grant)).toString('base64url')
      if (value.length > 65536) throw new Error('Invalid local session')
      const cookies = window.webContents.session.cookies
      for (const cookie of await cookies.get({ url: origin }))
        if (/^tacticus-auth-token(?:\.\d+)?$/.test(cookie.name))
          await cookies.remove(origin, cookie.name)
      const chunks = value.match(/.{1,3000}/g)
      for (let i = 0; i < chunks.length; i++)
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
      await window.loadURL(origin + destination)
      return true
    })().finally(() => {
      pending = undefined
    }))
  window.webContents.on('will-navigate', (event, address) => {
    const url = new URL(address)
    if (
      url.origin === origin &&
      url.pathname === '/desktop/setup' &&
      !url.search &&
      !url.hash
    ) {
      event.preventDefault()
      void open()
        .then((opened) => {
          if (!opened) return window.loadURL(origin + '/desktop/setup')
        })
        .catch(() => window.loadURL(origin + '/desktop/setup'))
    }
  })
  window.webContents.on('did-navigate', (_event, address) => {
    const url = new URL(address)
    if (
      url.origin === origin &&
      url.pathname === '/desktop/setup' &&
      !url.search &&
      !url.hash
    )
      void open().catch(() => {})
  })
  return { open }
}
