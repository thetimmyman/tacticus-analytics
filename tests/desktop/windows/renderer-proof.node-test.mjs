import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { stage } from '../../../apps/desktop/platform/windows/stage.mjs'

const root = new URL('../../../', import.meta.url)
const mainPath = new URL('apps/desktop/platform/windows/main.cjs', root)
const helperPath = new URL(
  'apps/desktop/platform/windows/renderer-proof.cjs',
  root
)
const nodeRequire = createRequire(import.meta.url)
const png = Buffer.from('89504e470d0a1a0a73796e746865746963', 'hex')

// Inert Electron/DOM/clock boundary. The maintained main source and the actual
// helper's serialized renderer probes execute; no native process or pixels do.
async function journey(options = {}) {
  let now = 0,
    next = 0,
    done = false,
    task
  const timers = new Map(),
    writes = new Map(),
    captures = [],
    actions = [],
    encodings = [],
    consoleErrors = [],
    writeEvents = []
  const clock = {
    set(fn, ms) {
      const id = ++next
      timers.set(id, { at: now + ms, fn })
      return id
    },
    clear(id) {
      timers.delete(id)
    },
    async drain(limit = 2000) {
      for (let i = 0; i < limit; i++) {
        await new Promise(setImmediate)
        if (done) return
        const first = [...timers].sort((a, b) => a[1].at - b[1].at)[0]
        assert.ok(first, 'owned test operation must settle or have a deadline')
        timers.delete(first[0])
        now = first[1].at
        first[1].fn()
      }
      assert.fail('bounded inert timer work')
    },
    async late() {
      for (const [id, t] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
        if (!timers.has(id)) continue
        timers.delete(id)
        now = Math.max(now, t.at)
        t.fn()
        await new Promise(setImmediate)
      }
    }
  }
  const state = {
    reloaded: false,
    scrolled: false,
    painted: 0,
    exitCode: null,
    helperLoads: 0
  }
  const style = { display: 'block', visibility: 'visible', opacity: '1' }
  const chart = {
    parentElement: null,
    scrollIntoView() {
      actions.push('scroll')
      state.scrolled = true
    },
    getClientRects: () => [1],
    getBoundingClientRect: () => rect(90, 180),
    querySelectorAll: () => rows
  }
  function rect(top, height = 20) {
    const y = top + (state.scrolled ? 0 : 900)
    return {
      left: 100,
      right: 500,
      top: y,
      bottom: y + height,
      width: 400,
      height
    }
  }
  const values = options.wrong ? ['+57%', '-50%'] : ['+58%', '-50%']
  const scores = values.map((textContent, i) => ({
    textContent,
    parentElement: chart,
    getClientRects: () => (options.hidden ? [] : [1]),
    getBoundingClientRect: () => rect(130 + i * 30),
    contains(hit) {
      return hit === this
    }
  }))
  const rows = scores.map((score) => ({
    parentElement: chart,
    getClientRects: () => [1],
    getBoundingClientRect: score.getBoundingClientRect,
    querySelectorAll: () => [score]
  }))
  const heading = {
    textContent: 'Weighted Average Performance vs Guild [%]',
    closest: () => chart
  }
  const fonts = {
    status: options.lateFonts ? 'loading' : 'loaded',
    ready: Promise.resolve()
  }
  if (options.lateFonts)
    fonts.ready = new Promise((accept) =>
      clock.set(() => {
        fonts.status = 'loaded'
        accept()
      }, 50000)
    )
  const body = {
    get innerText() {
      return state.reloaded ? `AFTER ${values.join(' ')}` : 'BEFORE +58% -50%'
    }
  }
  const document = {
    readyState: 'complete',
    fonts,
    body,
    querySelectorAll: () => (options.missing ? [] : [heading]),
    elementFromPoint(_x, y) {
      return options.occluded
        ? {}
        : scores.find((score) => {
            const r = score.getBoundingClientRect()
            return y >= r.top && y <= r.bottom
          })
    }
  }
  const browser = {
    document,
    location: { pathname: '/player-performance' },
    window: { innerWidth: 1024, innerHeight: 720, scrollX: 0, scrollY: 0 },
    getComputedStyle(node) {
      return options.hidden && node === chart
        ? { ...style, visibility: 'hidden' }
        : style
    },
    Date: { now: () => now },
    setTimeout: clock.set,
    clearTimeout: clock.clear,
    requestAnimationFrame(fn) {
      return clock.set(
        () => {
          state.painted++
          actions.push('paint')
          fn()
        },
        options.lateRAF ? 50000 : 16
      )
    },
    cancelAnimationFrame: clock.clear
  }
  const handlers = new Map()
  const contents = {
    setWindowOpenHandler() {},
    on() {},
    once(name, fn) {
      handlers.set(name, fn)
    },
    getURL: () => 'http://127.0.0.1:1234/player-performance',
    reload() {
      state.reloaded = true
      actions.push('reload')
      handlers.get('did-finish-load')()
    },
    async executeJavaScript(code) {
      if (code.includes("fetch('/desktop/official-state')")) return 200
      if (code.includes("fetch('/desktop/open'")) return 403
      if (code === 'document.body.innerText') return body.innerText
      if (code.includes('({text:document.body.innerText'))
        return { text: body.innerText, nodeAccess: false }
      const evaluate = () => runInNewContext(code, browser)
      if (options.lateDOM)
        return new Promise((accept) =>
          clock.set(() => accept(evaluate()), 50000)
        )
      return evaluate()
    },
    capturePage() {
      const row = {
        at: now,
        reloaded: state.reloaded,
        painted: state.painted,
        scrolled: state.scrolled
      }
      captures.push(row)
      actions.push('capture')
      const image = {
        isEmpty: () => false,
        getSize: () => {
          if (options.failureImageClockStall) now += 30000
          return { width: 1024, height: 720 }
        },
        toPNG: () => {
          encodings.push(now)
          if (options.failureEncodeClockStall) now += 30000
          return png
        }
      }
      if (options.lateCapture)
        return new Promise((accept) => clock.set(() => accept(image), 50000))
      if (options.mutateDuringCapture) values[0] = '+57%'
      if (options.captureClockStall) now += 30000
      return Promise.resolve(image)
    }
  }
  const app = {
    enableSandbox() {},
    disableHardwareAcceleration() {},
    setPath() {},
    on() {},
    quit() {
      actions.push('quit')
    },
    exit(code) {
      state.exitCode = code
    },
    whenReady() {
      return {
        then(fn) {
          return {
            catch(refuse) {
              task = Promise.resolve()
                .then(fn)
                .catch(refuse)
                .finally(() => {
                  done = true
                })
            }
          }
        }
      }
    }
  }
  const config = {
    url: 'http://127.0.0.1:1234',
    state: 'synthetic-state',
    transportKey: 'a'.repeat(64),
    brokerToken: 'b'.repeat(64),
    verify: options.ordinary
      ? false
      : { screenshot: 'synthetic.png', evidence: 'synthetic.json' }
  }
  const sessions = {
    cookies: {
      async get() {
        return []
      },
      async remove() {}
    },
    setPermissionRequestHandler() {},
    webRequest: Object.fromEntries(
      ['onBeforeRequest', 'onBeforeSendHeaders', 'onCompleted'].map((key) => [
        key,
        () => {}
      ])
    )
  }
  let helper
  function require(name) {
    if (name === 'electron')
      return {
        app,
        BrowserWindow: function () {
          return {
            webContents: contents,
            async loadURL() {},
            destroy() {
              actions.push('destroy')
            }
          }
        },
        session: { defaultSession: sessions }
      }
    if (name === 'node:fs')
      return {
        readFileSync: () => JSON.stringify(config),
        writeFileSync(path, value) {
          writeEvents.push(path)
          writes.set(path, value)
        }
      }
    if (name === './device-session.cjs')
      return () => ({
        async open() {
          return '/player-performance'
        }
      })
    if (name === './renderer-proof.cjs') {
      state.helperLoads++
      return helper
    }
    return nodeRequire(name)
  }
  try {
    const source = await readFile(helperPath, 'utf8'),
      module = { exports: {} }
    runInNewContext(source, {
      module,
      exports: module.exports,
      require(name) {
        return name === 'node:perf_hooks'
          ? { performance: { now: () => now } }
          : nodeRequire(name)
      },
      Buffer,
      Date: { now: () => now },
      setTimeout: clock.set,
      clearTimeout: clock.clear
    })
    helper = module.exports
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  // Only imported services are inert replacements; the complete main producer
  // body, verify branch, checkpoint ordering and failure handler stay actual.
  const main = (await readFile(mainPath, 'utf8'))
    .replace(
      "await import('../../launcher/workspace-session.mjs')",
      'await Promise.resolve({currentWorkspaceToken(){return null}})'
    )
    .replace(
      "await import('./credential-surface.mjs')",
      'await Promise.resolve({rendererCredentialSurface(){return false}})'
    )
  runInNewContext(main, {
    require,
    URL,
    Buffer,
    process: { on() {}, connected: false },
    console: {
      error(message) {
        consoleErrors.push(message)
      }
    },
    setTimeout: clock.set,
    clearTimeout: clock.clear
  })
  await clock.drain()
  await task
  const beforeLate = {
    captures: captures.length,
    writes: writes.size,
    actions: actions.length,
    writeEvents: writeEvents.length,
    finishedAt: now
  }
  await clock.late()
  return {
    state,
    writes,
    captures,
    actions,
    encodings,
    consoleErrors,
    writeEvents,
    beforeLate,
    now,
    timers: timers.size
  }
}

test('main proof emits final post-reload DOM only after visible scores and paint at capture', async () => {
  const out = await journey()
  assert.equal(out.state.exitCode, null)
  const evidence = JSON.parse(out.writes.get('synthetic.json'))
  assert.equal(evidence.observed.text, 'AFTER +58% -50%')
  assert.ok(
    out.captures[0].reloaded &&
      out.captures[0].scrolled &&
      out.captures[0].painted >= 2
  )
  assert.deepEqual(evidence.scoreCaptureCheckpoint, {
    phase: 'after-native-recovery-reload',
    visibleSyntheticScores: true,
    documentComplete: true,
    fontsLoaded: true,
    paintFrames: 2,
    domStableAcrossCapture: true
  })
})

test('main proof refuses hidden score text rather than declaring a successful screenshot', async () => {
  const out = await journey({ hidden: true })
  assert.equal(out.state.exitCode, 1)
  assert.equal(out.writes.has('synthetic.json'), false)
})

for (const option of [
  'missing',
  'wrong',
  'occluded',
  'lateFonts',
  'lateRAF',
  'lateDOM',
  'lateCapture',
  'captureClockStall',
  'mutateDuringCapture'
]) {
  test(`score capture refuses ${option} and late settlement cannot emit success or continue capture`, async () => {
    const out = await journey({ [option]: true })
    assert.equal(out.state.exitCode, 1)
    assert.equal(out.writes.has('synthetic.json'), false)
    assert.equal(out.captures.length, out.beforeLate.captures)
    assert.equal(out.writes.size, out.beforeLate.writes)
    assert.equal(out.writeEvents.length, out.beforeLate.writeEvents)
    assert.equal(out.actions.length, out.beforeLate.actions)
    assert.ok(
      out.beforeLate.finishedAt <=
        (option === 'captureClockStall' ? 70000 : 40000),
      'original 10s settle plus 30s checkpoint bound'
    )
    assert.ok(out.captures.every((capture) => capture.at < 40000))
    if (option === 'lateFonts' || option === 'lateRAF' || option === 'lateDOM')
      assert.equal(out.state.painted, 0, 'late readiness must not paint')
    if (option === 'lateCapture')
      assert.equal(out.captures.length, 1, 'no second in-flight capture')
  })
}

test('failure screenshot shares the deadline and cannot write after a late capture', async () => {
  const out = await journey({ hidden: true, lateCapture: true })
  assert.equal(out.state.exitCode, 1)
  assert.equal(out.writes.size, 0)
  assert.equal(out.captures.length, 1)
  assert.equal(out.beforeLate.finishedAt, 40000)
  assert.equal(out.writeEvents.length, out.beforeLate.writeEvents)
  assert.equal(out.actions.length, out.beforeLate.actions)
})

for (const option of ['failureEncodeClockStall', 'failureImageClockStall']) {
  test(`failure PNG ${option} discards a late result and never begins encoding after the shared deadline`, async () => {
    const out = await journey({ hidden: true, [option]: true })
    assert.equal(out.state.exitCode, 1)
    assert.equal(out.writes.has('synthetic.json'), false)
    assert.equal(out.writes.has('synthetic.png'), false)
    assert.deepEqual(out.consoleErrors, [
      'Error: Synthetic score checkpoint unavailable'
    ])
    assert.ok(out.encodings.every((at) => at < 40000))
    if (option === 'failureImageClockStall')
      assert.equal(out.encodings.length, 0)
    assert.equal(out.writeEvents.length, out.beforeLate.writeEvents)
    assert.equal(out.actions.length, out.beforeLate.actions)
  })
}

test('ordinary launch never loads proof helper or captures', async () => {
  const out = await journey({ ordinary: true })
  assert.equal(out.state.helperLoads, 0)
  assert.equal(out.captures.length, 0)
  assert.equal(out.writes.size, 0)
})

test('actual stage includes exact invoked renderer proof bytes in its inventory', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'windows-score-stage-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const input = join(dir, 'inputs')
  for (const name of [
    'application',
    'postgres/bin',
    'postgres/lib',
    'postgres/share',
    'electron',
    'auth',
    'native',
    'crt'
  ])
    await mkdir(join(input, name), { recursive: true })
  for (const name of [
    'postgres/bin/postgres.exe',
    'node.exe',
    'electron/electron.exe',
    'auth/auth.exe',
    'postgrest.exe',
    'native/TacticusDesktop.exe',
    'crt/msvcp140.dll'
  ])
    await writeFile(join(input, name), Buffer.alloc(64))
  await writeFile(
    join(input, 'application/server.js'),
    '// synthetic inert runtime'
  )
  const output = join(dir, 'staged')
  await stage({
    output,
    application: join(input, 'application'),
    postgres: join(input, 'postgres'),
    node: join(input, 'node.exe'),
    electron: join(input, 'electron'),
    auth: join(input, 'auth'),
    postgrest: join(input, 'postgrest.exe'),
    native: join(input, 'native'),
    vcRuntime: join(input, 'crt'),
    sourceSha: 'a'.repeat(40)
  })
  const rel = 'apps/desktop/platform/windows/renderer-proof.cjs',
    original = await readFile(helperPath)
  assert.deepEqual(await readFile(join(output, rel)), original)
  const manifest = JSON.parse(
    await readFile(join(output, 'bundle-manifest.json'), 'utf8')
  )
  assert.deepEqual(
    manifest.files.find((row) => row.path === rel),
    {
      path: rel,
      size: original.length,
      sha256: createHash('sha256').update(original).digest('hex')
    }
  )
  assert.equal(
    typeof nodeRequire(join(output, rel)).captureScoreCheckpoint,
    'function'
  )
})
