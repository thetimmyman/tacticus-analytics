import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import { readlinkSync } from 'node:fs'
const { browserEnvironment, openSystemBrowser } = createRequire(
  import.meta.url
)('../launcher/system-browser.cjs')
const website = 'https://example.invalid/synthetic-planner?view=offline'

test('Linux browser environment omits credentials, command overrides and runtime settings', () => {
  assert.deepEqual(
    browserEnvironment({
      HOME: '/synthetic',
      DISPLAY: ':99',
      PATH: '/synthetic/bin',
      BROWSER: 'synthetic-command',
      SUPABASE_SERVICE_ROLE_KEY: 'synthetic-secret',
      CRON_SECRET: 'synthetic-secret',
      NODE_OPTIONS: 'synthetic-option'
    }),
    {
      HOME: '/synthetic',
      DISPLAY: ':99',
      PATH: '/usr/bin:/bin'
    }
  )
})

test('Linux opens via an absolute OS helper with closed descriptors and no shell', async () => {
  let call,
    unreferenced = false
  await openSystemBrowser(website, {
    platform: 'linux',
    env: { HOME: '/synthetic' },
    spawnProcess(file, args, options) {
      call = { file, args, options }
      assert.equal(
        readlinkSync('/proc/self/fd/' + options.stdio[3]),
        '/dev/null'
      )
      assert.equal(options.stdio[3], options.stdio[4])
      const child = new EventEmitter()
      child.unref = () => {
        unreferenced = true
      }
      setImmediate(() => {
        child.emit('spawn')
        child.emit('exit', 0)
      })
      return child
    }
  })
  assert.equal(call.file, '/usr/bin/xdg-open')
  assert.deepEqual(call.args, [website])
  assert.equal(call.options.detached, true)
  assert.deepEqual(call.options.stdio.slice(0, 3), [
    'ignore',
    'ignore',
    'ignore'
  ])
  assert.equal(call.options.shell, undefined)
  assert.equal(unreferenced, true)
})

test('browser lifetime does not delay handoff completion; startup failures reject', async () => {
  const keeper = setTimeout(() => {}, 1000)
  try {
    await openSystemBrowser(website, {
      platform: 'linux',
      settleMs: 1,
      spawnProcess() {
        const child = new EventEmitter()
        child.unref = () => {}
        setImmediate(() => child.emit('spawn'))
        return child
      }
    })
  } finally {
    clearTimeout(keeper)
  }
  for (const event of ['error', 'exit'])
    await assert.rejects(
      openSystemBrowser(website, {
        platform: 'linux',
        spawnProcess() {
          const child = new EventEmitter()
          child.unref = () => {}
          setImmediate(() =>
            event === 'error'
              ? child.emit('error', new Error('Synthetic failure'))
              : child.emit('exit', 3)
          )
          return child
        }
      }),
      /System browser could not be opened/
    )
})

test('unsafe protocols refuse before OS APIs; other platforms use Electron shell', async () => {
  await assert.rejects(
    openSystemBrowser('file:///synthetic', {
      platform: 'linux',
      spawnProcess() {
        throw new Error('Unexpected spawn')
      }
    }),
    /Invalid website URL/
  )
  for (const platform of ['darwin', 'win32']) {
    let opened
    await openSystemBrowser(website, {
      platform,
      electronShell: {
        async openExternal(url) {
          opened = url
        }
      },
      spawnProcess() {
        throw new Error('Unexpected spawn')
      }
    })
    assert.equal(opened, website)
  }
})
