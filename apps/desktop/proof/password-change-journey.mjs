import assert from 'node:assert/strict'
import { createServerClient } from '@supabase/ssr'
import { randomBytes, randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { nativeServices } from './native-services.mjs'
import { loopbackGateway } from './loopback-gateway.mjs'
import { workspaceSetup } from '../launcher/workspace.mjs'

const config = JSON.parse(await readFile(process.argv[2], 'utf8'))
assert(config.application, 'Compiled application required')
const state = join(
  config.stateRoot || config.state,
  'password-change-probe-' + randomUUID()
)
const password = randomBytes(24).toString('hex')
let services, gateway, key, cron, cookie, client
async function start() {
  services = await nativeServices({ ...config, state })
  key = randomBytes(32).toString('hex')
  cron = randomBytes(32).toString('hex')
  const listener = createServer()
  await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve))
  const port = listener.address().port
  await new Promise((resolve) => listener.close(resolve))
  gateway = await loopbackGateway({
    services,
    transportKey: key,
    handleLocalRequest: workspaceSetup(
      services,
      new URL('../launcher', import.meta.url).pathname
    )
  })
  gateway.setAppPort(port)
  services.launch(
    config.application.node,
    [join(config.application.directory, 'server.js')],
    {
      PATH: process.env.PATH,
      NODE_ENV: 'production',
      HOSTNAME: '127.0.0.1',
      PORT: String(port),
      NEXT_TELEMETRY_DISABLED: '1',
      NEXT_PUBLIC_RUNTIME_PROFILE: 'desktop',
      NEXT_PUBLIC_SITE_URL: gateway.origin,
      SITE_URL: gateway.origin,
      NEXT_PUBLIC_SUPABASE_URL: gateway.origin + '/supabase',
      SUPABASE_URL: gateway.origin + '/supabase',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'desktop-public',
      SUPABASE_SERVICE_ROLE_KEY: services.serviceCredential,
      DESKTOP_TRANSPORT_KEY: key,
      CRON_SECRET: cron
    },
    config.application.directory
  )
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    assert(!services.fault, 'Native application stays alive')
    try {
      if ((await request('/api/health')).ok) return
    } catch {}
    await delay(100)
  }
  throw new Error('Native application readiness timeout')
}
const request = (path, body, extra = {}) =>
  fetch(gateway.origin + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'x-desktop-transport': key,
      origin: gateway.origin,
      'content-type': 'application/json',
      ...extra
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(25000)
  })
async function login(secret = password) {
  const cookies = []
  client = createServerClient(gateway.origin + '/supabase', 'desktop-public', {
    global: {
      fetch: (url, options) =>
        fetch(url, {
          ...options,
          headers: { ...options?.headers, 'x-desktop-transport': key }
        })
    },
    auth: { storageKey: 'tacticus-auth-token' },
    cookies: {
      getAll: () => cookies,
      setAll: (values) => cookies.splice(0, cookies.length, ...values)
    }
  })
  const result = await client.auth.signInWithPassword({
    email: 'desktop@localhost.invalid',
    password: secret
  })
  assert.equal(result.error, null)
  cookie = cookies.map(({ name, value }) => `${name}=${value}`).join('; ')
  return result.data.session
}
async function stop() {
  await gateway?.stop()
  gateway = undefined
  await services?.stop()
  services = undefined
}
const replacement = randomBytes(24).toString('hex') + 'Aa!7'
let before, subject
const checks = []
try {
  await start()
  assert.equal(
    (await request('/desktop/setup', { password, sample: true })).status,
    201
  )
  subject = (await login()).user.id
  before = (
    await services.psql(
      'SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public."EOT_GR_data" r;'
    )
  ).trim()
  assert.equal(JSON.parse(before).length, 8)
  const page = await request('/profile/change-password', undefined, { cookie })
  assert.equal(page.status, 200)
  const html = await page.text()
  assert(html.includes('Open workspace recovery'))
  assert(!html.includes('Email me a reset link'))
  const verify = (secret) =>
    request(
      '/api/auth/login',
      {
        email: 'desktop@localhost.invalid',
        password: secret,
        rememberMe: true
      },
      { cookie, 'user-agent': 'Mozilla/5.0' }
    )
  assert.equal((await verify(password + 'wrong')).status, 401)
  assert.equal(
    (
      await services.psql(
        'SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public."EOT_GR_data" r;'
      )
    ).trim(),
    before
  )
  const verified = await verify(password)
  assert.equal(verified.status, 200)
  const loginResult = await verified.json()
  assert.equal(loginResult.success, true)
  assert.equal(loginResult.user.id, subject)
  assert(!JSON.stringify(loginResult).includes(password))
  assert(!('session' in loginResult))
  // The same local Auth client used by the form performs the actual update.
  const changed = await client.auth.updateUser({ password: replacement })
  assert.equal(changed.error, null)
  assert.equal(changed.data.user.id, subject)
  await login(replacement)
  assert.equal((await verify(password)).status, 401)
  assert.equal((await verify(replacement)).status, 200)
  assert.equal(
    (
      await services.psql(
        'SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public."EOT_GR_data" r;'
      )
    ).trim(),
    before
  )
  checks.push(
    'compiled desktop password page offers local recovery rather than email reset',
    'actual login verification refuses wrong password and returns a token-free response for the owner',
    'canonical Auth update changes the password, old password fails and replacement succeeds without changing raid data'
  )
  await stop()
  await start()
  assert.equal((await login(replacement)).user.id, subject)
  assert.equal(
    (
      await services.psql(
        'SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public."EOT_GR_data" r;'
      )
    ).trim(),
    before
  )
  checks.push(
    'native restart authenticates the replacement password and preserves all eight synthetic rows'
  )
  const evidence = {
    status: 'passed',
    checks,
    scope:
      'Native Auth and compiled application paths; form interaction and installed workspace acceptance are separate.'
  }
  await writeFile(
    config.evidence.replace(/\.json$/, '-password-change.json'),
    JSON.stringify(evidence, null, 2),
    { mode: 0o600 }
  )
  console.log(JSON.stringify(evidence, null, 2))
} finally {
  await stop()
}
