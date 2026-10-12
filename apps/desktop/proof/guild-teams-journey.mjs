import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
import { createServerClient } from '@supabase/ssr'
import { nativeServices } from './native-services.mjs'
import { loopbackGateway } from './loopback-gateway.mjs'
import { workspaceSetup } from '../launcher/workspace.mjs'
import { electronDisplay } from '../launcher/display.mjs'
import { syntheticRosterUnit } from './synthetic-roster.mjs'
import { saveScopedConnections } from '../launcher/scoped-connections.mjs'

// Fixture setup is privileged; every roster observation uses the signed-in
// public RPC. The installation owner remains a member throughout this proof.
const config = JSON.parse(await readFile(process.argv[2], 'utf8'))
assert(config.application, 'Compiled desktop application required')
const state = join(
  config.stateRoot || config.state,
  'guild-teams-' + randomUUID()
)
const password = randomBytes(24).toString('hex')
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`
const checks = []
let expected

async function open(schemaDirectory = config.schemaDirectory) {
  const services = await nativeServices({ ...config, state, schemaDirectory })
  const key = randomBytes(32).toString('hex')
  const broker = randomBytes(32).toString('hex'),
    cron = randomBytes(32).toString('hex')
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
        brokerToken: broker,
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
          assert.equal(response.status, 200, await response.clone().text())
          return response.json()
        }
      }
    )
  })
  gateway.setAppPort(port)
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
  const request = (path, body, auth = {}) =>
    fetch(gateway.origin + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'x-desktop-transport': key,
        origin: gateway.origin,
        apikey: 'desktop-public',
        'content-type': 'application/json',
        ...auth
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10000)
    })
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
  assert(ready, 'Compiled application ready')
  const login = async () => {
    const cookies = []
    const ssr = createServerClient(
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
    const result = await ssr.auth.signInWithPassword({
      email: 'desktop@localhost.invalid',
      password
    })
    assert.equal(result.error, null)
    const session = result.data.session
    return {
      subject: session.user.id,
      auth: { authorization: `Bearer ${session.access_token}` },
      cookies,
      cookie: cookies.map(({ name, value }) => `${name}=${value}`).join('; ')
    }
  }
  const roster = (body, auth) =>
    request('/supabase/rest/v1/rpc/get_guild_team_roster', body, auth)
  const close = async () => {
    await gateway.stop()
    await services.stop()
  }
  const importRoster = async (snapshot) => {
    await delay(3100)
    return request(
      '/desktop/import-roster',
      { password, contents: JSON.stringify(snapshot) },
      { 'x-desktop-broker': broker }
    )
  }
  const renderer = async (cookies, phase) => {
    assert(config.application.electron, 'Real Electron runtime required')
    assert(['initial', 'reopened'].includes(phase))
    const path = join(
      services.state,
      `guild-teams-${phase}-renderer-config.json`
    )
    const evidence = join(services.state, `guild-teams-${phase}-renderer.json`)
    await writeFile(
      path,
      JSON.stringify({
        url: gateway.origin + '/guild-teams',
        transportKey: key,
        state: services.state,
        cookies,
        guildTeams: true,
        evidence,
        screenshot: evidence.replace(/\.json$/, '.png')
      }),
      { mode: 0o600 }
    )
    const display = electronDisplay()
    const child = services.launch(
      config.application.electron,
      [
        new URL('./electron-shell.cjs', import.meta.url).pathname,
        path,
        ...display.args
      ],
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
    assert.equal(
      await new Promise((resolve, reject) => {
        child.once('exit', resolve)
        child.once('error', reject)
      }),
      0
    )
    const observed = JSON.parse(await readFile(evidence, 'utf8'))
    assert.equal(observed.guildTeams.status, 'passed')
    assert.equal(observed.renderer.nodeAccess, false)
    assert.deepEqual(observed.blocked, [])
    assert.deepEqual(observed.failures, [])
    assert.deepEqual(observed.consoleErrors, [])
    return evidence
  }
  return { services, request, login, roster, close, importRoster, renderer }
}

let first = await open(config.previousSchemaDirectory || config.schemaDirectory)
try {
  assert.equal(
    (
      await first.request('/desktop/setup', {
        password,
        sample: false,
        identity: {
          guildCode: 'SYN-LOCAL',
          playerId: 'synthetic-team-player',
          displayName: 'Synthetic Team Alias',
          guildName: 'Synthetic Local Guild'
        }
      })
    ).status,
    201
  )
  let { subject, auth, cookie, cookies } = await first.login()
  const foreign = randomUUID(),
    guildForeign = randomUUID()
  await first.services.psql(`
    INSERT INTO auth.users(id,aud,role,email) VALUES
      (${quote(foreign)},'authenticated','authenticated','synthetic-team-other@example.invalid'),
      (${quote(guildForeign)},'authenticated','authenticated','synthetic-team-foreign@example.invalid');
    INSERT INTO public.guild_config(id,guild_code,display_name) VALUES(999,'SYN-FOREIGN','Synthetic Foreign Guild');
    INSERT INTO public.player_mapping(id,user_id,player_id,display_name,guild_code,is_current,role) VALUES
      (999,${quote(foreign)},'synthetic-team-other','Synthetic Other Member','SYN-LOCAL',true,'member'),
      (1000,${quote(guildForeign)},'synthetic-team-foreign','Synthetic Foreign Member','SYN-FOREIGN',true,'member');
    INSERT INTO public.hero_mappings(id,unit_id,display_name,category) VALUES
      (901,'syntheticCore','Synthetic Core','Hero'),(902,'syntheticSupport','Synthetic Support','Hero'),
      (903,'syntheticMissing','Synthetic Missing','Hero');
    INSERT INTO public.player_roster(user_id,hero_mapping_id,stars,progression_index,rank_name,active_ability_level,passive_ability_level,synced_at)
    VALUES (${quote(foreign)},901,1,1,'Stone II',1,1,'2026-01-01T00:00:00Z'),
      (${quote(guildForeign)},901,1,1,'Stone II',1,1,'2026-01-01T00:00:00Z');
    INSERT INTO public.desktop_roster_snapshots(subject_user_id,guild_code,payload)
      VALUES(${quote(foreign)},'SYN-LOCAL','{"format":"ta-official-roster-v1","guildCode":"SYN-LOCAL","playerName":"Synthetic Other Member","powerLevel":1,"units":[],"machinesOfWar":[]}'::jsonb);`)
  const snapshot = {
    format: 'ta-official-roster-v1',
    guildCode: 'SYN-LOCAL',
    playerName: 'Synthetic Team Alias',
    powerLevel: 12345,
    units: [
      { ...syntheticRosterUnit(), id: 'syntheticCore', name: 'Synthetic Core' },
      {
        ...syntheticRosterUnit(),
        id: 'syntheticSupport',
        name: 'Synthetic Support',
        progressionIndex: 19,
        rank: 23,
        xpLevel: 55,
        abilities: [
          { id: 'syntheticActive', level: 55 },
          { id: 'syntheticPassive', level: 30 }
        ]
      }
    ],
    machinesOfWar: []
  }
  const imported = await first.importRoster(snapshot)
  assert.equal(imported.status, 200, await imported.clone().text())
  assert.deepEqual(await imported.json(), { units: 2, mapped: 2, unmapped: 0 })
  if (config.previousSchemaDirectory) {
    await first.close()
    first = await open()
    ;({ auth, cookie, cookies } = await first.login())
    checks.push(
      'recognized previous schema upgrades under a stopped checkpoint and retains the imported roster'
    )
  }
  const body = {
    p_guild_code: 'SYN-LOCAL',
    p_unit_ids: ['syntheticCore', 'syntheticSupport', 'syntheticMissing']
  }
  const response = await first.roster(body, auth)
  assert.equal(response.status, 200, await response.clone().text())
  expected = await response.json()
  assert.equal(expected.length, 3)
  assert(
    expected.every(
      (row) =>
        row.player_display_name === 'Synthetic Team Alias' &&
        row.guild_role === 'member'
    )
  )
  assert.deepEqual(
    expected.map((row) => [
      row.unit_id,
      row.stars,
      row.progression_index,
      row.rank_name
    ]),
    [
      ['syntheticCore', 12, 12, 'Diamond I'],
      ['syntheticMissing', null, null, null],
      ['syntheticSupport', 19, 19, 'Mythic III']
    ]
  )
  checks.push(
    'canonical signed-in member projection returns only own selected heroes, including unmapped roster cells as null'
  )
  for (const refusedSnapshot of [
    { ...snapshot, guildCode: 'SYN-FOREIGN' },
    {
      ...snapshot,
      units: [snapshot.units[0], { ...snapshot.units[1], xpLevel: 32768 }]
    }
  ]) {
    const refused = await first.importRoster(refusedSnapshot)
    assert([400, 409].includes(refused.status))
    const unchanged = await first.roster(body, auth)
    assert.deepEqual(await unchanged.json(), expected)
  }
  checks.push(
    'native roster import writes through actual canonical normalization; malformed later units and foreign guild imports retain the previous team projection'
  )
  for (const requestBody of [
    { ...body, p_guild_code: 'SYN-FOREIGN' },
    { ...body, p_guild_code: null },
    { ...body, p_unit_ids: [] },
    { ...body, p_unit_ids: null },
    { ...body, p_unit_ids: ['syntheticUnknown'] }
  ]) {
    const refused = await first.roster(requestBody, auth)
    assert.equal(refused.status, 200, await refused.clone().text())
    assert.deepEqual(await refused.json(), [])
  }
  assert.equal((await first.roster(body, {})).status, 401)
  const malformed = await first.roster(
    { ...body, p_unit_ids: { forged: true } },
    auth
  )
  assert(malformed.status >= 400)
  const after = await first.roster(body, auth)
  assert.deepEqual(await after.json(), expected)
  checks.push(
    'foreign guild, anonymous caller, unknown heroes, empty/null scope and malformed unit array disclose no roster and leave the saved projection unchanged'
  )
  // Controlled saved access metadata models removal without a game key or a
  // claim that the upstream live protocol has been qualified.
  const accessFixture = {
    format: 'ta-scoped-official-access-v1',
    installation: subject,
    guildCode: 'SYN-LOCAL',
    roles: {
      Player: {
        handle: randomBytes(16).toString('hex'),
        verifiedAt: Date.now(),
        expiresAt: null
      }
    }
  }
  await saveScopedConnections(first.services.state, accessFixture)
  assert.equal(
    (await (await first.request('/desktop/onboarding-status')).json()).roles
      .Player.saved,
    true
  )
  await saveScopedConnections(first.services.state, {
    ...accessFixture,
    roles: {}
  })
  const disconnected = await first.request('/desktop/onboarding-status')
  assert.equal((await disconnected.json()).playerReady, false)
  const cached = await first.request('/api/player/roster', undefined, {
    cookie
  })
  assert.equal(cached.status, 200, await cached.clone().text())
  const cache = await cached.json()
  assert.equal(cache.cachePresent, true)
  assert.deepEqual(
    cache.units.map((unit) => [unit.id, unit.progressionIndex, unit.rank]),
    [
      ['syntheticCore', 12, 15],
      ['syntheticSupport', 19, 23]
    ]
  )
  assert.equal((await first.request('/api/player/roster')).status, 401)
  const foreignCache = await first.request(
    '/supabase/rest/v1/desktop_roster_snapshots?subject_user_id=eq.' + foreign,
    undefined,
    auth
  )
  assert.equal(foreignCache.status, 200)
  assert.deepEqual(await foreignCache.json(), [])
  const forgedQuery = await first.request(
    '/api/player/roster?user_id=' + foreign,
    undefined,
    { cookie }
  )
  assert.deepEqual((await forgedQuery.json()).units, cache.units)
  checks.push(
    'removing controlled saved Player access metadata disables the live capability while the own cached roster remains readable; anonymous and foreign-subject cache queries disclose no foreign roster'
  )
  const page = await first.request('/guild-teams', undefined, { cookie })
  assert.equal(page.status, 200, await page.clone().text())
  const backfill = await first.request(
    '/api/guild-teams/backfill',
    {},
    { cookie }
  )
  assert.equal(backfill.status, 409)
  const tokens = await first.request(
    '/api/guild-teams/tokens?guild=SYN-LOCAL',
    undefined,
    { cookie }
  )
  assert.equal(tokens.status, 200)
  assert.deepEqual(await tokens.json(), [])
  assert.equal(
    (
      await first.request(
        '/api/guild-teams/tokens?guild=SYN-FOREIGN',
        undefined,
        { cookie }
      )
    ).status,
    403
  )
  assert.equal(
    (await first.request('/api/guild-teams/backfill', {})).status,
    401
  )
  assert.equal(
    (await first.request('/api/guild-teams/tokens?guild=SYN-LOCAL')).status,
    401
  )
  checks.push(
    'actual member page renders; authenticated local backfill is refused and token endpoint reports no live estimate; anonymous and foreign-guild requests are denied'
  )
  checks.push(
    'hydrated custom team comparison: ' +
      (await first.renderer(cookies, 'initial'))
  )
} finally {
  await first.close()
}
const second = await open()
try {
  const { auth, cookies } = await second.login()
  const response = await second.roster(
    {
      p_guild_code: 'SYN-LOCAL',
      p_unit_ids: ['syntheticCore', 'syntheticSupport', 'syntheticMissing']
    },
    auth
  )
  assert.equal(response.status, 200, await response.clone().text())
  assert.deepEqual(await response.json(), expected)
  assert.equal(
    (await (await second.request('/desktop/onboarding-status')).json())
      .playerReady,
    false
  )
  const cached = await second.request('/api/player/roster', undefined, {
    cookie: (await second.login()).cookie
  })
  assert.equal(cached.status, 200)
  assert.equal((await cached.json()).cachePresent, true)
  checks.push(
    'full native service shutdown/restart retains the authorized canonical team roster projection'
  )
  checks.push(
    'reopened hydrated custom team comparison: ' +
      (await second.renderer(cookies, 'reopened'))
  )
} finally {
  await second.close()
}
const evidence = {
  status: 'passed',
  checks,
  scope:
    'Synthetic native Auth/PostgREST/PostgreSQL, canonical compiled normalization and sandboxed Electron renderer. Installation/package qualification, live tokens and officer multi-member parity remain separate acceptance.'
}
await writeFile(
  config.evidence.replace(/\.json$/, '-guild-teams.json'),
  JSON.stringify(evidence, null, 2),
  { mode: 0o600 }
)
console.log(JSON.stringify(evidence, null, 2))
