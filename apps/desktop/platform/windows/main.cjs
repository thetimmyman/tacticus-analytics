const { app, BrowserWindow, session } = require('electron')
const { readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const config = JSON.parse(readFileSync(0, 'utf8'))
const origin = new URL(config.url).origin
const deviceSession = require('./device-session.cjs')
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
app
  .whenReady()
  .then(async () => {
    const { currentWorkspaceToken } =
      await import('../../launcher/workspace-session.mjs')
    const { rendererCredentialSurface } =
      await import('./credential-surface.mjs')
    let device
    process.on('message', async (message) => {
      if (
        !message ||
        message.operation !== 'workspace-session' ||
        typeof message.nonce !== 'string' ||
        !/^[a-f0-9-]{36}$/.test(message.nonce)
      )
        return
      let token = null
      try {
        if (message.renew) await device.open()
        try {
          token = currentWorkspaceToken(
            await session.defaultSession.cookies.get({ url: origin })
          )
          const expiry = JSON.parse(
            Buffer.from(token.split('.')[1], 'base64url')
          ).exp
          if (!Number.isSafeInteger(expiry) || expiry <= Date.now() / 1000)
            token = null
        } catch {}
        if (!token) await device.open()
        token = currentWorkspaceToken(
          await session.defaultSession.cookies.get({ url: origin })
        )
      } catch {}
      if (process.connected)
        process.send({
          operation: 'workspace-session',
          nonce: message.nonce,
          token
        })
    })
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
        for (const key of Object.keys(details.requestHeaders))
          if (key.toLowerCase() === 'x-desktop-broker')
            delete details.requestHeaders[key]
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
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event, url) => {
      if (new URL(url).origin !== origin) event.preventDefault()
    })
    device = deviceSession(window, config)
    const destination = await device.open()
    await window.loadURL(origin + destination)
    if (config.verify) {
      if (config.verify.setupScreenshot)
        writeFileSync(
          config.verify.setupScreenshot,
          (await window.webContents.capturePage()).toPNG(),
          { mode: 0o600 }
        )
      if (window.webContents.getURL().includes('/desktop/setup')) {
        const setup = await window.webContents.executeJavaScript(
          `({passwordFields:document.querySelectorAll('input[type=password]').length})`
        )
        if (setup.passwordFields)
          throw new Error('Desktop setup exposed a password field')
        await window.webContents.executeJavaScript(
          `document.querySelector('#sample').checked=true; document.querySelector('#demo').requestSubmit();`
        )
        for (let i = 0; i < 250; i++) {
          await new Promise((accept) => setTimeout(accept, 100))
          if (window.webContents.getURL().includes('/player-performance')) break
          const error = await window.webContents.executeJavaScript(
            `document.querySelector('#status')?.textContent`
          )
          if (error && /failed|Invalid|already|cannot|unavailable/.test(error))
            throw new Error(error)
        }
      }
      await new Promise((accept) => setTimeout(accept, 10000))
      const observed = await window.webContents.executeJavaScript(
        `({text:document.body.innerText,nodeAccess:typeof require!=='undefined'||typeof process!=='undefined'})`
      )
      const sessionStatus = await window.webContents.executeJavaScript(
        `(async()=>{const response=await fetch('/desktop/official-state');return response.status})()`
      )
      if (sessionStatus !== 200)
        throw new Error(
          'Native coordinator could not reuse the authenticated workspace session'
        )
      const rendererBootstrapStatus =
        await window.webContents.executeJavaScript(
          `(async()=>{const response=await fetch('/desktop/open',{method:'POST'});return response.status})()`
        )
      if (rendererBootstrapStatus !== 403)
        throw new Error('Renderer obtained bootstrap access')
      for (const cookie of await session.defaultSession.cookies.get({
        url: origin
      }))
        if (/^tacticus-auth-token(?:\.\d+)?$/.test(cookie.name))
          await session.defaultSession.cookies.remove(origin, cookie.name)
      const recovered = await window.webContents.executeJavaScript(
        `(async()=>{const response=await fetch('/desktop/official-state');return response.status})()`
      )
      if (recovered !== 200)
        throw new Error('Native signed-out session recovery failed')
      window.webContents.reload()
      await new Promise((accept) => setTimeout(accept, 3000))
      const retained = await window.webContents.executeJavaScript(
        `document.body.innerText`
      )
      if (!retained.includes('+58%') || !retained.includes('-50%'))
        throw new Error('Session recovery lost retained sample data')
      const evidence = {
        automaticDeviceSession: true,
        signedOutNativeRecovery: true,
        rendererBootstrapStatus,
        workspaceSessionReuse: true,
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
            !(failure.path === '/api/guild-tokens' && failure.status === 403) &&
            !(failure.path === '/desktop/open' && failure.status === 403) &&
            !(
              failure.path === '/desktop/official-state' &&
              failure.status === 401
            ) &&
            !(
              failure.status === 501 &&
              rendererCredentialSurface(new URL(failure.path, origin))
            )
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
