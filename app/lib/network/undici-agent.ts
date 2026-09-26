// fetch over node:http/https: Next's undici pool degrades in long-running containers and
// undici.fetch hangs under Sentry/OTel. Modules are require()d for edge builds.

function httpFetch(
  input: Parameters<typeof globalThis.fetch>[0],
  init?: Parameters<typeof globalThis.fetch>[1]
): Promise<Response> {
  return new Promise((resolve, reject) => {
    try {
      if (init?.signal?.aborted) {
        reject(new DOMException('The operation was aborted.', 'AbortError'))
        return
      }

      const http = require('http')

      const https = require('https')

      let url: URL
      let inputMethod: string | undefined
      let inputHeaders: HeadersInit | undefined
      if (typeof input === 'string') {
        url = new URL(input)
      } else if (input instanceof URL) {
        url = input
      } else {
        url = new URL(input.url)
        inputMethod = input.method
        if (input.headers) {
          inputHeaders = input.headers
        }
      }

      const isHttps = url.protocol === 'https:'
      const mod = isHttps ? https : http

      const headers: Record<string, string> = {}
      if (inputHeaders) {
        if (inputHeaders instanceof Headers) {
          inputHeaders.forEach((value, key) => {
            headers[key] = value
          })
        }
      }
      if (init?.headers) {
        if (init.headers instanceof Headers) {
          init.headers.forEach((value, key) => {
            headers[key] = value
          })
        } else if (Array.isArray(init.headers)) {
          for (const [key, value] of init.headers) {
            headers[key] = value
          }
        } else {
          Object.assign(headers, init.headers)
        }
      }

      const bodyStr = init?.body != null ? String(init.body) : ''
      const finalMethod = init?.method ?? inputMethod ?? 'GET'

      // node:http adds no Content-Length; an unframed body on a keep-alive
      // connection bleeds into the next request, corrupting both.
      if (bodyStr) {
        const hasFramingHeader = Object.keys(headers).some((key) => {
          const lower = key.toLowerCase()
          return lower === 'content-length' || lower === 'transfer-encoding'
        })
        if (!hasFramingHeader) {
          headers['Content-Length'] = String(
            Buffer.byteLength(bodyStr, 'utf-8')
          )
        }
      }

      const req = mod.request(
        url,
        {
          method: finalMethod,
          headers,
          timeout: 120_000 // 2 min — heavy RPCs (materialized view refresh) need >30s
        },
        (res: import('http').IncomingMessage) => {
          const chunks: Buffer[] = []
          res.on('data', (chunk: Buffer) => chunks.push(chunk))
          res.on('end', () => {
            try {
              const status = res.statusCode ?? 200
              const responseHeaders = new Headers()
              for (const [key, value] of Object.entries(res.headers)) {
                if (value)
                  responseHeaders.set(
                    key,
                    Array.isArray(value) ? value.join(', ') : value
                  )
              }
              // Response() throws on a non-null body for null-body statuses.
              const isNullBodyStatus =
                status === 204 || status === 205 || status === 304
              const body = isNullBodyStatus
                ? null
                : new Uint8Array(Buffer.concat(chunks))
              resolve(
                new Response(body, {
                  status,
                  statusText: res.statusMessage ?? '',
                  headers: responseHeaders
                })
              )
            } catch (err) {
              reject(err)
            }
          })
        }
      )

      if (init?.signal) {
        init.signal.addEventListener(
          'abort',
          () => {
            req.destroy()
            reject(new DOMException('The operation was aborted.', 'AbortError'))
          },
          { once: true }
        )
      }

      req.on('error', (err: Error) => {
        if (init?.signal?.aborted) return
        reject(err)
      })
      req.on('timeout', () => {
        req.destroy()
        reject(new Error('httpFetch: request timed out after 120s'))
      })

      if (bodyStr) req.write(bodyStr)
      req.end()
    } catch (err) {
      reject(err)
    }
  })
}

export function getSharedFetch(): typeof globalThis.fetch {
  return ((
    input: Parameters<typeof globalThis.fetch>[0],
    init?: Parameters<typeof globalThis.fetch>[1]
  ) => {
    return httpFetch(input, init)
  }) as typeof globalThis.fetch
}

/** Call from instrumentation.ts register() before anything imports fetch; nodejs runtime only. */
export function patchGlobalFetch(): boolean {
  if (typeof globalThis === 'undefined') {
    return false
  }

  globalThis.fetch = ((
    input: Parameters<typeof globalThis.fetch>[0],
    init?: Parameters<typeof globalThis.fetch>[1]
  ) => {
    return httpFetch(input, init)
  }) as typeof globalThis.fetch

  return true
}
