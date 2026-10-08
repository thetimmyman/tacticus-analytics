import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { nativeServices } from './native-services.mjs'
import { workspaceSetup } from '../launcher/workspace.mjs'

// Fixture enrollment is privileged. Every target/scope observation uses the
// signed-in PostgREST interface, never the fixture writer's database authority.
const config = JSON.parse(await readFile(process.argv[2], 'utf8'))
const checks = []
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`
const password = randomBytes(24).toString('hex')
const state = config.raidManagementState || config.state
await mkdir(state, { recursive: true, mode: 0o700 })
let services, listener
const check = (name) => checks.push({ name, passed: true })
async function open(schemaDirectory) {
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
  return (await response.json()).access_token
}
async function rest(
  path,
  token,
  body,
  method = body === undefined ? 'GET' : 'POST'
) {
  return fetch(`http://127.0.0.1:${services.ports.rest}/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      Prefer: 'return=representation'
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  })
}
const rpc = (token, name, body) => rest('rpc/' + name, token, body)
const tokenArgs = {
  p_guild_code: 'SYN001',
  p_season: '9999',
  p_cluster_code: null,
  p_player_id: null
}
let subject
const target = {
  guild_code: 'SYN001',
  boss_name: 'SyntheticBoss',
  rarity: 'Legendary',
  set: 1,
  encounter_id: 0,
  season_number: '9999',
  target_tokens: 12,
  source: 'officer_manual',
  notes: 'Saved offline target',
  skip: false
}
const targetQuery =
  'boss_target_tokens?guild_code=eq.SYN001&season_number=eq.9999'
try {
  await open(config.previousSchemaDirectory || config.schemaDirectory)
  const handler = workspaceSetup(
    services,
    new URL('../launcher', import.meta.url).pathname,
    { brokerToken: randomBytes(32).toString('hex') }
  )
  listener = createServer((req, res) => {
    void handler(req, res, new URL(req.url, 'http://127.0.0.1')).catch(() => {
      res.statusCode = 500
      res.end()
    })
  })
  await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve))
  const setup = await fetch(
    `http://127.0.0.1:${listener.address().port}/desktop/setup`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: `http://127.0.0.1:${listener.address().port}`
      },
      body: JSON.stringify({ password, sample: true })
    }
  )
  assert.equal(setup.status, 201, await setup.text())
  await new Promise((resolve) => listener.close(resolve))
  listener = undefined
  let token = await login()
  if (config.previousSchemaDirectory) {
    const absent = await rpc(token, 'desktop_get_player_token_state', tokenArgs)
    assert.equal(absent.status, 404)
    check('previous installed schema lacks the new token adapter')
    await services.stop()
    services = undefined
    await open(config.schemaDirectory)
    assert.equal(services.fresh, false)
    token = await login()
    check('recognized previous schema migrates and retains the local account')
  }
  const member = await rpc(token, 'desktop_get_player_token_state', tokenArgs)
  assert.equal(member.status, 200, await member.clone().text())
  const initial = await member.json()
  assert.equal(initial.length, 2)
  check('current member reads canonical cached guild token state')
  assert.equal(
    (
      await rpc(
        services.token.anon,
        'desktop_get_player_token_state',
        tokenArgs
      )
    ).status,
    401
  )
  const foreign = await rpc(token, 'desktop_get_player_token_state', {
    ...tokenArgs,
    p_guild_code: 'FOREIGN'
  })
  assert.equal(foreign.status, 200)
  assert.deepEqual(await foreign.json(), [])
  check('anonymous and foreign guild token reads are refused')
  const denied = await rest('boss_target_tokens', token, target)
  assert.equal(denied.status, 403)
  assert.deepEqual(await (await rest(targetQuery, token)).json(), [])
  check('installation member cannot create officer targets')
  subject = JSON.parse(
    (
      await services.psql(
        "SELECT to_json(user_id) FROM public.player_mapping WHERE display_name='SyntheticPlayer-A' AND is_current;"
      )
    ).trim()
  )
  assert(subject)
  for (const role of ['officer', 'leader', 'Officer', 'Leader', 'member']) {
    await services.psql(
      `UPDATE public.player_mapping SET role=${quote(role)} WHERE user_id=${quote(subject)} AND is_current;`
    )
    const peer = await rpc(token, 'desktop_get_player_token_state', {
      ...tokenArgs,
      p_guild_code: 'SYN002'
    })
    assert.equal(peer.status, 200)
    assert.equal(
      (await peer.json()).length,
      role.toLowerCase() === 'member' ? 0 : 1,
      `${role} peer-guild access`
    )
    const other = await rpc(token, 'desktop_get_player_token_state', {
      ...tokenArgs,
      p_guild_code: 'SYN003'
    })
    assert.deepEqual(await other.json(), [], `${role} foreign-cluster access`)
  }
  await assert.rejects(
    services.psql(
      `UPDATE public.player_mapping SET role='admin' WHERE user_id=${quote(subject)};`
    )
  )
  check(
    'peer token reads require current officer or leader roles and matching canonical cluster'
  )
  // This is an explicit synthetic officer fixture, not installer-granted or
  // upstream-verified authority. No credentials are inserted into the mapping.
  await services.psql(
    `UPDATE public.player_mapping SET role='officer',last_sync_tokens=2,last_sync_bombs=0,next_token_seconds=3600,next_bomb_seconds=3600,last_sync_at=now()-interval '13 hours',api_key_is_valid=false,tacticus_api_key_encrypted=NULL WHERE user_id=${quote(subject)} AND is_current;`
  )
  const cached = await rpc(token, 'desktop_get_player_token_state', tokenArgs)
  assert.equal(cached.status, 200, await cached.clone().text())
  const own = (await cached.json()).find(
    (row) => row.display_name === 'SyntheticPlayer-A'
  )
  assert.equal(own.data_source, 'cached')
  assert.equal(own.tokens_available, 3)
  assert.equal(own.is_capped, true)
  assert.equal(own.token_next_in_seconds, null)
  assert.equal(own.bombs_available, 1)
  assert.equal(own.bomb_next_in_seconds, null)
  check(
    'saved snapshot projects to canonical token and bomb caps without a game key'
  )
  const fixed = JSON.parse(
    (
      await services.psql(
        `SELECT json_agg(row_to_json(s)) FROM (SELECT available,next_in_seconds FROM public.project_token_snapshot(3,NULL,'2030-01-01T00:00:00Z',ARRAY['2030-01-01T01:00:00Z'::timestamptz],'2030-01-01T02:00:00Z',3,43200) UNION ALL SELECT available,next_in_seconds FROM public.project_token_snapshot(0,3600,'2030-01-01T00:00:00Z',ARRAY[]::timestamptz[],'2030-01-01T01:00:00Z',1,64800)) s;`
      )
    ).trim()
  )
  assert.deepEqual(fixed, [
    { available: 2, next_in_seconds: 39600 },
    { available: 1, next_in_seconds: null }
  ])
  check(
    'fixed-time canonical spend and regeneration boundaries match worked examples'
  )
  let response = await rest('boss_target_tokens', token, {
    ...target,
    updated_by: subject
  })
  assert.equal(response.status, 201, await response.clone().text())
  assert.equal((await response.json())[0].target_tokens, 12)
  response = await rest(
    targetQuery,
    token,
    { notes: 'Saved offline revision', skip: true },
    'PATCH'
  )
  assert.equal(response.status, 200)
  assert.equal((await response.json())[0].skip, true)
  check('scoped synthetic officer creates and edits persisted targets')
  for (const bad of [
    { ...target, guild_code: 'FOREIGN' },
    { ...target, target_tokens: -1, season_number: '9998' },
    { ...target, encounter_id: 9, season_number: '9998' }
  ])
    assert((await rest('boss_target_tokens', token, bad)).status >= 400)
  let rows = await (await rest(targetQuery, token)).json()
  assert.equal(rows.length, 1)
  assert.equal(rows[0].notes, 'Saved offline revision')
  assert.equal(rows[0].target_tokens, 12)
  check('foreign and malformed target writes preserve the committed target')
  await services.psql(
    `UPDATE public.player_mapping SET is_current=false WHERE user_id=${quote(subject)};`
  )
  assert.deepEqual(await (await rest(targetQuery, token)).json(), [])
  assert.deepEqual(
    await (
      await rpc(token, 'desktop_get_player_token_state', tokenArgs)
    ).json(),
    []
  )
  assert.equal(
    (
      await rest('boss_target_tokens', token, {
        ...target,
        season_number: '9998'
      })
    ).status,
    403
  )
  await services.psql(
    `UPDATE public.player_mapping SET is_current=true WHERE user_id=${quote(subject)};`
  )
  check('stale membership cannot read cached guild state or write targets')
  await services.stop()
  services = undefined
  await open(config.schemaDirectory)
  token = await login()
  rows = await (await rest(targetQuery, token)).json()
  assert.equal(rows.length, 1)
  assert.equal(rows[0].notes, 'Saved offline revision')
  assert.equal(rows[0].skip, true)
  const reopened = await (
    await rpc(token, 'desktop_get_player_token_state', tokenArgs)
  ).json()
  assert.equal(
    reopened.find((row) => row.display_name === 'SyntheticPlayer-A')
      .data_source,
    'cached'
  )
  check(
    'full native service restart preserves committed targets and disconnected cached state'
  )
  response = await rest(targetQuery, token, undefined, 'DELETE')
  assert.equal(response.status, 200)
  assert.deepEqual(await (await rest(targetQuery, token)).json(), [])
  check('authorized target deletion persists through public readback')
  await writeFile(
    config.raidManagementEvidence || config.evidence,
    JSON.stringify(
      {
        schema: 'desktop-native-raid-management-journey/v1',
        classification: 'synthetic-native-module-proof',
        status: 'passed',
        previousSchemaMigrated: Boolean(config.previousSchemaDirectory),
        normalUid: process.getuid(),
        node: process.version,
        checks,
        scope:
          'Actual native PostgreSQL/Auth/PostgREST; no installed GUI/offline qualification or upstream officer authority inferred.'
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
