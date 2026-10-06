const { app, BrowserWindow, session } = require('electron')
const { join } = require('node:path')
const { readFileSync, writeFileSync } = require('node:fs')
const config = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const endpoint = new URL(config.url)
if (
  endpoint.protocol !== 'http:' ||
  endpoint.hostname !== '127.0.0.1' ||
  !endpoint.port ||
  !/^[a-f0-9]{64}$/.test(config.transportKey)
)
  throw new Error('Invalid local shell configuration')
app.enableSandbox()
app.disableHardwareAcceleration()
if (config.state) app.setPath('userData', join(config.state, 'browser'))
const failures = [],
  blocked = [],
  consoleErrors = []
app
  .whenReady()
  .then(async () => {
    session.defaultSession.setPermissionRequestHandler(
      (_contents, _permission, callback) => callback(false)
    )
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      const url = new URL(details.url)
      const allowed =
        url.origin === endpoint.origin ||
        url.protocol === 'data:' ||
        url.protocol === 'blob:'
      if (!allowed) blocked.push(url.origin + url.pathname)
      callback({ cancel: !allowed })
    })
    session.defaultSession.webRequest.onBeforeSendHeaders(
      (details, callback) => {
        if (new URL(details.url).origin === endpoint.origin)
          details.requestHeaders['x-desktop-transport'] = config.transportKey
        callback({ requestHeaders: details.requestHeaders })
      }
    )
    session.defaultSession.webRequest.onCompleted((details) => {
      if (details.statusCode >= 400)
        failures.push({
          path: new URL(details.url).pathname,
          query: new URL(details.url).search,
          status: details.statusCode
        })
    })
    for (const cookie of config.cookies)
      await session.defaultSession.cookies.set({
        url: endpoint.origin,
        name: cookie.name,
        value: cookie.value,
        path: '/',
        sameSite: 'lax'
      })
    const window = new BrowserWindow({
      show: false,
      width: 1440,
      height: 1000,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
        offscreen: true,
        webSecurity: true
      }
    })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event, url) => {
      if (new URL(url).origin !== endpoint.origin) event.preventDefault()
    })
    window.webContents.on('console-message', (details) => {
      if (details.level === 'error') consoleErrors.push(details.message)
    })
    console.log('renderer: load start')
    await Promise.race([
      window.loadURL(config.url),
      new Promise((_accept, reject) =>
        setTimeout(() => reject(new Error('Renderer load timed out')), 20000)
      )
    ])
    console.log('renderer: load complete')
    await new Promise((accept) => setTimeout(accept, 12000))
    let wake
    if (config.wake)
      wake = await require('./renderer-wake.cjs').proveRendererWake(
        window,
        session.defaultSession,
        config
      )
    console.log('renderer: read DOM')
    const renderer = await window.webContents.executeJavaScript(
      `({ text: document.body.innerText, nodeAccess: typeof require !== 'undefined' || typeof process !== 'undefined', title: document.title })`
    )
    console.log('renderer: capture')
    writeFileSync(
      config.screenshot,
      (await window.webContents.capturePage()).toPNG(),
      { mode: 0o600 }
    )
    const corePages =
      config.corePages === true
        ? await require('./core-pages.cjs').captureCorePages(
            window,
            endpoint.origin
          )
        : []
    writeFileSync(
      config.evidence,
      JSON.stringify(
        {
          renderer,
          corePages,
          wake,
          failures,
          blocked,
          consoleErrors,
          processMetrics: app.getAppMetrics(),
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false
        },
        null,
        2
      ),
      { mode: 0o600 }
    )
    window.destroy()
    app.quit()
  })
  .catch((error) => {
    console.error(error.message)
    app.exit(1)
  })
