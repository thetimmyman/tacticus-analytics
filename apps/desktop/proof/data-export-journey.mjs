import assert from 'node:assert/strict'
import { createServerClient } from '@supabase/ssr'
import { randomBytes, randomUUID, createHmac } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { nativeServices } from './native-services.mjs'
import { loopbackGateway } from './loopback-gateway.mjs'
import { workspaceSetup } from '../launcher/workspace.mjs'

const config = JSON.parse(await readFile(process.argv[2], 'utf8'))
assert(config.application, 'Compiled application required')
const state = join(
  config.stateRoot || config.state,
  'data-export-' + randomUUID()
)
const password = randomBytes(24).toString('hex')
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`
let services, gateway, key, cron, cookie, application, holder
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
  application = services.launch(
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
async function login() {
  const cookies = []
  const client = createServerClient(
    gateway.origin + '/supabase',
    'desktop-public',
    {
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
    }
  )
  const result = await client.auth.signInWithPassword({
    email: 'desktop@localhost.invalid',
    password
  })
  assert.equal(result.error, null)
  cookie = cookies.map(({ name, value }) => `${name}=${value}`).join('; ')
  return result.data.session
}
const tick = () =>
  request('/api/desktop/jobs', {}, { authorization: `Bearer ${cron}` })
async function enqueue(suffix) {
  const dedupe = 'SYN-EXPORT-' + suffix + '-' + randomUUID()
  await services.psql(
    `INSERT INTO public.work_queue(job_type,job_class,payload,dedupe_key,max_attempts) VALUES('export-local-profile-data','hook','{"subjectUserId":"synthetic-forged"}',${quote(dedupe)},10);`
  )
  return dedupe
}
async function stop() {
  if (holder && holder.exitCode === null && holder.signalCode === null)
    holder.kill('SIGTERM')
  await gateway?.stop()
  gateway = undefined
  await services?.stop()
  services = undefined
}
const checks = []
let subject, exportId, baseline
try {
  await start()
  assert.equal(
    (
      await request('/desktop/setup', {
        password,
        sample: false,
        identity: {
          guildCode: 'SYN-LOCAL',
          playerId: 'synthetic-export-player',
          displayName: 'Synthetic Shared Alias',
          guildName: 'Synthetic Local Guild'
        }
      })
    ).status,
    201
  )
  let session = await login()
  subject = session.user.id
  const foreign = randomUUID()
  await services.psql(`
    INSERT INTO auth.users(id,aud,role,email) VALUES(${quote(foreign)},'authenticated','authenticated','synthetic-foreign@example.invalid');
    INSERT INTO public.player_mapping(id,user_id,player_id,display_name,guild_code,is_current,role) VALUES(999,${quote(foreign)},'synthetic-foreign-player','Synthetic Shared Alias','SYN-LOCAL',true,'member');
    UPDATE public.player_mapping SET tacticus_api_key_encrypted='synthetic-export-credential-canary' WHERE user_id=${quote(subject)};
    INSERT INTO public."EOT_GR_data"("Guild","Season","userId","displayName","Name","damageType","damageDealt","encounterId","encounterIndex","loopIndex")
    VALUES('SYN-LOCAL','9999','synthetic-export-player','Synthetic Shared Alias','Synthetic Boss','Battle',50,0,0,1),
      ('SYN-LOCAL','9999','synthetic-foreign-player','Synthetic Shared Alias','Synthetic Boss','Battle',999,0,0,1),
      ('SYN-OTHER','9999','synthetic-export-player','Synthetic Shared Alias','Synthetic Boss','Battle',888,0,0,1);
  `)
  const rest = (path, body, auth = session.access_token, method) =>
    fetch(gateway.origin + '/supabase/rest/v1/' + path, {
      method: method || (body === undefined ? 'GET' : 'POST'),
      headers: {
        'x-desktop-transport': key,
        origin: gateway.origin,
        apikey: 'desktop-public',
        'content-type': 'application/json',
        prefer: 'return=representation',
        ...(auth ? { authorization: `Bearer ${auth}` } : {})
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10000)
    })
  assert.equal((await request('/api/gdpr/my-data', {})).status, 401)
  for (const body of [
    { user_id: foreign },
    { user_id: subject, status: 'completed' },
    { user_id: subject, data_package: {} },
    { user_id: subject, request_id: randomUUID() }
  ])
    assert([400, 403].includes((await rest('gdpr_data_exports', body)).status))
  assert.equal(
    (await rest('rpc/get_user_data_for_export', { p_user_id: foreign })).status,
    403
  )
  assert(
    [401, 403].includes(
      (await rest('rpc/get_user_data_for_export', { p_user_id: subject }, null))
        .status
    )
  )
  const collected = await rest('rpc/get_user_data_for_export', {
    p_user_id: subject
  })
  assert.equal(collected.status, 200)
  baseline = await collected.json()
  assert.equal(baseline.data.battle_data.length, 1)
  assert.equal(baseline.data.battle_data[0].damageDealt, 50)
  assert.deepEqual(Object.keys(baseline.data.profile).sort(), [
    'created_at',
    'email',
    'id',
    'last_sign_in_at'
  ])
  assert.equal(baseline.data.identity_verification.game_account_verified, false)
  assert(
    !JSON.stringify(baseline).includes('synthetic-export-credential-canary')
  )
  // Even a forged HTTP body cannot choose the queued account or destination.
  const queued = await request(
    '/api/gdpr/my-data',
    { user_id: foreign, download_url: 'https://example.invalid/' },
    { cookie }
  )
  assert.equal(queued.status, 200)
  exportId = (await queued.json()).requestId
  assert.equal(
    (
      await services.psql(
        `SELECT user_id||':'||status FROM public.gdpr_data_exports WHERE request_id=${quote(exportId)};`
      )
    ).trim(),
    subject + ':pending'
  )
  assert.equal(
    (
      await request(`/api/gdpr/my-data/${exportId}/download`, undefined, {
        cookie
      })
    ).status,
    404
  )
  await enqueue('first')
  // Actual privilege failure must leave durable processing work for a retry.
  await services.psql(
    'REVOKE EXECUTE ON FUNCTION public.get_user_data_for_export(uuid) FROM service_role;'
  )
  assert.equal((await tick()).status, 503)
  assert.equal(
    (
      await services.psql(
        `SELECT status||':'||coalesce(download_url,'absent') FROM public.gdpr_data_exports WHERE request_id=${quote(exportId)};`
      )
    ).trim(),
    'processing:absent'
  )
  await stop()
  await start()
  session = await login()
  assert.equal(
    (
      await services.psql(
        `SELECT status FROM public.gdpr_data_exports WHERE request_id=${quote(exportId)};`
      )
    ).trim(),
    'processing'
  )
  await services.psql(
    "GRANT EXECUTE ON FUNCTION public.get_user_data_for_export(uuid) TO service_role; UPDATE public.work_queue SET scheduled_for=now() WHERE job_type='export-local-profile-data' AND status='pending';"
  )
  assert.equal((await tick()).status, 200)
  let status = await request(`/api/gdpr/my-data/${exportId}`, undefined, {
    cookie
  })
  assert.equal(status.status, 200)
  status = await status.json()
  assert.equal(status.status, 'completed')
  assert.equal(
    (await (await request('/api/gdpr/my-data', undefined, { cookie })).json())
      .requestId,
    exportId
  )
  assert.equal(status.downloadUrl, `/api/gdpr/my-data/${exportId}/download`)
  let download = await request(status.downloadUrl, undefined, { cookie })
  assert.equal(download.status, 200)
  assert(download.headers.get('content-disposition').includes('attachment'))
  assert(download.headers.get('cache-control').includes('no-store'))
  baseline = await download.json()
  assert.equal(baseline.data.battle_data.length, 1)
  assert(
    !JSON.stringify(baseline).includes('synthetic-export-credential-canary')
  )
  assert.equal((await request(status.downloadUrl)).status, 401)
  const metadata = await readFile(
    join(services.state, 'credentials.json'),
    'utf8'
  )
  const credentials = JSON.parse(metadata)
  const claims = {
    sub: foreign,
    aud: 'authenticated',
    role: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 60
  }
  const head = Buffer.from(
    JSON.stringify({ alg: 'HS256', typ: 'JWT' })
  ).toString('base64url')
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url')
  const foreignToken =
    head +
    '.' +
    body +
    '.' +
    createHmac('sha256', credentials.jwt)
      .update(head + '.' + body)
      .digest('base64url')
  assert.deepEqual(
    await (
      await rest(
        `gdpr_data_exports?request_id=eq.${exportId}`,
        undefined,
        foreignToken
      )
    ).json(),
    []
  )
  assert.equal(
    (
      await rest(
        'rpc/get_user_data_for_export',
        { p_user_id: subject },
        foreignToken
      )
    ).status,
    403
  )
  assert.equal(
    (
      await services.psql(
        "SELECT rolcanlogin::text||':'||rolbypassrls::text FROM pg_roles WHERE rolname='desktop_export_reader';"
      )
    ).trim(),
    'false:false'
  )
  checks.push(
    'durable request binds authenticated local subject; protected writes and foreign/anonymous reads refuse',
    'export uses stable player and guild identifiers despite equal display aliases, excludes credentials and Auth secrets',
    'actual RPC privilege failure leaves processing request durable across native restart; worker retry completes authenticated attachment'
  )
  await stop()
  await start()
  await login()
  assert.deepEqual(
    await (
      await request(`/api/gdpr/my-data/${exportId}/download`, undefined, {
        cookie
      })
    ).json(),
    baseline
  )
  await services.psql(
    `UPDATE public.gdpr_data_exports SET expires_at=now()-interval '1 second' WHERE request_id=${quote(exportId)};`
  )
  assert.equal(
    (
      await request(`/api/gdpr/my-data/${exportId}/download`, undefined, {
        cookie
      })
    ).status,
    404
  )
  assert.equal(
    (await request(`/api/gdpr/my-data/${exportId}`, undefined, { cookie }))
      .status,
    404
  )
  checks.push(
    'completed bundle remains exact across offline native restart; expired request and download refuse'
  )
  assert.equal(
    (await (await request('/api/gdpr/my-data', undefined, { cookie })).json())
      .requestId,
    null
  )
  for (const secret of Object.values(credentials))
    assert(!JSON.stringify(baseline).includes(secret))
  await services.psql(
    `INSERT INTO public."EOT_GR_data"("Guild","Season","userId","displayName","Name","damageType","damageDealt","encounterId","encounterIndex","loopIndex") SELECT 'SYN-LOCAL','9999','synthetic-export-player','Synthetic Shared Alias','Synthetic Boss','Battle',1,0,0,1 FROM generate_series(1,1001);`
  )
  const bounded = await rest('rpc/get_user_data_for_export', {
    p_user_id: subject
  })
  assert.equal(bounded.status, 200)
  const limited = await bounded.json()
  assert.equal(limited.data.battle_data.length, 1000)
  assert.equal(limited.data_summary.battle_limit, 1000)
  checks.push(
    '1,002 matching battle rows produce exactly the documented 1,000-row limit; actual workspace credentials are absent'
  )
  // Hold a real canonical export input, then kill the compiled application after
  // the worker commits processing state and reaches the blocked RPC.
  holder = spawn(
    config.binaries.psql,
    [
      '-X',
      '-v',
      'ON_ERROR_STOP=1',
      '-h',
      '127.0.0.1',
      '-p',
      String(services.ports.db),
      '-U',
      'desktop_owner',
      '-d',
      'postgres',
      '-At'
    ],
    {
      env: {
        PATH: process.env.PATH,
        LD_LIBRARY_PATH: config.libraryPath,
        PGPASSWORD: credentials.owner
      },
      stdio: ['pipe', 'pipe', 'ignore']
    }
  )
  const locked = new Promise((resolve, reject) => {
    let output = ''
    holder.stdout.on('data', (bytes) => {
      output += bytes
      if (output.split('\n').includes('locked')) resolve()
    })
    holder.once('error', reject)
    holder.once('exit', () =>
      reject(new Error('Export control lock exited early'))
    )
  })
  holder.stdin.end(
    "BEGIN; LOCK TABLE public.gdpr_processing_log IN ACCESS EXCLUSIVE MODE; SELECT 'locked'; SELECT pg_sleep(120); ROLLBACK;"
  )
  await Promise.race([
    locked,
    delay(10000).then(() => {
      throw new Error('Export control lock timeout')
    })
  ])
  const interruptedId = (
    await (await request('/api/gdpr/my-data', {}, { cookie })).json()
  ).requestId
  const claim = await enqueue('interrupted')
  const interrupted = tick().then(
    () => null,
    () => null
  )
  let reached = false
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    reached =
      (
        await services.psql(
          "SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%get_user_data_for_export%';"
        )
      ).trim() === '1'
    if (reached) break
    await delay(100)
  }
  assert(reached, 'Canonical export RPC must reach the real database lock')
  assert.equal(
    (
      await services.psql(
        `SELECT status FROM public.gdpr_data_exports WHERE request_id=${quote(interruptedId)};`
      )
    ).trim(),
    'processing'
  )
  const exited = new Promise((resolve) => application.once('exit', resolve))
  application.kill('SIGKILL')
  await exited
  await interrupted
  await stop()
  await start()
  session = await login()
  assert.equal(
    (
      await services.psql(
        `SELECT status FROM public.gdpr_data_exports WHERE request_id=${quote(interruptedId)};`
      )
    ).trim(),
    'processing'
  )
  await services.psql(
    `UPDATE public.work_queue SET claimed_at=now()-interval '601 seconds' WHERE dedupe_key=${quote(claim)};`
  )
  assert.equal((await tick()).status, 200)
  assert.equal(
    (
      await services.psql(
        `SELECT status||':'||attempts FROM public.work_queue WHERE dedupe_key=${quote(claim)};`
      )
    ).trim(),
    'completed:2'
  )
  assert.equal(
    (
      await request(`/api/gdpr/my-data/${interruptedId}/download`, undefined, {
        cookie
      })
    ).status,
    200
  )
  checks.push(
    'compiled application killed during a blocked canonical export RPC; durable request and claim survive restart and actual reaper retries successfully'
  )
  await services.psql(
    `INSERT INTO public.gdpr_processing_log(user_id,data_type,processing_purpose,legal_basis) VALUES(${quote(subject)},'synthetic-oversize',repeat('x',9000000),'consent');`
  )
  const largeId = (
    await (await request('/api/gdpr/my-data', {}, { cookie })).json()
  ).requestId
  await enqueue('oversize')
  assert.equal((await tick()).status, 200)
  assert.equal(
    (
      await services.psql(
        `SELECT status||':'||coalesce(download_url,'absent') FROM public.gdpr_data_exports WHERE request_id=${quote(largeId)};`
      )
    ).trim(),
    'failed:absent'
  )
  assert.equal(
    (
      await request(`/api/gdpr/my-data/${largeId}/download`, undefined, {
        cookie
      })
    ).status,
    404
  )
  checks.push(
    'actual oversized collection becomes a terminal failed request without publishing a package or blocking worker completion'
  )

  const evidence = {
    status: 'passed',
    checks,
    scope:
      'Compiled desktop routes and worker with real native Auth/PostgREST and synthetic data. Installed save-dialog acceptance is separate.'
  }
  await writeFile(
    config.evidence.replace(/\.json$/, '-data-export.json'),
    JSON.stringify(evidence, null, 2),
    { mode: 0o600 }
  )
  console.log(JSON.stringify(evidence, null, 2))
} finally {
  await stop()
}
