const { randomBytes, createHash } = require('node:crypto')
const { readFile } = require('node:fs/promises')
const { join } = require('node:path')
const { pathToFileURL } = require('node:url')

function authorizedSender(event, window, address) {
  return (
    !window.isDestroyed() &&
    event.sender === window.webContents &&
    event.senderFrame === window.webContents.mainFrame &&
    event.senderFrame.url === address
  )
}

module.exports = async function addonMenu(owner, config, dependencies = {}) {
  const { BrowserWindow, ipcMain, session, dialog } =
    dependencies.electron ?? require('electron')
  const { currentWorkspaceToken } = await import('./workspace-session.mjs')
  const { createNativeAddonRuntime } =
    dependencies.runtime ?? require('../addons/native-runtime.cjs')
  const origin = new URL(config.url).origin
  if (
    !/^http:\/\/127\.0\.0\.1:\d+$/.test(origin) ||
    ![config.transportKey, config.brokerToken].every((value) =>
      /^[a-f0-9]{64}$/.test(value)
    )
  )
    throw new Error('Invalid native add-on destination')
  const policy =
    dependencies.policy ??
    JSON.parse(
      await readFile(join(__dirname, '../../../addon-policy.json'), 'utf8')
    )
  const runtime = createNativeAddonRuntime(join(config.state, 'addons'), policy)
  const coordinator = dependencies.fetch
    ? null
    : session.fromPartition(
        'native-addon-context-' + randomBytes(16).toString('hex')
      )
  const target = origin + '/desktop/addon-context'
  coordinator?.webRequest.onBeforeRequest((details, callback) =>
    callback({ cancel: details.url !== target })
  )
  coordinator?.webRequest.onBeforeSendHeaders((details, callback) =>
    callback(
      details.url === target
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
  const context =
    dependencies.context ??
    (async () => {
      const token = currentWorkspaceToken(
        await owner.webContents.session.cookies.get({ url: origin })
      )
      const response = await (
        dependencies.fetch ?? coordinator.fetch.bind(coordinator)
      )(target, {
        method: 'POST',
        headers: {
          origin,
          'content-type': 'application/json',
          authorization: `Bearer ${token}`
        },
        body: '{}',
        redirect: 'error',
        signal: AbortSignal.timeout(15000)
      })
      if (
        !response.ok ||
        response.redirected ||
        (response.url && response.url !== target)
      )
        throw new Error('Local session unavailable')
      const reader = response.body?.getReader()
      if (!reader) throw new Error('Local session unavailable')
      const parts = []
      let size = 0
      try {
        for (;;) {
          const part = await reader.read()
          if (part.done) break
          size += part.value.length
          if (size > 16384) throw new Error('Local context too large')
          parts.push(part.value)
        }
      } finally {
        await reader.cancel().catch(() => {})
        reader.releaseLock()
      }
      return JSON.parse(Buffer.concat(parts).toString('utf8'))
    })
  const binding = async () => {
    const value = await context()
    if (
      !value ||
      typeof value.installation !== 'string' ||
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(
        value.installation
      ) ||
      typeof value.guildCode !== 'string' ||
      !/^[A-Za-z0-9_-]{1,32}$/.test(value.guildCode)
    )
      throw new Error('Invalid local workspace')
    const hash = (name) => createHash('sha256').update(name).digest('hex')
    return {
      accountHandle: hash(value.installation),
      guildHandle: hash(value.installation + ':' + value.guildCode)
    }
  }
  let window, pending
  const open = () =>
    (pending ??= (async () => {
      if (window && !window.isDestroyed()) {
        window.focus()
        return window
      }
      const initial = await binding()
      runtime.setBinding(initial)
      const channel = randomBytes(32).toString('hex')
      const partition = session.fromPartition(
        'native-addon-ui-' + randomBytes(16).toString('hex')
      )
      const address = pathToFileURL(join(__dirname, 'addons.html')).href
      const resources = new Set([
        address,
        pathToFileURL(join(__dirname, 'addons.css')).href,
        pathToFileURL(join(__dirname, '../addons/native-manager.js')).href
      ])
      partition.setPermissionRequestHandler(
        (_contents, _permission, callback) => callback(false)
      )
      partition.webRequest.onBeforeRequest((details, callback) =>
        callback({ cancel: !resources.has(details.url) })
      )
      const current = new BrowserWindow({
        parent: owner,
        width: 1100,
        height: 850,
        show: false,
        webPreferences: {
          session: partition,
          preload: join(__dirname, 'addon-preload.cjs'),
          additionalArguments: ['--addon-channel=' + channel],
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          webSecurity: true
        }
      })
      window = current
      current.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      current.webContents.on('will-navigate', (event) => event.preventDefault())
      current.webContents.on('will-attach-webview', (event) =>
        event.preventDefault()
      )
      let queue = Promise.resolve()
      ipcMain.handle(channel, (event, request) => {
        if (!authorizedSender(event, current, address))
          return { ok: false, code: 'invalid-session' }
        const action = queue.then(async () => {
          if (!authorizedSender(event, current, address))
            return { ok: false, code: 'invalid-session' }
          let active
          try {
            active = await binding()
          } catch {
            runtime.setBinding(null)
            current.destroy()
            return { ok: false, code: 'invalid-session' }
          }
          try {
            if (JSON.stringify(active) !== JSON.stringify(initial)) {
              runtime.setBinding(active)
              current.destroy()
              return { ok: false, code: 'invalid-session' }
            }
            if (!authorizedSender(event, current, address))
              return { ok: false, code: 'invalid-session' }
            return { ok: true, value: await runtime.dispatch(request) }
          } catch (error) {
            const codes = new Set([
              'invalid-package',
              'untrusted-package',
              'incompatible-package',
              'approval-required',
              'dependency-unavailable',
              'not-installed',
              'addon-disabled',
              'invalid-session',
              'update-failed',
              'recoverable-storage',
              'transaction-busy',
              'no-local-data'
            ])
            return {
              ok: false,
              code: codes.has(error.code) ? error.code : 'invalid-package'
            }
          }
        })
        queue = action.then(
          () => {},
          () => {}
        )
        return action
      })
      current.once('closed', () => {
        ipcMain.removeHandler(channel)
        if (window === current) window = null
      })
      try {
        await current.loadURL(address)
        current.show()
        return current
      } catch (error) {
        current.destroy()
        throw error
      }
    })().finally(() => {
      pending = null
    }))
  owner.once('closed', () => {
    if (window && !window.isDestroyed()) window.destroy()
  })
  return {
    id: 'application-addons',
    label: 'Local add-ons…',
    click: () =>
      open().catch(() =>
        dialog.showMessageBox(owner, {
          type: 'error',
          buttons: ['Close'],
          message:
            'The add-on manager could not open. Reopen your local workspace and try again. Existing data was preserved.'
        })
      ),
    open
  }
}
module.exports.authorizedSender = authorizedSender
