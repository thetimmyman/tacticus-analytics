import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFile, writeFile, mkdir, readlink, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
const { openSystemBrowser } = createRequire(import.meta.url)(
  '../launcher/system-browser.cjs'
)
const website = 'https://example.invalid/synthetic-planner?view=offline'
const script = fileURLToPath(import.meta.url)

async function descriptor(fd) {
  try {
    return await readlink('/proc/self/fd/' + fd)
  } catch {
    return null
  }
}

if (process.argv[2] === '--browser') {
  const state = process.argv[3]
  assert.equal(process.argv[4], website)
  const leaseInherited = (
    await Promise.all((await readdir('/proc/self/fd')).map(descriptor))
  ).some((path) => path?.endsWith('/runtime.lease'))
  const standardDescriptorsClosed = (
    await Promise.all([0, 1, 2].map(descriptor))
  ).every((path) => path === '/dev/null')
  const credentialEnvironmentAbsent = ![
    'SUPABASE_SERVICE_ROLE_KEY',
    'CRON_SECRET',
    'DESKTOP_KERNEL_LEASE',
    'NODE_OPTIONS',
    'BROWSER'
  ].some((key) => key in process.env)
  await writeFile(
    join(state, 'browser.json'),
    JSON.stringify({
      pid: process.pid,
      url: website,
      leaseInherited,
      standardDescriptorsClosed,
      credentialEnvironmentAbsent
    }),
    { mode: 0o600 }
  )
  if (
    leaseInherited ||
    !standardDescriptorsClosed ||
    !credentialEnvironmentAbsent
  )
    process.exitCode = 1
  else {
    for (let i = 0; i < 600; i++) {
      try {
        await readFile(join(state, 'release'))
        break
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
      await delay(200)
    }
  }
} else if (process.argv[2] === '--owner') {
  const state = process.argv[3],
    legacy = process.argv[4] === 'legacy'
  assert((await descriptor(4))?.endsWith('/runtime.lease'))
  const keeper = setInterval(() => {}, 1000)
  const operation = openSystemBrowser(website, {
    spawnProcess(file, args, options) {
      assert.equal(file, '/usr/bin/xdg-open')
      assert.deepEqual(args, [website])
      return spawn(process.argv[5], [script, '--browser', state, website], {
        ...options,
        ...(legacy
          ? { stdio: ['ignore', 'ignore', 'ignore', 'ignore', 4] }
          : {})
      })
    }
  })
  try {
    if (legacy) await assert.rejects(operation)
    else await operation
  } finally {
    clearInterval(keeper)
  }
} else if (process.argv[2] === '--lock-probe') {
  assert((await descriptor(4))?.endsWith('/runtime.lease'))
} else {
  const config = JSON.parse(await readFile(process.argv[2], 'utf8'))
  assert(config.runtimeGuard, 'A real native runtime guard is required')
  const state = join(
    config.stateRoot || config.state,
    'browser-lifetime-' + randomUUID()
  )
  await mkdir(state, { recursive: true, mode: 0o700 })
  const node = config.application?.node || process.execPath
  const electron = config.application?.electron
  assert(electron, 'The real Electron runtime is required')
  const guard = async (directory, ...args) => {
    const child = spawn(
      config.runtimeGuard,
      ['--owner', directory, electron, script, ...args],
      {
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          ELECTRON_RUN_AS_NODE: '1'
        },
        stdio: ['ignore', 'pipe', 'pipe']
      }
    )
    let output = ''
    for (const stream of [child.stdout, child.stderr])
      stream.on('data', (chunk) => {
        output = (output + chunk).slice(-16384)
      })
    const timeout = setTimeout(() => child.kill('SIGKILL'), 15000)
    try {
      await new Promise((resolve, reject) => {
        child.once('error', reject)
        child.once('close', (code) =>
          code === 0
            ? resolve()
            : reject(new Error('Native browser lifetime owner failed'))
        )
      })
    } finally {
      clearTimeout(timeout)
      await writeFile(join(directory, 'owner.log'), output, { mode: 0o600 })
    }
  }
  try {
    const legacy = join(state, 'legacy')
    await mkdir(legacy, { mode: 0o700 })
    await guard(legacy, '--owner', legacy, 'legacy', node)
    const rejected = JSON.parse(
      await readFile(join(legacy, 'browser.json'), 'utf8')
    )
    assert.equal(rejected.leaseInherited, true)
    assert.equal(rejected.standardDescriptorsClosed, true)
    await guard(state, '--owner', state, 'current', node)
    const browser = JSON.parse(
      await readFile(join(state, 'browser.json'), 'utf8')
    )
    assert.equal(browser.leaseInherited, false)
    assert.equal(browser.standardDescriptorsClosed, true)
    assert.equal(browser.credentialEnvironmentAbsent, true)
    assert.equal(browser.url, website)
    process.kill(browser.pid, 0)
    await guard(state, '--lock-probe')
    process.kill(browser.pid, 0)
    const evidence = {
      status: 'passed',
      checks: [
        'real native kernel lease is present in owner; deliberately inherited lease control refuses dispatch',
        'browser counterpart receives only synthetic URL and filtered desktop environment; standard and native IPC/lease descriptors are closed',
        'native owner fully closes while the detached browser stays alive',
        'same workspace kernel lease can be reacquired while that browser remains alive'
      ],
      scope:
        'Real Linux runtime guard and Node child descriptors with a synthetic holding browser; installed GUI/OS default-handler acceptance is separate.'
    }
    await writeFile(
      config.evidence.replace('.json', '-browser-lifetime.json'),
      JSON.stringify(evidence, null, 2),
      { mode: 0o600 }
    )
    console.log(JSON.stringify(evidence, null, 2))
  } finally {
    await writeFile(join(state, 'release'), '', { mode: 0o600 })
    await writeFile(join(state, 'legacy/release'), '', { mode: 0o600 })
  }
}
