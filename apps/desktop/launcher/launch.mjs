import { randomBytes } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
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
const option = (name) =>
  args.includes(name) ? args[args.indexOf(name) + 1] : undefined
const state = resolve(
  option('--state') ||
    join(homedir(), '.local/share/tacticus-analytics-preview')
)
const services = await nativeServices({
  state,
  libraryPath: join(root, 'postgres/lib'),
  schemaDirectory: join(root, 'apps/desktop/local-schema'),
  binaries: {
    initdb: join(root, 'postgres/bin/initdb'),
    postgres: join(root, 'postgres/bin/postgres'),
    psql: join(root, 'postgres/bin/psql'),
    auth: join(root, 'auth/auth'),
    authCwd: join(root, 'auth'),
    postgrest: join(root, 'postgrest/postgrest')
  }
})
let gateway
try {
  const transportKey = randomBytes(32).toString('hex')
  gateway = await loopbackGateway({
    services,
    transportKey,
    handleLocalRequest: workspaceSetup(services, here)
  })
  const listener = createServer()
  await new Promise((accept) => listener.listen(0, '127.0.0.1', accept))
  const port = listener.address().port
  await new Promise((accept) => listener.close(accept))
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
      state: services.state,
      verify
    }),
    { mode: 0o600 }
  )
  const window = services.launch(
    join(root, 'electron/electron'),
    [join(here, 'main.cjs'), config, '--ozone-platform=wayland'],
    {
      PATH: join(root, 'bin'),
      LANG: 'C.UTF-8',
      XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR,
      WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY
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
} finally {
  if (gateway) await gateway.stop()
  await services.stop()
}
