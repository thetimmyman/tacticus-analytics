import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { nativeServices, windowFailureDiagnostic } from './services.mjs'
import { loopbackGateway } from '../../proof/loopback-gateway.mjs'
import { windowsSetup } from './setup.mjs'
import { currentSessionChannel } from './session-gate.mjs'
import { strict as assert } from 'node:assert'
import { recoveryJourney } from './recovery.mjs'
import { seedFormerPasswordFixture } from './migration-fixture.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../../../..')
const args = process.argv.slice(2)
const option = (name) =>
  args.includes(name) ? args[args.indexOf(name) + 1] : undefined
const stateArgument = option('--state')
if (!stateArgument)
  throw new Error('Native workspace owner must supply its protected state path')
const state = resolve(stateArgument)
const postgresHome = option('--postgres-home')
if (!postgresHome || /[^\x00-\x7f]/.test(postgresHome))
  throw new Error('Native owner must supply a verified ASCII database path')
const serviceConfig = {
  state,
  schemaDirectory: join(root, 'apps/desktop/local-schema'),
  binaries: {
    initdb: join(postgresHome, 'bin/initdb.exe'),
    postgres: join(postgresHome, 'bin/postgres.exe'),
    psql: join(postgresHome, 'bin/psql.exe'),
    pgctl: join(postgresHome, 'bin/pg_ctl.exe'),
    auth: join(root, 'auth/auth.exe'),
    authCwd: join(root, 'auth'),
    postgrest: join(root, 'postgrest/postgrest.exe')
  }
}
if (args.includes('--schema-recovery')) {
  const { windowsSchemaRecoveryProof } =
    await import('./schema-bootstrap-recovery-proof.mjs')
  await windowsSchemaRecoveryProof(serviceConfig, {
    scenario: option('--schema-recovery'),
    evidence: option('--schema-recovery-evidence'),
    root
  })
  process.exit(0)
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
      { brokerToken, currentToken: (renew) => sessionChannel.token(renew) }
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
      SUPABASE_SERVICE_ROLE_KEY: services.serviceCredential,
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
  if (verify?.seedFormerPasswordFixture === true)
    await seedFormerPasswordFixture(services)
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
    assert.equal(
      (
        await fetch(`${gateway.origin}/desktop/open`, {
          method: 'POST',
          headers: authorized
        })
      ).status,
      403
    )
  }
  const ownerBefore = verify
    ? (
        await services.psql(
          'SELECT subject_user_id FROM public.desktop_preview_setup LIMIT 1;'
        )
      ).trim()
    : null
  const config = JSON.stringify({
    url: `${gateway.origin}/desktop/setup`,
    transportKey,
    brokerToken,
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
  let windowOutput = Buffer.alloc(0)
  window.stderr.on('data', (chunk) => {
    if (windowOutput.length < 8192)
      windowOutput = Buffer.concat([
        windowOutput,
        Buffer.from(chunk).subarray(0, 8192 - windowOutput.length)
      ])
  })
  const code = await new Promise((accept, reject) => {
    window.once('exit', accept)
    window.once('error', reject)
  })
  if (verify && code === 0 && ownerBefore) {
    assert.equal(
      (
        await services.psql(
          'SELECT subject_user_id FROM public.desktop_preview_setup LIMIT 1;'
        )
      ).trim(),
      ownerBefore
    )
    assert.equal(
      (
        await services.psql('SELECT count(*) FROM public."EOT_GR_data";')
      ).trim(),
      '8'
    )
  }
  if (code !== 0)
    throw new Error(
      'Desktop window verification failed; ' +
        windowFailureDiagnostic(windowOutput.toString('utf8'), code)
    )
} finally {
  if (gateway) await gateway.stop()
  await services.stop()
}
