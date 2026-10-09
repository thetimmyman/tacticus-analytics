import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  existsSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { tsImport } from 'tsx/esm/api'
const { createNativeAddonRuntime } = await tsImport(
  '../../addons/native-runtime.ts',
  import.meta.url
)
const { fixturePolicy, war, replay } = await tsImport(
  '../../../tests/addons/fixtures.ts',
  import.meta.url
)
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

async function exportMenuFixture(t, capabilities) {
  const state = mkdtempSync(join(tmpdir(), 'native-export-menu-'))
  t.after(() => rmSync(state, { recursive: true, force: true }))
  const fixture = fixturePolicy(),
    handlers = new Map(),
    dialogs = []
  const policy = {
    schemaVersion: 1,
    coreVersion: '1.0.0',
    trustedKeys: Object.fromEntries(
      [...fixture.policy.trustedKeys].map(([id, key]) => [
        id,
        key.export({ type: 'spki', format: 'pem' }).toString()
      ])
    ),
    revokedKeyIds: [],
    approvedReviews: [...fixture.policy.approvedReviews],
    approvedRightsReceipts: [...fixture.policy.approvedRightsReceipts]
  }
  class Window extends EventEmitter {
    destroyed = false
    webContents = Object.assign(new EventEmitter(), {
      mainFrame: { url: '' },
      setWindowOpenHandler() {}
    })
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
  const destination = join(state, 'synthetic-export.json')
  const control = {
    guildCode: 'SYN001',
    available: true,
    result: { canceled: false, filePath: destination },
    duringDialog: async () => {}
  }
  let runtime
  const menu = await addonMenu(
    owner,
    {
      url: 'http://127.0.0.1:3210/desktop/setup',
      transportKey: 'a'.repeat(64),
      brokerToken: 'b'.repeat(64),
      state
    },
    {
      electron: {
        BrowserWindow: Window,
        dialog: {
          async showSaveDialog(window, options) {
            dialogs.push({ window, options })
            await control.duringDialog()
            return control.result
          }
        },
        ipcMain: {
          handle: (id, handler) => handlers.set(id, handler),
          removeHandler: (id) => handlers.delete(id)
        },
        session: {
          fromPartition: () => ({
            webRequest: { onBeforeRequest() {} },
            setPermissionRequestHandler() {}
          })
        }
      },
      fetch: () => {
        throw new Error('Unexpected network')
      },
      policy,
      context: async () => {
        if (!control.available)
          throw new Error('synthetic-private-context-error')
        return {
          installation: '11111111-1111-4111-8111-111111111111',
          guildCode: control.guildCode
        }
      },
      runtime: {
        createNativeAddonRuntime: (...args) => {
          runtime = createNativeAddonRuntime(...args)
          return runtime
        }
      }
    }
  )
  const window = await menu.open()
  const event = {
    sender: window.webContents,
    senderFrame: window.webContents.mainFrame
  }
  const [, handler] = [...handlers][0]
  for (const id of ['guild-war', 'replays']) {
    const staged = await runtime.dispatch({
      method: 'stagePackage',
      args: [
        JSON.stringify(
          fixture.bundle(id, '1.0.0', capabilities ? { capabilities } : {})
        )
      ]
    })
    await runtime.dispatch({
      method: 'activate',
      args: [staged.digest, staged.manifest.capabilities]
    })
    await runtime.dispatch({
      method: 'importLocalData',
      args: [id, JSON.stringify(id === 'guild-war' ? war : replay)]
    })
  }
  return {
    state,
    owner,
    window,
    event,
    handler,
    runtime,
    control,
    destination,
    dialogs
  }
}

test('main-owned save dialog exports both normalized formats, returns no bytes/path and preserves other module/core data', async (t) => {
  const f = await exportMenuFixture(t)
  const registry = readFileSync(join(f.state, 'addons/registry.json'))
  const core = join(f.state, 'synthetic-core.txt')
  writeFileSync(core, 'synthetic-core-preserved')
  for (const id of ['guild-war', 'replays']) {
    const result = await f.handler(f.event, {
      method: 'exportLocalData',
      args: [id]
    })
    assert.deepEqual(result, { ok: true, value: undefined })
    assert.equal(f.dialogs.at(-1).window, f.window)
    assert.equal(
      f.dialogs.at(-1).options.defaultPath,
      id === 'guild-war' ? 'war-summary.json' : 'replay-timeline.json'
    )
    assert.deepEqual(f.dialogs.at(-1).options.filters, [
      { name: 'JSON', extensions: ['json'] }
    ])
    assert.deepEqual(
      JSON.parse(readFileSync(f.destination, 'utf8')),
      id === 'guild-war' ? war : replay
    )
    assert.deepEqual(
      readFileSync(join(f.state, 'addons/registry.json')),
      registry
    )
    assert.equal(readFileSync(core, 'utf8'), 'synthetic-core-preserved')
  }
  for (const request of [
    { method: 'exportLocalData', args: ['guild-war', f.destination] },
    { method: 'exportLocalData', args: ['guild-war'], bytes: '{}' },
    { method: 'exportLocalData', args: ['replays'], filePath: f.destination }
  ])
    assert.deepEqual(await f.handler(f.event, request), {
      ok: false,
      code: 'invalid-package'
    })
  assert.equal(f.dialogs.length, 2)
})

test('cancelled export writes nothing; no data/read permission refuses before opening a save dialog', async (t) => {
  const f = await exportMenuFixture(t)
  f.control.result.canceled = true
  assert.deepEqual(
    await f.handler(f.event, {
      method: 'exportLocalData',
      args: ['guild-war']
    }),
    { ok: true, value: undefined }
  )
  assert.equal(f.dialogs.length, 1)
  assert.equal(existsSync(f.destination), false)
  f.control.guildCode = 'SYN002'
  assert.deepEqual(
    await f.handler(f.event, {
      method: 'exportLocalData',
      args: ['guild-war']
    }),
    { ok: false, code: 'invalid-session' }
  )
  assert.equal(existsSync(f.destination), false)
  const unreadable = await exportMenuFixture(t, ['offline.import'])
  assert.deepEqual(
    await unreadable.handler(unreadable.event, {
      method: 'exportLocalData',
      args: ['replays']
    }),
    { ok: false, code: 'invalid-session' }
  )
  assert.equal(unreadable.dialogs.length, 0)
  assert.equal(existsSync(unreadable.destination), false)
})

for (const change of [
  'signed-binding',
  'signed-refusal',
  'disable',
  'binding-epoch',
  'owner-close',
  'top-frame'
]) {
  test(`save dialog await rechecks authority and refuses ${change} without any destination write`, async (t) => {
    const f = await exportMenuFixture(t)
    f.control.duringDialog = async () => {
      if (change === 'signed-binding') f.control.guildCode = 'SYN002'
      else if (change === 'signed-refusal') f.control.available = false
      else if (change === 'disable')
        await f.runtime.dispatch({
          method: 'setEnabled',
          args: ['guild-war', false]
        })
      else if (change === 'owner-close') f.owner.emit('closed')
      else if (change === 'top-frame')
        f.window.webContents.mainFrame.url = 'https://example.invalid/forged'
      else {
        f.runtime.setBinding(null)
      }
    }
    const result = await f.handler(f.event, {
      method: 'exportLocalData',
      args: ['guild-war']
    })
    assert.deepEqual(result, { ok: false, code: 'invalid-session' })
    assert.equal(f.dialogs.length, 1)
    assert.equal(existsSync(f.destination), false)
    assert.equal(JSON.stringify(result).includes('synthetic-private'), false)
  })
}

test('main uses fixed errors for save failure and rechecks data again after the save dialog', async (t) => {
  const f = await exportMenuFixture(t)
  f.control.result.filePath = join(
    f.state,
    'missing-parent',
    'synthetic-private-path.json'
  )
  assert.deepEqual(
    await f.handler(f.event, {
      method: 'exportLocalData',
      args: ['guild-war']
    }),
    { ok: false, code: 'recoverable-storage' }
  )
  assert.equal(f.dialogs.length, 1)
  assert.equal(existsSync(f.control.result.filePath), false)
  f.control.result.filePath = f.destination
  f.control.duringDialog = async () => {
    await f.runtime.dispatch({
      method: 'importLocalData',
      args: ['guild-war', JSON.stringify({ ...war, battles: [] })]
    })
  }
  assert.deepEqual(
    await f.handler(f.event, {
      method: 'exportLocalData',
      args: ['guild-war']
    }),
    { ok: true, value: undefined }
  )
  assert.deepEqual(JSON.parse(readFileSync(f.destination, 'utf8')), {
    ...war,
    battles: []
  })
})

test('actual preload exposes exactly nine fixed commands and export supplies only explicit caller arguments', async () => {
  let exposed
  const calls = []
  runInNewContext(
    readFileSync(
      new URL('../launcher/addon-preload.cjs', import.meta.url),
      'utf8'
    ),
    {
      process: { argv: ['--addon-channel=' + 'c'.repeat(64)] },
      require(name) {
        assert.equal(name, 'electron')
        return {
          contextBridge: {
            exposeInMainWorld(name, value) {
              assert.equal(name, 'localAddons')
              exposed = value
            }
          },
          ipcRenderer: {
            async invoke(channel, request) {
              calls.push({ channel, request })
              return { ok: true, value: undefined }
            }
          }
        }
      }
    }
  )
  assert.deepEqual(
    Object.keys(exposed).sort(),
    [
      'list',
      'stagePackage',
      'activate',
      'setEnabled',
      'rollback',
      'uninstall',
      'importLocalData',
      'view',
      'exportLocalData'
    ].sort()
  )
  assert.equal(Object.isFrozen(exposed), true)
  assert.equal(await exposed.exportLocalData('guild-war'), undefined)
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    {
      channel: 'c'.repeat(64),
      request: { method: 'exportLocalData', args: ['guild-war'] }
    }
  ])
})
