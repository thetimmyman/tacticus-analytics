import { strict as assert } from 'node:assert'
import { readFile, writeFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import { createServer } from 'node:net'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { createClient } from '@supabase/supabase-js'
import { nativeServices } from './native-services.mjs'
import { loopbackGateway } from './loopback-gateway.mjs'
import { localJobScheduler } from '../launcher/job-scheduler.mjs'
const config = JSON.parse(await readFile(process.argv[2], 'utf8'))
assert(
  config.application?.node && config.application?.directory,
  'A compiled desktop application is required'
)
let services, gateway, application, holder, transportKey, cronSecret
const credentials = []
async function start() {
  services = await nativeServices(config)
  transportKey = randomBytes(32).toString('hex')
  cronSecret = randomBytes(32).toString('hex')
  credentials.push(cronSecret, services.serviceCredential)
  gateway = await loopbackGateway({ services, transportKey })
  const listener = createServer()
  await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve))
  const port = listener.address().port
  await new Promise((resolve) => listener.close(resolve))
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
      NEXT_PUBLIC_SUPABASE_URL: `${gateway.origin}/supabase`,
      SUPABASE_URL: `${gateway.origin}/supabase`,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'desktop-public',
      SUPABASE_SERVICE_ROLE_KEY: services.serviceCredential,
      DESKTOP_TRANSPORT_KEY: transportKey,
      CRON_SECRET: cronSecret
    },
    config.application.directory
  )
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    if (services.fault) throw new Error('Native application stopped')
    try {
      if ((await request('/api/health')).ok) return
    } catch {}
    await delay(100)
  }
  throw new Error('Application health timeout')
}
const request = (path, init = {}) =>
  fetch(`${gateway.origin}${path}`, {
    ...init,
    headers: {
      ...Object.fromEntries(new Headers(init.headers)),
      'x-desktop-transport': transportKey
    },
    signal: init.signal || AbortSignal.timeout(20000)
  })
const tick = () =>
  request('/api/desktop/jobs', {
    method: 'POST',
    headers: { authorization: `Bearer ${cronSecret}` }
  })
async function stop() {
  if (holder && holder.exitCode === null && holder.signalCode === null)
    holder.kill('SIGTERM')
  await gateway?.stop()
  gateway = undefined
  await services?.stop()
  services = undefined
}
const key = `SYN-JOB-RECOVERY-${randomUUID()}`
try {
  await start()
  const before = (
    await services.psql('SELECT count(*) FROM public.work_queue;')
  ).trim()
  assert.equal(
    (await request('/api/desktop/jobs', { method: 'POST' })).status,
    401
  )
  assert.equal(
    (await services.psql('SELECT count(*) FROM public.work_queue;')).trim(),
    before
  )
  await assert.rejects(
    services.psql(
      "INSERT INTO public.work_queue(job_type,job_class,dedupe_key) VALUES('guild-sync','sync','SYN-DENIED-INTEGRATION');"
    )
  )
  const owner = JSON.parse(
    await readFile(join(services.state, 'credentials.json'), 'utf8')
  )
  credentials.push(...Object.values(owner))
  async function holdTable(table) {
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
          PGPASSWORD: owner.owner,
          PGCONNECT_TIMEOUT: '3'
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
        reject(new Error('Control database lock exited early'))
      )
    })
    holder.stdin.end(
      `BEGIN; LOCK TABLE public.${table} IN ACCESS EXCLUSIVE MODE; SELECT 'locked'; SELECT pg_sleep(120); ROLLBACK;`
    )
    await Promise.race([
      locked,
      delay(10000).then(() => {
        throw new Error('Control database lock timeout')
      })
    ])
  }
  await holdTable('public_guild_snapshots')
  await services.psql(
    `INSERT INTO public.work_queue(job_type,job_class,dedupe_key) VALUES('refresh-explore-snapshots','hook','${key}');`
  )
  const interrupted = tick().then(
    (response) => ({ status: response.status }),
    () => ({ interrupted: true })
  )
  const deadline = Date.now() + 15000
  let blocked = false
  while (Date.now() < deadline) {
    blocked =
      (
        await services.psql(
          "SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%manual_refresh_guild_snapshots%';"
        )
      ).trim() === '1'
    if (blocked) break
    await delay(100)
  }
  assert(
    blocked,
    'real canonical handler did not reach the controlled database lock'
  )
  assert.equal(
    (
      await services.psql(
        `SELECT status||':'||attempts FROM public.work_queue WHERE dedupe_key='${key}';`
      )
    ).trim(),
    'processing:1'
  )
  const appExit = new Promise((resolve) => application.once('exit', resolve))
  application.kill('SIGKILL')
  await appExit
  await interrupted
  await stop()
  await start()
  assert.equal(
    (
      await services.psql(
        `SELECT status||':'||attempts FROM public.work_queue WHERE dedupe_key='${key}';`
      )
    ).trim(),
    'processing:1'
  )
  // Advance only the synthetic claim timestamp to exercise the real 600-second policy without a ten-minute test delay.
  await services.psql(
    `UPDATE public.work_queue SET claimed_at=now()-interval '601 seconds' WHERE dedupe_key='${key}';`
  )
  const completed = await tick()
  assert.equal(completed.status, 200)
  assert.equal((await completed.json()).jobsSucceeded, 1)
  assert.equal(
    (
      await services.psql(
        `SELECT status||':'||attempts FROM public.work_queue WHERE dedupe_key='${key}';`
      )
    ).trim(),
    'completed:2'
  )
  assert.equal(
    (
      await services.psql('SELECT count(*) FROM public.public_guild_snapshots;')
    ).trim(),
    '3'
  )
  assert.equal(
    (
      await services.psql(
        "SELECT rolcanlogin::text||':'||rolbypassrls::text FROM pg_roles WHERE rolname='desktop_snapshot_owner';"
      )
    ).trim(),
    'false:false'
  )
  const account = JSON.parse(
    await readFile(join(services.state, 'synthetic-account.json'), 'utf8')
  )
  assert(
    typeof account.email === 'string' &&
      account.email.endsWith('.invalid') &&
      typeof account.password === 'string',
    'The journey requires its synthetic account fixture'
  )
  const client = createClient(`${gateway.origin}/supabase`, 'desktop-public', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (url, init) =>
        fetch(url, {
          ...init,
          headers: {
            ...Object.fromEntries(new Headers(init?.headers)),
            'x-desktop-transport': transportKey
          }
        })
    }
  })
  assert.equal(
    (
      await client.auth.signInWithPassword({
        email: account.email,
        password: account.password
      })
    ).error,
    null
  )
  const snapshots = await client
    .from('public_guild_snapshots')
    .select('guild_code,total_damage')
  assert.equal(snapshots.error, null)
  assert.deepEqual(snapshots.data, [
    { guild_code: 'SYN001', total_damage: 625 }
  ])
  assert(
    (
      await client.rpc('claim_next_work_job', {
        p_worker_id: 'forged',
        p_classes: ['hook']
      })
    ).error
  )
  assert((await client.from('work_queue').select('id')).error)
  await holdTable('work_queue')
  let failures = 0
  const scheduler = localJobScheduler({
    services,
    origin: gateway.origin,
    transportKey,
    cronSecret,
    onFailure: () => {
      failures++
    }
  })
  try {
    scheduler.start()
    await delay(100)
    const drainedAt = Date.now()
    await scheduler.stop()
    assert(
      Date.now() - drainedAt < 7000,
      'Queue lock must not prevent bounded scheduler shutdown'
    )
    assert.equal(
      failures,
      0,
      'Intentional cancellation is not a background failure'
    )
    assert.equal((await services.psql('SELECT 1;')).trim(), '1')
  } finally {
    await scheduler.stop()
    holder.kill('SIGTERM')
  }
  for (const file of await readdir(services.state))
    if (file.endsWith('.log')) {
      const bytes = await readFile(join(services.state, file), 'utf8')
      assert(
        credentials.every((value) => !bytes.includes(value)),
        'Administrative credential reached native application logs'
      )
    }
  const evidence = {
    status: 'passed',
    checks: [
      'unauthorized local worker API cannot claim or enqueue work',
      'unclassified integration job type rejected before execution',
      'real application killed while canonical snapshot handler waits on a database lock',
      'durable processing claim survives the native stack restart',
      'canonical expired-claim reaper and real API worker complete retry at attempts=2',
      'canonical local snapshots preserve expected damage and authenticated guild scope',
      'normal caller cannot read the administrative queue or claim work',
      'snapshot owner has no login or RLS bypass',
      'locked queue seed drains within its bounded wait on scheduler shutdown',
      'administrative and scheduler credentials absent from native application logs'
    ],
    scope:
      'compiled desktop application and native services with eight synthetic rows; controlled expiry timestamp, not a physical ten-minute suspend or all application jobs'
  }
  if (config.evidence)
    await writeFile(
      config.evidence.replace(/\.json$/, '-jobs.json'),
      JSON.stringify(evidence, null, 2),
      { mode: 0o600 }
    )
  console.log(JSON.stringify(evidence, null, 2))
} finally {
  await stop()
}
