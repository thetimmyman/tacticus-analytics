import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { rosterSnapshotHttp } from './roster-snapshot-http.mjs'

const container = `roster-snapshot-${randomUUID()}`
const network = `${container}-network`
let networkCreated = false
const migration = readFileSync(
  new URL(
    '../../../supabase/migrations/20261015020000_atomic_roster_snapshots.sql',
    import.meta.url
  ),
  'utf8'
)
const rollback = readFileSync(
  new URL(
    '../../../supabase/snippets/20261015020000_rollback_atomic_roster_snapshots.sql',
    import.meta.url
  ),
  'utf8'
)
const owner = '00000000-0000-4000-8000-000000000001'
const sqlString = (value) => `'${value.replaceAll("'", "''")}'`
function docker(args, input) {
  const result = spawnSync('docker', args, {
    input,
    encoding: 'utf8',
    timeout: 60000
  })
  assert.equal(result.status, 0, result.error?.message ?? result.stderr)
  return result.stdout.trim()
}
function sql(statement, database = 'postgres') {
  return docker(
    [
      'exec',
      '-i',
      container,
      'psql',
      '-X',
      '-qAt',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      'postgres',
      '-d',
      database
    ],
    statement
  )
}
function service(statement) {
  return sql(`SET ROLE service_role; ${statement}`)
}
function concurrentService(statement) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'docker',
      [
        'exec',
        '-i',
        container,
        'psql',
        '-X',
        '-qAt',
        '-v',
        'ON_ERROR_STOP=1',
        '-U',
        'postgres',
        '-d',
        'postgres'
      ],
      { timeout: 60000 }
    )
    let output = '',
      error = ''
    child.stdout.on('data', (bytes) => {
      output += bytes
    })
    child.stderr.on('data', (bytes) => {
      error += bytes
    })
    child.on('error', reject)
    child.on('close', (code) =>
      code === 0 ? resolve(JSON.parse(output)) : reject(new Error(error))
    )
    child.stdin.end(`SET ROLE service_role; ${statement}`)
  })
}
try {
  docker(['network', 'create', '--internal', network])
  networkCreated = true
  docker([
    'run',
    '-d',
    '--network',
    network,
    '--name',
    container,
    '-e',
    'POSTGRES_PASSWORD=throwaway',
    'postgres:17'
  ])
  let ready = false
  for (let attempt = 0; attempt < 60; attempt++) {
    if (
      spawnSync('docker', [
        'exec',
        container,
        'pg_isready',
        '-h',
        '127.0.0.1',
        '-U',
        'postgres'
      ]).status === 0
    ) {
      ready = true
      break
    }
    await delay(1000)
  }
  assert(ready, 'disposable PostgreSQL must become ready')
  sql(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]);
    CREATE TABLE public.guild_config(guild_code text PRIMARY KEY,enabled boolean,auto_sync_enabled boolean);
    INSERT INTO public.guild_config VALUES ('SYNTHETIC',true,true),('DISABLED',false,true);
    CREATE TABLE public.player_mapping(id integer PRIMARY KEY,user_id uuid REFERENCES auth.users(id),player_id text NOT NULL,is_current boolean NOT NULL DEFAULT true,player_power bigint,updated_at timestamptz,last_sync_at timestamp,guild_code text DEFAULT 'SYNTHETIC');
    CREATE TABLE public.hero_mappings(id integer PRIMARY KEY);
    CREATE TABLE public.player_roster(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,user_id uuid REFERENCES auth.users(id),player_mapping_id integer REFERENCES public.player_mapping(id),hero_mapping_id integer REFERENCES public.hero_mappings(id),rank_name text NOT NULL,stars integer,progression_index integer,rarity text,xp_level integer,active_ability_level integer,passive_ability_level integer,crit_item_id text,crit_item_level integer,defensive_item_id text,defensive_item_level integer,booster_item_id text,booster_item_level integer,synced_at timestamptz,
      UNIQUE(user_id,hero_mapping_id),UNIQUE(player_mapping_id,hero_mapping_id));
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO authenticated,service_role;
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO authenticated,service_role;
    INSERT INTO auth.users VALUES ('${owner}');
    INSERT INTO public.player_mapping(id,user_id,player_id,player_power,last_sync_at) VALUES (1,'${owner}','synthetic-player',10,now());
    INSERT INTO public.hero_mappings VALUES (10),(11);`)
  sql(migration)
  const candidates = (ids = [1]) =>
    JSON.parse(
      service(
        `SELECT coalesce(json_agg(id),'[]') FROM public.get_player_roster_refresh_candidates(ARRAY[${ids.join(',')}]::integer[],1200,300) id`
      )
    )
  assert.deepEqual(
    candidates(),
    [1],
    'token freshness does not certify a never-imported roster'
  )
  const summary = (ids = [1]) =>
    JSON.parse(
      service(
        `SELECT public.get_player_roster_verification_summary(ARRAY[${ids.join(',')}]::integer[],21600)`
      )
    )
  assert.deepEqual(summary(), {
    total: 1,
    verified: 0,
    fresh: 0,
    oldestVerifiedAt: null
  })
  const begin = () =>
    JSON.parse(
      service(`SELECT public.begin_player_roster_refresh(1,'${owner}');`)
    )
  const receipt = begin()
  assert.equal(receipt.playerMappingId, 1)
  assert.match(receipt.attemptId, /^[0-9a-f-]{36}$/)
  assert(Number.isFinite(Date.parse(receipt.observedAt)))
  const rows = [
    { hero_mapping_id: 10, rank_name: 'Stone 1', stars: 0, rarity: 'Common' }
  ]
  const persist = (attempt = receipt.attemptId, power = 20, payload = rows) =>
    JSON.parse(
      service(
        `SELECT public.persist_player_roster_snapshot(1,'${owner}','${attempt}',${sqlString(JSON.stringify(payload))}::jsonb,${power},true);`
      )
    )
  assert.equal(persist().upserted, 1)
  assert.equal(summary().fresh, 1)
  assert.equal(
    Date.parse(summary().oldestVerifiedAt),
    Date.parse(receipt.observedAt),
    'verification is dated from the observation, not a later save'
  )
  assert.deepEqual(
    candidates(),
    [],
    'complete roster verification suppresses a second background read'
  )
  const before = sql(
    'SELECT id,xmin,synced_at FROM public.player_roster ORDER BY id'
  )
  const second = begin()
  const unchanged = persist(second.attemptId)
  assert.equal(unchanged.upserted, 0)
  assert.equal(unchanged.unchanged, true)
  assert.equal(
    sql('SELECT id,xmin,synced_at FROM public.player_roster ORDER BY id'),
    before,
    'unchanged imported rows are not rewritten'
  )
  assert.equal(
    sql('SELECT player_power FROM public.player_mapping WHERE id=1'),
    '20'
  )
  const state = () =>
    sql(
      'SELECT row_to_json(s) FROM public.player_roster_sync_state s WHERE player_mapping_id=1'
    )
  const unchangedState = state()
  assert.equal(persist(second.attemptId).idempotent, true)
  assert.equal(
    state(),
    unchangedState,
    'replayed delivery cannot extend verification'
  )
  assert.equal(persist(receipt.attemptId, 999).status, 'superseded')
  assert.equal(state(), unchangedState)
  const invalid = begin()
  const priorPower = sql(
    'SELECT player_power FROM public.player_mapping WHERE id=1'
  )
  const priorRows = sql(
    'SELECT row_to_json(r) FROM public.player_roster r ORDER BY id'
  )
  const priorState = state()
  assert.throws(
    () =>
      persist(invalid.attemptId, 999, [{ ...rows[0], hero_mapping_id: 99 }]),
    /foreign key/
  )
  assert.equal(
    sql('SELECT player_power FROM public.player_mapping WHERE id=1'),
    priorPower,
    'failed roster writes roll power back too'
  )
  assert.equal(
    sql('SELECT row_to_json(r) FROM public.player_roster r ORDER BY id'),
    priorRows
  )
  assert.equal(
    state(),
    priorState,
    'failed snapshots do not stamp successful freshness'
  )
  assert.throws(
    () =>
      persist(invalid.attemptId, 999, [
        { ...rows[0], privatePayload: 'synthetic-value' }
      ]),
    /Invalid roster snapshot/
  )
  assert.throws(
    () => persist(invalid.attemptId, 999, [rows[0], rows[0]]),
    /Invalid roster snapshot/
  )
  const older = begin(),
    newer = begin()
  assert.equal(persist(older.attemptId, 999).status, 'superseded')
  assert.equal(
    persist(newer.attemptId, 30, [{ ...rows[0], rank_name: 'Stone 2' }])
      .upserted,
    1
  )
  const concurrent = begin()
  const duplicateSql = `SELECT public.persist_player_roster_snapshot(1,'${owner}','${concurrent.attemptId}',${sqlString(JSON.stringify([{ ...rows[0], rank_name: 'Stone 3' }]))}::jsonb,40,true);`
  const callbacks = await Promise.all([
    concurrentService(duplicateSql),
    concurrentService(duplicateSql)
  ])
  assert.equal(
    callbacks.filter((result) => result.idempotent === true).length,
    1,
    'independent database sessions commit one observation only once'
  )
  const current = state()
  assert.equal(
    sql(
      "SELECT has_table_privilege('service_role','public.player_roster_sync_state','SELECT')"
    ),
    'f'
  )
  for (const role of ['anon', 'authenticated']) {
    assert.throws(
      () =>
        sql(
          `SET ROLE ${role}; SELECT public.begin_player_roster_refresh(1,'${owner}');`
        ),
      /permission denied/
    )
    assert.throws(
      () =>
        sql(`SET ROLE ${role}; SELECT * FROM public.player_roster_sync_state;`),
      /permission denied/
    )
  }
  sql(rollback)
  assert.throws(() => begin(), /permission denied/)
  assert.throws(() => candidates(), /permission denied/)
  assert.throws(() => summary(), /permission denied/)
  assert.equal(
    state(),
    current,
    'rollback retains observation and snapshot state'
  )
  sql(migration)
  assert.equal(
    state(),
    current,
    'reapply preserves existing freshness and outcomes'
  )
  assert.equal(persist(concurrent.attemptId).idempotent, true)
  sql('CREATE DATABASE wrong_target')
  assert.throws(
    () => sql(migration, 'wrong_target'),
    /requires the General database/
  )
  assert.equal(
    sql(
      "SELECT to_regclass('public.player_roster_sync_state') IS NULL",
      'wrong_target'
    ),
    't'
  )
  const other = '00000000-0000-4000-8000-000000000002'
  sql(
    `INSERT INTO auth.users VALUES ('${other}'); INSERT INTO public.player_mapping(id,user_id,player_id) VALUES (2,NULL,'synthetic-unclaimed');`
  )
  const unclaimed = JSON.parse(
    service('SELECT public.begin_player_roster_refresh(2,NULL)')
  )
  const unclaimedResult = JSON.parse(
    service(
      `SELECT public.persist_player_roster_snapshot(2,NULL,'${unclaimed.attemptId}',${sqlString(JSON.stringify(rows))}::jsonb,10,true)`
    )
  )
  assert.equal(
    unclaimedResult.upserted,
    1,
    'unclaimed rows retain their mapping-based conflict key'
  )
  sql(`UPDATE public.player_mapping SET user_id='${other}' WHERE id=2`)
  assert.throws(
    () =>
      service(
        `SELECT public.persist_player_roster_snapshot(2,NULL,'${unclaimed.attemptId}',${sqlString(JSON.stringify(rows))}::jsonb,10,true)`
      ),
    /Invalid roster owner/
  )
  const claimed = JSON.parse(
    service(`SELECT public.begin_player_roster_refresh(2,'${other}')`)
  )
  const claimedResult = JSON.parse(
    service(
      `SELECT public.persist_player_roster_snapshot(2,'${other}','${claimed.attemptId}',${sqlString(JSON.stringify(rows))}::jsonb,10,true)`
    )
  )
  assert.equal(claimedResult.upserted, 1)
  sql(
    `DELETE FROM public.player_roster WHERE user_id='${other}'; UPDATE public.player_mapping SET user_id=NULL WHERE id=2; DELETE FROM auth.users WHERE id='${other}';`
  )
  assert.equal(
    sql(
      'SELECT count(*) FROM public.player_roster_sync_state WHERE player_mapping_id=2'
    ),
    '0',
    'account erasure removes its snapshot metadata'
  )
  sql(`INSERT INTO public.player_mapping(id,player_id,guild_code,is_current) VALUES
    (3,'synthetic-disabled','DISABLED',true),(4,'synthetic-retired','SYNTHETIC',false),
    (5,'synthetic-failed','SYNTHETIC',true),(6,'synthetic-never','SYNTHETIC',true)`)
  service('SELECT public.begin_player_roster_refresh(5,NULL)')
  sql(
    "UPDATE public.player_roster_sync_state SET attempted_at=now()-interval '2 hours' WHERE player_mapping_id=5"
  )
  assert.deepEqual(
    candidates([1, 2, 3, 4, 5, 6]),
    [2, 6, 5],
    'never-attempted and enabled current members precede older failures deterministically'
  )
  service('SELECT public.begin_player_roster_refresh(2,NULL)')
  assert.deepEqual(
    candidates([1, 2, 3, 4, 5, 6]),
    [6, 5],
    'failed or pending attempts respect the cooldown'
  )
  sql(
    "UPDATE public.player_roster_sync_state SET attempted_at=now()-interval '10 minutes' WHERE player_mapping_id=2"
  )
  assert.deepEqual(
    candidates([1, 2, 3, 4, 5, 6]),
    [6, 5, 2],
    'a failed head rotates behind the remaining cohort'
  )
  const verifiedBeforePartial = JSON.parse(state()).verified_at
  const partial = begin()
  const partialResult = JSON.parse(
    service(
      `SELECT public.persist_player_roster_snapshot(1,'${owner}','${partial.attemptId}','[]',20,false)`
    )
  )
  assert.equal(partialResult.complete, false)
  assert.equal(
    JSON.parse(state()).verified_at,
    verifiedBeforePartial,
    'partial evidence does not advance verification'
  )
  sql(
    "UPDATE public.player_roster_sync_state SET attempted_at=now()-interval '10 minutes' WHERE player_mapping_id=1"
  )
  assert.deepEqual(
    candidates(),
    [1],
    'partial evidence is not fresh even if an earlier verified stamp is recent'
  )
  sql(`UPDATE public.player_mapping SET user_id='${owner}' WHERE id=5`)
  assert.deepEqual(
    candidates([5]),
    [5],
    'new ownership cannot inherit an old attempt or verified stamp'
  )
  for (const role of ['anon', 'authenticated'])
    assert.throws(
      () =>
        sql(
          `SET ROLE ${role}; SELECT * FROM public.get_player_roster_refresh_candidates(ARRAY[1],1200,300)`
        ),
      /permission denied/
    )
  assert.throws(
    () =>
      service(
        'SELECT * FROM public.get_player_roster_refresh_candidates(ARRAY[NULL]::integer[],1200,300)'
      ),
    /Invalid roster selection/
  )
  const background = await Promise.all([
    concurrentService(
      'SELECT public.try_begin_player_roster_refresh(6,NULL,1200,300,true)'
    ),
    concurrentService(
      'SELECT public.try_begin_player_roster_refresh(6,NULL,1200,300,true)'
    )
  ])
  assert.equal(
    background.filter(Boolean).length,
    1,
    'overlapping background selections yield only one observation before provider dispatch'
  )
  assert.deepEqual(
    summary([1, 2, 3, 4, 5, 6]),
    { total: 5, verified: 0, fresh: 0, oldestVerifiedAt: null },
    'partial, unverified, retired and previous-owner states cannot claim current verification'
  )
  for (const role of ['anon', 'authenticated'])
    assert.throws(
      () =>
        sql(
          `SET ROLE ${role}; SELECT public.get_player_roster_verification_summary(ARRAY[1],21600)`
        ),
      /permission denied/
    )
  await rosterSnapshotHttp({ container, network, sql, owner, rows })
  console.log(
    'PASS: atomic/unchanged roster writes, fenced/replayed observations, owner changes, private roles, retained rollback/reapply and wrong-target guard'
  )
} finally {
  spawnSync('docker', ['rm', '-f', container], {
    stdio: 'ignore',
    timeout: 60000
  })
  if (networkCreated)
    spawnSync('docker', ['network', 'rm', network], {
      stdio: 'ignore',
      timeout: 60000
    })
}
