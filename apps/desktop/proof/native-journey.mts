import { strict as assert } from 'node:assert'
import { randomBytes } from 'node:crypto'
import { readFile, writeFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { nativeServices } from './native-services.mjs'
import { electronDisplay } from '../launcher/display.mjs'
import { loopbackGateway } from './loopback-gateway.mjs'
import { workspaceGameConnection } from '../launcher/game-connection.mjs'
import { proveMetaRoleBoundaries } from './meta-role-boundaries.mjs'
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
const gateway = await loopbackGateway({
  services,
  transportKey,
  handleLocalRequest: workspaceGameConnection(services, {
    brokerToken: randomBytes(32).toString('hex')
  })
})
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
  const admin = client(services.serviceCredential)
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
  await proveMetaRoleBoundaries(services, account.id)
  evidence.metaRoleBoundaries =
    'Self declarations and timestamps, same-guild leader overrides, foreign membership isolation, forged setter and automated-write refusal; synthetic transactions rolled back'
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
  if (config.corePages === true) {
    const trends = await user.rpc('get_guild_trends_batch', {
      p_guild_code: 'SYN001',
      p_seasons: ['9999']
    })
    assert.equal(trends.error, null)
    assert.equal(trends.data?.length, 1)
    for (const [field, value] of Object.entries({
      total_damage: 400,
      total_battles: 6,
      max_hit: 200,
      active_players: 2,
      guild_member_count: 2,
      participation_rate: 100,
      avg_damage_per_token: 100,
      vs_cluster_percent: -20,
      guild_rank_in_cluster: 1,
      total_guilds_in_cluster: 2
    }))
      assert.equal(trends.data[0][field], value)
    for (const [name, extra] of [
      ['get_boss_difficulty_analysis', {}],
      ['get_damage_by_boss_loop', {}],
      ['get_token_usage_by_loop', {}],
      ['get_guild_vs_cluster_prime_performance', {}],
      ['get_token_usage_by_loop_and_set', {}],
      ['get_guild_trends_batch', { p_seasons: ['9999'] }],
      ['get_boss_performance_overview', { p_level: 'L1' }]
    ] as const) {
      const args = {
        p_guild_code: 'SYN003',
        ...(name === 'get_guild_trends_batch' ? {} : { p_season: '9999' }),
        ...extra
      }
      const response = await user.rpc(name, args)
      assert.equal(response.error, null)
      assert.ok(
        name === 'get_boss_performance_overview'
          ? response.data === null
          : response.data.length === 0
      )
      assert.ok((await anon.rpc(name, args)).error)
    }
    const statsArgs = {
      p_guild_code: 'SYN001',
      p_season: '9999',
      p_display_name: 'SyntheticPlayer-A'
    }
    assert.ok(
      (await user.rpc('get_player_stats_comprehensive', statsArgs)).error
    )
    const stats = await admin.rpc('get_player_stats_comprehensive', statsArgs)
    assert.equal(stats.error, null)
    assert.equal(stats.data.totalDamage, 525)
    assert.equal(stats.data.tokensUsed, 4)
    assert.equal(stats.data.avgDamagePerHit, 150)
    const rankings = await user.rpc('get_player_boss_rankings', {
      p_player_name: 'SyntheticPlayer-A',
      p_guild_code: 'SYN001',
      p_cluster_code: 'SYN-CLUSTER',
      p_season: '9999'
    })
    assert.equal(rankings.error, null)
    assert.equal(rankings.data?.length, 1)
    assert.equal(rankings.data[0].player_rank, 2)
    assert.equal(rankings.data[0].total_players, 3)
    for (const table of [
      'meta_teams',
      'hero_mappings',
      'player_avatar_frames',
      'boss_mapping'
    ]) {
      assert.equal((await user.from(table).select('*')).error, null)
      assert.ok((await user.from(table).insert({})).error)
    }
  }
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
        SUPABASE_SERVICE_ROLE_KEY: services.serviceCredential,
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
    for (const path of [
      '/api/player-api-key',
      '/api/player-api-key/sync',
      '/api/guild/update-api-key',
      '/api/guild/replace-api-key',
      '/api/guild/validate-api-key',
      '/api/player/test-api-key',
      '/api/admin/player-api-key',
      '/api/onboarding/validate-player-key',
      '/api/profile/change-player-id'
    ]) {
      const denied = await request(gateway.origin + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ apiKey: 'synthetic-forbidden-renderer-key' })
      })
      assert.equal(
        denied.status,
        409,
        'Hosted credential operation refused before application authentication or body processing'
      )
      assert.equal(
        (await denied.json()).error,
        'Use File → Game connection for native credential operations.'
      )
    }
    ;(evidence.checks as string[]).push(
      'hosted credential endpoints refuse renderer key operations in desktop mode'
    )
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
      !html.includes(transportKey) &&
        !html.includes(services.serviceCredential),
      'No privileged secret in renderer HTML'
    )
    evidence.application = {
      api: 'canonical historical-performance HTTP route matches direct orchestrator',
      page: 'existing player-performance server render succeeds; interactive hydration not yet proven',
      anonymousApi: 401,
      unprotectedInternalPort: 403
    }
    if (config.application.electron) {
      if (config.rendererWake) {
        // Earlier HTTP assertions may refresh short-lived sessions. Seed the
        // browser with a current login rather than an unconsumed response cookie.
        const current = await ssr.auth.signInWithPassword({
          email: account.email,
          password: account.password
        })
        assert.equal(current.error, null)
      }
      const rendererConfig = join(services.state, 'renderer-config.json')
      await writeFile(
        rendererConfig,
        JSON.stringify({
          url: `${gateway.origin}/player-performance?guild=SYN001&season=9999`,
          transportKey,
          state: services.state,
          wake: config.rendererWake ? { expected: result } : undefined,
          corePages: config.corePages === true,
          cookies,
          screenshot: config.application.screenshot,
          evidence: config.application.rendererEvidence
        }),
        { mode: 0o600 }
      )
      const display = electronDisplay()
      const renderer = services.launch(
        config.application.electron,
        [config.application.shell, rendererConfig, ...display.args],
        {
          PATH: process.env.PATH,
          LANG: 'C.UTF-8',
          HOME: homedir(),
          XDG_CACHE_HOME: join(services.state, 'cache'),
          DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS,
          ...display.environment
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
      if (config.rendererWake) assert.equal(observed.wake?.status, 'passed')
      assert.equal(observed.renderer.nodeAccess, false)
      assert.ok(observed.renderer.text.includes('SyntheticPlayer-A'))
      assert.ok(observed.renderer.text.includes('+58%'))
      assert.ok(observed.renderer.text.includes('SyntheticPlayer-B'))
      assert.ok(observed.renderer.text.includes('-50%'))
      assert.ok(!observed.renderer.text.includes('Service Disruption'))
      if (config.corePages === true) {
        assert.equal(observed.corePages.length, 6)
        for (const page of observed.corePages) {
          assert.equal(page.nodeAccess, false)
          assert.ok(!page.text.includes('Supabase Warning'))
          assert.ok(!page.text.includes('Service Disruption'))
        }
        const page = (path: string) =>
          observed.corePages.find((entry: { path: string }) =>
            entry.path.startsWith(path)
          )?.text as string
        assert.ok(page('/dashboard').includes('TOTAL DAMAGE\n625'))
        assert.ok(page('/guild-trends').includes('#1/2'))
        assert.ok(page('/guild-trends').includes('-20%'))
        assert.ok(page('/player-stats').includes('Total Damage\n525'))
        assert.ok(page('/player-stats').includes('Tokens Used\n4'))
        assert.ok(page('/boss').includes('AVERAGE DAMAGE\n100'))
        assert.ok(
          observed.corePages
            .find((entry: { path: string }) =>
              entry.path.startsWith('/token-usage')
            )
            ?.title.includes('Access Denied')
        )
        assert.ok(page('/roster').includes('Native game connection'))
        assert.ok(page('/roster').includes('No saved roster yet'))
      }
      assert.deepEqual(
        observed.failures.filter(
          (failure: { path: string; status: number }) =>
            !(failure.path === '/api/guild-tokens' && failure.status === 403) &&
            !(
              observed.wake?.status === 'passed' &&
              failure.path === '/supabase/rest/v1/EOT_GR_data' &&
              failure.query === '?select=id' &&
              failure.status === 401
            )
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
  const credentials = JSON.parse(
    await readFile(join(services.state, 'credentials.json'), 'utf8')
  )
  const administrativeSecrets = [
    ...Object.values(credentials),
    services.serviceCredential
  ] as string[]
  assert.ok(
    administrativeSecrets.every(
      (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
    ),
    'Administrative credentials have the expected private format'
  )
  const noAdministrativeSecret = (content: string) =>
    assert.ok(
      administrativeSecrets.every((value) => !content.includes(value)),
      'Administrative credential reached logs, renderer configuration or process arguments'
    )
  for (const file of await readdir(services.state)) {
    if (/\.log$|^renderer-config\.json$/.test(file))
      noAdministrativeSecret(await readFile(join(services.state, file), 'utf8'))
  }
  for (const child of [services.supervisor, ...services.children]) {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null)
      continue
    noAdministrativeSecret(await readFile(`/proc/${child.pid}/cmdline`, 'utf8'))
  }
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
    'interrupted import rollback',
    'administrative credentials absent from native logs, renderer configuration and owned process arguments'
  ]
  await writeFile(config.evidence, JSON.stringify(evidence, null, 2), {
    mode: 0o600
  })
  console.log(JSON.stringify(evidence, null, 2))
} finally {
  await gateway.stop()
  await services.stop()
}
