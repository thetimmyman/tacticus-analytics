import { spawn } from 'node:child_process'
import { localJobScheduler } from './job-scheduler.mjs'
import { electronDisplay } from './display.mjs'
import { launcherOptions } from './options.mjs'
import { bundledServices } from './runtime.mjs'
import {
  initializeReferenceHeroes,
  initializeReferenceBosses
} from './reference-catalog.mjs'
import {
  maintenanceCLI,
  guardedTransfer,
  guardedEncryptedTransfer,
  encryptedPassphrase
} from './maintenance.mjs'
import { selectedWorkspace, selectWorkspace } from './workspace-selection.mjs'
import { startupMessage } from './startup-message.mjs'
import { randomBytes } from 'node:crypto'
import { readFile, writeFile, unlink, mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { createServer } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { nativeServices } from '../proof/native-services.mjs'
import { loopbackGateway } from '../proof/loopback-gateway.mjs'
import { workspaceSetup } from './workspace.mjs'
import { strict as assert } from 'node:assert'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../../..')
const args = process.argv.slice(2)
const options = launcherOptions(args)
const option = (name) => options.get(name)
const defaultState = join(homedir(), '.local/share/tacticus-analytics-preview')
const state = resolve(
  option('--state') || (await selectedWorkspace(defaultState))
)
if (args.includes('--backup') || args.includes('--restore')) {
  console.log(JSON.stringify(await maintenanceCLI(root, state, args)))
  process.exit(0)
}
const verifyPath = option('--verify')
const verify = verifyPath
  ? JSON.parse(await readFile(verifyPath, 'utf8'))
  : undefined
const startup = new AbortController()
const cancelStartup = () => startup.abort()
process.on('SIGINT', cancelStartup)
process.on('SIGTERM', cancelStartup)
let services, display
try {
  display = electronDisplay()
  services = await nativeServices(
    bundledServices(root, state, verify?.userSessionLifetimeSeconds ?? 3600),
    { signal: startup.signal }
  )
} catch (error) {
  const message = startupMessage(error.code)
  if (!verify && display && error.name !== 'AbortError') {
    await new Promise((accept) => {
      const window = spawn(
        join(root, 'electron/electron'),
        [
          join(here, 'startup-error.cjs'),
          error.code || 'unknown',
          ...display.args
        ],
        {
          stdio: 'ignore',
          env: {
            PATH: join(root, 'bin'),
            LANG: 'C.UTF-8',
            HOME: homedir(),
            ...display.environment,
            DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS
          }
        }
      )
      window.once('error', accept)
      window.once('exit', accept)
    })
  }
  throw new Error(
    error.name === 'AbortError' ? 'Application startup cancelled' : message
  )
} finally {
  process.removeListener('SIGINT', cancelStartup)
  process.removeListener('SIGTERM', cancelStartup)
}
let gateway, scheduler, maintenance, applicationPort
const maintenanceNonce = randomBytes(32).toString('hex')
const maintenanceRequest = join(state, `maintenance-${maintenanceNonce}.json`)
try {
  try {
    await initializeReferenceHeroes(
      services,
      join(root, 'application/data/game-data'),
      join(root, 'application/public/images/portraits')
    )
  } catch {
    // Missing optional reference data must not prevent reading existing data.
    console.warn(
      'Bundled reference catalogue could not refresh; existing catalogue retained.'
    )
  }
  try {
    await initializeReferenceBosses(
      services,
      join(root, 'application/data/game-data')
    )
  } catch {
    console.warn(
      'Bundled boss catalogue could not refresh; existing catalogue retained.'
    )
  }
  const transportKey = randomBytes(32).toString('hex')
  const cronSecret = randomBytes(32).toString('hex')
  const brokerToken = randomBytes(32).toString('hex')
  gateway = await loopbackGateway({
    services,
    transportKey,
    handleLocalRequest: workspaceSetup(services, here, {
      brokerToken,
      normalizeRoster: async (contents, subject) => {
        const response = await fetch(
          `http://127.0.0.1:${applicationPort}/api/desktop/normalize-roster`,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              Authorization: `Bearer ${cronSecret}`,
              'x-desktop-transport': transportKey
            },
            body: JSON.stringify({ contents, subject }),
            signal: AbortSignal.timeout(20000)
          }
        )
        if (!response.ok) throw new Error('Roster normalization failed')
        const reader = response.body?.getReader()
        if (!reader) throw new Error('Invalid roster result')
        const chunks = []
        let bytes = 0
        try {
          for (;;) {
            const part = await reader.read()
            if (part.done) break
            bytes += part.value.byteLength
            if (bytes > 4 * 1024 * 1024)
              throw new Error('Invalid roster result')
            chunks.push(part.value)
          }
        } finally {
          await reader.cancel().catch(() => {})
          reader.releaseLock()
        }
        return JSON.parse(Buffer.concat(chunks).toString('utf8'))
      },
      normalize: async (contents, context) => {
        const response = await fetch(
          `http://127.0.0.1:${applicationPort}/api/desktop/normalize-raid-file`,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              Authorization: `Bearer ${cronSecret}`,
              'x-desktop-transport': transportKey
            },
            body: JSON.stringify({ contents, context }),
            signal: AbortSignal.timeout(20000)
          }
        )
        if (!response.ok) throw new Error('Invalid raid file')
        const result = await response.json()
        if (
          !Array.isArray(result.rows) ||
          result.rows.length < 1 ||
          result.rows.length > 10000
        )
          throw new Error('Invalid raid file')
        return result.rows
      }
    })
  })
  const listener = createServer()
  await new Promise((accept) => listener.listen(0, '127.0.0.1', accept))
  const port = listener.address().port
  await new Promise((accept) => listener.close(accept))
  applicationPort = port
  gateway.setAppPort(port)
  const application = services.launch(
    join(root, 'bin/node'),
    [join(root, 'application/server.js')],
    {
      PATH: join(root, 'bin'),
      NODE_ENV: 'production',
      HOSTNAME: '127.0.0.1',
      PORT: String(port),
      NEXT_TELEMETRY_DISABLED: '1',
      NEXT_PUBLIC_RUNTIME_PROFILE: 'desktop',
      NEXT_PUBLIC_SITE_URL: gateway.origin,
      SITE_URL: gateway.origin,
      NEXT_PUBLIC_SUPABASE_URL: `${gateway.origin}/supabase`,
      SUPABASE_URL: `${gateway.origin}/supabase`,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'desktop-public',
      SUPABASE_SERVICE_ROLE_KEY: services.serviceCredential,
      DESKTOP_TRANSPORT_KEY: transportKey,
      CRON_SECRET: cronSecret
    },
    join(root, 'application')
  )
  let ready = false
  for (let i = 0; i < 150; i++) {
    if (application.exitCode !== null || services.fault)
      throw new Error('The local application stopped during startup')
    try {
      const health = await fetch(`${gateway.origin}/api/health`, {
        headers: { 'x-desktop-transport': transportKey },
        signal: AbortSignal.timeout(2000)
      })
      if (health.ok && (await health.json()).status === 'healthy') {
        ready = true
        break
      }
    } catch {}
    await delay(100)
  }
  if (!ready) throw new Error('Local application health did not become ready')
  scheduler = localJobScheduler({
    services,
    origin: gateway.origin,
    transportKey,
    cronSecret,
    onFailure: () =>
      console.error(
        'Local background refresh failed; existing data remains available.'
      )
  })
  scheduler.start()
  if (verify) {
    assert.equal((await fetch(`${gateway.origin}/desktop/setup`)).status, 403)
    const authorized = { 'x-desktop-transport': transportKey }
    assert.equal(
      (
        await fetch(`${gateway.origin}/desktop/setup`, {
          headers: { ...authorized, Origin: 'https://foreign.invalid' }
        })
      ).status,
      403
    )
    const page = await fetch(`${gateway.origin}/desktop/setup`, {
      headers: authorized
    })
    if ((await page.text()).includes('data-mode="create"')) {
      for (const body of ['null', '{']) {
        assert.equal(
          (
            await fetch(`${gateway.origin}/desktop/setup`, {
              method: 'POST',
              headers: { ...authorized, 'content-type': 'application/json' },
              body
            })
          ).status,
          400
        )
      }
      assert.equal(
        (
          await fetch(`${gateway.origin}/desktop/setup`, {
            method: 'POST',
            headers: { ...authorized, 'content-type': 'application/json' },
            body: JSON.stringify({ password: 'x'.repeat(20000), sample: true })
          })
        ).status,
        413
      )
    }
  }
  const config = join(services.state, 'window-config.json')
  await writeFile(
    config,
    JSON.stringify({
      url: `${gateway.origin}/desktop/setup`,
      transportKey,
      brokerToken,
      state: services.state,
      maintenanceNonce,
      maintenanceRequest,
      verify
    }),
    { mode: 0o600 }
  )
  const window = services.launch(
    join(root, 'electron/electron'),
    [join(here, 'main.cjs'), config, ...display.args],
    {
      PATH: join(root, 'bin'),
      LANG: 'C.UTF-8',
      HOME: homedir(),
      XDG_CACHE_HOME: join(state, 'cache'),
      XDG_CURRENT_DESKTOP: process.env.XDG_CURRENT_DESKTOP,
      XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
      XDG_DATA_HOME: process.env.XDG_DATA_HOME,
      DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS,
      ...display.environment
    },
    state,
    true
  )
  const code = await new Promise((accept, reject) => {
    window.once('exit', accept)
    window.once('error', reject)
  })
  if (code !== 0)
    throw new Error(
      'Desktop window verification failed; inspect private local logs'
    )
  try {
    const request = JSON.parse(await readFile(maintenanceRequest, 'utf8'))
    if (
      request.nonce !== maintenanceNonce ||
      !['backup', 'restore'].includes(request.operation) ||
      typeof request.directory !== 'string' ||
      !request.directory.startsWith('/') ||
      (request.encrypted !== undefined &&
        typeof request.encrypted !== 'boolean') ||
      (request.operation === 'restore' &&
        (typeof request.source !== 'string' || !request.source.startsWith('/')))
    )
      throw new Error('Invalid workspace maintenance request')
    maintenance = request
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
} finally {
  await scheduler?.stop()
  if (gateway) await gateway.stop()
  await services.stop()
  await unlink(maintenanceRequest).catch((error) => {
    if (error.code !== 'ENOENT') throw error
  })
}
if (maintenance) {
  try {
    if (maintenance.encrypted) {
      const passphrase = await encryptedPassphrase(maintenance.operation)
      try {
        if (maintenance.operation === 'restore')
          await mkdir(resolve(maintenance.directory), { mode: 0o700 })
        await guardedEncryptedTransfer(
          root,
          maintenance.operation,
          maintenance.operation === 'backup'
            ? state
            : resolve(maintenance.directory),
          resolve(
            maintenance.operation === 'backup'
              ? maintenance.directory
              : maintenance.source
          ),
          passphrase
        )
      } finally {
        passphrase.fill(0)
      }
    } else if (maintenance.operation === 'backup')
      await guardedTransfer(
        root,
        'backup',
        state,
        resolve(maintenance.directory)
      )
    else {
      await maintenanceCLI(root, resolve(maintenance.directory), [
        '--state',
        maintenance.directory,
        '--restore',
        maintenance.source
      ])
    }
    if (maintenance.operation === 'restore') {
      // Check that this application's pinned services can reopen the restored
      // schema before making it the default workspace for future launches.
      let restored
      try {
        restored = await nativeServices(
          bundledServices(root, resolve(maintenance.directory))
        )
      } finally {
        await restored?.stop()
      }
      if (!verify) {
        await mkdir(defaultState, { recursive: true, mode: 0o700 })
        await selectWorkspace(defaultState, resolve(maintenance.directory))
      }
    }
    if (verify)
      console.log(
        JSON.stringify({ maintenance: maintenance.operation, status: 'passed' })
      )
    else
      await new Promise((accept, reject) => {
        const result = spawn(
          join(root, 'electron/electron'),
          [
            join(here, 'maintenance-result.cjs'),
            maintenance.operation,
            maintenance.directory,
            ...display.args
          ],
          {
            stdio: 'ignore',
            env: {
              PATH: join(root, 'bin'),
              LANG: 'C.UTF-8',
              HOME: homedir(),
              DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS,
              ...display.environment
            }
          }
        )
        result.once('error', reject)
        result.once('exit', accept)
      })
  } catch (error) {
    if (!verify)
      await new Promise((accept) => {
        const result = spawn(
          join(root, 'electron/electron'),
          [join(here, 'startup-error.cjs'), 'ETRANSFER', ...display.args],
          {
            stdio: 'ignore',
            env: {
              PATH: join(root, 'bin'),
              LANG: 'C.UTF-8',
              HOME: homedir(),
              DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS,
              ...display.environment
            }
          }
        )
        result.once('error', accept)
        result.once('exit', accept)
      })
    throw error
  }
}
