import { spawn } from 'node:child_process'
import { createHmac, createHash, randomBytes, randomUUID } from 'node:crypto'
import { createServer } from 'node:net'
import { mkdir, readFile, writeFile, stat, lstat } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { resolve, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const secret = () => randomBytes(32).toString('hex')
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
async function run(file, args, options, observe) {
  const child = spawn(file, args, {
    ...options,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  observe?.(child)
  let stdout = '',
    stderr = ''
  child.stdout.on('data', (v) => {
    stdout += v
  })
  child.stderr.on('data', (v) => {
    stderr += v
  })
  await new Promise((accept, reject) => {
    child.once('error', reject)
    child.once('exit', (code) =>
      code === 0
        ? accept()
        : reject(new Error(`${file} exited ${code}: ${stderr.slice(-1200)}`))
    )
  })
  return stdout
}
export async function nativeServices({
  state,
  binaries,
  schemaDirectory,
  libraryPath,
  tokenLifetimeSeconds = 86400
}) {
  if (
    !Number.isInteger(tokenLifetimeSeconds) ||
    tokenLifetimeSeconds < 1 ||
    tokenLifetimeSeconds > 86400
  )
    throw new Error('Invalid local token lifetime')
  state = resolve(state)
  await mkdir(state, { recursive: true, mode: 0o700 })
  const info = await lstat(state)
  if (
    info.isSymbolicLink() ||
    (typeof process.getuid === 'function' && info.uid !== process.getuid()) ||
    (info.mode & 0o077) !== 0
  )
    throw new Error('State directory must be private')
  const lockPath = join(state, 'running.lock')
  // Never recover a stale lock by guessing which process owns it.
  const schemaHash = createHash('sha256')
    .update(await readFile(join(schemaDirectory, 'canonical-objects.sql')))
    .update(await readFile(join(schemaDirectory, 'authority.sql')))
    .digest('hex')
  await writeFile(lockPath, String(process.pid), { flag: 'wx', mode: 0o600 })
  let needsSchema = true
  try {
    if ((await readFile(join(state, 'schema-version'), 'utf8')) !== schemaHash)
      throw new Error('Incompatible local schema; activation refused')
    needsSchema = false
  } catch (error) {
    if (error.code !== 'ENOENT') {
      await (await import('node:fs/promises')).unlink(lockPath)
      throw error
    }
  }
  const children = []
  const utilities = new Set()
  const { unlink } = await import('node:fs/promises')
  const onInterrupt = () => {
    void stop().finally(() => process.exit(130))
  }
  process.on('SIGINT', onInterrupt)
  process.on('SIGTERM', onInterrupt)
  let stopping = false
  let stopPromise
  let fault
  const managedRun = (file, args, options) => {
    if (stopping) throw new Error('Local services are stopping')
    return run(file, args, options, (child) => {
      utilities.add(child)
      child.once('close', () => utilities.delete(child))
    })
  }
  const stop = () => {
    if (stopPromise) return stopPromise
    stopping = true
    stopPromise = (async () => {
      for (const child of [...children].reverse().concat([...utilities])) {
        if (child.exitCode !== null || child.signalCode !== null) continue
        const exited = new Promise((accept) => child.once('exit', accept))
        // PostgreSQL fast shutdown cancels open sessions and checkpoints WAL.
        // SIGTERM requests smart shutdown and can wait indefinitely on clients.
        child.kill(child === children[0] ? 'SIGINT' : 'SIGTERM')
        await Promise.race([exited, delay(5000, undefined, { ref: false })])
        if (child.exitCode === null && child.signalCode === null) {
          child.kill('SIGKILL')
          await exited
        }
      }
      await unlink(lockPath).catch(() => {})
      process.removeListener('SIGINT', onInterrupt)
      process.removeListener('SIGTERM', onInterrupt)
    })()
    return stopPromise
  }
  try {
    let credentials
    try {
      credentials = JSON.parse(
        await readFile(join(state, 'credentials.json'), 'utf8')
      )
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      credentials = {
        owner: secret(),
        auth: secret(),
        rest: secret(),
        jwt: secret()
      }
      await writeFile(
        join(state, 'credentials.json'),
        JSON.stringify(credentials),
        { flag: 'wx', mode: 0o600 }
      )
    }
    if (
      ['owner', 'auth', 'rest', 'jwt'].some(
        (key) => !/^[a-f0-9]{64}$/.test(credentials[key])
      )
    )
      throw new Error('Corrupt local credentials; refusing activation')
    const ports = {
      db: await freePort(),
      auth: await freePort(),
      rest: await freePort()
    }
    const pgEnv = {
      PATH: process.env.PATH,
      LANG: 'C.UTF-8',
      ...(libraryPath ? { LD_LIBRARY_PATH: libraryPath } : {}),
      PGPASSWORD: credentials.owner
    }
    const psql = async (sql) => {
      const path = join(state, `command-${randomUUID()}.sql`)
      await writeFile(path, sql, { mode: 0o600 })
      try {
        return await managedRun(
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
    const launch = (file, args, env, cwd = state, ephemeral = false) => {
      if (stopping) throw new Error('Local services are stopping')
      const log = createWriteStream(join(state, `${children.length}.log`), {
        mode: 0o600,
        flags: 'a'
      })
      const child = spawn(file, args, {
        cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe']
      })
      child.stdout.pipe(log)
      child.stderr.pipe(log)
      child.once('error', () => {})
      children.push(child)
      child.once('exit', (code, signal) => {
        if (!stopping && (!ephemeral || code !== 0 || signal)) {
          fault = new Error('A proof-owned service failed')
          void stop()
        }
      })
      return child
    }
    const pgData = join(state, 'pgdata')
    let fresh = false
    try {
      await stat(join(pgData, 'PG_VERSION'))
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      const pass = join(state, 'owner-password')
      await writeFile(pass, credentials.owner, { mode: 0o600 })
      await managedRun(
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
      await unlink(pass)
      fresh = true
    }
    const pg = launch(
      binaries.postgres,
      ['-D', pgData, '-h', '127.0.0.1', '-p', String(ports.db), '-k', ''],
      pgEnv
    )
    const ready = async (probe, child, label) => {
      for (let i = 0; i < 100; i++) {
        if (child.exitCode !== null || child.signalCode !== null)
          throw new Error(
            `${label} exited before readiness; inspect private service log`
          )
        try {
          await probe()
          return
        } catch {
          await delay(100)
        }
      }
      throw new Error(`${label} readiness timed out`)
    }
    await ready(() => psql('SELECT 1;'), pg, 'PostgreSQL')
    const token = {
      get anon() {
        return signedToken(credentials.jwt, 'anon', tokenLifetimeSeconds)
      },
      get service() {
        return signedToken(
          credentials.jwt,
          'service_role',
          tokenLifetimeSeconds
        )
      }
    }
    // Private server clients exchange this stable credential at the guarded
    // gateway. Native JWTs are minted per use and never retained until expiry.
    const serviceCredential = secret()
    if (
      (
        await psql(
          "SELECT count(*) FROM pg_roles WHERE rolname='supabase_auth_admin';"
        )
      ).trim() === '0'
    )
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
    await psql(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='postgres') THEN CREATE ROLE postgres NOLOGIN NOBYPASSRLS; END IF; END $$;
      ALTER ROLE supabase_auth_admin SET search_path=auth;
      DO $$ BEGIN IF to_regprocedure('auth.uid()') IS NOT NULL THEN ALTER FUNCTION auth.uid() OWNER TO supabase_auth_admin; END IF; IF to_regprocedure('auth.jwt()') IS NOT NULL THEN ALTER FUNCTION auth.jwt() OWNER TO supabase_auth_admin; END IF; END $$;`)
    const authEnv = {
      PATH: process.env.PATH,
      LANG: 'C.UTF-8',
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
    await managedRun(binaries.auth, ['migrate'], {
      env: authEnv,
      cwd: binaries.authCwd
    })
    const auth = launch(binaries.auth, ['serve'], authEnv, binaries.authCwd)
    await ready(
      async () => {
        const r = await fetch(`http://127.0.0.1:${ports.auth}/health`)
        if (!r.ok) throw Error('Auth not ready')
      },
      auth,
      'Auth'
    )
    if (needsSchema) {
      // The native Auth release supplies its own versioned schema migrations.
      await psql(
        'BEGIN;\n' +
          (await readFile(
            join(schemaDirectory, 'canonical-objects.sql'),
            'utf8'
          )) +
          '\n' +
          (await readFile(join(schemaDirectory, 'authority.sql'), 'utf8')) +
          '\nCOMMIT;'
      )
      await writeFile(join(state, 'schema-version'), schemaHash, {
        mode: 0o600,
        flag: 'wx'
      })
    }
    const rest = launch(binaries.postgrest, [], {
      PATH: process.env.PATH,
      PGRST_DB_URI: `postgres://authenticator:${credentials.rest}@127.0.0.1:${ports.db}/postgres`,
      PGRST_DB_SCHEMAS: 'public',
      PGRST_DB_ANON_ROLE: 'anon',
      PGRST_JWT_SECRET: credentials.jwt,
      PGRST_SERVER_HOST: '127.0.0.1',
      PGRST_SERVER_PORT: String(ports.rest),
      PGRST_LOG_LEVEL: 'warn'
    })
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
    return {
      state,
      ports,
      token,
      serviceCredential,
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
    await stop()
    throw error
  }
}
