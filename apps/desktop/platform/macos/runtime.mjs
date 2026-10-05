import { randomBytes } from 'node:crypto'
import { mkdir, lstat, readFile, writeFile, unlink } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { nativeServices } from '../../proof/native-services.mjs'
import { loopbackGateway } from '../../proof/loopback-gateway.mjs'
import { workspaceSetup } from '../../launcher/workspace.mjs'
import {
  WorkspaceOnboardingV1,
  DeviceOfficialSourceV1
} from '../../../../packages/workspace-onboarding/v1.mjs'
import { privateState } from './state.mjs'
import { nativeVault } from './vault.mjs'
import { qualifyRecovery } from './recovery.mjs'

process.umask(0o077)
if (process.platform !== 'darwin' || !process.env.TA_MAC_GUARD_LOCK)
  throw new Error('Use the native macOS application launcher')
const here = dirname(fileURLToPath(import.meta.url)),
  root = resolve(here, '../../../..')
const state = dirname(process.env.TA_MAC_GUARD_LOCK)
await mkdir(state, { recursive: true, mode: 0o700 })
const info = await lstat(state)
if (
  !info.isDirectory() ||
  info.isSymbolicLink() ||
  info.uid !== process.getuid() ||
  info.mode & 0o077
)
  throw new Error('Private application data directory required')
const args = process.argv.slice(2)
const option = (name) =>
  args.includes(name) ? args[args.indexOf(name) + 1] : undefined
const verify = option('--verify')
  ? JSON.parse(await readFile(option('--verify'), 'utf8'))
  : null
if (verify && verify.synthetic !== true)
  throw new Error('Synthetic developer verification required')
const vault = nativeVault(join(root, 'bin/secret-vault'))
const lifetime = new AbortController()
const onboarding = new WorkspaceOnboardingV1({
  vault,
  state: privateState(join(state, 'personal.json')),
  upstream: new DeviceOfficialSourceV1({
    fetchImpl: (url, options) =>
      fetch(url, {
        ...options,
        signal: AbortSignal.any([lifetime.signal, options.signal])
      })
  })
})
if (!verify && !onboarding.view().personal) {
  await onboarding.connect({ confirmPlayer: vault.confirmPlayer })
  await onboarding.skipOptional()
}
// The kernel lock is held by the native owner, so an interrupted prior session
// cannot own this workspace. The proof supervisor's persistent marker is stale.
await unlink(join(state, 'running.lock')).catch((error) => {
  if (error.code !== 'ENOENT') throw error
})
const services = await nativeServices({
  state,
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
  if (option('--storage-check')) {
    if (verify?.synthetic !== true)
      throw new Error('Disposable synthetic verification required')
    const rows = Number(
      (await services.psql('SELECT count(*) FROM public."EOT_GR_data";')).trim()
    )
    if (rows !== 8) throw new Error('Installed fixture state was not retained')
    await services.psql(
      'CREATE TABLE IF NOT EXISTS public.desktop_macos_probe(counter integer NOT NULL); INSERT INTO public.desktop_macos_probe SELECT 0 WHERE NOT EXISTS(SELECT 1 FROM public.desktop_macos_probe); UPDATE public.desktop_macos_probe SET counter=counter+1;'
    )
    const counter = Number(
      (
        await services.psql('SELECT counter FROM public.desktop_macos_probe;')
      ).trim()
    )
    const sum = Number(
      (
        await services.psql(
          'SELECT sum("damageDealt") FROM public."EOT_GR_data" WHERE "Guild"=\'SYN001\';'
        )
      ).trim()
    )
    if (sum !== 525) throw new Error('Installed local calculation differs')
    let migrationRejected = false
    try {
      await services.psql(
        'BEGIN; CREATE TABLE public.desktop_macos_bad_migration(value integer); SELECT deliberately_missing_function(); COMMIT;'
      )
    } catch {
      migrationRejected =
        (
          await services.psql(
            "SELECT to_regclass('public.desktop_macos_bad_migration') IS NULL;"
          )
        ).trim() === 't'
    }
    if (!migrationRejected) throw new Error('Bad migration was not rolled back')
    const recovery = await qualifyRecovery({
      services,
      postgres: join(root, 'postgres'),
      state
    })
    await writeFile(
      option('--storage-check'),
      JSON.stringify({
        synthetic: true,
        rows,
        counter,
        sum,
        migrationRejected,
        recovery
      }),
      { mode: 0o600 }
    )
  } else {
    const transportKey = randomBytes(32).toString('hex')
    const setup = workspaceSetup(services, join(root, 'apps/desktop/launcher'))
    gateway = await loopbackGateway({
      services,
      transportKey,
      handleLocalRequest: async (req, res, url) => {
        if (url.pathname === '/api/desktop/personal' && req.method === 'GET') {
          res.writeHead(200, {
            'content-type': 'application/json',
            'cache-control': 'no-store'
          })
          res.end(JSON.stringify(onboarding.view()))
          return true
        }
        // Existing renderer key-writing surfaces remain disabled until their native
        // capability adapter is integrated. API credentials only enter native input.
        if (
          url.pathname.startsWith('/api/api-keys') ||
          url.pathname.startsWith('/api/validation/api-key')
        ) {
          res.writeHead(403, { 'content-type': 'application/json' })
          res.end('{"error":"Use native official access"}')
          return true
        }
        if (
          url.pathname === '/desktop/setup' &&
          req.method === 'POST' &&
          !verify &&
          !onboarding.view().personal
        ) {
          res.writeHead(409)
          res.end('Player access required')
          return true
        }
        return setup(req, res, url)
      }
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
    for (let n = 0; n < 150; n++) {
      if (application.exitCode !== null || services.fault)
        throw new Error('Local services stopped during startup')
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
    if (!ready) throw new Error('Local services did not become ready')
    const config = join(state, 'window-config.json')
    await writeFile(
      config,
      JSON.stringify({
        url: `${gateway.origin}/desktop/setup`,
        transportKey,
        state,
        verify
      }),
      { mode: 0o600 }
    )
    const window = services.launch(
      join(root, 'electron/Electron.app/Contents/MacOS/Electron'),
      [join(here, 'main.cjs'), config],
      {
        PATH: join(root, 'bin'),
        LANG: 'en_US.UTF-8',
        HOME: process.env.HOME,
        TMPDIR: process.env.TMPDIR
      },
      state,
      true
    )
    let actionBuffer = '',
      actionQueue = Promise.resolve()
    window.stdout.on('data', (chunk) => {
      actionBuffer += chunk.toString('utf8')
      if (actionBuffer.length > 16384) {
        actionBuffer = ''
        return
      }
      let end
      while ((end = actionBuffer.indexOf('\n')) !== -1) {
        const line = actionBuffer.slice(0, end)
        actionBuffer = actionBuffer.slice(end + 1)
        if (!line.startsWith('TA-MAC-ACTION:')) continue
        let action
        try {
          action = JSON.parse(line.slice('TA-MAC-ACTION:'.length))
        } catch {
          continue
        }
        if (
          !action ||
          Object.keys(action).sort().join(',') !== 'operation,scope' ||
          !['connect', 'disconnect'].includes(action.operation) ||
          !['Player', 'Guild', 'Guild Raid'].includes(action.scope)
        )
          continue
        actionQueue = actionQueue
          .then(async () => {
            if (action.operation === 'disconnect')
              await onboarding.disconnect(action.scope)
            else
              await onboarding.connect({
                requested:
                  action.scope === 'Player'
                    ? ['Player', 'Guild', 'Guild Raid']
                    : [action.scope],
                confirmPlayer: vault.confirmPlayer,
                expectedGuildId: onboarding.state.read().guildId
              })
          })
          .catch(() => {})
      }
    })
    const code = await new Promise((accept, reject) => {
      window.once('exit', accept)
      window.once('error', reject)
    })
    if (code !== 0)
      throw new Error(
        'Local application window failed; retained data was preserved'
      )
  }
} finally {
  lifetime.abort()
  vault.close()
  if (gateway) await gateway.stop()
  await services.stop()
}
