import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
const require = createRequire(import.meta.url)
const addonMenu = require('../launcher/addon-menu.cjs')

test('only the manager top frame can invoke fixed commands; binding changes close stale views', async () => {
  const handlers = new Map(),
    calls = [],
    sessions = []
  class Window extends EventEmitter {
    destroyed = false
    webContents = Object.assign(new EventEmitter(), {
      mainFrame: { url: '' },
      setWindowOpenHandler() {}
    })
    constructor(options) {
      super()
      this.options = options
    }
    async loadURL(url) {
      this.webContents.mainFrame.url = url
    }
    isDestroyed() {
      return this.destroyed
    }
    show() {}
    focus() {}
    destroy() {
      this.destroyed = true
      this.emit('closed')
    }
  }
  const owner = new EventEmitter()
  let guildCode = 'SYN001'
  let contextAvailable = true
  let contextPause
  const menu = await addonMenu(
    owner,
    {
      url: 'http://127.0.0.1:3210/desktop/setup',
      transportKey: 'a'.repeat(64),
      brokerToken: 'b'.repeat(64),
      state: '/tmp/synthetic-addon-state'
    },
    {
      electron: {
        BrowserWindow: Window,
        dialog: {
          showMessageBox() {
            throw new Error('Unexpected failure')
          }
        },
        ipcMain: {
          handle: (id, handler) => handlers.set(id, handler),
          removeHandler: (id) => handlers.delete(id)
        },
        session: {
          fromPartition() {
            const value = {
              webRequest: {
                onBeforeRequest(fn) {
                  value.filter = fn
                }
              },
              setPermissionRequestHandler() {}
            }
            sessions.push(value)
            return value
          }
        }
      },
      fetch: () => {
        throw new Error('Unexpected network')
      },
      policy: {},
      context: async () => {
        await contextPause
        if (!contextAvailable) throw new Error('Synthetic expired session')
        return {
          installation: '11111111-1111-4111-8111-111111111111',
          guildCode
        }
      },
      runtime: {
        createNativeAddonRuntime: () => ({
          setBinding: (binding) => calls.push({ binding }),
          dispatch: async (request) => {
            calls.push(request)
            return []
          }
        })
      }
    }
  )
  const window = await menu.open()
  const [channel, handler] = [...handlers][0]
  assert.match(channel, /^[a-f0-9]{64}$/)
  assert.equal(window.options.webPreferences.sandbox, true)
  assert.equal(window.options.webPreferences.nodeIntegration, false)
  const event = {
    sender: window.webContents,
    senderFrame: window.webContents.mainFrame
  }
  assert.deepEqual(
    await handler({ ...event, sender: {} }, { method: 'list', args: [] }),
    { ok: false, code: 'invalid-session' }
  )
  assert.deepEqual(
    await handler(
      { ...event, senderFrame: { url: event.senderFrame.url } },
      {}
    ),
    { ok: false, code: 'invalid-session' }
  )
  assert.deepEqual(await handler(event, { method: 'list', args: [] }), {
    ok: true,
    value: []
  })
  let network
  sessions
    .at(-1)
    .filter({ url: 'https://example.invalid/secret' }, (result) => {
      network = result
    })
  assert.equal(network.cancel, true)
  guildCode = 'SYN002'
  assert.deepEqual(
    await handler(event, { method: 'view', args: ['guild-war'] }),
    { ok: false, code: 'invalid-session' }
  )
  assert.equal(window.isDestroyed(), true)
  assert.equal(handlers.size, 0)
  assert.equal(calls.filter((value) => value.method).length, 1)
  const reopened = await menu.open()
  const [, expiredHandler] = [...handlers][0]
  contextAvailable = false
  assert.deepEqual(
    await expiredHandler(
      {
        sender: reopened.webContents,
        senderFrame: reopened.webContents.mainFrame
      },
      { method: 'view', args: ['replays'] }
    ),
    { ok: false, code: 'invalid-session' }
  )
  assert.equal(reopened.isDestroyed(), true)
  assert.equal(calls.at(-1).binding, null)
  contextAvailable = true
  let release
  contextPause = new Promise((accept) => {
    release = accept
  })
  const opening = menu.open()
  owner.emit('closed')
  release()
  await assert.rejects(opening, /workspace closed/)
  assert.equal(handlers.size, 0)
  assert.equal(calls.at(-1).binding, null)
})
