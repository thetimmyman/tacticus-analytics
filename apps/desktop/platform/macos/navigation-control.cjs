// Synthetic network-lifetime experiment; never product acceptance.
const { app, BrowserWindow, session } = require('electron')
const { createServer } = require('node:http')
const { writeFileSync } = require('node:fs')
const { isAbsolute } = require('node:path')
const diagnostics = require('./request-diagnostics.cjs')
const output = process.argv[2]
if (!isAbsolute(output ?? ''))
  throw new Error('Absolute control output required')
app.setPath('userData', output + '-browser')
app.enableSandbox()
app.disableHardwareAcceleration()
app.on('window-all-closed', () => {})
const errorNames = { 'net::ERR_ABORTED': 'request-canceled' }
const pause = (milliseconds) =>
  new Promise((accept) => setTimeout(accept, milliseconds))
const modes = [
  'completed-post',
  'truncated-get',
  'navigate-get',
  'navigate-post',
  'immediate-post',
  'beforeunload-post',
  'keepalive-post',
  'rsc-prefetch-get'
]
app
  .whenReady()
  .then(async () => {
    const { loopbackGateway } = await import('../../proof/loopback-gateway.mjs')
    const results = []
    for (const mode of modes) {
      let requestSeen
      const seen = new Promise((accept) => {
        requestSeen = accept
      })
      const timers = []
      const upstream = createServer((req, res) => {
        req.resume()
        res.setHeader('cache-control', 'no-store')
        if (
          req.url === '/api/briefing/seen' ||
          req.url === '/api/user/token-alerts'
        ) {
          requestSeen()
          if (mode === 'truncated-get') {
            res.writeHead(200, {
              'content-length': '100',
              'content-type': 'application/json'
            })
            res.write('{"synthetic":')
            timers.push(setTimeout(() => res.destroy(), 50))
          } else
            timers.push(
              setTimeout(() => {
                res.writeHead(200, { 'content-type': 'application/json' })
                res.end('{"synthetic":true}')
              }, 2000)
            )
        } else if (req.url === '/home' || req.url === '/player-performance') {
          res.writeHead(200, { 'content-type': 'text/html' })
          res.end(
            '<!doctype html><title>Synthetic control</title><p>synthetic</p>'
          )
        } else {
          res.writeHead(404)
          res.end()
        }
      })
      await new Promise((accept) => upstream.listen(0, '127.0.0.1', accept))
      const transportKey = '0'.repeat(64)
      const gateway = await loopbackGateway({
        services: { ports: {}, token: { anon: 'synthetic-control' } },
        transportKey,
        appPort: upstream.address().port
      })
      const origin = gateway.origin
      const requests = new Map(),
        events = []
      let navigating = false,
        blocked = 0
      const window = new BrowserWindow({
        show: false,
        webPreferences: {
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          webSecurity: true,
          backgroundThrottling: false,
          offscreen: true
        }
      })
      const committedDocument = () =>
        diagnostics.requestDocumentLabel(
          window.isDestroyed() ? '' : window.webContents.getURL()
        )
      session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
        const url = new URL(details.url)
        const allowed =
          url.origin === origin || ['data:', 'blob:'].includes(url.protocol)
        if (!allowed) blocked++
        if (
          url.origin === origin &&
          ['/api/briefing/seen', '/api/user/token-alerts'].includes(
            url.pathname
          )
        )
          requests.set(details.id, {
            ...diagnostics.requestLabel(url.pathname, details.resourceType),
            ...diagnostics.requestMetadata(details.method),
            document: diagnostics.requestDocumentLabel(details.referrer),
            startedBeforeNavigation: !navigating
          })
        callback({ cancel: !allowed })
      })
      // Match the production synchronous header-interception seam exactly.
      session.defaultSession.webRequest.onBeforeSendHeaders(
        (details, callback) => {
          const label = requests.get(details.id)
          if (label)
            requests.set(details.id, {
              ...label,
              ...diagnostics.requestMetadata(
                details.method,
                details.requestHeaders
              )
            })
          if (new URL(details.url).origin === origin)
            details.requestHeaders['x-desktop-transport'] = transportKey
          callback({ requestHeaders: details.requestHeaders })
        }
      )
      session.defaultSession.webRequest.onCompleted((details) => {
        const label = requests.get(details.id)
        if (label)
          events.push({
            ...label,
            outcome: 'completed',
            status: details.statusCode,
            committedDocument: committedDocument()
          })
      })
      session.defaultSession.webRequest.onErrorOccurred((details) => {
        const label = requests.get(details.id)
        if (label)
          events.push({
            ...label,
            outcome: 'error',
            networkError: Object.hasOwn(errorNames, details.error)
              ? errorNames[details.error]
              : diagnostics.networkErrorLabel(details.error),
            committedDocument: committedDocument(),
            ...('frame' in details
              ? { frameAvailable: Boolean(details.frame) }
              : {})
          })
      })
      try {
        await window.loadURL(origin + '/home')
        const post = mode.endsWith('post')
        await window.webContents.executeJavaScript(`
        globalThis.finished = false; globalThis.failed = false;
        globalThis.control = new AbortController();
        ${mode === 'beforeunload-post' ? "addEventListener('beforeunload', () => control.abort(), {once:true});" : ''}
        fetch('${post ? '/api/briefing/seen' : '/api/user/token-alerts'}', {
          method: '${post ? 'POST' : 'GET'}', cache: 'no-store', signal: control.signal,
          ${post ? "headers: {'Content-Type':'application/json'}, body:'{}'," : ''}
          ${mode === 'keepalive-post' ? 'keepalive:true,' : ''}
          ${mode === 'rsc-prefetch-get' ? "headers:{RSC:'1','Next-Router-Prefetch':'1'}," : ''}
        }).then(response => response.json()).then(() => {finished=true}).catch(() => {failed=true});
        true
      `)
        if (!['immediate-post', 'rsc-prefetch-get'].includes(mode)) {
          for (let attempt = 0; attempt < 100 && !requests.size; attempt++)
            await pause(50)
          if (!requests.size)
            throw new Error('Synthetic control request did not start')
          await Promise.race([
            seen,
            pause(5000).then(() => {
              throw new Error('Synthetic upstream did not receive request')
            })
          ])
        }
        if (['completed-post', 'truncated-get'].includes(mode)) {
          let bodyFinished = false
          for (let attempt = 0; attempt < 100; attempt++) {
            bodyFinished =
              await window.webContents.executeJavaScript('finished')
            if (events.length && (mode !== 'completed-post' || bodyFinished))
              break
            await pause(50)
          }
          if (mode === 'completed-post' && bodyFinished !== true)
            throw new Error('Completed baseline body unavailable')
          if (
            mode === 'truncated-get' &&
            !events.some((event) => event.outcome === 'error')
          )
            throw new Error('Truncated baseline was not refused')
        }
        navigating = true
        await window.loadURL(origin + '/player-performance')
        for (let attempt = 0; attempt < 100 && !events.length; attempt++)
          await pause(50)
        if (requests.size && !events.length)
          throw new Error('Synthetic request completion not observed')
        results.push({
          mode,
          events,
          blocked,
          requestObserved: requests.size > 0,
          nodeAccess: await window.webContents.executeJavaScript(
            "typeof require !== 'undefined' || typeof process !== 'undefined'"
          )
        })
      } finally {
        window.destroy()
        for (const timer of timers) clearTimeout(timer)
        await gateway.stop()
        await new Promise((accept) => {
          upstream.close(accept)
          upstream.closeAllConnections()
        })
      }
    }
    writeFileSync(
      output,
      JSON.stringify(
        {
          schemaVersion: 'macos-navigation-control/v1',
          classification: 'diagnostic',
          accepted: false,
          productAcceptance: false,
          sandbox: true,
          electron: process.versions.electron,
          architecture: process.arch,
          results
        },
        null,
        2
      ) + '\n',
      { mode: 0o600 }
    )
    app.quit()
  })
  .catch(() => {
    writeFileSync(
      output,
      JSON.stringify({
        schemaVersion: 'macos-navigation-control/v1',
        classification: 'diagnostic',
        accepted: false,
        productAcceptance: false,
        failure: 'control-failed'
      }) + '\n',
      { mode: 0o600 }
    )
    app.exit(1)
  })
