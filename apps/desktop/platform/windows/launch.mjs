import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { nativeServices } from './services.mjs'
import { loopbackGateway } from '../../proof/loopback-gateway.mjs'
import { windowsSetup } from './setup.mjs'
import { currentSessionChannel } from './session-gate.mjs'
import { strict as assert } from 'node:assert'
import { recoveryJourney } from './recovery.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../../../..')
const args = process.argv.slice(2)
const option = (name) =>
  args.includes(name) ? args[args.indexOf(name) + 1] : undefined
const stateArgument = option('--state')
if (!stateArgument)
  throw new Error('Native workspace owner must supply its protected state path')
const state = resolve(stateArgument)
const serviceConfig = {
  state,
  schemaDirectory: join(root, 'apps/desktop/local-schema'),
  binaries: {
    initdb: join(root, 'postgres/bin/initdb.exe'),
    postgres: join(root, 'postgres/bin/postgres.exe'),
    psql: join(root, 'postgres/bin/psql.exe'),
    pgctl: join(root, 'postgres/bin/pg_ctl.exe'),
    auth: join(root, 'auth/auth.exe'),
    authCwd: join(root, 'auth'),
    postgrest: join(root, 'postgrest/postgrest.exe')
  }
}
const services = await nativeServices(serviceConfig)
if (option('--recovery')) {
  try {
    await recoveryJourney(services, serviceConfig, option('--recovery'))
  } finally {
    await services.stop()
  }
  process.exit(0)
}
let gateway
try {
  const transportKey = randomBytes(32).toString('hex')
  const brokerToken = randomBytes(32).toString('hex')
  const sessionChannel = currentSessionChannel()
  gateway = await loopbackGateway({
    services,
    transportKey,
    handleLocalRequest: windowsSetup(
      services,
      here,
      join(root, 'apps/desktop/launcher'),
      { brokerToken, currentToken: () => sessionChannel.token() }
    )
  })
  const listener = createServer()
  await new Promise((accept) => listener.listen(0, '127.0.0.1', accept))
  const port = listener.address().port
  await new Promise((accept) => listener.close(accept))
  gateway.setAppPort(port)
  const application = services.launch(
    join(root, 'bin/node.exe'),
    [join(root, 'application/server.js')],
    {
      ...process.env,
      PATH: join(root, 'bin') + ';' + process.env.PATH,
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
      SUPABASE_SERVICE_ROLE_KEY: services.token.service,
      DESKTOP_TRANSPORT_KEY: transportKey
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
  const verifyPath = option('--verify')
  const verify = verifyPath
    ? JSON.parse(await readFile(verifyPath, 'utf8'))
    : undefined
  if (verify) {
    assert.equal((await fetch(`${gateway.origin}/desktop/setup`)).status, 403)
    const authorized = { 'x-desktop-transport': transportKey }
    for (const path of [
      '/profile/edit',
      '/api/player-api-key',
      '/api/validate-api-key',
      '/api/player/test-api-key'
    ]) {
      const held = await fetch(gateway.origin + path, { headers: authorized })
      assert.equal(held.status, 501)
    }
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
            await fetch(`${gateway.origin}/desktop/demo-setup`, {
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
  const config = JSON.stringify({
    url: `${gateway.origin}/desktop/setup`,
    transportKey,
    state: services.state,
    verify
  })
  const window = services.launch(
    join(root, 'electron/electron.exe'),
    [join(here, 'main.cjs')],
    {
      ...process.env,
      PATH: join(root, 'bin') + ';' + process.env.PATH,
      LANG: 'C',
      LC_ALL: 'C'
    },
    state,
    true,
    config,
    true
  )
  sessionChannel.attach(window)
  const code = await new Promise((accept, reject) => {
    window.once('exit', accept)
    window.once('error', reject)
  })
  if (code !== 0)
    throw new Error(
      'Desktop window verification failed; inspect private local logs'
    )
} finally {
  if (gateway) await gateway.stop()
  await services.stop()
}
