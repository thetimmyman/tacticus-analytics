import { createServer, request as httpRequest } from 'node:http'
import { timingSafeEqual } from 'node:crypto'

export async function loopbackGateway({
  services,
  transportKey,
  appPort,
  handleLocalRequest
}) {
  if (!/^[a-f0-9]{64}$/.test(transportKey))
    throw new Error('Invalid transport key')
  let origin
  const server = createServer(async (req, res) => {
    const supplied = req.headers['x-desktop-transport']
    const authorized =
      typeof supplied === 'string' &&
      /^[a-f0-9]{64}$/.test(supplied) &&
      timingSafeEqual(Buffer.from(supplied), Buffer.from(transportKey))
    if (
      !authorized ||
      req.headers.host !== new URL(origin).host ||
      (req.headers.origin && req.headers.origin !== origin)
    ) {
      res.writeHead(403, {
        'content-type': 'application/json',
        'cache-control': 'no-store'
      })
      res.end('{"error":"Local transport denied"}')
      return
    }
    const url = new URL(req.url, origin)
    if (url.origin !== origin || req.url.startsWith('//')) {
      res.writeHead(400)
      res.end()
      return
    }
    if (handleLocalRequest) {
      try {
        if (await handleLocalRequest(req, res, url)) return
      } catch {
        if (!res.headersSent)
          res.writeHead(500, { 'content-type': 'application/json' })
        res.end(
          '{"error":"Local workspace setup failed. Your existing data was preserved."}'
        )
        return
      }
    }
    let path = url.pathname + url.search,
      port = appPort
    if (url.pathname.startsWith('/supabase/auth/v1/')) {
      path = path.slice('/supabase/auth/v1'.length)
      port = services.ports.auth
    } else if (url.pathname.startsWith('/supabase/rest/v1/')) {
      path = path.slice('/supabase/rest/v1'.length)
      port = services.ports.rest
    } else if (url.pathname.startsWith('/supabase/')) {
      res.writeHead(404)
      res.end()
      return
    }
    if (!port) {
      res.writeHead(503)
      res.end()
      return
    }
    const headers = { ...req.headers, host: `127.0.0.1:${port}` }
    if (headers.authorization === 'Bearer desktop-public')
      headers.authorization = `Bearer ${services.token.anon}`
    else if (
      services.serviceCredential &&
      headers.authorization === `Bearer ${services.serviceCredential}`
    )
      headers.authorization = `Bearer ${services.token.service}`
    delete headers.connection
    const upstream = httpRequest(
      { host: '127.0.0.1', port, path, method: req.method, headers },
      (response) => {
        const responseHeaders = {
          ...response.headers,
          'cache-control': 'no-store'
        }
        delete responseHeaders.connection
        res.writeHead(response.statusCode, responseHeaders)
        response.pipe(res)
      }
    )
    upstream.setTimeout(30000, () =>
      upstream.destroy(new Error('Local upstream timeout'))
    )
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(503)
      res.end()
    })
    req.on('aborted', () => upstream.destroy())
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 1024 * 1024) {
        upstream.destroy()
        if (!res.headersSent) res.writeHead(413)
        res.end()
        req.destroy()
      } else upstream.write(chunk)
    })
    req.on('end', () => upstream.end())
  })
  await new Promise((accept, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', accept)
  })
  origin = `http://127.0.0.1:${server.address().port}`
  return {
    origin,
    setAppPort: (port) => {
      appPort = port
    },
    stop: () =>
      new Promise((accept) => {
        server.close(accept)
        server.closeAllConnections()
      })
  }
}
