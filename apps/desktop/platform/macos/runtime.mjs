import { randomBytes } from 'node:crypto'
import { mkdir, lstat, readFile, writeFile, unlink } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { nativeServices } from './services.mjs'
import { loopbackGateway } from '../../proof/loopback-gateway.mjs'
import {
  WorkspaceOnboardingV1,
  DeviceOfficialSourceV1
} from '../../../../packages/workspace-onboarding/v1.mjs'
import { privateState } from './state.mjs'
import { nativeVault } from './vault.mjs'
import { qualifyRecovery } from './recovery.mjs'
import { personalWorkspace } from './workspace.mjs'
import { localSessionGate } from './session.mjs'
import { currentWorkspaceToken } from '../../launcher/workspace-session.mjs'
import { importCachedPersonal } from './personal-backup.mjs'
import { rendererCredentialSurface } from './credential-surface.mjs'
import { windowDiagnostics } from './window-diagnostics.mjs'
import requestDiagnostics from './request-diagnostics.cjs'
import { workspaceDeviceSession } from './device-session.mjs'
import {
  qualifyDeviceSession,
  syntheticWorkspaceDigest
} from './device-proof.mjs'

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
let activeSession
const vault = nativeVault(join(root, 'bin/secret-vault'), {
  pending: privateState(join(state, 'vault-pending.json')),
  authorize: () => {
    if (!activeSession)
      throw Object.assign(new Error('Local session unavailable'), {
        code: 'ESESSION'
      })
    activeSession.assert()
  }
})
const lifetime = new AbortController()
const savedPersonal = privateState(join(state, 'personal.json'))
const onboarding = new WorkspaceOnboardingV1({
  vault,
  state: {
    read: savedPersonal.read,
    write: (value) => {
      if (!activeSession)
        throw Object.assign(new Error('Local session unavailable'), {
          code: 'ESESSION'
        })
      activeSession.assert()
      savedPersonal.write(value)
      vault.commit(Object.values(value.vaultReferences ?? {}))
    }
  },
  upstream: new DeviceOfficialSourceV1({
    fetchImpl: (url, options) =>
      fetch(url, {
        ...options,
        signal: AbortSignal.any([lifetime.signal, options.signal])
      })
  })
})
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
const gate = localSessionGate({
  services,
  signingKey: privateState(join(state, 'credentials.json')).read().jwt
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
    const transportKey = randomBytes(32).toString('hex'),
      brokerToken = randomBytes(32).toString('hex')
    const setup = personalWorkspace(services, here)
    const device = workspaceDeviceSession(services, {
      brokerToken,
      synthetic: Boolean(verify)
    })
    gateway = await loopbackGateway({
      services,
      transportKey,
      handleLocalRequest: async (req, res, url) => {
        if (await device(req, res, url)) return true
        if (
          [
            '/auth/login',
            '/auth/signup',
            '/auth/forgot-password',
            '/auth/reset-password',
            '/login'
          ].includes(url.pathname)
        ) {
          res.writeHead(303, {
            location: '/desktop/setup',
            'cache-control': 'no-store'
          })
          res.end()
          return true
        }
        if (
          [
            '/api/auth/login',
            '/api/auth/logout',
            '/api/auth/signup',
            '/api/auth/change-password',
            '/api/auth/forgot-password',
            '/api/auth/reset-password'
          ].includes(url.pathname)
        ) {
          res.writeHead(403, {
            'content-type': 'application/json',
            'cache-control': 'no-store'
          })
          res.end(
            '{"error":"Local workspace access uses the current OS account"}'
          )
          return true
        }
        if (url.pathname === '/api/desktop/personal' && req.method === 'GET') {
          try {
            const cookies = String(req.headers.cookie ?? '')
              .split(';')
              .map((part) => {
                const separator = part.indexOf('=')
                return {
                  name: part.slice(0, separator).trim(),
                  value: part.slice(separator + 1).trim()
                }
              })
            await gate.authorize(currentWorkspaceToken(cookies))
          } catch {
            res.writeHead(401, {
              'content-type': 'application/json',
              'cache-control': 'no-store'
            })
            res.end('{"error":"Reopen the app to restore your local session"}')
            return true
          }
          res.writeHead(200, {
            'content-type': 'application/json',
            'cache-control': 'no-store'
          })
          res.end(JSON.stringify(onboarding.view()))
          return true
        }
        // Existing renderer key-writing surfaces remain disabled until their native
        // capability adapter is integrated. API credentials only enter native input.
        if (rendererCredentialSurface(url)) {
          res.writeHead(403, { 'content-type': 'application/json' })
          res.end('{"error":"Use native official access"}')
          return true
        }
        if (
          !verify &&
          !onboarding.view().personal &&
          !url.pathname.startsWith('/desktop/') &&
          !url.pathname.startsWith('/api/auth/') &&
          !url.pathname.startsWith('/supabase/auth/v1/') &&
          url.pathname !== '/api/health'
        ) {
          res.writeHead(409, {
            'content-type': 'application/json',
            'cache-control': 'no-store'
          })
          res.end('{"error":"Player access is required for personal content"}')
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
    if (verify) {
      const deviceProof = await qualifyDeviceSession({
        services,
        gateway,
        transportKey,
        brokerToken,
        gate,
        personal: onboarding
      })
      await writeFile(
        verify.deviceEvidence,
        JSON.stringify({
          ...deviceProof,
          sourceCommit: verify.sourceCommit,
          artifactSha256: verify.artifactSha256
        }),
        { mode: 0o600 }
      )
    }
    const config = join(state, 'window-config.json')
    await writeFile(
      config,
      JSON.stringify({
        url: `${gateway.origin}/desktop/setup`,
        transportKey,
        brokerToken,
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
      true,
      true
    )
    const nativeDiagnostic = windowDiagnostics()
    if (verify) {
      window.stderr.on('data', nativeDiagnostic.observe)
      let diagnostic = ''
      window.stdout.on('data', (chunk) => {
        diagnostic = (diagnostic + chunk.toString('utf8')).slice(-4096)
        for (const line of diagnostic.split('\n')) {
          if (!line.startsWith('TA-MAC-VERIFY-FAILURE:')) continue
          try {
            const value = JSON.parse(
              line.slice('TA-MAC-VERIFY-FAILURE:'.length)
            )
            if (
              value.synthetic === true &&
              [
                'window-startup',
                'workspace-page',
                'workspace-setup',
                'workspace-navigation',
                'native-session',
                'renderer-observation',
                'renderer-scores',
                'renderer-network'
              ].includes(value.stage) &&
              [
                'ESESSION',
                'EVAULT',
                'EVAULTLOCKED',
                'EACCESS',
                'EVERIFY'
              ].includes(value.code)
            )
              console.log(
                'TA-MAC-VERIFY-FAILURE:' +
                  JSON.stringify(requestDiagnostics.sanitizeFailure(value))
              )
          } catch {}
        }
        diagnostic = diagnostic.slice(diagnostic.lastIndexOf('\n') + 1)
      })
    }
    let actionQueue = Promise.resolve()
    window.on('message', (action) => {
      if (
        !action ||
        JSON.stringify(action).length > 20000 ||
        Object.keys(action).sort().join(',') !==
          (action.operation === 'import'
            ? 'operation,path,requestId,scope,token'
            : 'operation,requestId,scope,token') ||
        !/^[a-f0-9]{32}$/.test(action.requestId ?? '') ||
        !['connect', 'disconnect', 'session', 'import'].includes(
          action.operation
        ) ||
        (action.operation === 'import' &&
          (action.scope !== 'Player' ||
            typeof action.path !== 'string' ||
            action.path.length > 4096)) ||
        !['Player', 'Guild', 'Guild Raid'].includes(action.scope)
      )
        return
      actionQueue = actionQueue
        .then(async () => {
          try {
            activeSession = await gate.authorize(action.token)
            await vault.recover(
              Object.values(onboarding.state.read().vaultReferences ?? {})
            )
            if (action.operation === 'disconnect')
              await onboarding.disconnect(action.scope)
            else if (action.operation === 'import')
              await importCachedPersonal({
                path: action.path,
                onboarding,
                authorize: activeSession.assert
              })
            else if (action.operation === 'connect')
              await onboarding.connect({
                requested:
                  action.scope === 'Player'
                    ? ['Player', 'Guild', 'Guild Raid']
                    : [action.scope],
                confirmPlayer: vault.confirmPlayer,
                expectedGuildId: onboarding.state.read().guildId
              })
            activeSession.assert()
            window.send({
              requestId: action.requestId,
              status: 'ok',
              view: onboarding.view()
            })
          } catch (error) {
            let code = [
              'ESESSION',
              'EVAULTLOCKED',
              'EVAULT',
              'EEXPIRED',
              'EUPSTREAM',
              'ECANCELLED'
            ].includes(error.code)
              ? error.code
              : 'EACCESS'
            try {
              activeSession?.assert()
            } catch {
              code = 'ESESSION'
            }
            if (window.connected)
              window.send({
                requestId: action.requestId,
                status: 'unavailable',
                code
              })
          } finally {
            action.token = ''
            activeSession = null
          }
        })
        .catch(() => {})
    })
    const result = await new Promise((accept, reject) => {
      window.once('exit', (code, signal) => accept({ code, signal }))
      window.once('error', reject)
    })
    if (verify) {
      const diagnostic = nativeDiagnostic.exit(result.code, result.signal)
      if (services.fault)
        diagnostic.serviceFault = {
          component: services.fault.component,
          exitCode: services.fault.exitCode,
          signal: services.fault.signal
        }
      await writeFile(
        verify.evidence + '.native.json',
        JSON.stringify(diagnostic),
        { mode: 0o600 }
      )
      console.log('TA-MAC-WINDOW-EXIT:' + JSON.stringify(diagnostic))
    }
    if (result.code !== 0)
      throw new Error(
        'Local application window failed; retained data was preserved'
      )
    if (verify) {
      await actionQueue
      const deviceProof = JSON.parse(
        await readFile(verify.deviceEvidence, 'utf8')
      )
      deviceProof.postJourneyDataDigest = await syntheticWorkspaceDigest(
        services,
        onboarding
      )
      await writeFile(verify.deviceEvidence, JSON.stringify(deviceProof), {
        mode: 0o600
      })
    }
  }
} finally {
  lifetime.abort()
  vault.close()
  if (gateway) await gateway.stop()
  await services.stop()
}
