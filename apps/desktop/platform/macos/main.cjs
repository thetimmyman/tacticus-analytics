const { app, BrowserWindow, session, Menu, dialog } = require('electron')
const { readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const { randomBytes } = require('node:crypto')
const {
  requestLabel,
  sanitizeFailure,
  rendererReceipt
} = require('./request-diagnostics.cjs')
const {
  createNativeActions,
  exportCachedPersonal
} = require('./native-actions.cjs')
const config = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const origin = new URL(config.url).origin
if (
  !/^http:\/\/127\.0\.0\.1:\d+$/.test(origin) ||
  ![config.transportKey, config.brokerToken].every((value) =>
    /^[a-f0-9]{64}$/.test(value)
  )
)
  throw new Error('Invalid local desktop configuration')
app.enableSandbox()
app.disableHardwareAcceleration()
app.setPath('userData', join(config.state, 'browser'))
let verifyStage = 'window-startup',
  verifyNetwork,
  verificationWindow
app
  .whenReady()
  .then(async () => {
    session.defaultSession.setPermissionRequestHandler(
      (_contents, _permission, callback) => callback(false)
    )
    const activeRequests = new Map()
    const failures = [],
      blocked = []
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      const url = new URL(details.url)
      const allowed =
        url.origin === origin ||
        url.protocol === 'data:' ||
        url.protocol === 'blob:'
      if (!allowed) blocked.push(url.origin + url.pathname)
      if (config.verify && url.origin === origin)
        activeRequests.set(
          details.id,
          requestLabel(url.pathname, details.resourceType)
        )
      callback({ cancel: !allowed })
    })
    session.defaultSession.webRequest.onBeforeSendHeaders(
      (details, callback) => {
        if (new URL(details.url).origin === origin)
          details.requestHeaders['x-desktop-transport'] = config.transportKey
        callback({ requestHeaders: details.requestHeaders })
      }
    )
    session.defaultSession.webRequest.onCompleted((details) => {
      activeRequests.delete(details.id)
      if (details.statusCode >= 400)
        failures.push({
          path: new URL(details.url).pathname,
          ...requestLabel(new URL(details.url).pathname, details.resourceType),
          status: details.statusCode
        })
    })
    session.defaultSession.webRequest.onErrorOccurred((details) => {
      activeRequests.delete(details.id)
      if (
        config.verify &&
        details.error !== 'net::ERR_ABORTED' &&
        new URL(details.url).origin === origin
      )
        failures.push({
          path: new URL(details.url).pathname,
          ...requestLabel(new URL(details.url).pathname, details.resourceType),
          status: 0
        })
    })
    const window = new BrowserWindow({
      show: !config.verify,
      width: 1440,
      height: 1000,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        backgroundThrottling: false,
        offscreen: Boolean(config.verify)
      }
    })
    if (config.verify) verificationWindow = window
    const device = require('./device-session.cjs')(window, config)
    const capabilities = ['Player', 'Guild', 'Guild Raid']
    const { currentWorkspaceToken } =
      await import('../../launcher/workspace-session.mjs')
    const pending = new Map()
    process.on('message', (reply) => {
      const request = pending.get(reply?.requestId)
      if (!request) return
      pending.delete(reply.requestId)
      clearTimeout(request.deadline)
      if (reply.status === 'ok') request.accept(reply.view)
      else
        request.reject(
          Object.assign(new Error('Native access unavailable'), {
            code: reply.code
          })
        )
    })
    const nativeRequest = async (operation, scope, path) => {
      const token = currentWorkspaceToken(
        await window.webContents.session.cookies.get({ url: origin })
      )
      if (typeof process.send !== 'function')
        throw new Error('Native coordinator channel unavailable')
      const requestId = randomBytes(16).toString('hex')
      return new Promise((accept, reject) => {
        const deadline = setTimeout(() => {
          pending.delete(requestId)
          reject(new Error('Native request timed out'))
        }, 300000)
        pending.set(requestId, { accept, reject, deadline })
        // The inherited native-only IPC pipe is never attached to renderer IPC,
        // stdout, logs or an export. Workspace passwords are never retained here.
        process.send(
          {
            requestId,
            operation,
            scope,
            token,
            ...(operation === 'import' ? { path } : {})
          },
          (error) => {
            if (error) {
              clearTimeout(deadline)
              pending.delete(requestId)
              reject(new Error('Native channel closed'))
            }
          }
        )
      })
    }
    const nativeActions = createNativeActions({
      perform: async (operation, scope, path) => {
        if (operation === 'export') {
          await exportCachedPersonal({
            path,
            requestSession: () => nativeRequest('session', 'Player'),
            writeDestination: writeFileSync
          })
          await dialog.showMessageBox(window, {
            message: 'Cached personal data exported',
            detail: 'Official API access remains in the native vault.'
          })
          return
        }
        const view = await nativeRequest(operation, scope, path)
        if (operation !== 'session') {
          await dialog.showMessageBox(window, {
            message:
              operation === 'import'
                ? 'Cached personal data restored'
                : 'Official access updated',
            detail:
              operation === 'import'
                ? 'Historical data is available offline. Connect Player access to refresh it. Cloud contribution remains separate.'
                : capabilities
                    .map(
                      (item) =>
                        `${item}: ${view.capabilities[item] ?? 'not connected'}`
                    )
                    .join('\n')
          })
          if (
            window.webContents.getURL().startsWith(origin + '/desktop/personal')
          )
            window.reload()
        }
        return view
      },
      recover: () => device.open(),
      failed: async (error, operation) => {
        if (error.code === 'ECANCELLED') return
        if (error.code === 'ESESSION') {
          await dialog.showMessageBox(window, {
            type: 'error',
            message: 'The local workspace could not open.',
            detail: 'Existing data was preserved. Reopen the app to retry.'
          })
          return
        }
        if (operation === 'export') {
          await dialog.showMessageBox(window, {
            type: 'error',
            message: 'Export did not finish',
            detail:
              'Your existing file and workspace data were preserved. Select a new destination and try again.'
          })
          return
        }
        await dialog.showMessageBox(window, {
          type: 'error',
          message:
            error.code === 'EVAULTLOCKED'
              ? 'Unlock your native Keychain to continue.'
              : error.code === 'EVAULT'
                ? 'Secure Keychain access is unavailable.'
                : operation === 'import'
                  ? 'Cached data import did not finish'
                  : 'Official access could not finish',
          detail:
            operation === 'import'
              ? 'Choose a supported personal-data export in an empty personal workspace. Existing data and the original file are preserved.'
              : 'Cached data is retained. Check native vault availability and official access, then retry.'
        })
      }
    })
    const nativeAction = nativeActions.run
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        { role: 'appMenu' },
        {
          label: 'Official access',
          submenu: [
            ...capabilities.map((scope) => ({
              label: `Connect ${scope} access…`,
              click: () => nativeAction('connect', scope)
            })),
            { type: 'separator' },
            ...capabilities.map((scope) => ({
              label: `Disconnect ${scope} access`,
              click: () => nativeAction('disconnect', scope)
            }))
          ]
        },
        {
          label: 'Workspace',
          submenu: [
            {
              label: 'Import cached personal data…',
              click: async () => {
                const selected = await dialog.showOpenDialog(window, {
                  title:
                    'Import cached personal data into an empty personal workspace',
                  properties: ['openFile'],
                  filters: [
                    { name: 'Personal data export', extensions: ['json'] }
                  ]
                })
                if (!selected.canceled && selected.filePaths.length === 1)
                  await nativeAction('import', 'Player', selected.filePaths[0])
              }
            },
            {
              label: 'Export cached personal data…',
              click: async () => {
                const selected = await dialog.showSaveDialog(window, {
                  title: 'Export cached personal data',
                  defaultPath: 'personal-data.json',
                  filters: [{ name: 'JSON data', extensions: ['json'] }]
                })
                if (selected.canceled || !selected.filePath) return
                await nativeAction('export', 'Player', selected.filePath)
              }
            }
          ]
        },
        { role: 'editMenu' },
        { role: 'viewMenu' },
        { role: 'windowMenu' }
      ])
    )
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event, url) => {
      if (new URL(url).origin !== origin) event.preventDefault()
    })
    verifyStage = 'workspace-page'
    if (!config.verify) {
      let recovering = false
      window.webContents.on('did-finish-load', async () => {
        if (
          !window.webContents.getURL().startsWith(origin + '/desktop/personal')
        )
          return
        if (recovering) return
        try {
          const view = await nativeRequest('session', 'Player')
          if (!view.personal) await nativeAction('connect', 'Player')
        } catch (error) {
          if (error.code === 'ESESSION') {
            recovering = true
            try {
              await device.open()
            } catch {
              if (!window.isDestroyed())
                void dialog
                  .showMessageBox(window, {
                    type: 'error',
                    message: 'The local workspace could not open.',
                    detail:
                      'Existing data was preserved. Reopen the app to retry.'
                  })
                  .catch(() => {})
            } finally {
              recovering = false
            }
          }
        }
      })
    }
    if (!(await device.open())) await window.loadURL(config.url)
    if (config.verify) {
      verifyStage = 'workspace-setup'
      const rendererBootstrapRefused =
        await window.webContents.executeJavaScript(
          `fetch('/desktop/open', {method:'POST'}).then(response => response.status === 403)`
        )
      if (rendererBootstrapRefused !== true)
        throw new Error('Renderer session bootstrap was not refused')
      await nativeRequest('session', 'Player')
      for (const cookie of await window.webContents.session.cookies.get({
        url: origin
      }))
        if (/^tacticus-auth-token(?:\.\d+)?$/.test(cookie.name))
          await window.webContents.session.cookies.remove(origin, cookie.name)
      let signedOutRefused = false
      try {
        await nativeRequest('session', 'Player')
      } catch (error) {
        signedOutRefused = error.code === 'ESESSION'
      }
      if (!signedOutRefused || !(await device.open()))
        throw new Error('Automatic signed-out recovery failed')
      await nativeRequest('session', 'Player')
      verifyStage = 'workspace-navigation'
      await window.loadURL(
        origin + '/player-performance?guild=SYN001&season=9999'
      )
      await new Promise((accept) => setTimeout(accept, 10000))
      verifyStage = 'native-session'
      const nativeSession = await nativeRequest('session', 'Player')
      if (nativeSession.cloudContribution !== 'separate-consent-required')
        throw new Error('Native owner session was not verified')
      verifyStage = 'renderer-network'
      for (let attempt = 0; attempt < 100 && activeRequests.size; attempt++)
        await new Promise((accept) => setTimeout(accept, 100))
      if (activeRequests.size) {
        verifyNetwork = {
          pending: [...activeRequests.values()],
          failed: failures,
          blocked: blocked.length
        }
        throw Object.assign(
          new Error('Packaged renderer requests did not finish'),
          { cause: 'requests-pending' }
        )
      }
      verifyStage = 'renderer-observation'
      const observed = await window.webContents.executeJavaScript(
        `({text:document.body.innerText,nodeAccess:typeof require!=='undefined'||typeof process!=='undefined'})`
      )
      const evidence = {
        ...rendererReceipt({
          observed,
          pending: [...activeRequests.values()],
          failed: failures,
          blocked: blocked.length
        }),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        nativeSessionVerified: true,
        deviceSession: true,
        signedOutRecovery: true,
        rendererBootstrapRefused: true
      }
      writeFileSync(config.verify.evidence, JSON.stringify(evidence, null, 2), {
        mode: 0o600
      })
      writeFileSync(
        config.verify.screenshot,
        (await window.webContents.capturePage()).toPNG(),
        { mode: 0o600 }
      )
      verifyStage = 'renderer-scores'
      if (
        observed.nodeAccess ||
        !observed.text.includes('+58%') ||
        !observed.text.includes('-50%') ||
        observed.text.includes('Service Disruption')
      )
        throw new Error(
          'Packaged graphical journey did not render expected scores'
        )
      verifyStage = 'renderer-network'
      if (
        blocked.length ||
        failures.some(
          (failure) =>
            !(
              failure.status === 403 &&
              ['/api/guild-tokens', '/desktop/open'].includes(failure.path)
            )
        )
      ) {
        verifyNetwork = {
          pending: [...activeRequests.values()],
          failed: failures,
          blocked: blocked.length
        }
        throw Object.assign(
          new Error('Unexpected packaged renderer request failure'),
          { cause: 'request-failed' }
        )
      }
      window.destroy()
      app.quit()
    }
  })
  .catch(async (error) => {
    if (config.verify) {
      const diagnostic = sanitizeFailure({
        stage: verifyStage,
        code: error.code,
        cause: error.cause,
        network: verifyNetwork
      })
      console.log('TA-MAC-VERIFY-FAILURE:' + JSON.stringify(diagnostic))
      writeFileSync(
        config.verify.evidence + '.failure.json',
        JSON.stringify(diagnostic),
        { mode: 0o600 }
      )
      if (verificationWindow && !verificationWindow.isDestroyed()) {
        try {
          writeFileSync(
            config.verify.screenshot,
            (await verificationWindow.webContents.capturePage()).toPNG(),
            { mode: 0o600 }
          )
        } catch {}
      }
    }
    console.error(error.message)
    app.exit(1)
  })
app.on('window-all-closed', () => app.quit())
