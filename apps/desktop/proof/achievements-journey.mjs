import assert from 'node:assert/strict'
import { createServerClient } from '@supabase/ssr'
import { randomBytes, randomUUID, createHmac } from 'node:crypto'
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
  'achievements-' + randomUUID()
)
const password = randomBytes(24).toString('hex')
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`
let services, gateway, key, cron, cookie
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
  const dedupe = 'SYN-ACHIEVEMENT-' + suffix + '-' + randomUUID()
  await services.psql(
    `INSERT INTO public.work_queue(job_type,job_class,payload,dedupe_key,max_attempts) VALUES('refresh-local-achievements','hook','{"subjectUserId":"synthetic-forged"}',${quote(dedupe)},10);`
  )
  return dedupe
}
async function stop() {
  await gateway?.stop()
  gateway = undefined
  await services?.stop()
  services = undefined
}
let expected, subject
try {
  await start()
  assert.equal(
    (
      await request('/desktop/setup', {
        password,
        sample: false,
        identity: {
          guildCode: 'SYN-LOCAL',
          playerId: 'synthetic-achievement-player',
          displayName: 'Synthetic Achievement Alias',
          guildName: 'Synthetic Local Guild'
        }
      })
    ).status,
    201
  )
  const session = await login()
  subject = session.user.id
  const foreign = randomUUID(),
    zone = randomUUID()
  await services.psql(`
    INSERT INTO auth.users(id,aud,role,email) VALUES(${quote(foreign)},'authenticated','authenticated','synthetic-foreign@example.invalid');
    INSERT INTO public.player_mapping(id,user_id,player_id,display_name,guild_code,is_current,role) VALUES(999,${quote(foreign)},'synthetic-foreign-player','Synthetic Foreign Alias','SYN-LOCAL',true,'member');
    UPDATE public.player_mapping SET player_power=12345,player_level=40 WHERE user_id=${quote(subject)};
    INSERT INTO public.hero_mappings(id,unit_id,game_id,faction_id,category) VALUES(901,'synthetic-achievement-unit','synthetic-achievement-unit','Synthetic','Hero');
    INSERT INTO public.player_roster(user_id,hero_mapping_id,rank_name,rarity,xp_level,active_ability_level,passive_ability_level) VALUES(${quote(subject)},901,'Diamond I','Legendary',40,35,30);
    INSERT INTO public.guild_war_zones(id,war_id,guild_code,zone_number,zone_type,zone_status) VALUES(${quote(zone)},'synthetic-war','SYN-LOCAL',1,'Synthetic','available');
    INSERT INTO public.guild_war_player_attempts(war_id,zone_id,guild_code,player_id,player_name,attempt_number,attempt_status) VALUES('synthetic-war',${quote(zone)},'SYN-LOCAL','synthetic-achievement-player','Synthetic Achievement Alias',1,'completed');
    INSERT INTO public."EOT_GR_data"("Guild","Season","userId","displayName","Name","damageType","damageDealt","remainingHp","maxHp","startedOn","completedOn",rarity,tier,set,"encounterId","encounterIndex","loopIndex") VALUES('SYN-LOCAL','9999','synthetic-achievement-player','Synthetic Achievement Alias','Synthetic Boss','Battle',5000,0,5000,'2026-01-01T00:00:00Z','2026-01-01T00:00:10Z','Legendary',1,1,0,0,1);
  `)
  await services.psql(
    `INSERT INTO public."EOT_GR_data"("Guild","Season","userId","displayName","Name","damageType","damageDealt","remainingHp","maxHp","startedOn","completedOn",rarity,tier,set,"encounterId","encounterIndex","loopIndex") SELECT "Guild","Season","userId","displayName","Name","damageType","damageDealt","remainingHp","maxHp","startedOn"+interval '1 minute',"completedOn"+interval '1 minute',rarity,tier,set,"encounterId","encounterIndex","loopIndex" FROM public."EOT_GR_data";`
  )
  assert.equal((await request('/api/desktop/jobs', {})).status, 401)
  assert.equal((await request('/api/player/achievements')).status, 401)
  let response = await request('/api/player/achievements', undefined, {
    cookie
  })
  assert.equal(response.status, 200)
  let live = await response.json()
  assert.equal(live.stats.guildWarCount, 1)
  assert.equal(live.stats.rosterUnitCount, 1)
  assert.equal(live.stats.totalDamage, 10000)
  assert.equal(live.stats.votlwGoldMedals, 1)
  assert.equal(live.stats.votlwBiggestHitAwards, 1)
  assert(live.summary.unlocked > 0)
  assert.equal(
    (
      await request(
        '/api/player/achievements?playerId=synthetic-foreign-player',
        undefined,
        { cookie }
      )
    ).status,
    403
  )
  await enqueue('first')
  response = await tick()
  assert.equal(response.status, 200)
  assert.equal((await response.json()).jobsSucceeded, 1)
  const stored = () =>
    services.psql(
      `SELECT coalesce(jsonb_agg(jsonb_build_object('key',achievement_key,'at',unlocked_at,'value',value) ORDER BY achievement_key),'[]') FROM public.player_achievements WHERE user_id=${quote(subject)};`
    )
  expected = (await stored()).trim()
  assert(JSON.parse(expected).length > 0)
  assert.equal(
    (
      await services.psql(
        `SELECT count(*) FROM public.player_achievements WHERE user_id=${quote(foreign)};`
      )
    ).trim(),
    '0'
  )
  const auth = {
    authorization: `Bearer ${session.access_token}`,
    apikey: 'desktop-public'
  }
  response = await request(
    '/supabase/rest/v1/player_achievements?select=user_id',
    undefined,
    auth
  )
  assert.equal(response.status, 200)
  assert((await response.json()).every((row) => row.user_id === subject))
  response = await request(
    '/supabase/rest/v1/player_achievements',
    { user_id: subject, achievement_key: 'synthetic_forged' },
    auth
  )
  assert.equal(response.status, 403)
  assert.equal(
    (
      await request(
        '/supabase/rest/v1/rpc/get_votlw_set_winners',
        { p_guild_code: 'SYN-FOREIGN', p_season: '9999' },
        auth
      )
    ).status,
    200
  )
  assert.deepEqual(
    await (
      await request(
        '/supabase/rest/v1/rpc/get_votlw_set_winners',
        { p_guild_code: 'SYN-FOREIGN', p_season: '9999' },
        auth
      )
    ).json(),
    []
  )
  const signingKey = JSON.parse(
    await readFile(join(state, 'credentials.json'), 'utf8')
  ).jwt
  const encode = (value) =>
    Buffer.from(JSON.stringify(value)).toString('base64url')
  const unsigned =
    encode({ alg: 'HS256', typ: 'JWT' }) +
    '.' +
    encode({
      role: 'authenticated',
      sub: foreign,
      aud: 'authenticated',
      exp: Math.floor(Date.now() / 1000) + 3600
    })
  const foreignAuth = {
    apikey: 'desktop-public',
    authorization:
      'Bearer ' +
      unsigned +
      '.' +
      createHmac('sha256', signingKey).update(unsigned).digest('base64url')
  }
  response = await request(
    '/supabase/rest/v1/player_achievements?select=user_id',
    undefined,
    foreignAuth
  )
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), [])
  response = await request(
    '/supabase/rest/v1/rpc/get_votlw_set_winners',
    { p_guild_code: 'SYN-LOCAL', p_season: '9999' },
    foreignAuth
  )
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), [])
  await services.psql(
    'REVOKE INSERT ON public.player_achievements FROM service_role;'
  )
  const failed = await enqueue('failure')
  response = await tick()
  assert.equal(response.status, 503)
  assert.equal(
    (
      await services.psql(
        `SELECT status FROM public.work_queue WHERE dedupe_key=${quote(failed)};`
      )
    ).trim(),
    'pending'
  )
  const failedAttempts = Number(
    (
      await services.psql(
        `SELECT attempts FROM public.work_queue WHERE dedupe_key=${quote(failed)};`
      )
    ).trim()
  )
  assert(failedAttempts > 0 && failedAttempts < 10)
  assert.equal((await stored()).trim(), expected)
  await services.psql(
    `GRANT INSERT ON public.player_achievements TO service_role; UPDATE public.work_queue SET scheduled_for=now() WHERE dedupe_key=${quote(failed)};`
  )
  response = await tick()
  assert.equal(response.status, 200)
  assert.equal(
    (
      await services.psql(
        `SELECT status||':'||attempts FROM public.work_queue WHERE dedupe_key=${quote(failed)};`
      )
    ).trim(),
    'completed:' + (failedAttempts + 1)
  )
  assert.equal((await stored()).trim(), expected)
  await stop()
  await start()
  await login()
  assert.equal((await stored()).trim(), expected)
  await services.psql(
    'DELETE FROM public.player_roster; DELETE FROM public."EOT_GR_data"; DELETE FROM public.guild_war_player_attempts;'
  )
  response = await request('/api/player/achievements', undefined, { cookie })
  assert.equal(response.status, 200)
  live = await response.json()
  assert.equal(live.stats.totalDamage, 0)
  assert(live.achievements.some((row) => row.unlocked && row.unlockedAt))
  assert.equal((await stored()).trim(), expected)
  const evidence = {
    status: 'passed',
    checks: [
      'actual compiled evaluator reads native raid, roster, guild-war and award inputs',
      'unauthorized worker and foreign player requests refuse; authenticated callers cannot forge unlocks',
      'job payload cannot choose another subject; same-guild foreign subject receives no persisted unlocks',
      'strict persistence failure records a pending durable retry with its failure, retains existing unlocks and retries successfully',
      'first-unlock timestamps and values survive repeat evaluation, native restart and disappearance of current inputs'
    ],
    scope:
      'Synthetic native services and compiled desktop application; guild-war ingestion/modules, installed renderer and cross-platform acceptance remain separate.'
  }
  await writeFile(
    config.evidence.replace(/\.json$/, '-achievements.json'),
    JSON.stringify(evidence, null, 2),
    { mode: 0o600 }
  )
  console.log(JSON.stringify(evidence, null, 2))
} finally {
  await stop()
}
