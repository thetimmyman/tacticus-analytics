import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { setTimeout } from 'node:timers/promises'

// Registry index digest, including PostgreSQL 17.4 and pg_cron extension 1.6.
const image =
  'public.ecr.aws/supabase/postgres@sha256:d2876f04b74270999881ee26922b145a697b748c109e2d300b5c0a5b156250c7'
const read = (path) =>
  readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8')
const migration = process.argv[2]
  ? readFileSync(process.argv[2], 'utf8')
  : read('supabase/migrations/20261008180000_revoke_public_cron_history.sql')
const rollback = read(
  'supabase/snippets/20261008180000_rollback_revoke_public_cron_history.sql'
)
const suite = read('supabase/tests/pgtap/cron_history_privileges.sql')
const container = `cron-history-${randomUUID()}`
const ledger =
  "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20261008180000';"
let checks = 0
let started = false
let passed = false

function docker(args, input, timeout = 60_000) {
  return spawnSync('docker', args, { input, encoding: 'utf8', timeout })
}
function query(input, user = 'postgres', database = 'postgres') {
  return docker(
    [
      'exec',
      '-i',
      container,
      'psql',
      '-h',
      '/fixture',
      '-X',
      '-qAt',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      user,
      '-d',
      database
    ],
    `\\set VERBOSITY verbose\n${input}`
  )
}
function sql(input, user, database) {
  const result = query(input, user, database)
  assert.equal(result.status, 0, result.error?.message ?? result.stderr)
  return result.stdout.trim()
}
function same(label, actual, expected) {
  assert.deepEqual(actual, expected, label)
  checks += 1
}
function rejected(input, pattern, user, database) {
  const result = query(input, user, database)
  assert.notEqual(result.status, 0, input)
  assert.match(result.stderr, pattern)
  checks += 1
}
const grants = `SELECT scope,a.grantee,a.grantor,a.privilege_type,a.is_grantable FROM (
  SELECT 'table'::text scope,c.relacl acl FROM pg_class c WHERE c.oid='cron.job_run_details'::regclass
  UNION ALL SELECT 'column:'||attname,attacl FROM pg_attribute WHERE attrelid='cron.job_run_details'::regclass AND attnum>0
) g CROSS JOIN LATERAL aclexplode(g.acl) a`
const publicQuery = `SELECT coalesce(jsonb_agg(to_jsonb(g) ORDER BY scope,grantor,privilege_type),'[]') FROM (${grants} WHERE a.grantee=0) g;`
const publicAcl = () => JSON.parse(sql(publicQuery))
function stable() {
  return JSON.parse(
    sql(`SELECT jsonb_build_object(
    'owner',(SELECT relowner FROM pg_class WHERE oid='cron.job_run_details'::regclass),
    'rls',(SELECT jsonb_build_array(relrowsecurity,relforcerowsecurity) FROM pg_class WHERE oid='cron.job_run_details'::regclass),
    'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY polname) FROM pg_policy p WHERE polrelid='cron.job_run_details'::regclass),
    'named',(SELECT jsonb_agg(to_jsonb(g) ORDER BY scope,grantee,grantor,privilege_type) FROM (${grants} WHERE a.grantee<>0) g),
    'schema',(SELECT nspacl FROM pg_namespace WHERE nspname='cron'),
    'other_relations',(SELECT jsonb_agg(jsonb_build_array(relname,relacl) ORDER BY relname) FROM pg_class WHERE relnamespace='cron'::regnamespace AND oid<>'cron.job_run_details'::regclass),
    'functions',(SELECT jsonb_agg(jsonb_build_array(oid,proacl) ORDER BY oid) FROM pg_proc WHERE pronamespace='cron'::regnamespace));`)
  )
}
async function waitFor(label, predicate) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (sql(predicate) === 't') {
      checks += 1
      return
    }
    await setTimeout(500)
  }
  assert.fail(label)
}
function hardened() {
  same('no PUBLIC table or column grant', publicAcl(), [])
  same(
    'named analytics SELECT and no inherited write class',
    sql(
      "SELECT has_table_privilege('analytics_ro','cron.job_run_details','SELECT') AND NOT has_table_privilege('rest_reader','cron.job_run_details','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN');"
    ),
    't'
  )
  sql('GRANT USAGE ON SCHEMA cron TO rest_reader;')
  for (const statement of [
    'SELECT runid FROM cron.job_run_details LIMIT 0;',
    'DELETE FROM cron.job_run_details WHERE false;',
    "UPDATE cron.job_run_details SET status='synthetic' WHERE false;",
    'INSERT INTO cron.job_run_details(jobid,runid) VALUES(0,-100);',
    'TRUNCATE cron.job_run_details;'
  ])
    rejected(statement, /42501:/, 'rest_reader')
  sql('REVOKE USAGE ON SCHEMA cron FROM rest_reader;')
  sql('SELECT runid FROM cron.job_run_details LIMIT 0;', 'analytics_ro')
  checks += 1
}

try {
  const run = docker(
    [
      'run',
      '-d',
      '--rm',
      '--network',
      'none',
      '--name',
      container,
      '--tmpfs',
      '/fixture:rw,uid=101,gid=102,mode=0700',
      '--user',
      '101:102',
      '--entrypoint',
      '/bin/sh',
      image,
      '-c',
      'initdb -D /fixture/data -U postgres --auth=trust >/fixture/initdb.log && exec postgres -D /fixture/data -c shared_preload_libraries=pg_cron -c cron.database_name=postgres -c cron.log_run=on -c cron.use_background_workers=off -c max_worker_processes=20 -c unix_socket_directories=/fixture -c listen_addresses=localhost'
    ],
    undefined,
    180_000
  )
  assert.equal(run.status, 0, run.error?.message ?? run.stderr)
  started = true
  let ready = false
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (
      docker([
        'exec',
        container,
        'pg_isready',
        '-h',
        '/fixture',
        '-U',
        'postgres'
      ]).status === 0
    ) {
      ready = true
      break
    }
    await setTimeout(500)
  }
  assert.ok(ready, 'disposable PostgreSQL must become ready')
  same(
    'PostgreSQL version',
    sql("SELECT current_setting('server_version');"),
    '17.4'
  )
  sql(`CREATE SCHEMA extensions; CREATE SCHEMA supabase_migrations;
    CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text NOT NULL,statements text[]);`)
  rejected(migration, /42704:.*Install pg_cron/)
  same('absent extension leaves no ledger', sql(ledger), '0')
  same(
    'absent extension leaves no target',
    sql("SELECT to_regclass('cron.job_run_details') IS NULL;"),
    't'
  )
  sql('CREATE DATABASE fixture_other;')
  rejected(migration, /requires database postgres/, 'postgres', 'fixture_other')
  same(
    'wrong database leaves no ledger',
    sql(
      "SELECT to_regclass('supabase_migrations.schema_migrations') IS NULL;",
      'postgres',
      'fixture_other'
    ),
    't'
  )
  sql(`CREATE EXTENSION pg_cron;
    CREATE ROLE rest_reader LOGIN BYPASSRLS; CREATE ROLE analytics_ro LOGIN;
    CREATE ROLE fixture_plain LOGIN; CREATE ROLE fixture_column_reader; CREATE ROLE fixture_grantor;
    REVOKE USAGE ON SCHEMA cron FROM PUBLIC;
    GRANT USAGE ON SCHEMA cron TO analytics_ro,fixture_plain;
    GRANT SELECT ON cron.job_run_details TO analytics_ro;
    GRANT SELECT(status) ON cron.job_run_details TO fixture_column_reader;
    INSERT INTO cron.job_run_details(jobid,runid,username,start_time)
    VALUES(0,-1,'postgres',now()),(0,-2,'fixture_plain',now()),(0,-3,'postgres',now());`)
  same(
    'pg_cron version',
    sql("SELECT extversion FROM pg_extension WHERE extname='pg_cron';"),
    '1.6'
  )
  same(
    'PUBLIC DELETE is inherited',
    sql(
      "SELECT has_table_privilege('rest_reader','cron.job_run_details','DELETE');"
    ),
    't'
  )
  rejected('SELECT * FROM cron.job_run_details;', /42501:/, 'rest_reader')
  sql('GRANT USAGE ON SCHEMA cron TO rest_reader;')
  same(
    'latent PUBLIC DELETE becomes executable with schema access',
    sql(
      'WITH d AS (DELETE FROM cron.job_run_details WHERE runid=-1 RETURNING runid) SELECT count(*) FROM d;',
      'rest_reader'
    ),
    '1'
  )
  sql('REVOKE USAGE ON SCHEMA cron FROM rest_reader;')
  same(
    'ordinary RLS exposes only own history',
    sql('SELECT count(*) FROM cron.job_run_details;', 'fixture_plain'),
    '1'
  )
  same(
    'ordinary RLS filters DELETE',
    sql(
      'WITH d AS (DELETE FROM cron.job_run_details WHERE runid IN(-2,-3) RETURNING runid) SELECT count(*) FROM d;',
      'fixture_plain'
    ),
    '1'
  )
  const originalPublic = publicAcl()
  const originalStable = stable()
  sql(`CREATE TABLE public.fixture_state(phase text); INSERT INTO public.fixture_state VALUES('before');
    CREATE TABLE public.fixture_events(at timestamptz DEFAULT clock_timestamp(),phase text,kind text,username text,removed bigint);
    SELECT cron.schedule('fixture-log','2 seconds',$job$INSERT INTO public.fixture_events SELECT clock_timestamp(),phase,'run',current_user,0 FROM public.fixture_state;$job$);
    SELECT cron.schedule('fixture-prune','3 seconds',$job$WITH d AS (DELETE FROM cron.job_run_details WHERE start_time<now()-interval '1 day' RETURNING runid) INSERT INTO public.fixture_events SELECT clock_timestamp(),phase,'prune',current_user,(SELECT count(*) FROM d) FROM public.fixture_state;$job$);`)
  await waitFor(
    'scheduler logs before migration',
    "SELECT EXISTS(SELECT 1 FROM cron.job_run_details WHERE status='succeeded') AND EXISTS(SELECT 1 FROM public.fixture_events WHERE phase='before' AND kind='run' AND username='postgres');"
  )
  sql(migration)
  // Seed cleanup evidence only after the privilege transaction has committed.
  sql(
    "INSERT INTO cron.job_run_details(jobid,runid,username,start_time) VALUES(0,-4,'postgres',now()-interval '2 days'); UPDATE public.fixture_state SET phase='after';"
  )
  hardened()
  same('named grants, RLS and other ACLs preserved', stable(), originalStable)
  await waitFor(
    'scheduler logs after migration',
    "SELECT EXISTS(SELECT 1 FROM public.fixture_events e JOIN cron.job j ON j.jobname='fixture-log' JOIN cron.job_run_details d USING(jobid) WHERE e.phase='after' AND e.kind='run' AND e.username='postgres' AND d.status='succeeded' AND d.start_time>=e.at);"
  )
  await waitFor(
    'scheduled owner pruning continues',
    "SELECT NOT EXISTS(SELECT 1 FROM cron.job_run_details WHERE runid=-4) AND EXISTS(SELECT 1 FROM public.fixture_events WHERE phase='after' AND kind='prune' AND username='postgres' AND removed>0) AND EXISTS(SELECT 1 FROM cron.job_run_details d JOIN cron.job j USING(jobid) WHERE j.jobname='fixture-prune' AND d.status='succeeded');"
  )
  console.log(
    sql('SELECT row_to_json(e) FROM public.fixture_events e ORDER BY at;')
  )
  sql(rollback)
  same('rollback restores grant semantics', publicAcl(), originalPublic)
  same('rollback preserves named grants and RLS', stable(), originalStable)
  same('rollback clears ledger', sql(ledger), '0')
  sql(migration)
  hardened()
  for (const tableGrant of [true, false]) {
    sql(rollback)
    sql('REVOKE ALL PRIVILEGES ON TABLE cron.job_run_details FROM PUBLIC;')
    if (tableGrant)
      sql('GRANT ALL PRIVILEGES ON TABLE cron.job_run_details TO PUBLIC;')
    sql(
      'GRANT SELECT(jobid),INSERT(command),UPDATE(status),REFERENCES(runid) ON TABLE cron.job_run_details TO PUBLIC;'
    )
    sql(migration)
    hardened()
    same(
      'column ACL cleanup preserves named grants and RLS',
      stable(),
      originalStable
    )
  }
  const tap = sql(suite)
  console.log(tap)
  assert.match(tap, /^1\.\.10$/m)
  assert.doesNotMatch(tap, /not ok|#\s*skip/i)
  same(
    'maintained pgTAP executes every assertion',
    (tap.match(/^ok \d+ /gm) ?? []).length,
    10
  )
  sql(`DELETE FROM supabase_migrations.schema_migrations WHERE version='20261008180000';
    GRANT USAGE ON SCHEMA cron TO fixture_grantor;
    GRANT SELECT,DELETE,UPDATE ON TABLE cron.job_run_details TO fixture_grantor WITH GRANT OPTION;
    GRANT SELECT,DELETE ON TABLE cron.job_run_details TO PUBLIC;
    SET ROLE fixture_grantor; GRANT SELECT,DELETE ON TABLE cron.job_run_details TO PUBLIC;
    GRANT UPDATE(status) ON TABLE cron.job_run_details TO PUBLIC; RESET ROLE;`)
  for (const columnOnly of [false, true]) {
    if (columnOnly)
      sql(
        'SET ROLE fixture_grantor; REVOKE SELECT,DELETE ON TABLE cron.job_run_details FROM PUBLIC; RESET ROLE;'
      )
    const before = publicAcl()
    const residual = JSON.parse(
      sql(
        `BEGIN; REVOKE ALL PRIVILEGES ON TABLE cron.job_run_details FROM PUBLIC; ${publicQuery} ROLLBACK;`
      )
    )
    assert.ok(
      residual.some((grant) => grant.scope.startsWith('column:')),
      'owner REVOKE leaves an alternate column grantor'
    )
    if (columnOnly)
      assert.ok(residual.every((grant) => grant.scope !== 'table'))
    rejected(migration, /PUBLIC history privileges remain/)
    same('alternate grantor rejection rolls back ACLs', publicAcl(), before)
    same('alternate grantor rejection leaves no ledger', sql(ledger), '0')
  }
  sql(
    'SET ROLE fixture_grantor; REVOKE ALL PRIVILEGES ON TABLE cron.job_run_details FROM PUBLIC; RESET ROLE; REVOKE ALL PRIVILEGES ON TABLE cron.job_run_details FROM fixture_grantor;'
  )
  sql(migration)
  sql('ALTER EXTENSION pg_cron DROP TABLE cron.job_run_details;')
  const detached = stable()
  for (const input of [migration, rollback]) {
    rejected(input, /Expected the pg_cron-owned history table/)
    same('unrelated relation leaves ACLs unchanged', stable(), detached)
    same('unrelated relation leaves ledger unchanged', sql(ledger), '1')
  }
  sql('ALTER EXTENSION pg_cron ADD TABLE cron.job_run_details;')
  console.log(
    `cron history privileges: ${checks} controls passed; real pg_cron, worker logging/pruning, lifecycle, apply/rollback/reapply, pgTAP 10/10 with zero skips`
  )
  passed = true
} finally {
  if (started) {
    if (!passed) {
      const logs = docker(['logs', container])
      console.error(logs.stdout, logs.stderr)
    }
    docker(['rm', '-f', container])
    assert.notEqual(
      docker(['inspect', container]).status,
      0,
      'owned container must be removed'
    )
  }
}
