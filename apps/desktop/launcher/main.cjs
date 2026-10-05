const { app, BrowserWindow, session, dialog, shell } = require('electron')
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
if (
  process.platform === 'linux' &&
  !app.commandLine.hasSwitch('password-store')
)
  app.commandLine.appendSwitch('password-store', 'gnome-libsecret')
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
          query: new URL(details.url).search,
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
    require('./external-links.cjs').installExternalLinks(window, origin, {
      dialog,
      shell: {
        openExternal: (url) =>
          require('./system-browser.cjs').openSystemBrowser(url, {
            electronShell: shell
          })
      },
      enabled: !config.verify
    })
    const device = require('./device-session.cjs')(window, config)
    if (!(await device.open())) await window.loadURL(config.url)
    const gameItems = config.verify
      ? []
      : [
          await require('./onboarding-menu.cjs')(window, config),
          await require('./update-menu.cjs')(window, config)
        ]
    const maintenance = require('./maintenance-menu.cjs')(
      window,
      config,
      gameItems
    )
    if (config.verify) {
      if (config.verify.setupScreenshot)
        writeFileSync(
          config.verify.setupScreenshot,
          (await window.webContents.capturePage()).toPNG(),
          { mode: 0o600 }
        )
      if (window.webContents.getURL().includes('/desktop/setup')) {
        await window.webContents.executeJavaScript(
          `if(document.querySelector('input[type="password"]')) throw new Error('Unexpected workspace password'); document.querySelector('#sample').checked=true; document.querySelector('form').requestSubmit();`
        )
        for (let i = 0; i < 250; i++) {
          await new Promise((accept) => setTimeout(accept, 100))
          if (!window.webContents.getURL().includes('/desktop/setup')) break
        }
      }
      await window.loadURL(
        origin + '/player-performance?guild=SYN001&season=9999'
      )
      await new Promise((accept) => setTimeout(accept, 10000))
      const wake = config.verify.wake
        ? await require('../proof/renderer-wake.cjs').proveRendererWake(
            window,
            session.defaultSession,
            { ...config, wake: config.verify.wake }
          )
        : undefined
      const observed = await window.webContents.executeJavaScript(
        `({text:document.body.innerText,nodeAccess:typeof require!=='undefined'||typeof process!=='undefined'})`
      )
      const screenshot = (await window.webContents.capturePage()).toPNG()
      const corePages =
        config.verify.corePages === true
          ? await require('../proof/core-pages.cjs').captureCorePages(
              window,
              origin
            )
          : []
      const evidence = {
        observed,
        corePages,
        deviceSession: true,
        wake,
        failures,
        blocked,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false
      }
      writeFileSync(config.verify.evidence, JSON.stringify(evidence, null, 2), {
        mode: 0o600
      })
      writeFileSync(config.verify.screenshot, screenshot, { mode: 0o600 })
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
            !(failure.path === '/api/guild-tokens' && failure.status === 403) &&
            !(
              wake?.status === 'passed' &&
              failure.path === '/supabase/rest/v1/EOT_GR_data' &&
              failure.query === '?select=id' &&
              failure.status === 401
            )
        )
      )
        throw new Error('Unexpected packaged renderer request failure')
      if (config.verify.maintenance)
        return maintenance(
          config.verify.maintenance.operation,
          config.verify.maintenance
        )
      window.destroy()
      app.quit()
    }
  })
  .catch((error) => {
    console.error(error.message)
    app.exit(1)
  })
app.on('window-all-closed', () => app.quit())
