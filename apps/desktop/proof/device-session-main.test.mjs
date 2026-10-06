import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import { randomBytes } from 'node:crypto'
import { currentWorkspaceToken } from '../launcher/workspace-session.mjs'
const deviceSession = createRequire(import.meta.url)(
  '../launcher/device-session.cjs'
)
test('main installs owner cookies without a renderer password or native capability and limits bootstrap transport to one endpoint', async () => {
  const origin = 'http://127.0.0.1:34567',
    cookies = [{ name: 'tacticus-auth-token.0', value: 'stale' }],
    webContents = new EventEmitter()
  const removed = [],
    calls = []
  let allowed, headers, loaded
  webContents.session = {
    cookies: {
      async get() {
        return cookies
      },
      async remove(_url, name) {
        removed.push(name)
        cookies.splice(0, cookies.length)
      },
      async set(cookie) {
        cookies.push(cookie)
      }
    }
  }
  const config = {
    url: origin + '/desktop/setup',
    transportKey: randomBytes(32).toString('hex'),
    brokerToken: randomBytes(32).toString('hex')
  }
  const grant = {
    access_token: 'synthetic.payload.signature',
    refresh_token: 'synthetic-refresh',
    user: { metadata: 'x'.repeat(5000) }
  }
  const device = deviceSession(
    {
      webContents,
      async loadURL(url) {
        loaded = url
      }
    },
    config,
    {
      electron: {
        session: {
          fromPartition(name) {
            assert(!name.startsWith('persist:'))
            return {
              webRequest: {
                onBeforeRequest(cb) {
                  allowed = cb
                },
                onBeforeSendHeaders(cb) {
                  headers = cb
                }
              },
              async fetch(url, options) {
                calls.push(url)
                assert.equal(options.method, 'POST')
                return new Response(
                  JSON.stringify({
                    session: grant,
                    destination: '/desktop/connect'
                  })
                )
              }
            }
          }
        }
      }
    }
  )
  for (const url of [
    origin + '/desktop/open?next=foreign',
    origin + '/desktop/open/extra',
    'https://example.invalid/desktop/open'
  ])
    allowed({ url }, (value) => assert.equal(value.cancel, true))
  allowed({ url: origin + '/desktop/open' }, (value) =>
    assert.equal(value.cancel, false)
  )
  headers({ url: origin + '/desktop/open', requestHeaders: {} }, (value) =>
    assert.equal(value.requestHeaders['x-desktop-broker'], config.brokerToken)
  )
  assert.equal(await device.open(), true)
  assert.equal(loaded, origin + '/desktop/connect')
  assert.deepEqual(removed, ['tacticus-auth-token.0'])
  assert.equal(currentWorkspaceToken(cookies), grant.access_token)
  assert(cookies.length > 1)
  assert(cookies.every((cookie) => !cookie.value.includes(config.brokerToken)))
  assert.deepEqual(calls, [origin + '/desktop/open'])
})
