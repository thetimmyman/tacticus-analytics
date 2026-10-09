import assert from 'node:assert/strict'
import { randomBytes, createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { nativeServices, signedToken } from './native-services.mjs'
import { workspaceSetup } from '../launcher/workspace.mjs'

// Privileged calls enroll synthetic fixtures and count the complete migration
// inventory. Authorization assertions use signed Auth/PostgREST and literal values.
const config = JSON.parse(await readFile(process.argv[2], 'utf8'))
const state = config.seasonPlanningState || config.state
const password = randomBytes(24).toString('hex')
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`
const checks = []
const check = (name) => checks.push({ name, passed: true })
let services, listener, token, subject
const open = async (schemaDirectory) => {
  services = await nativeServices({ ...config, schemaDirectory, state })
}
async function login() {
  const response = await fetch(
    `http://127.0.0.1:${services.ports.auth}/token?grant_type=password`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'desktop@localhost.invalid', password })
    }
  )
  assert.equal(response.status, 200)
  const account = await response.json()
  if (subject) assert.equal(account.user.id, subject)
  subject = account.user.id
  token = account.access_token
}
async function rest(
  path,
  body,
  method = body === undefined ? 'GET' : 'POST',
  bearer = token
) {
  return fetch(`http://127.0.0.1:${services.ports.rest}/${path}`, {
    method,
    headers: {
      authorization: `Bearer ${bearer}`,
      'content-type': 'application/json',
      Prefer: 'return=representation'
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  })
}
async function rows(path) {
  const response = await rest(path)
  assert.equal(response.status, 200, await response.clone().text())
  return response.json()
}
async function expectStatus(response, expected, name) {
  assert.equal(
    response.status,
    expected,
    `${name}: ${await response.clone().text()}`
  )
  return response
}
const query = 'guild_raid_season_plans?guild_code=eq.SYN001'
const byId = (id) => `guild_raid_season_plans?id=eq.${id}`
const plan = (extra = {}) => ({
  guild_code: 'SYN001',
  season_id: '9999',
  start_at: '2030-01-01T00:00:00Z',
  end_at: '2030-01-14T00:00:00Z',
  snapshot_at: '2030-01-02T00:00:00Z',
  kind: 'baseline',
  baseline_key: 'synthetic-baseline',
  trigger: 'manual',
  resolved_options: { seed: 42 },
  input_snapshots: { players: 2 },
  plan_metrics: { totalTokens: 12, expectedDamage: 2400 },
  plan: { season: 9999, stages: [{ boss: 'SyntheticBoss', tokens: 12 }] },
  seed: 42,
  plan_hash: 'synthetic-plan-digest',
  created_by: subject,
  ...extra
})
async function insert(extra) {
  const response = await expectStatus(
    await rest('guild_raid_season_plans', plan(extra)),
    201,
    'plan create'
  )
  return (await response.json())[0]
}
async function role(value) {
  await services.psql(
    `UPDATE public.player_mapping SET role=${quote(value)},is_current=true,is_active=true,is_app_admin=false WHERE user_id=${quote(subject)};`
  )
}
async function auxiliaryUser() {
  const response = await fetch(
    `http://127.0.0.1:${services.ports.auth}/admin/users`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${services.token.service}`
      },
      body: JSON.stringify({
        email: 'synthetic-planner@localhost.invalid',
        password: randomBytes(24).toString('hex'),
        email_confirm: true
      })
    }
  )
  assert.equal(response.status, 200)
  return (await response.json()).id
}
try {
  await open(config.previousSchemaDirectory || config.schemaDirectory)
  const handler = workspaceSetup(
    services,
    new URL('../launcher/', import.meta.url).pathname
  )
  listener = createServer((req, res) => {
    void handler(req, res, new URL(req.url, 'http://127.0.0.1')).catch(() => {
      res.statusCode = 500
      res.end()
    })
  })
  await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${listener.address().port}`
  await expectStatus(
    await fetch(origin + '/desktop/setup', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ password, sample: true })
    }),
    201,
    'workspace enrollment'
  )
  await new Promise((resolve) => listener.close(resolve))
  listener = undefined
  await login()
  if (config.previousSchemaDirectory) {
    assert.equal((await rest(query)).status, 404)
    await services.psql(
      "INSERT INTO public.feature_releases(feature_key,display_name,description,release_stage,route) VALUES ('boss_assignments','Captured targets','Captured target description','coming_soon','/captured-targets'),('boss_assignment_season_planner','Captured planner','Captured planner description','alpha','/captured-planner'),('synthetic_unselected','Captured unrelated','Unchanged unrelated description','alpha','/captured-unrelated');"
    )
    assert.equal((await rows('EOT_GR_data?select=id')).length, 7)
    assert.equal(
      (
        await services.psql('SELECT count(*) FROM public."EOT_GR_data";')
      ).trim(),
      '8'
    )
    await services.stop()
    services = undefined
    await open(config.schemaDirectory)
    assert.equal(services.fresh, false)
    await login()
    assert.equal((await rows('EOT_GR_data?select=id')).length, 7)
    assert.equal(
      (
        await services.psql('SELECT count(*) FROM public."EOT_GR_data";')
      ).trim(),
      '8'
    )
    check(
      'v15 upgrade preserves account, seven caller-visible raid rows and all eight fixture-inventory rows'
    )
    assert.deepEqual(
      await rows(
        'feature_releases?feature_key=in.(boss_assignments,boss_assignment_season_planner,synthetic_unselected)&select=feature_key,display_name,description,release_stage,route&order=feature_key'
      ),
      [
        {
          feature_key: 'boss_assignment_season_planner',
          display_name: 'Captured planner',
          description: 'Captured planner description',
          release_stage: 'public',
          route: '/boss-assignments/season'
        },
        {
          feature_key: 'boss_assignments',
          display_name: 'Captured targets',
          description: 'Captured target description',
          release_stage: 'public',
          route: '/boss-assignments/targets'
        },
        {
          feature_key: 'synthetic_unselected',
          display_name: 'Captured unrelated',
          description: 'Unchanged unrelated description',
          release_stage: 'alpha',
          route: '/captured-unrelated'
        }
      ]
    )
    check(
      'populated v15 catalogue upgrade changes only two preview capability stages/routes and preserves unrelated metadata'
    )
  }
  assert.deepEqual(await rows(query), [])
  assert.equal((await rest('guild_raid_season_plans', plan())).status, 403)
  assert.equal(
    (await rest(query, undefined, 'GET', services.token.anon)).status,
    401
  )
  assert.equal(
    (await rest(query, undefined, 'GET', services.token.service)).status,
    403
  )
  assert.deepEqual(
    await rows('guild_raid_season_plans?guild_code=eq.FOREIGN'),
    []
  )
  check(
    'installation member reads plans but member, anonymous and service roles cannot write or bypass table grants'
  )
  const aux = await auxiliaryUser()
  // A validly signed runtime role without a subject must not inherit fixture
  // owner exemptions. This key is synthetic and remains in process memory.
  const credentials = JSON.parse(
    await readFile(join(state, 'credentials.json'), 'utf8')
  )
  const noSubject = signedToken(credentials.jwt, 'authenticated')
  assert.deepEqual(
    await (await rest(query, undefined, 'GET', noSubject)).json(),
    []
  )
  assert.equal(
    (await rest('guild_raid_season_plans', plan(), 'POST', noSubject)).status,
    403
  )
  await role('officer')
  // This regression fails without the explicit local write guard: canonical
  // officer policy alone accepts another existing account as the creator.
  await expectStatus(
    await rest('guild_raid_season_plans', plan({ created_by: aux })),
    403,
    'forged creator refused'
  )
  assert.deepEqual(await rows(query), [])
  check('authenticated creator must be the signed subject before any insertion')
  let saved = await insert()
  assert.deepEqual(saved.plan_metrics, {
    totalTokens: 12,
    expectedDamage: 2400
  })
  assert.deepEqual(saved.plan, {
    season: 9999,
    stages: [{ boss: 'SyntheticBoss', tokens: 12 }]
  })
  assert.equal(saved.created_by, subject)
  assert.equal(saved.season_id, '9999')
  const id = saved.id
  await expectStatus(
    await rest(byId(id), { created_by: aux }, 'PATCH'),
    403,
    'creator immutable'
  )
  await expectStatus(
    await rest('guild_raid_season_plans', plan()),
    409,
    'unique baseline key'
  )
  for (const variant of [
    { kind: 'invalid', baseline_key: 'bad-kind' },
    { start_at: 'not-a-date', baseline_key: 'bad-date' },
    { id: 'not-a-uuid', baseline_key: 'bad-id' },
    { guild_code: 'FOREIGN', baseline_key: 'bad-guild' },
    { guild_code: 'SYN002', baseline_key: 'peer-guild' }
  ])
    assert((await rest('guild_raid_season_plans', plan(variant))).status >= 400)
  assert.equal((await rows(query)).length, 1)
  assert.deepEqual((await rows(byId(id)))[0].plan_metrics, {
    totalTokens: 12,
    expectedDamage: 2400
  })
  check(
    'canonical uniqueness, type and guild failures preserve the saved literal plan and immutable creator'
  )
  // Trusted fixture owner inserts baselines that the signed caller must reject.
  const foreignId = '11111111-1111-4111-8111-111111111111'
  const seasonId = '22222222-2222-4222-8222-222222222222'
  const numericalSeasonId = '44444444-4444-4444-8444-444444444444'
  await services.psql(
    `INSERT INTO public.guild_raid_season_plans(id,guild_code,season_id,start_at,end_at,kind,created_by) VALUES (${quote(foreignId)},'SYN002','9999','2030-01-01','2030-01-14','baseline',${quote(aux)}),(${quote(seasonId)},'SYN001','9998','2030-01-01','2030-01-14','baseline',${quote(aux)});`
  )
  await services.psql(
    `INSERT INTO public.guild_raid_season_plans(id,guild_code,season_id,start_at,end_at,kind,created_by,plan) VALUES (${quote(numericalSeasonId)},'SYN001','9999','2030-01-01','2030-01-14','baseline',${quote(aux)},'{"season":9998}'::jsonb);`
  )
  for (const baseline of [
    foreignId,
    seasonId,
    numericalSeasonId,
    '33333333-3333-4333-8333-333333333333'
  ]) {
    await expectStatus(
      await rest(
        'guild_raid_season_plans',
        plan({ kind: 'replan', baseline_key: null, baseline_plan_id: baseline })
      ),
      403,
      'baseline caller scope'
    )
  }
  const replan = await insert({
    kind: 'replan',
    baseline_key: null,
    baseline_plan_id: id,
    trigger: 'manual-replan'
  })
  assert.equal(replan.baseline_plan_id, id)
  for (const baseline of [foreignId, seasonId, numericalSeasonId]) {
    await expectStatus(
      await rest(byId(replan.id), { baseline_plan_id: baseline }, 'PATCH'),
      403,
      'baseline update caller scope'
    )
    assert.equal((await rows(byId(replan.id)))[0].baseline_plan_id, id)
  }
  const minimal = await insert({ plan: {}, baseline_key: 'minimal-json' })
  const minimalReplan = await insert({
    plan: {},
    kind: 'replan',
    baseline_key: null,
    baseline_plan_id: minimal.id
  })
  assert.equal(minimalReplan.baseline_plan_id, minimal.id)
  await expectStatus(
    await rest(byId(minimalReplan.id), undefined, 'DELETE'),
    200,
    'minimal replan cleanup'
  )
  await expectStatus(
    await rest(byId(minimal.id), undefined, 'DELETE'),
    200,
    'minimal baseline cleanup'
  )
  check(
    'baseline linkage binds visible guild, captured config and numerical saved season while retaining both-null canonical JSON compatibility'
  )
  for (const currentRole of ['officer', 'leader', 'Officer', 'Leader']) {
    await role(currentRole)
    const row = await insert({ kind: 'replan', baseline_key: null })
    const updated = await expectStatus(
      await rest(byId(row.id), { trigger: 'synthetic-revision' }, 'PATCH'),
      200,
      'current role update'
    )
    assert.equal((await updated.json())[0].trigger, 'synthetic-revision')
    await expectStatus(
      await rest(byId(row.id), undefined, 'DELETE'),
      200,
      'current role delete'
    )
    assert.deepEqual(await rows(byId(row.id)), [])
    assert.deepEqual(
      await rows(`guild_raid_season_plans?id=eq.${foreignId}`),
      []
    )
  }
  check(
    'current lowercase and canonical titlecase officer/leader roles can CRUD only their own guild'
  )
  await role('member')
  await services.psql(
    `UPDATE public.player_mapping SET is_app_admin=true WHERE user_id=${quote(subject)};`
  )
  assert.equal(
    (
      await rest(
        'guild_raid_season_plans',
        plan({ baseline_key: 'admin-bypass' })
      )
    ).status,
    403
  )
  assert.deepEqual(
    await (await rest(byId(id), { trigger: 'denied' }, 'PATCH')).json(),
    []
  )
  assert.deepEqual(await (await rest(byId(id), undefined, 'DELETE')).json(), [])
  assert.equal((await rows(byId(id)))[0].trigger, 'manual')
  await services.psql(
    `UPDATE public.player_mapping SET is_current=false WHERE user_id=${quote(subject)};`
  )
  assert.deepEqual(await rows(query), [])
  assert.equal(
    (await rest('guild_raid_season_plans', plan({ baseline_key: 'stale' })))
      .status,
    403
  )
  check(
    'app-admin admission never grants database writes and stale membership sees no saved plans'
  )
  await role('officer')
  const signatureStart = token.lastIndexOf('.') + 1
  const invalid =
    token.slice(0, signatureStart) +
    (token[signatureStart] === 'A' ? 'B' : 'A') +
    token.slice(signatureStart + 1)
  assert.equal((await rest(query, undefined, 'GET', invalid)).status, 401)
  await services.psql(
    "INSERT INTO public.raid_progression_config(scope,first_pass_sequence,loop_sequence,loop_start_stage) VALUES ('synthetic-local',ARRAY['L1','E1'],ARRAY['L1'],'L1');"
  )
  assert.deepEqual(
    await rows(
      'raid_progression_config?scope=eq.synthetic-local&select=scope,first_pass_sequence,loop_sequence,loop_start_stage'
    ),
    [
      {
        scope: 'synthetic-local',
        first_pass_sequence: ['L1', 'E1'],
        loop_sequence: ['L1'],
        loop_start_stage: 'L1'
      }
    ]
  )
  assert.equal(
    (
      await rest('raid_progression_config', {
        scope: 'denied',
        first_pass_sequence: ['L1'],
        loop_sequence: ['L1']
      })
    ).status,
    403
  )
  assert.equal(
    (
      await rest(
        'raid_progression_config?scope=eq.synthetic-local',
        { loop_start_stage: 'E1' },
        'PATCH'
      )
    ).status,
    403
  )
  assert.equal(
    (
      await rest(
        'raid_progression_config?scope=eq.synthetic-local',
        undefined,
        'DELETE'
      )
    ).status,
    403
  )
  assert.equal(
    (await rows('guild_config?guild_code=eq.SYN001&select=timezone')).length,
    1
  )
  check(
    'forged JWT refuses and authenticated progression/timezone reads do not permit configuration writes'
  )
  for (const feature of [
    'boss_assignments',
    'boss_assignment_season_planner'
  ]) {
    const response = await expectStatus(
      await rest('rpc/check_feature_access', {
        p_user_id: subject,
        p_feature_key: feature
      }),
      200,
      'saved feature capability'
    )
    assert.deepEqual(await response.json(), {
      has_access: true,
      reason: 'public_feature',
      stage: 'public'
    })
  }
  assert.equal(
    (
      await rest('rpc/check_feature_access', {
        p_user_id: aux,
        p_feature_key: 'boss_assignment_season_planner'
      })
    ).status,
    403
  )
  const missing = await rest('rpc/check_feature_access', {
    p_user_id: subject,
    p_feature_key: 'synthetic_missing'
  })
  assert.equal((await missing.json()).has_access, false)
  await services.psql(
    "INSERT INTO public.feature_releases(feature_key,display_name,release_stage) VALUES ('synthetic_alpha','Synthetic alpha','alpha'),('synthetic_pending','Synthetic pending','coming_soon');"
  )
  for (const feature of ['synthetic_alpha', 'synthetic_pending'])
    assert.equal(
      (
        await (
          await rest('rpc/check_feature_access', {
            p_user_id: subject,
            p_feature_key: feature
          })
        ).json()
      ).has_access,
      false
    )
  await services.psql(
    `INSERT INTO public.feature_access_grants(user_id,access_level,expires_at) VALUES (${quote(subject)},'alpha_tester',now()-interval '1 hour');`
  )
  assert.equal(
    (
      await (
        await rest('rpc/check_feature_access', {
          p_user_id: subject,
          p_feature_key: 'synthetic_alpha'
        })
      ).json()
    ).has_access,
    false
  )
  await services.psql(
    `UPDATE public.feature_access_grants SET expires_at=now()+interval '1 hour' WHERE user_id=${quote(subject)};`
  )
  assert.equal(
    (
      await (
        await rest('rpc/check_feature_access', {
          p_user_id: subject,
          p_feature_key: 'synthetic_alpha'
        })
      ).json()
    ).has_access,
    true
  )
  check(
    'two local saved capabilities use canonical caller-bound RPC and retain missing, pending and expiring grant semantics'
  )
  const before = (await rows(byId(id)))[0].updated_at
  const changed = await expectStatus(
    await rest(byId(id), { trigger: 'saved-revision' }, 'PATCH'),
    200,
    'timestamp trigger'
  )
  assert.notEqual((await changed.json())[0].updated_at, before)
  await services.stop()
  services = undefined
  await open(config.schemaDirectory)
  await login()
  saved = (await rows(byId(id)))[0]
  assert.equal(saved.trigger, 'saved-revision')
  assert.deepEqual(saved.plan_metrics, {
    totalTokens: 12,
    expectedDamage: 2400
  })
  assert.equal((await rows(byId(replan.id)))[0].baseline_plan_id, id)
  check(
    'full native restart preserves saved payload, identity, baseline linkage and timestamped revision'
  )
  await expectStatus(
    await rest(byId(id), undefined, 'DELETE'),
    200,
    'baseline deletion'
  )
  assert.equal((await rows(byId(replan.id)))[0].baseline_plan_id, null)
  const deleted = await fetch(
    `http://127.0.0.1:${services.ports.auth}/admin/users/${aux}`,
    {
      method: 'DELETE',
      headers: { authorization: `Bearer ${services.token.service}` }
    }
  )
  assert.equal(deleted.status, 200)
  assert.equal((await rows(byId(seasonId)))[0].created_by, null)
  check(
    'canonical baseline and Auth creator ON DELETE SET NULL actions remain compatible with direct-write guard'
  )
  const canonical = await readFile(
    new URL('../local-schema/canonical-objects.sql', import.meta.url)
  )
  const authority = await readFile(
    new URL('../local-schema/authority.sql', import.meta.url)
  )
  await writeFile(
    config.seasonPlanningEvidence || config.evidence,
    JSON.stringify(
      {
        schema: 'desktop-native-season-planning-journey/v1',
        classification: 'synthetic-native-module-proof',
        status: 'passed',
        previousSchemaMigrated: Boolean(config.previousSchemaDirectory),
        schemaVersion: 17,
        schemaSha256: createHash('sha256')
          .update(canonical)
          .update(authority)
          .digest('hex'),
        node: process.version,
        normalUid: process.getuid(),
        checks,
        scope:
          'Actual native PostgreSQL/Auth/PostgREST with synthetic fixtures. No installed GUI/offline qualification, hosted entitlements or upstream officer authority inferred.'
      },
      null,
      2
    ),
    { mode: 0o600 }
  )
  console.log(JSON.stringify({ status: 'passed', checks: checks.length }))
} finally {
  if (listener) await new Promise((resolve) => listener.close(resolve))
  await services?.stop()
}
