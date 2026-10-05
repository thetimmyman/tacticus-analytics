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
    await window.loadURL(config.url)
    const gameItems = config.verify
      ? []
      : await require('./game-menu.cjs')(window, config)
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
      if (config.verify.recovery === true) {
        const anotherPassword = randomBytes(24).toString('hex')
        const waitFor = async (expression) => {
          for (let i = 0; i < 150; i++) {
            if (await window.webContents.executeJavaScript(expression)) return
            await new Promise((accept) => setTimeout(accept, 100))
          }
          throw new Error('Workspace recovery form did not complete')
        }
        await window.webContents.executeJavaScript(
          `if(document.querySelector('#recovery').hidden) throw new Error('Recovery requires an existing workspace'); document.querySelector('#recovery-password').value=${JSON.stringify(config.verify.password)}; document.querySelector('#recovery-save').requestSubmit();`
        )
        await waitFor(
          `document.querySelector('#saved-code').textContent.length === 64`
        )
        for (const password of [anotherPassword, config.verify.password]) {
          await new Promise((accept) => setTimeout(accept, 3200))
          await window.webContents.executeJavaScript(
            `document.querySelector('#recovery-reset-status').textContent=''; document.querySelector('#recovery-code').value=document.querySelector('#saved-code').textContent; document.querySelector('#new-password').value=${JSON.stringify(password)}; document.querySelector('#recovery-reset').requestSubmit();`
          )
          await waitFor(
            `document.querySelector('#recovery-reset-status').textContent.includes('Password changed')`
          )
        }
        await window.webContents.executeJavaScript(
          `document.querySelector('#saved-code').textContent=''`
        )
      }
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
        recovery: config.verify.recovery === true,
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
