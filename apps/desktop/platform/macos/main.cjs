const { app, BrowserWindow, session, Menu, dialog } = require('electron')
const { readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
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
    const nativeAction = (operation, scope) => {
      // Emitted by a fixed native menu; renderer content has no command bridge.
      process.stdout.write(
        'TA-MAC-ACTION:' + JSON.stringify({ operation, scope }) + '\n'
      )
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
                  const response = await fetch(
                    `${origin}/api/desktop/personal`,
                    {
                      headers: { 'x-desktop-transport': config.transportKey },
                      redirect: 'error'
                    }
                  )
                  if (!response.ok) throw new Error('Personal data unavailable')
                  const view = await response.json()
                  writeFileSync(
                    selected.filePath,
                    JSON.stringify(
                      {
                        schemaVersion: 'macos-personal-export/v1',
                        personal: view.personal,
                        freshness: view.freshness
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
                } catch {
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
      const observed = await window.webContents.executeJavaScript(
        `({text:document.body.innerText,nodeAccess:typeof require!=='undefined'||typeof process!=='undefined'})`
      )
      const evidence = {
        observed,
        failures,
        blocked,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false
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
