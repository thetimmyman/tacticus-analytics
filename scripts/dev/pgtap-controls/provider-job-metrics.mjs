import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { setTimeout } from 'node:timers/promises'

const baselineOnly = process.argv.includes('--expect-new-on-baseline')
assert(process.argv.slice(2).every((arg) => arg === '--expect-new-on-baseline'))
const image =
  'postgres:17.4-alpine@sha256:7062a2109c4b51f3c792c7ea01e83ed12ef9a980886e3b3d380a7d2e5f6ce3f5'
const container = `provider-metrics-${randomUUID()}`
const baseline = readFileSync(
  new URL(
    '../../../supabase/migrations/20260813000000_clean_baseline.sql',
    import.meta.url
  ),
  'utf8'
)
const migration = readFileSync(
  new URL(
    '../../../supabase/migrations/20261015010000_record_provider_job_metrics.sql',
    import.meta.url
  ),
  'utf8'
)
const rollback = readFileSync(
  new URL(
    '../../../supabase/snippets/20261015010000_rollback_record_provider_job_metrics.sql',
    import.meta.url
  ),
  'utf8'
)
const predecessors = ['complete_job', 'fail_job']
  .map((name) => {
    const match = baseline.match(
      new RegExp(
        `CREATE FUNCTION public\\.${name}\\([^\\n]+\\) RETURNS boolean\\n[\\s\\S]*?\\$\\$;`
      )
    )
    assert(match, 'public predecessor is required')
    return match[0]
  })
  .join('\n')
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const docker = (args, input) =>
  spawnSync('docker', args, { input, encoding: 'utf8', timeout: 60_000 })
const query = (sql, user = 'synthetic_worker', database = 'postgres') =>
  docker(
    [
      'exec',
      '-i',
      container,
      'psql',
      '-XqAt',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      user,
      '-h',
      '127.0.0.1',
      '-d',
      database
    ],
    sql
  )
const execute = (sql, user, database) => {
  const result = query(sql, user, database)
  assert.equal(result.status, 0, result.error?.message ?? result.stderr)
  return result.stdout.trim()
}
const concurrentQuery = (sql) =>
  new Promise((resolve, reject) => {
    const process = spawn('docker', [
      'exec',
      '-i',
      container,
      'psql',
      '-XqAt',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      'synthetic_worker',
      '-h',
      '127.0.0.1',
      '-d',
      'postgres'
    ])
    let output = '',
      errors = ''
    process.stdout.on('data', (chunk) => {
      output += chunk
    })
    process.stderr.on('data', (chunk) => {
      errors += chunk
    })
    process.on('error', reject)
    process.on('close', (code) =>
      code === 0 ? resolve(output.trim()) : reject(new Error(errors))
    )
    process.stdin.end(sql)
  })
const seed = (n, attempts = 1) =>
  execute(
    `INSERT INTO public.sync_queue(id,guild_code,job_type,worker_id,status,attempts) VALUES ('${id(n)}','synthetic','player_sync','synthetic-worker','processing',${attempts});`,
    'postgres'
  )
const metrics = () =>
  JSON.parse(
    execute(
      "SELECT coalesce(json_agg(json_build_array(api_calls,api_errors,api_retry_count,success) ORDER BY job_id), '[]'::json) FROM public.sync_metrics;",
      'synthetic_reader'
    )
  )

try {
  const start = docker([
    'run',
    '-d',
    '--network',
    'none',
    '--name',
    container,
    '-e',
    'POSTGRES_HOST_AUTH_METHOD=trust',
    image
  ])
  assert.equal(start.status, 0, start.stderr)
  let ready = false
  for (let i = 0; i < 30; i++) {
    if (query('SELECT 1', 'postgres').status === 0) {
      ready = true
      break
    }
    await setTimeout(1000)
  }
  assert(ready, 'disposable database must be query-ready')
  execute(
    `
    CREATE ROLE synthetic_worker LOGIN;
    CREATE ROLE synthetic_reader LOGIN;
    CREATE SCHEMA supabase_migrations;
    CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY, name text, statements text[]);
    CREATE TABLE public.sync_queue(
      id uuid PRIMARY KEY, guild_code text, job_type text, worker_id text, status text,
      attempts integer DEFAULT 1, max_attempts integer DEFAULT 3,
      started_at timestamptz DEFAULT now(), completed_at timestamptz, updated_at timestamptz,
      scheduled_for timestamptz, progress jsonb DEFAULT '{}', error_log jsonb DEFAULT '[]'
    );
    CREATE TABLE public.guild_sync_status(
      guild_code text PRIMARY KEY, status text, last_sync timestamptz, updated_at timestamptz,
      records_synced integer, error_message text, last_error text,
      full_sync_at timestamptz, full_sync_success boolean
    );
    CREATE TABLE public.sync_metrics(
      guild_code text, job_id uuid, job_type text, processing_time_ms integer,
      records_processed integer, players_updated integer,
      api_calls integer DEFAULT 0, api_errors integer DEFAULT 0, api_retry_count integer DEFAULT 0,
      success boolean, error_message text
    );
    CREATE FUNCTION public.update_sync_health(text,boolean) RETURNS void LANGUAGE plpgsql AS $$BEGIN RETURN; END;$$;
    GRANT USAGE ON SCHEMA public TO synthetic_worker, synthetic_reader;
    GRANT SELECT, UPDATE ON public.sync_queue, public.guild_sync_status TO synthetic_worker;
    GRANT SELECT, INSERT ON public.sync_metrics TO synthetic_worker;
    GRANT SELECT ON public.sync_metrics, public.sync_queue TO synthetic_reader;
    ${predecessors}
  `,
    'postgres'
  )
  const authorityBefore = execute(
    "SELECT json_agg(json_build_array(proowner,proacl,prosecdef,proconfig) ORDER BY proname) FROM pg_proc WHERE oid IN ('public.complete_job(uuid,text,jsonb,jsonb)'::regprocedure,'public.fail_job(uuid,text,text,jsonb)'::regprocedure);",
    'postgres'
  )
  if (!baselineOnly) {
    execute(
      'ALTER FUNCTION public.complete_job(uuid,text,jsonb,jsonb) SECURITY DEFINER;',
      'postgres'
    )
    assert.notEqual(
      query(migration, 'postgres').status,
      0,
      'unexpected function authority is refused before replacement'
    )
    assert.equal(
      execute(
        'SELECT count(*) FROM supabase_migrations.schema_migrations;',
        'postgres'
      ),
      '0',
      'refused apply leaves no migration receipt'
    )
    execute(
      'ALTER FUNCTION public.complete_job(uuid,text,jsonb,jsonb) SECURITY INVOKER;',
      'postgres'
    )
    execute(migration, 'postgres')
  }
  assert.equal(
    execute(
      "SELECT json_agg(json_build_array(proowner,proacl,prosecdef,proconfig) ORDER BY proname) FROM pg_proc WHERE oid IN ('public.complete_job(uuid,text,jsonb,jsonb)'::regprocedure,'public.fail_job(uuid,text,text,jsonb)'::regprocedure);",
      'postgres'
    ),
    authorityBefore,
    'function authorization is preserved'
  )
  seed(1)
  assert.equal(
    execute(
      `SELECT public.complete_job('${id(1)}','synthetic-worker','{}','{"api_calls":2,"api_errors":1,"api_retry_count":1}');`
    ),
    't'
  )
  assert.deepEqual(
    metrics(),
    [[2, 1, 1, true]],
    'real completion stores supplied provider measurements'
  )
  assert.equal(
    execute(
      `SELECT public.complete_job('${id(1)}','synthetic-worker','{}','{"api_calls":2,"api_errors":1,"api_retry_count":1}');`
    ),
    'f',
    'replayed completion is refused'
  )
  assert.deepEqual(
    metrics(),
    [[2, 1, 1, true]],
    'replay adds no duplicate measurements'
  )
  seed(2)
  assert.equal(
    execute(
      `SELECT public.complete_job('${id(2)}','wrong-worker','{}','{"api_calls":99}');`
    ),
    'f'
  )
  assert.notEqual(
    query(
      `SELECT public.complete_job('${id(2)}','synthetic-worker','{}','{}');`,
      'synthetic_reader'
    ).status,
    0,
    'reader cannot gain worker capability'
  )
  assert.equal(
    execute(
      `SELECT public.fail_job('${id(2)}','synthetic-worker','synthetic failure','{"api_calls":3,"api_errors":2,"api_retry_count":2}');`
    ),
    't'
  )
  assert.deepEqual(
    metrics(),
    [
      [2, 1, 1, true],
      [3, 2, 2, false]
    ],
    'failed attempts also retain measurements'
  )
  assert.equal(
    execute(
      `SELECT error_message FROM public.sync_metrics WHERE job_id='${id(2)}';`,
      'synthetic_reader'
    ),
    'Job execution failed',
    'telemetry does not copy detailed application errors'
  )
  assert.equal(
    execute(
      `SELECT public.fail_job('${id(2)}','synthetic-worker','synthetic failure','{"api_calls":3}');`
    ),
    'f'
  )
  assert.equal(
    execute(
      `SELECT status FROM public.sync_queue WHERE id='${id(2)}';`,
      'synthetic_reader'
    ),
    'pending',
    'existing retry scheduling is preserved'
  )
  seed(3, 3)
  assert.equal(
    execute(
      `SELECT public.fail_job('${id(3)}','synthetic-worker','synthetic failure','{}');`
    ),
    't'
  )
  assert.equal(
    execute(
      `SELECT status FROM public.sync_queue WHERE id='${id(3)}';`,
      'synthetic_reader'
    ),
    'failed',
    'retry exhaustion remains terminal'
  )
  seed(4)
  assert.notEqual(
    query(
      `SELECT public.complete_job('${id(4)}','synthetic-worker','{}','{"api_calls":1,"api_errors":2}');`
    ).status,
    0
  )
  assert.equal(
    execute(
      `SELECT status FROM public.sync_queue WHERE id='${id(4)}';`,
      'synthetic_reader'
    ),
    'processing',
    'invalid observations roll back the transition'
  )
  seed(5)
  const completion = `SELECT public.complete_job('${id(5)}','synthetic-worker','{}','{"api_calls":4,"api_errors":2,"api_retry_count":1}');`
  const receipts = await Promise.all([
    concurrentQuery(
      `BEGIN; SELECT id FROM public.sync_queue WHERE id='${id(5)}' FOR UPDATE; SELECT pg_sleep(0.2); ${completion} COMMIT;`
    ),
    concurrentQuery(completion)
  ])
  assert.deepEqual(
    receipts.map((value) => value.split('\n').filter(Boolean).at(-1)).sort(),
    ['f', 't'],
    'independent concurrent sessions complete the owned attempt once'
  )
  assert.equal(
    execute(
      `SELECT count(*) FROM public.sync_metrics WHERE job_id='${id(5)}';`,
      'synthetic_reader'
    ),
    '1',
    'concurrent callbacks do not duplicate physical measurements'
  )
  execute('CREATE DATABASE synthetic_wrong;', 'postgres')
  assert.notEqual(
    query(migration, 'postgres', 'synthetic_wrong').status,
    0,
    'wrong database is refused'
  )
  const retained = metrics()
  execute(rollback, 'postgres')
  assert.deepEqual(
    metrics(),
    retained,
    'rollback retains already observed traffic'
  )
  assert.equal(
    execute(
      "SELECT md5(prosrc) FROM pg_proc WHERE oid='public.complete_job(uuid,text,jsonb,jsonb)'::regprocedure;",
      'postgres'
    ),
    'bc50fd9768db5fd90306b6bcf440f1b1'
  )
  assert.equal(
    execute(
      "SELECT md5(prosrc) FROM pg_proc WHERE oid='public.fail_job(uuid,text,text,jsonb)'::regprocedure;",
      'postgres'
    ),
    '3d63c61f3124312d6348efc940016b7e'
  )
  execute(migration, 'postgres')
  assert.deepEqual(metrics(), retained, 'reapplication retains observations')
  console.log(
    'PASS: provider job measurements, claim ownership, replay refusal, failed attempts, existing retries, narrow authorization and guarded rollback/reapply'
  )
} finally {
  docker(['rm', '-f', container])
}
