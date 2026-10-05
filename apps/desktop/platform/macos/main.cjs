const { app, BrowserWindow, session, Menu, dialog } = require('electron')
const { readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const { randomBytes } = require('node:crypto')
const config = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const origin = new URL(config.url).origin
if (
  !/^http:\/\/127\.0\.0\.1:\d+$/.test(origin) ||
  !/^[a-f0-9]{64}$/.test(config.transportKey)
)
  throw new Error('Invalid local desktop configuration')
app.enableSandbox()
app.disableHardwareAcceleration()
app.setPath('userData', join(config.state, 'browser'))
app
  .whenReady()
  .then(async () => {
    session.defaultSession.setPermissionRequestHandler(
      (_contents, _permission, callback) => callback(false)
    )
    const failures = [],
      blocked = []
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      const url = new URL(details.url)
      const allowed =
        url.origin === origin ||
        url.protocol === 'data:' ||
        url.protocol === 'blob:'
      if (!allowed) blocked.push(url.origin + url.pathname)
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
      if (details.statusCode >= 400)
        failures.push({
          path: new URL(details.url).pathname,
          status: details.statusCode
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
    const nativeRequest = async (operation, scope) => {
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
        process.send({ requestId, operation, scope, token }, (error) => {
          if (error) {
            clearTimeout(deadline)
            pending.delete(requestId)
            reject(new Error('Native channel closed'))
          }
        })
      })
    }
    let retry,
      busy = false
    const nativeAction = async (operation, scope) => {
      if (busy) return
      busy = true
      try {
        const view = await nativeRequest(operation, scope)
        if (operation !== 'session') {
          await dialog.showMessageBox(window, {
            message: 'Official access updated',
            detail: capabilities
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
      } catch (error) {
        if (error.code === 'ESESSION') {
          retry = { operation, scope }
          await dialog.showMessageBox(window, {
            message: 'Unlock your local workspace to continue.'
          })
          await window.loadURL(origin + '/desktop/setup')
        } else if (error.code !== 'ECANCELLED')
          await dialog.showMessageBox(window, {
            type: 'error',
            message:
              error.code === 'EVAULTLOCKED'
                ? 'Unlock your native Keychain to continue.'
                : error.code === 'EVAULT'
                  ? 'Secure Keychain access is unavailable.'
                  : 'Official access could not finish',
            detail:
              'Cached data is retained. Check native vault availability and official access, then retry.'
          })
      } finally {
        busy = false
      }
    }
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
              label: 'Export cached personal data…',
              click: async () => {
                const selected = await dialog.showSaveDialog(window, {
                  title: 'Export cached personal data',
                  defaultPath: 'personal-data.json',
                  filters: [{ name: 'JSON data', extensions: ['json'] }]
                })
                if (selected.canceled || !selected.filePath) return
                try {
                  const { personal } = await nativeRequest('session', 'Player')
                  if (!personal) throw new Error('Personal data unavailable')
                  writeFileSync(
                    selected.filePath,
                    JSON.stringify(
                      {
                        schemaVersion: 'macos-personal-export/v1',
                        personal,
                        freshness: {
                          syncedAt: personal.upstreamUpdatedAt,
                          offlineReadable: true
                        }
                      },
                      null,
                      2
                    ),
                    { mode: 0o600, flag: 'wx' }
                  )
                  await dialog.showMessageBox(window, {
                    message: 'Cached personal data exported',
                    detail: 'Official API access remains in the native vault.'
                  })
                } catch (error) {
                  if (error.code === 'ESESSION') {
                    await nativeAction('session', 'Player')
                    return
                  }
                  await dialog.showMessageBox(window, {
                    type: 'error',
                    message: 'Export did not finish',
                    detail:
                      'Your existing file and workspace data were preserved. Select a new destination and try again.'
                  })
                }
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
    await window.loadURL(config.url)
    if (!config.verify) {
      window.webContents.on('did-finish-load', async () => {
        if (
          !window.webContents.getURL().startsWith(origin + '/desktop/personal')
        )
          return
        if (retry) {
          const action = retry
          retry = null
          await nativeAction(action.operation, action.scope)
          return
        }
        try {
          const view = await nativeRequest('session', 'Player')
          if (!view.personal) await nativeAction('connect', 'Player')
        } catch (error) {
          if (error.code === 'ESESSION')
            await window.loadURL(origin + '/desktop/setup')
        }
      })
    }
    if (config.verify) {
      if (config.verify.setupScreenshot)
        writeFileSync(
          config.verify.setupScreenshot,
          (await window.webContents.capturePage()).toPNG(),
          { mode: 0o600 }
        )
      await window.webContents.executeJavaScript(
        `document.querySelector('#password').value=${JSON.stringify(config.verify.password)}; document.querySelector('#sample').checked=true; document.querySelector('form').requestSubmit();`
      )
      for (let i = 0; i < 250; i++) {
        await new Promise((accept) => setTimeout(accept, 100))
        if (window.webContents.getURL().includes('/player-performance')) break
        const error = await window.webContents.executeJavaScript(
          `document.querySelector('#status')?.textContent`
        )
        if (error && /failed|Invalid|Check|already|Use a/.test(error))
          throw new Error(error)
      }
      await new Promise((accept) => setTimeout(accept, 10000))
      const nativeSession = await nativeRequest('session', 'Player')
      if (nativeSession.cloudContribution !== 'separate-consent-required')
        throw new Error('Native owner session was not verified')
      const observed = await window.webContents.executeJavaScript(
        `({text:document.body.innerText,nodeAccess:typeof require!=='undefined'||typeof process!=='undefined'})`
      )
      const evidence = {
        observed,
        failures,
        blocked,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        nativeSessionVerified: true
      }
      writeFileSync(config.verify.evidence, JSON.stringify(evidence, null, 2), {
        mode: 0o600
      })
      writeFileSync(
        config.verify.screenshot,
        (await window.webContents.capturePage()).toPNG(),
        { mode: 0o600 }
      )
      if (
        observed.nodeAccess ||
        !observed.text.includes('+58%') ||
        !observed.text.includes('-50%') ||
        observed.text.includes('Service Disruption')
      )
        throw new Error(
          'Packaged graphical journey did not render expected scores'
        )
      if (
        blocked.length ||
        failures.some(
          (failure) =>
            !(failure.path === '/api/guild-tokens' && failure.status === 403)
        )
      )
        throw new Error('Unexpected packaged renderer request failure')
      window.destroy()
      app.quit()
    }
  })
  .catch((error) => {
    console.error(error.message)
    app.exit(1)
  })
app.on('window-all-closed', () => app.quit())
