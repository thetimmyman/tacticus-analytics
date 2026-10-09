import { spawn } from 'node:child_process'
import {
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual
} from 'node:crypto'
import { createServer } from 'node:net'
import { mkdir, writeFile, stat } from 'node:fs/promises'
import { nativeCommand } from './native-command.mjs'
import {
  captureNativeServicesFailure,
  nativeServicesProbeDiagnostic
} from './launch-diagnostic.mjs'
import { prepareSchemaBootstrap } from './schema-bootstrap.mjs'
import { resolve, join, basename } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

export function signedToken(key, role, lifetimeSeconds = 86400) {
  const encode = (value) =>
    Buffer.from(JSON.stringify(value)).toString('base64url')
  const body = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ role, iss: 'desktop', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + lifetimeSeconds })}`
  return `${body}.${createHmac('sha256', key).update(body).digest('base64url')}`
}
async function freePort() {
  const server = createServer()
  await new Promise((accept, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', accept)
  })
  const port = server.address().port
  await new Promise((accept) => server.close(accept))
  return port
}
export async function run(file, args, options, spawnChild = spawn) {
  const serviceName = basename(file)
  const publicServiceName = [
    'initdb.exe',
    'psql.exe',
    'auth.exe',
    'pg_ctl.exe'
  ].includes(serviceName)
    ? serviceName
    : 'owned-service'
  const launchFailure = () => {
    const error = new Error(
      `${publicServiceName === 'owned-service' ? 'Owned service' : publicServiceName} could not start; child-launch-failed; sensitive output suppressed`
    )
    error.serviceFailureCode = 'child-launch-failed'
    error.serviceBootstrapPhase = 'not-applicable'
    error.serviceExecutable = publicServiceName
    error.serviceExitCode = null
    error.postgresChildStatus = null
    return error
  }
  let child
  try {
    child = spawnChild(file, args, {
      // Attach to the existing owner console instead of CREATE_NO_WINDOW.
      windowsHide: false,
      ...options,
      stdio: ['ignore', 'pipe', 'pipe']
    })
  } catch {
    throw launchFailure()
  }
  let stdout = ''
  let failureText = ''
  child.stdout.on('data', (v) => {
    stdout += v
  })
  child.stderr.on('data', (value) => {
    if (failureText.length < 65536)
      failureText += value.toString().slice(0, 65536 - failureText.length)
  })
  await new Promise((accept, reject) => {
    child.once('error', () => reject(launchFailure()))
    // Process exit can precede the final pipe data. Wait for both streams.
    child.once('close', (code) => {
      if (code === 0) return accept()
      const failureCode = serviceFailureCode(`${failureText}\n${stdout}`)
      const phase =
        serviceName === 'initdb.exe' ? bootstrapPhase(stdout) : 'not-applicable'
      const postgresStatus = /^postgres-child-status-0x([0-9a-f]{8})$/.exec(
        failureCode
      )
      const error = new Error(
        `${['initdb.exe', 'psql.exe', 'auth.exe', 'pg_ctl.exe'].includes(serviceName) ? serviceName : 'Owned service'} exited ${code}; ${failureCode}${serviceName === 'initdb.exe' ? '; ' + phase : ''}; sensitive output suppressed`
      )
      error.serviceFailureCode = failureCode
      error.serviceBootstrapPhase = phase
      error.serviceExecutable = publicServiceName
      error.serviceExitCode =
        Number.isInteger(code) && code >= 0 && code <= 0xffffffff ? code : null
      error.postgresChildStatus = postgresStatus
        ? Number.parseInt(postgresStatus[1], 16)
        : null
      reject(error)
    })
  })
  return stdout
}
export function serviceFailureCode(text) {
  const encoding =
    /invalid byte sequence for encoding "UTF8": ((?:0x[0-9a-f]{2}(?:\s|$)){1,4})/i.exec(
      text
    )
  if (encoding)
    return `postgres-input-utf8-${encoding[1].trim().replace(/\s+/g, '-')}`
  // PostgreSQL's Windows bootstrap can report an NTSTATUS without a diagnostic
  // body. Preserve only the numeric status, never paths, SQL or server output.
  const childStatus = /child process exited with exit code (\d{1,10})\b/i.exec(
    text
  )
  if (childStatus) {
    const status = Number(childStatus[1])
    if (status > 1 && status <= 0xffffffff)
      return `postgres-child-status-0x${status.toString(16).padStart(8, '0')}`
  }
  for (const [pattern, code] of [
    [
      /administrative permissions.*not\s+permitted/is,
      'administrative-token-refused'
    ],
    [
      /could not bind|Address already in use|could not create any TCP\/IP sockets/i,
      'loopback-bind-refused'
    ],
    [/could not read password from file/i, 'password-file-read-refused'],
    [/could not access directory/i, 'data-directory-access-refused'],
    [/could not create directory/i, 'data-directory-create-refused'],
    [
      /could not change permissions of directory/i,
      'data-directory-permissions-refused'
    ],
    [/could not open file.*for reading/i, 'bootstrap-input-read-refused'],
    [/could not access file/i, 'bootstrap-input-access-refused'],
    [
      /is needed by .* but was not found|was found by .* but was not the same version/is,
      'postgres-executable-unavailable'
    ],
    [
      /invalid binary|could not find a ".+" to execute|could not identify current directory/i,
      'own-executable-unavailable'
    ],
    [
      /could not (?:open process token|get token information|set token information)/i,
      'process-token-refused'
    ],
    [/permission denied|access is denied/i, 'permission-refused'],
    [/invalid locale|locale.*not supported/i, 'locale-unavailable'],
    [
      /could not (?:open|read|access).*file|No such file or directory/i,
      'required-file-unavailable'
    ],
    [/could not execute|could not start process/i, 'child-launch-failed'],
    [
      /could not find.*postgres|does not match.*version/i,
      'postgres-executable-mismatch'
    ],
    [
      /could not load library|specified module could not be found/i,
      'dynamic-library-unavailable'
    ],
    [
      /could not create restricted token|could not re-execute with restricted token/i,
      'restricted-token-unavailable'
    ],
    [
      /could not create shared memory|could not map shared memory/i,
      'shared-memory-unavailable'
    ],
    [
      /not enough memory|out of memory|insufficient system resources/i,
      'system-memory-unavailable'
    ],
    [
      /could not generate (?:random|strong)|could not initialize.*random/i,
      'random-source-unavailable'
    ],
    [/syntax error/i, 'bootstrap-syntax-error'],
    [/invalid byte sequence/i, 'bootstrap-encoding-invalid'],
    [
      /SQLSTATE 42501|must be owner|insufficient_privilege/i,
      'database-authority-refused'
    ],
    [
      /SQLSTATE 42P01|relation .* does not exist/i,
      'database-schema-unavailable'
    ],
    [
      /SQLSTATE 42883|function .* does not exist/i,
      'database-function-unavailable'
    ],
    [/SQLSTATE 42710|already exists/i, 'database-object-conflict'],
    [
      /SQLSTATE 28P01|password authentication failed/i,
      'database-authentication-refused'
    ],
    [/child process exited.*exit code 1/i, 'postgres-child-exit-1'],
    [/bootstrap.*failed|child process exited/i, 'postgres-bootstrap-failed']
  ])
    if (pattern.test(text))
      // A shell or loader refusal can accompany a later fixed initdb message.
      return [
        'postgres-executable-unavailable',
        'own-executable-unavailable'
      ].includes(code) && /permission denied|access is denied/i.test(text)
        ? `${code}-access-denied`
        : code
  return 'unclassified-service-failure'
}
// These codes are finite diagnostic labels, not exit-status interpretations.
const postgrestCodes = ['PGRST000', 'PGRST001', 'PGRST002', 'PGRST003']
const postgresCodes = [
  '08000',
  '08001',
  '08006',
  '28P01',
  '3D000',
  '42501',
  '42710',
  '42883',
  '42P01',
  '57P03'
]
function fixedServiceCode(text, codes) {
  return (
    codes.find((code) =>
      new RegExp(
        `(?:"code"\\s*:\\s*"${code}"|\\bSQLSTATE\\s+${code}\\b)`,
        'i'
      ).test(text)
    ) ?? 'unavailable'
  )
}
export function serviceStartupDiagnostic(child) {
  let output = Buffer.alloc(0)
  let truncated = false
  let streamComplete = false
  let closed = false
  let resolveClosed
  const onClose = new Promise((resolve) => {
    resolveClosed = resolve
  })
  const collect = (chunk) => {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    const retained = bytes.subarray(0, 8192 - output.length)
    if (retained.length < bytes.length) truncated = true
    if (retained.length) output = Buffer.concat([output, retained])
  }
  child.stdout.on('data', collect)
  child.stderr.on('data', collect)
  child.once?.('close', () => {
    closed = true
    streamComplete =
      child.stdout.readableEnded === true && child.stderr.readableEnded === true
    resolveClosed()
  })
  const diagnostic = () => {
    const text = output.toString('utf8')
    const category = serviceFailureCode(text)
    const status = Number.isSafeInteger(child.exitCode)
      ? `exit-${child.exitCode}`
      : 'exit-unavailable'
    return `${category}; ${status}; pgrst-${fixedServiceCode(text, postgrestCodes)}; sqlstate-${fixedServiceCode(text, postgresCodes)}; streamComplete-${streamComplete}; capturedBytes-${output.length}; truncated-${truncated}; sensitive output suppressed`
  }
  diagnostic.afterClose = async () => {
    // Exit may precede pipe EOF. Bound diagnostic draining, not readiness.
    if (!closed) {
      let timer
      try {
        await Promise.race([
          onClose,
          new Promise((resolve) => {
            timer = setTimeout(resolve, 250)
          })
        ])
      } finally {
        clearTimeout(timer)
      }
    }
    return diagnostic()
  }
  return diagnostic
}
// Fixed coordinator messages only; renderer status text and other output stay private.
const windowFailures = [
  ['Invalid local desktop configuration', 'window-configuration-invalid'],
  ['Desktop setup exposed a password field', 'window-password-field'],
  [
    'Native coordinator could not reuse the authenticated workspace session',
    'window-session-reuse-failed'
  ],
  ['Renderer obtained bootstrap access', 'window-bootstrap-exposed'],
  ['Native signed-out session recovery failed', 'window-recovery-failed'],
  ['Session recovery lost retained sample data', 'window-recovery-data-lost'],
  [
    'Packaged graphical journey did not render expected scores',
    'window-scores-missing'
  ],
  ['Unexpected packaged renderer request failure', 'window-request-failure'],
  ['The local workspace could not open', 'window-workspace-unavailable'],
  ['Invalid local session destination', 'window-session-destination-invalid'],
  ['Invalid local session', 'window-session-invalid']
]
export function windowFailureDiagnostic(text, code) {
  const prefix = String(text).slice(0, 8192)
  const setupStatus = prefix.match(
    /Desktop setup reported a failure status: .*?(failed|Invalid|already|cannot|unavailable)/
  )
  const network = prefix.match(/\b(ERR_[A-Z_]{2,48})\b/)
  const kind = prefix.match(
    /^(TypeError|RangeError|SyntaxError|ReferenceError|AbortError|TimeoutError|AssertionError)\b/m
  )
  const category =
    windowFailures.find(([message]) => prefix.includes(message))?.[1] ??
    (setupStatus
      ? `window-setup-status-${setupStatus[1].toLowerCase()}`
      : network
        ? `window-load-${network[1].toLowerCase().replaceAll('_', '-')}`
        : /fetch failed/.test(prefix)
          ? 'window-coordinator-unreachable'
          : /Script failed to execute/.test(prefix)
            ? 'window-script-failed'
            : kind
              ? `window-unclassified-${kind[1].toLowerCase()}`
              : 'window-unclassified')
  const status = Number.isSafeInteger(code)
    ? `exit-${code > 0xffff || code < 0 ? '0x' + (code >>> 0).toString(16).toUpperCase().padStart(8, '0') : code}`
    : 'exit-unavailable'
  return `${category}; ${status}; sensitive output suppressed`
}
export function bootstrapPhase(text) {
  if (/performing post-bootstrap initialization/.test(text))
    return 'post-bootstrap'
  if (/running bootstrap script/.test(text)) return 'bootstrap-script'
  if (/creating configuration files/.test(text)) return 'configuration'
  for (const [pattern, phase] of [
    [/selecting default time zone/, 'time-zone'],
    [/selecting default shared_buffers/, 'shared-buffers'],
    [/selecting default max_connections/, 'max-connections'],
    [/selecting dynamic shared memory/, 'shared-memory'],
    [/creating subdirectories/, 'subdirectories'],
    [
      /creating directory|fixing permissions on existing directory/,
      'data-directory'
    ],
    [/will be owned by user/, 'preflight']
  ])
    if (pattern.test(text)) return phase
  return 'bootstrap-phase-unavailable'
}
export function validOwnerSession(value, subject, key) {
  try {
    if (typeof value !== 'string' || value.length > 16384) return false
    const [header, payload, signature, extra] = value.split('.')
    if (extra || !header || !payload || !signature) return false
    const metadata = JSON.parse(Buffer.from(header, 'base64url'))
    const claims = JSON.parse(Buffer.from(payload, 'base64url'))
    const expected = createHmac('sha256', key)
      .update(`${header}.${payload}`)
      .digest()
    const supplied = Buffer.from(signature, 'base64url')
    return (
      metadata.alg === 'HS256' &&
      supplied.length === expected.length &&
      timingSafeEqual(supplied, expected) &&
      claims.sub === subject &&
      claims.role === 'authenticated' &&
      Number.isFinite(claims.exp) &&
      claims.exp > Math.floor(Date.now() / 1000)
    )
  } catch {
    return false
  }
}

// Trusted installed-proof seam only. No serialized configuration, renderer or
// native IPC value supplies this callback. Normal activation uses the exact
// preparation and psql path, and any failure still stops the real stack.
export async function completeNativeSchema(
  preparation,
  psql,
  openClient,
  hook
) {
  if (hook !== undefined && typeof hook !== 'function')
    throw new Error('Invalid schema proof callback')
  return hook
    ? hook({ preparation, psql, openClient })
    : preparation.complete(psql)
}

export async function nativeServices(config, options = {}) {
  const trace = { stage: 'configuration' }
  try {
    return await startNativeServices(config, options, trace)
  } catch (error) {
    captureNativeServicesFailure(error, trace)
    throw error
  }
}

async function startNativeServices(
  {
    state,
    binaries,
    schemaDirectory,
    libraryPath,
    allowSourceHardlinks = false
  },
  { completeSchema } = {},
  trace
) {
  trace.stage = 'platform-admission'
  if (process.platform !== 'win32')
    throw new Error('Windows native owner required')
  state = resolve(state)
  trace.stage = 'state-directory'
  await mkdir(state, { recursive: true, mode: 0o700 })
  // The native owner holds the OS exclusive workspace lock and validates ACLs/reparse points.
  trace.stage = 'schema-preparation'
  const schema = await prepareSchemaBootstrap({
    state,
    schemaDirectory,
    allowSourceHardlinks
  })
  const children = []
  const diagnostics = new WeakMap()
  const { unlink } = await import('node:fs/promises')
  const onInterrupt = () => {
    void stop().finally(() => process.exit(130))
  }
  trace.stage = 'interrupt-handlers'
  process.once('SIGINT', onInterrupt)
  process.once('SIGTERM', onInterrupt)
  let stopping = false
  let stopPromise
  let fault
  let pgProcess
  const pgData = join(state, 'pgdata')
  const stop = () => {
    if (stopPromise) return stopPromise
    stopping = true
    process.removeListener('SIGINT', onInterrupt)
    process.removeListener('SIGTERM', onInterrupt)
    stopPromise = (async () => {
      for (const child of [...children].reverse()) {
        if (child.exitCode !== null || child.signalCode !== null) continue
        const exited = new Promise((accept) => child.once('exit', accept))
        if (child === pgProcess && binaries.pgctl) {
          try {
            await run(
              binaries.pgctl,
              ['stop', '-D', pgData, '-m', 'fast', '-w', '-t', '5'],
              { env: process.env }
            )
          } catch {}
          if (child.exitCode !== null || child.signalCode !== null) continue
        }
        child.kill('SIGTERM')
        await Promise.race([exited, delay(5000, undefined, { ref: false })])
        if (child.exitCode === null && child.signalCode === null) {
          child.kill('SIGKILL')
          await exited
        }
      }
    })()
    return stopPromise
  }
  try {
    trace.stage = 'service-material'
    const credentials = await nativeCommand(['service-material', state])
    trace.stage = 'credentials-check'
    if (
      ['owner', 'auth', 'rest', 'jwt'].some(
        (key) => !/^[a-f0-9]{64}$/.test(credentials[key])
      )
    )
      throw new Error('Corrupt local credentials; refusing activation')
    trace.stage = 'port-allocation'
    const ports = {
      db: await freePort(),
      auth: await freePort(),
      rest: await freePort()
    }
    const pgEnv = {
      ...process.env,
      PATH: process.env.PATH,
      LANG: 'C',
      LC_ALL: 'C',
      ...(libraryPath ? { LD_LIBRARY_PATH: libraryPath } : {}),
      PGPASSWORD: credentials.owner
    }
    const psql = async (sql) => {
      const path = join(state, `command-${randomUUID()}.sql`)
      await writeFile(path, sql, { mode: 0o600 })
      try {
        return await run(
          binaries.psql,
          [
            '-X',
            '-v',
            'ON_ERROR_STOP=1',
            '-h',
            '127.0.0.1',
            '-p',
            String(ports.db),
            '-U',
            'desktop_owner',
            '-d',
            'postgres',
            '-At',
            '-f',
            path
          ],
          { env: pgEnv }
        )
      } finally {
        await unlink(path).catch(() => {})
      }
    }
    const openSchemaClient = (applicationName) => {
      if (
        typeof applicationName !== 'string' ||
        !/^desktop-bootstrap-[a-f0-9]{16}$/.test(applicationName)
      )
        throw new Error('Invalid schema proof client')
      const client = spawn(
        binaries.psql,
        [
          '-X',
          '-v',
          'ON_ERROR_STOP=1',
          '-h',
          '127.0.0.1',
          '-p',
          String(ports.db),
          '-U',
          'desktop_owner',
          '-d',
          'postgres',
          '-At'
        ],
        {
          cwd: state,
          env: { ...pgEnv, PGAPPNAME: applicationName },
          stdio: ['pipe', 'ignore', 'ignore'],
          windowsHide: false
        }
      )
      // This utility deliberately observes a terminated backend. Its expected
      // nonzero close is tested by the proof, while stop still owns cleanup.
      // Long-lived service fault handling below is unchanged.
      children.push(client)
      client.stdin.on('error', () => {})
      const closed = new Promise((accept) => {
        client.once('error', () => accept({ code: null, signal: null }))
        client.once('close', (code, signal) => accept({ code, signal }))
      })
      return { client, closed }
    }
    const launch = (
      file,
      args,
      env,
      cwd = state,
      ephemeral = false,
      input,
      ipc = false
    ) => {
      const child = spawn(file, args, {
        cwd,
        env: { ...process.env, ...env },
        stdio: [
          input ? 'pipe' : 'ignore',
          'pipe',
          'pipe',
          ...(ipc ? ['ipc'] : [])
        ],
        windowsHide: false
      })
      // Classify only a bounded in-memory prefix; upstream bodies never enter diagnostics.
      if (input) child.stdin.end(input)
      const diagnostic = serviceStartupDiagnostic(child)
      diagnostics.set(child, diagnostic)
      child.once('error', () => {})
      children.push(child)
      child.once('exit', (code, signal) => {
        if (!stopping && (!ephemeral || code !== 0 || signal)) {
          const failure = new Error(
            'A proof-owned service failed; startup diagnostic pending; sensitive output suppressed'
          )
          fault = failure
          // Fail closed immediately; complete only the bounded diagnostic asynchronously.
          void stop()
          void diagnostic.afterClose().then((text) => {
            failure.message = 'A proof-owned service failed; ' + text
          })
        }
      })
      return child
    }
    let fresh = false
    trace.stage = 'postgres-version-check'
    try {
      await stat(join(pgData, 'PG_VERSION'))
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      const pass = join(state, 'owner-password')
      trace.stage = 'initdb-password-write'
      await writeFile(pass, credentials.owner, { mode: 0o600 })
      try {
        trace.stage = 'initdb-run'
        await run(
          binaries.initdb,
          [
            '-D',
            pgData,
            '-U',
            'desktop_owner',
            '--pwfile',
            pass,
            '--auth-local=scram-sha-256',
            '--auth-host=scram-sha-256',
            '--encoding=UTF8',
            '--locale=C'
          ],
          { env: pgEnv }
        )
      } catch (error) {
        trace.failure ??= { stage: trace.stage, error, probe: trace.probe }
        throw error
      } finally {
        trace.stage = 'initdb-password-retire'
        await unlink(pass)
      }
      fresh = true
    }
    trace.stage = 'postgres-launch'
    const pg = launch(
      binaries.postgres,
      ['-D', pgData, '-h', '127.0.0.1', '-p', String(ports.db), '-k', ''],
      pgEnv
    )
    pgProcess = pg
    const ready = async (probe, child, label) => {
      trace.probe = undefined
      for (let i = 0; i < 100; i++) {
        if (child.exitCode !== null || child.signalCode !== null)
          throw new Error(
            `${label} exited before readiness; ${await diagnostics.get(child).afterClose()}`
          )
        try {
          await probe()
          trace.probe = undefined
          return
        } catch (error) {
          trace.probe = nativeServicesProbeDiagnostic(error)
          await delay(100)
        }
      }
      throw new Error(`${label} readiness timed out`)
    }
    trace.stage = 'postgres-readiness'
    await ready(() => psql('SELECT 1;'), pg, 'PostgreSQL')
    trace.stage = 'schema-inspect'
    await schema.inspect(psql)
    // Native JWTs are minted per use; the application only holds a stable
    // private credential that the guarded gateway exchanges.
    const token = {
      get anon() {
        return signedToken(credentials.jwt, 'anon', 300)
      },
      get service() {
        return signedToken(credentials.jwt, 'service_role', 300)
      }
    }
    const serviceCredential = randomBytes(32).toString('hex')
    trace.stage = 'role-inspection'
    if (
      (
        await psql(
          "SELECT count(*) FROM pg_roles WHERE rolname='supabase_auth_admin';"
        )
      ).trim() === '0'
    ) {
      trace.stage = 'role-bootstrap'
      await psql(`
      BEGIN;
      REVOKE CREATE ON SCHEMA public FROM PUBLIC;
      CREATE ROLE anon NOLOGIN NOBYPASSRLS;
      CREATE ROLE authenticated NOLOGIN NOBYPASSRLS;
      CREATE ROLE service_role NOLOGIN BYPASSRLS;
      CREATE ROLE desktop_rpc_reader NOLOGIN NOBYPASSRLS;
      CREATE ROLE authenticator LOGIN NOINHERIT PASSWORD '${credentials.rest}';
      GRANT anon,authenticated,service_role TO authenticator;
      CREATE ROLE supabase_auth_admin LOGIN NOINHERIT PASSWORD '${credentials.auth}';
      CREATE SCHEMA auth AUTHORIZATION supabase_auth_admin;
      GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
      COMMIT;
    `)
    }
    trace.stage = 'auth-role-maintenance'
    await psql(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='postgres') THEN CREATE ROLE postgres NOLOGIN NOBYPASSRLS; END IF; END $$;
      ALTER ROLE supabase_auth_admin SET search_path=auth;
      DO $$ BEGIN IF to_regprocedure('auth.uid()') IS NOT NULL THEN ALTER FUNCTION auth.uid() OWNER TO supabase_auth_admin; END IF; IF to_regprocedure('auth.jwt()') IS NOT NULL THEN ALTER FUNCTION auth.jwt() OWNER TO supabase_auth_admin; END IF; END $$;`)
    const authEnv = {
      ...process.env,
      PATH: process.env.PATH,
      LANG: 'C',
      LC_ALL: 'C',
      GOTRUE_API_HOST: '127.0.0.1',
      PORT: String(ports.auth),
      API_EXTERNAL_URL: `http://127.0.0.1:${ports.auth}`,
      GOTRUE_SITE_URL: 'http://127.0.0.1',
      GOTRUE_DB_DRIVER: 'postgres',
      GOTRUE_DB_DATABASE_URL: `postgres://supabase_auth_admin:${credentials.auth}@127.0.0.1:${ports.db}/postgres`,
      GOTRUE_DB_NAMESPACE: 'auth',
      DB_NAMESPACE: 'auth',
      GOTRUE_JWT_SECRET: credentials.jwt,
      GOTRUE_JWT_AUD: 'authenticated',
      GOTRUE_JWT_DEFAULT_GROUP_NAME: 'authenticated',
      GOTRUE_JWT_ADMIN_ROLES: 'service_role',
      GOTRUE_DISABLE_SIGNUP: 'true',
      GOTRUE_EXTERNAL_EMAIL_ENABLED: 'true',
      GOTRUE_EXTERNAL_PHONE_ENABLED: 'false',
      GOTRUE_MAILER_AUTOCONFIRM: 'true',
      GOTRUE_LOG_LEVEL: 'warn'
    }
    trace.stage = 'auth-migrate'
    await run(binaries.auth, ['migrate'], {
      env: authEnv,
      cwd: binaries.authCwd
    })
    trace.stage = 'auth-launch'
    const auth = launch(binaries.auth, ['serve'], authEnv, binaries.authCwd)
    trace.stage = 'auth-readiness'
    await ready(
      async () => {
        const r = await fetch(`http://127.0.0.1:${ports.auth}/health`)
        if (!r.ok) throw Error('Auth not ready')
      },
      auth,
      'Auth'
    )
    trace.stage = 'schema-completion'
    await completeNativeSchema(schema, psql, openSchemaClient, completeSchema)
    trace.stage = 'postgrest-launch'
    const rest = launch(binaries.postgrest, [], {
      ...process.env,
      PATH: process.env.PATH,
      PGRST_DB_URI: `postgres://authenticator:${credentials.rest}@127.0.0.1:${ports.db}/postgres`,
      PGRST_DB_SCHEMAS: 'public',
      PGRST_DB_ANON_ROLE: 'anon',
      PGRST_JWT_SECRET: credentials.jwt,
      PGRST_SERVER_HOST: '127.0.0.1',
      PGRST_SERVER_PORT: String(ports.rest),
      PGRST_LOG_LEVEL: 'warn'
    })
    trace.stage = 'postgrest-readiness'
    await ready(
      async () => {
        const r = await fetch(`http://127.0.0.1:${ports.rest}/`, {
          headers: { Authorization: `Bearer ${token.service}` }
        })
        if (!r.ok) throw Error('PostgREST not ready')
      },
      rest,
      'PostgREST'
    )
    trace.stage = 'services-result'
    return {
      state,
      ports,
      token,
      serviceCredential,
      validOwnerSession: (value, subject) =>
        validOwnerSession(value, subject, credentials.jwt),
      psql,
      launch,
      children,
      stop,
      fresh,
      get fault() {
        return fault
      }
    }
  } catch (error) {
    trace.failure ??= { stage: trace.stage, error, probe: trace.probe }
    await stop()
    throw error
  }
}
