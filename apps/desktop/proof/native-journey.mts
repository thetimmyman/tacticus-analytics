import { strict as assert } from 'node:assert'
import { randomBytes } from 'node:crypto'
import { readFile, writeFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { nativeServices } from './native-services.mjs'
import { loopbackGateway } from './loopback-gateway.mjs'
import {
  syntheticRaidFixture,
  importSyntheticRaid
} from './synthetic-import.mjs'
import { fetchHistoricalPerformance } from '../../../app/lib/player-stats/fetchHistoricalPerformance'

const config = JSON.parse(await readFile(process.argv[2], 'utf8'))
const startedAt = performance.now()
const services = await nativeServices(config)
const nativeReadyMs = performance.now() - startedAt
const transportKey = randomBytes(32).toString('hex')
const gateway = await loopbackGateway({ services, transportKey })
const request: typeof fetch = (url, init) =>
  fetch(url, {
    ...init,
    headers: {
      ...Object.fromEntries(new Headers(init?.headers)),
      'x-desktop-transport': transportKey
    }
  })
const client = (key: string) =>
  createClient(`${gateway.origin}/supabase`, key, {
    global: { fetch: request },
    auth: { persistSession: false, autoRefreshToken: false }
  })
const evidence: Record<string, unknown> = {
  network: 'isolated loopback-only Linux network namespace',
  services: 'native PostgreSQL, Supabase Auth and PostgREST',
  checks: [],
  timings: { nativeReadyMs }
}
try {
  await assert.rejects(
    fetch('https://example.invalid', { signal: AbortSignal.timeout(2000) })
  )
  assert.equal((await fetch(`${gateway.origin}/supabase/rest/v1/`)).status, 403)
  assert.equal(
    (
      await request(`${gateway.origin}/supabase/rest/v1/`, {
        headers: { Origin: 'https://foreign.invalid' }
      })
    ).status,
    403
  )
  await assert.rejects(nativeServices(config), /EEXIST/)
  const admin = client(services.token.service)
  let account
  try {
    account = JSON.parse(
      await readFile(join(services.state, 'synthetic-account.json'), 'utf8')
    )
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    const password = randomBytes(24).toString('hex')
    const { data, error: createError } = await admin.auth.admin.createUser({
      email: 'synthetic@example.invalid',
      password,
      email_confirm: true
    })
    assert.equal(createError, null)
    assert.ok(data.user)
    account = { email: 'synthetic@example.invalid', password, id: data.user.id }
    await writeFile(
      join(services.state, 'synthetic-account.json'),
      JSON.stringify(account),
      { mode: 0o600 }
    )
    const fixture = syntheticRaidFixture(data.user.id)
    await assert.rejects(
      importSyntheticRaid(services, {
        ...fixture,
        rows: fixture.rows.map((row: unknown, i: number) =>
          i === 0 ? { ...(row as object), damageDealt: -1 } : row
        )
      })
    )
    await importSyntheticRaid(services, fixture)
  }
  const user = client('desktop-public')
  const login = await user.auth.signInWithPassword({
    email: account.email,
    password: account.password
  })
  assert.equal(login.error, null)
  assert.equal(login.data.user?.id, account.id)
  const raw = await user.from('EOT_GR_data').select('id, Guild').order('id')
  assert.equal(raw.error, null)
  assert.equal(raw.data?.length, 7)
  assert.ok(raw.data?.every((row) => row.Guild !== 'SYN003'))
  const denied = await user
    .from('EOT_GR_data')
    .select('id')
    .eq('Guild', 'SYN003')
  assert.equal(denied.error, null)
  assert.deepEqual(denied.data, [])
  const foreignAverage = await user.rpc('get_guild_boss_averages_batch', {
    p_guild_code: 'SYN003',
    p_seasons: ['9999']
  })
  assert.equal(foreignAverage.error, null)
  assert.deepEqual(foreignAverage.data, [])
  const authority = await user.rpc('resolve_verified_players', {
    p_user_ids: [account.id]
  })
  assert.ok(authority.error, 'Authority resolver must remain service-only')
  const owned = await admin.rpc('resolve_verified_players', {
    p_user_ids: [account.id]
  })
  assert.equal(owned.error, null)
  assert.equal(owned.data?.length, 1)
  const anon = client('desktop-public')
  assert.ok((await anon.from('EOT_GR_data').select('id')).error)
  const inputs = {
    supabase: user,
    playerName: 'SyntheticPlayer-A',
    guildCode: 'SYN001',
    season: '9999',
    playerClusterCode: 'SYN-CLUSTER'
  }
  const result = await fetchHistoricalPerformance(inputs)
  assert.ok(
    Math.abs(result.performance['9999'].vsGuild - 58.333333333333336) < 0.00001
  )
  assert.ok(
    Math.abs(result.performance['9999'].vsCluster - 26.66666666666666) < 0.00001
  )
  assert.equal(result.performance['9999'].clusterRank, 2)
  assert.equal(result.performance['9999'].guildRank, 1)
  assert.equal(result.tokens['9999'], 4)
  assert.equal(result.totalDamage['9999'], 131.25)
  assert.equal(result.reliability['9999'], 66.7)
  const empty = await fetchHistoricalPerformance({
    ...inputs,
    playerName: 'SyntheticMissing'
  })
  assert.ok(
    Object.values(empty.performance).every(
      (row) =>
        row.vsGuild === 0 &&
        row.vsCluster === 0 &&
        row.hasGuildComparison === false &&
        row.bossDetails?.length === 0
    )
  )
  assert.ok(Object.values(empty.tokens).every((value) => value === 0))
  const missingRpc = await user.rpc('synthetic_missing_rpc')
  assert.equal(missingRpc.error?.code, 'PGRST202')
  if (config.application) {
    const portServer = createServer()
    await new Promise<void>((accept) =>
      portServer.listen(0, '127.0.0.1', accept)
    )
    const appPort = (portServer.address() as { port: number }).port
    await new Promise<void>((accept) => portServer.close(() => accept()))
    gateway.setAppPort(appPort)
    services.launch(
      config.application.node,
      [join(config.application.directory, 'server.js')],
      {
        PATH: process.env.PATH,
        NODE_ENV: 'production',
        HOSTNAME: '127.0.0.1',
        PORT: String(appPort),
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
      config.application.directory
    )
    let up = false
    for (let i = 0; i < 100; i++) {
      try {
        if (
          (
            await fetch(
              `http://127.0.0.1:${appPort}/api/player-stats/historical-performance`
            )
          ).status === 403
        ) {
          up = true
          break
        }
      } catch {}
      await delay(100)
    }
    assert.ok(up, 'Standalone application readiness')
    const cookies: Array<{ name: string; value: string }> = []
    const ssr = createServerClient(
      `${gateway.origin}/supabase`,
      'desktop-public',
      {
        global: { fetch: request },
        auth: { storageKey: 'tacticus-auth-token' },
        cookies: {
          getAll: () => cookies,
          setAll: (values) => {
            cookies.splice(0, cookies.length, ...values)
          }
        }
      }
    )
    const signedIn = await ssr.auth.signInWithPassword({
      email: account.email,
      password: account.password
    })
    assert.equal(signedIn.error, null)
    const cookie = cookies
      .map(({ name, value }) => `${name}=${value}`)
      .join('; ')
    const response = await request(
      `${gateway.origin}/api/player-stats/historical-performance?player=SyntheticPlayer-A&guild_code=SYN001&season=9999&cluster_code=SYN-CLUSTER`,
      { headers: { Cookie: cookie } }
    )
    const actual = await response.json()
    assert.equal(response.status, 200, JSON.stringify(actual))
    assert.deepEqual(actual, result)
    const withoutSession = await request(
      `${gateway.origin}/api/player-stats/historical-performance?player=SyntheticPlayer-A&guild_code=SYN001&season=9999`
    )
    assert.equal(withoutSession.status, 401)
    const page = await request(
      `${gateway.origin}/player-performance?guild=SYN001&season=9999`,
      { headers: { Cookie: cookie } }
    )
    const html = await page.text()
    assert.equal(page.status, 200)
    assert.ok(html.includes('Player Performance'))
    assert.ok(
      !html.includes(transportKey) && !html.includes(services.token.service),
      'No privileged secret in renderer HTML'
    )
    evidence.application = {
      api: 'canonical historical-performance HTTP route matches direct orchestrator',
      page: 'existing player-performance server render succeeds; interactive hydration not yet proven',
      anonymousApi: 401,
      unprotectedInternalPort: 403
    }
    if (config.application.electron) {
      const rendererConfig = join(services.state, 'renderer-config.json')
      await writeFile(
        rendererConfig,
        JSON.stringify({
          url: `${gateway.origin}/player-performance?guild=SYN001&season=9999`,
          transportKey,
          cookies,
          screenshot: config.application.screenshot,
          evidence: config.application.rendererEvidence
        }),
        { mode: 0o600 }
      )
      const renderer = services.launch(
        config.application.electron,
        [config.application.shell, rendererConfig, '--ozone-platform=wayland'],
        {
          PATH: process.env.PATH,
          LANG: 'C.UTF-8',
          XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR,
          WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY
        },
        services.state,
        true
      )
      const exit = await new Promise<number | null>((accept, reject) => {
        renderer.once('exit', accept)
        renderer.once('error', reject)
      })
      assert.equal(exit, 0, 'Sandboxed renderer proof')
      const observed = JSON.parse(
        await readFile(config.application.rendererEvidence, 'utf8')
      )
      assert.equal(observed.renderer.nodeAccess, false)
      assert.ok(observed.renderer.text.includes('SyntheticPlayer-A'))
      assert.ok(observed.renderer.text.includes('+58%'))
      assert.ok(observed.renderer.text.includes('SyntheticPlayer-B'))
      assert.ok(observed.renderer.text.includes('-50%'))
      assert.ok(!observed.renderer.text.includes('Service Disruption'))
      assert.deepEqual(
        observed.failures.filter(
          (failure: { path: string; status: number }) =>
            !(failure.path === '/api/guild-tokens' && failure.status === 403)
        ),
        [],
        'No unexpected failed renderer requests'
      )
      assert.deepEqual(observed.consoleErrors, [])
      assert.deepEqual(observed.blocked, [])
      const health = await fetch(`${gateway.origin}/api/health`, {
        headers: { 'x-desktop-transport': transportKey }
      })
      assert.equal((await health.json()).status, 'healthy')
      evidence.application.page =
        'sandboxed existing page hydrates and renders both expected synthetic player scores'

      const processes = []
      for (const entry of await readdir('/proc')) {
        if (!/^\d+$/.test(entry)) continue
        try {
          const status = await readFile(`/proc/${entry}/status`, 'utf8')
          processes.push({
            pid: Number(entry),
            parent: Number(status.match(/^PPid:\s+(\d+)/m)?.[1]),
            name: status.match(/^Name:\s+(.+)$/m)?.[1],
            rssKiB: Number(status.match(/^VmRSS:\s+(\d+)/m)?.[1] ?? 0)
          })
        } catch {
          /* Processes can exit between enumeration and inspection. */
        }
      }
      const owned = new Set([process.pid])
      let changed = true
      while (changed) {
        changed = false
        for (const entry of processes)
          if (owned.has(entry.parent) && !owned.has(entry.pid)) {
            owned.add(entry.pid)
            changed = true
          }
      }
      evidence.processesAfterRendererExit = processes.filter((entry) =>
        owned.has(entry.pid)
      )
      evidence.renderer = observed
    }
  }
  const count = (
    await services.psql('SELECT count(*) FROM public."EOT_GR_data";')
  ).trim()
  await assert.rejects(
    services.psql(
      'BEGIN; INSERT INTO public."EOT_GR_data"(id,"Guild","encounterId","damageDealt") VALUES(99,\'SYN001\',0,1); INSERT INTO public."EOT_GR_data"(id,"Guild","encounterId","damageDealt") VALUES(100,\'SYN001\',0,-1); COMMIT;'
    )
  )
  assert.equal(
    (await services.psql('SELECT count(*) FROM public."EOT_GR_data";')).trim(),
    count
  )
  evidence.result = result
  evidence.checks = [
    'external access blocked',
    'missing transport denied',
    'foreign Origin denied',
    'second instance denied',
    'native Auth identity/login',
    'validated transactional persisted import',
    'authenticated RLS reads',
    'foreign guild raw and definer reads denied',
    'service-only authority resolver',
    'anonymous read denied',
    'canonical orchestrator and four analytical RPCs',
    'empty player',
    'interrupted import rollback'
  ]
  await writeFile(config.evidence, JSON.stringify(evidence, null, 2), {
    mode: 0o600
  })
  console.log(JSON.stringify(evidence, null, 2))
} finally {
  await gateway.stop()
  await services.stop()
}
