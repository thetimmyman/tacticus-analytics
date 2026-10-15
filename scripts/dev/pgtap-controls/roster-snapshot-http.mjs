import assert from 'node:assert/strict'
import { createHmac, randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { PostgrestClient } from '@supabase/postgrest-js'

const image =
  'postgrest/postgrest@sha256:e5978740a590628f2114730bb942f35342ea70b8b7a86697a3df283c0caea109'
function docker(args) {
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 60000 })
  assert.equal(result.status, 0, result.error?.message ?? result.stderr)
  return result.stdout.trim()
}

/** Real primary HTTP contract, using only a synthetic internal Docker network. */
export async function rosterSnapshotHttp({
  container,
  network,
  sql,
  owner,
  rows
}) {
  const name = `${container}-rest`,
    secret = randomBytes(32).toString('hex'),
    password = randomBytes(24).toString('hex')
  sql(
    `CREATE ROLE fixture_rest LOGIN NOINHERIT PASSWORD '${password}'; GRANT anon,authenticated,service_role TO fixture_rest; GRANT USAGE ON SCHEMA public TO fixture_rest,anon,authenticated,service_role;`
  )
  const token = (role) => {
    const unsigned = [
      { alg: 'HS256', typ: 'JWT' },
      { role, exp: Math.floor(Date.now() / 1000) + 600 }
    ]
      .map((value) => Buffer.from(JSON.stringify(value)).toString('base64url'))
      .join('.')
    return `${unsigned}.${createHmac('sha256', secret).update(unsigned).digest('base64url')}`
  }
  try {
    docker([
      'run',
      '-d',
      '--name',
      name,
      '--network',
      network,
      '-e',
      `PGRST_DB_URI=postgres://fixture_rest:${password}@${container}:5432/postgres`,
      '-e',
      `PGRST_JWT_SECRET=${secret}`,
      '-e',
      'PGRST_DB_SCHEMAS=public',
      '-e',
      'PGRST_DB_ANON_ROLE=anon',
      '-e',
      'PGRST_DB_CONFIG=false',
      '-e',
      'PGRST_DB_CHANNEL_ENABLED=false',
      '-e',
      'PGRST_DB_POOL=2',
      image
    ])
    const address = docker([
      'inspect',
      '-f',
      '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}',
      name
    ])
    const url = `http://${address}:3000`
    let ready = false
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(300) })
        await response.body?.cancel()
        if (response.ok) {
          ready = true
          break
        }
      } catch {}
      await delay(100)
    }
    assert(ready, 'the isolated primary PostgREST fixture must become ready')
    const client = (role) =>
      new PostgrestClient(url, {
        headers: { Authorization: `Bearer ${token(role)}` }
      })
    const service = client('service_role')
    const candidates = await service.rpc(
      'get_player_roster_refresh_candidates',
      {
        p_mapping_ids: [1],
        p_fresh_seconds: 1200,
        p_retry_seconds: 300,
        p_require_enabled_guild: true
      }
    )
    assert.equal(candidates.error, null)
    assert.deepEqual(
      candidates.data,
      [1],
      'the SDK receives the scalar-set candidate array over real HTTP'
    )
    const observation = await service.rpc('begin_player_roster_refresh', {
      p_player_mapping_id: 1,
      p_user_id: owner
    })
    assert.equal(observation.error, null)
    assert.equal(observation.data.playerMappingId, 1)
    const committed = await service.rpc('persist_player_roster_snapshot', {
      p_player_mapping_id: 1,
      p_user_id: owner,
      p_attempt_id: observation.data.attemptId,
      p_rows: rows,
      p_player_power: 20,
      p_complete: true
    })
    assert.equal(committed.error, null)
    assert.equal(committed.data.complete, true)
    const summary = await service.rpc(
      'get_player_roster_verification_summary',
      { p_mapping_ids: [1], p_fresh_seconds: 21600 }
    )
    assert.equal(summary.error, null)
    assert.equal(summary.data.fresh, 1)
    assert.equal(
      Date.parse(summary.data.oldestVerifiedAt),
      Date.parse(observation.data.observedAt)
    )
    sql(
      "UPDATE public.player_roster_sync_state SET attempted_at=now()-interval '10 minutes' WHERE player_mapping_id=6"
    )
    const concurrent = await Promise.all(
      Array.from({ length: 2 }, () =>
        service.rpc('try_begin_player_roster_refresh', {
          p_player_mapping_id: 6,
          p_user_id: null,
          p_fresh_seconds: 1200,
          p_retry_seconds: 300,
          p_require_enabled_guild: true
        })
      )
    )
    assert(concurrent.every((result) => result.error === null))
    assert.equal(
      concurrent.filter((result) => result.data !== null).length,
      1,
      'separate HTTP transactions coalesce the same selected background member'
    )
    for (const role of ['anon', 'authenticated']) {
      const denied = await client(role).rpc(
        'get_player_roster_verification_summary',
        { p_mapping_ids: [1], p_fresh_seconds: 21600 }
      )
      assert(
        denied.error && denied.status >= 400,
        'end-user roles cannot bypass the scoped server summary'
      )
    }
    assert(
      (await service.from('player_roster_sync_state').select('*')).error,
      'service callers cannot read raw snapshot metadata'
    )
    console.log(
      'PASS: real primary PostgREST/SDK shapes, scoped role refusals, atomic snapshot and concurrent background coalescing'
    )
  } finally {
    spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore', timeout: 60000 })
  }
}
