import assert from 'node:assert/strict'
import { createServerClient } from '@supabase/ssr'
import { randomBytes, randomUUID } from 'node:crypto'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { nativeServices } from './native-services.mjs'
import { loopbackGateway } from './loopback-gateway.mjs'
import { workspaceSetup } from '../launcher/workspace.mjs'
import { syntheticRosterUnit } from './synthetic-roster.mjs'
import { initializeReferenceHeroes } from '../launcher/reference-catalog.mjs'

const config = JSON.parse(await readFile(process.argv[2], 'utf8'))
assert(config.application, 'Compiled application required')
const state = join(config.stateRoot || config.state, `roster-${randomUUID()}`)
const services = await nativeServices({ ...config, state })
const key = randomBytes(32).toString('hex'),
  cron = randomBytes(32).toString('hex')
const brokerToken = randomBytes(32).toString('hex'),
  password = randomBytes(24).toString('hex')
const listener = createServer()
await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve))
const port = listener.address().port
await new Promise((resolve) => listener.close(resolve))
const gateway = await loopbackGateway({
  services,
  transportKey: key,
  handleLocalRequest: workspaceSetup(
    services,
    new URL('../launcher', import.meta.url).pathname,
    {
      brokerToken,
      normalizeRoster: async (contents, subject) => {
        const response = await fetch(
          `http://127.0.0.1:${port}/api/desktop/normalize-roster`,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${cron}`,
              'x-desktop-transport': key
            },
            body: JSON.stringify({ contents, subject }),
            signal: AbortSignal.timeout(20000)
          }
        )
        assert.equal(response.status, 200, 'Canonical normalization succeeds')
        return response.json()
      }
    }
  )
})
gateway.setAppPort(port)
const request = (path, body, extra = {}) =>
  fetch(gateway.origin + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'x-desktop-transport': key,
      origin: gateway.origin,
      'content-type': 'application/json',
      ...extra
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`
const evidence = { status: 'passed', checks: [] }
let expected
try {
  const application = services.launch(
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
  let ready = false
  for (let i = 0; i < 150; i++) {
    assert(
      application.exitCode === null && !services.fault,
      'Local application alive'
    )
    try {
      if ((await request('/api/health')).ok) {
        ready = true
        break
      }
    } catch {}
    await delay(100)
  }
  assert(ready)
  assert.equal(
    (await request('/api/desktop/normalize-roster', { contents: 'unused' }))
      .status,
    401
  )
  assert.equal(
    (
      await request('/desktop/setup', {
        password,
        sample: false,
        identity: {
          guildCode: 'SYN-LOCAL',
          playerId: 'synthetic-local-player',
          displayName: 'Synthetic Local Alias',
          guildName: 'Synthetic Local Guild'
        }
      })
    ).status,
    201
  )
  const subject = (
    await services.psql(
      'SELECT subject_user_id FROM public.desktop_preview_setup;'
    )
  ).trim()
  const cookies = []
  const ssr = createServerClient(
    `${gateway.origin}/supabase`,
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
  assert.equal(
    (
      await ssr.auth.signInWithPassword({
        email: 'desktop@localhost.invalid',
        password
      })
    ).error,
    null
  )
  const cookie = cookies.map(({ name, value }) => `${name}=${value}`).join('; ')
  const cached = () => request('/api/player/roster', undefined, { cookie })
  const empty = await cached()
  assert.equal(empty.status, 200, await empty.clone().text())
  assert.equal((await empty.json()).cachePresent, false)

  const reference = join(state, 'synthetic-reference')
  await mkdir(join(reference, 'heroes'), { recursive: true, mode: 0o700 })
  for (const unitId of ['syntheticHero', 'syntheticSecond'])
    await writeFile(
      join(reference, 'heroes', unitId + '.json'),
      JSON.stringify({
        gameId: unitId,
        id: unitId + '-engine',
        name: 'Synthetic Reference Hero',
        factionId: 'SyntheticFaction',
        allianceId: 'Imperial',
        traits: []
      }),
      { mode: 0o600 }
    )
  assert.equal(
    (await initializeReferenceHeroes(services, reference)).entries,
    2
  )
  const catalogueBefore = (
    await services.psql(
      'SELECT json_agg(h ORDER BY id) FROM public.hero_mappings h;'
    )
  ).trim()
  await initializeReferenceHeroes(services, reference)
  assert.equal(
    (
      await services.psql(
        'SELECT json_agg(h ORDER BY id) FROM public.hero_mappings h;'
      )
    ).trim(),
    catalogueBefore
  )
  await writeFile(join(reference, 'heroes', 'z-invalid.json'), '{}', {
    mode: 0o600
  })
  await assert.rejects(initializeReferenceHeroes(services, reference))
  assert.equal(
    (
      await services.psql(
        'SELECT json_agg(h ORDER BY id) FROM public.hero_mappings h;'
      )
    ).trim(),
    catalogueBefore
  )
  evidence.checks.push(
    'bundled static reference metadata initializes canonical mapping rows with stable IDs; repeated refresh retains IDs and malformed later definitions make no writes'
  )
  const snapshot = {
    format: 'ta-official-roster-v1',
    guildCode: 'SYN-LOCAL',
    playerName: '<img src=x onerror=alert(1)>',
    powerLevel: 12345,
    units: [
      {
        ...syntheticRosterUnit(),
        progressionIndex: 19,
        rank: 23,
        xpLevel: 55,
        abilities: [
          { id: 'syntheticActive', level: 55 },
          { id: 'syntheticPassive', level: 30 }
        ]
      },
      {
        ...syntheticRosterUnit(),
        id: 'syntheticSecond',
        abilities: [
          ...syntheticRosterUnit().abilities,
          { id: 'syntheticThird', level: 1 }
        ]
      }
    ],
    machinesOfWar: []
  }
  const attempt = async (value, extra = {}) => {
    await delay(3100)
    return request('/desktop/import-roster', value, {
      'x-desktop-broker': brokerToken,
      ...extra
    })
  }
  const contents = JSON.stringify(snapshot)
  assert.equal(
    (await request('/desktop/import-roster', { password, contents })).status,
    403
  )
  assert.equal(
    (
      await request(
        '/desktop/import-roster',
        { password, contents },
        { 'x-desktop-broker': '0'.repeat(64) }
      )
    ).status,
    403
  )
  assert.equal(
    (await attempt({ password: randomBytes(24).toString('hex'), contents }))
      .status,
    401
  )
  assert.equal(
    (
      await attempt({
        password,
        contents: JSON.stringify({ ...snapshot, guildCode: 'SYN-OTHER' })
      })
    ).status,
    409
  )
  assert.equal(
    (
      await attempt({
        password,
        contents: JSON.stringify({
          ...snapshot,
          units: [snapshot.units[0], { ...snapshot.units[1], xpLevel: 32768 }]
        })
      })
    ).status,
    400
  )
  assert.equal(
    (await services.psql('SELECT count(*) FROM public.player_roster;')).trim(),
    '0'
  )
  assert.equal(
    (
      await services.psql(
        'SELECT count(*) FROM public.desktop_roster_snapshots;'
      )
    ).trim(),
    '0'
  )
  evidence.checks.push(
    'native capability, current password, guild binding and complete payload validation precede all writes'
  )
  const imported = await attempt({ password, contents })
  assert.equal(imported.status, 200, await imported.clone().text())
  assert.deepEqual(await imported.json(), { units: 2, mapped: 2, unmapped: 0 })
  const rows = JSON.parse(
    (
      await services.psql(
        'SELECT json_agg(r ORDER BY hero_mapping_id) FROM public.player_roster r;'
      )
    ).trim()
  )
  const retainedId = (
    await services.psql(
      "SELECT r.id FROM public.player_roster r JOIN public.hero_mappings h ON h.id=r.hero_mapping_id WHERE h.unit_id='syntheticHero';"
    )
  ).trim()
  assert.equal(rows.length, 2)
  assert.equal(rows[0].user_id, subject)
  assert.equal(rows[0].stars, 19)
  assert.equal(rows[0].progression_index, 19)
  assert.equal(rows[0].rank_name, 'Mythic III')
  assert.equal(rows[0].xp, 1000)
  assert.equal(rows[0].xp_level, 55)
  assert.equal(rows[0].shards, 100)
  assert.equal(rows[0].active_ability_level, 55)
  assert.equal(rows[0].passive_ability_level, 30)
  assert.deepEqual(rows[0].upgrades, [0, 4])
  assert.equal(rows[0].player_mapping_id, null)
  assert.equal(
    (
      await services.psql(
        'SELECT player_power FROM public.player_mapping WHERE is_current;'
      )
    ).trim(),
    '12345'
  )
  const saved = await cached()
  assert.equal(saved.status, 200, await saved.clone().text())
  const savedBody = await saved.json()
  assert.equal(savedBody.cachePresent, true)
  assert.equal(savedBody.source, 'official-own-key-local-claim')
  assert.equal(savedBody.playerName, snapshot.playerName)
  assert.equal(savedBody.units.length, 2)
  assert.equal(savedBody.units[0].xpLevel, 55)
  assert(Number.isFinite(Date.parse(savedBody.cachedAt)))
  evidence.checks.push(
    'actual authenticated roster API reads an empty or saved local cache without a hosted key or upstream game request'
  )
  const again = await attempt({ password, contents })
  assert.equal(again.status, 200, await again.clone().text())
  assert.deepEqual(
    JSON.parse(
      (
        await services.psql(
          'SELECT json_agg(id ORDER BY hero_mapping_id) FROM public.player_roster;'
        )
      ).trim()
    ),
    rows.map((row) => row.id)
  )
  const normalizedResponse = await request(
    '/api/desktop/normalize-roster',
    { contents, subject },
    { authorization: `Bearer ${cron}` }
  )
  assert.equal(normalizedResponse.status, 200)
  const normalized = (await normalizedResponse.json()).rows
  const fingerprint = () =>
    services.psql(
      'SELECT md5((SELECT json_agg(r ORDER BY id)::text FROM public.player_roster r)|| (SELECT payload::text FROM public.desktop_roster_snapshots));'
    )
  const before = await fingerprint()
  const save = async (who, values) =>
    services.psql(
      `BEGIN; SELECT set_config('request.jwt.claims',${quote(JSON.stringify({ sub: who }))},true); SELECT public.desktop_save_roster(${quote(contents)}::jsonb,${quote(JSON.stringify(values))}::jsonb); COMMIT;`
    )
  await assert.rejects(
    save(subject, [normalized[0], { ...normalized[1], xp_level: 32768 }])
  )
  await assert.rejects(save(randomUUID(), normalized))
  await assert.rejects(
    save(subject, [
      normalized[0],
      { ...normalized[1], source_unit_id: 'syntheticForeign' }
    ])
  )
  assert.equal(await fingerprint(), before)
  for (const role of ['anon', 'authenticated', 'service_role']) {
    await assert.rejects(
      services.psql(
        `SET ROLE ${role}; SELECT public.desktop_save_roster(${quote(contents)}::jsonb,'[]'::jsonb);`
      )
    )
    await assert.rejects(
      services.psql(
        `SET ROLE ${role}; DELETE FROM public.desktop_roster_snapshots;`
      )
    )
    await assert.rejects(
      services.psql(
        `SET ROLE ${role}; INSERT INTO public.player_roster(rank_name) VALUES('synthetic');`
      )
    )
  }
  const readAs = async (who) =>
    (
      await services.psql(
        `BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims',${quote(JSON.stringify({ sub: who }))},true); SELECT 'count:'||count(*) FROM public.desktop_roster_snapshots; ROLLBACK;`
      )
    )
      .split('\n')
      .find((line) => line.startsWith('count:'))
  assert.equal(await readAs(subject), 'count:1')
  assert.equal(await readAs(randomUUID()), 'count:0')
  evidence.checks.push(
    'canonical mapped roster, raw allowlisted cache and player power commit atomically; repeated sync keeps row IDs; malformed later row, foreign subject and forged mapping roll back'
  )
  evidence.checks.push(
    'renderer and service roles cannot execute the writer or mutate cache; authenticated reads are scoped to the current subject'
  )
  const reduced = { ...snapshot, units: [snapshot.units[0]], powerLevel: 54321 }
  const replaced = await attempt({
    password,
    contents: JSON.stringify(reduced)
  })
  assert.equal(replaced.status, 200, await replaced.clone().text())
  assert.deepEqual(await replaced.json(), { units: 1, mapped: 1, unmapped: 0 })
  assert.equal(
    (await services.psql('SELECT count(*) FROM public.player_roster;')).trim(),
    '1'
  )
  assert.equal(
    (await services.psql('SELECT id FROM public.player_roster;')).trim(),
    retainedId
  )
  expected = await fingerprint()
  evidence.checks.push(
    'a replacement snapshot removes obsolete mapped units while retaining stable IDs for retained units'
  )
} finally {
  await gateway.stop()
  await services.stop()
}
const reopened = await nativeServices({ ...config, state })
try {
  assert.equal(
    await reopened.psql(
      'SELECT md5((SELECT json_agg(r ORDER BY id)::text FROM public.player_roster r)|| (SELECT payload::text FROM public.desktop_roster_snapshots));'
    ),
    expected
  )
  assert.equal(
    (
      await reopened.psql(
        'SELECT player_power FROM public.player_mapping WHERE is_current;'
      )
    ).trim(),
    '54321'
  )
  evidence.checks.push(
    'native shutdown and restart preserve the cache, canonical roster and player power without an active game connection'
  )
} finally {
  await reopened.stop()
}
evidence.scope =
  'Synthetic native services and actual compiled canonical normalization. Native menu and installed offline renderer require separate acceptance proof.'
await writeFile(
  config.evidence.replace(/\.json$/, '-roster.json'),
  JSON.stringify(evidence, null, 2),
  { mode: 0o600 }
)
console.log(JSON.stringify(evidence, null, 2))
