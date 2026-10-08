import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { setTimeout } from 'node:timers/promises'

// Genuine disposable login sessions exercise PostgreSQL's role checks. A
// superuser doing SET ROLE alone would not prove that escalation is refused.
const migration = readFileSync(
  new URL(
    '../../../supabase/migrations/20261008001000_policy_rows_trusted_caller.sql',
    import.meta.url
  ),
  'utf8'
)
const rollback = readFileSync(
  new URL(
    '../../../supabase/snippets/20261008001000_rollback_policy_rows_trusted_caller.sql',
    import.meta.url
  ),
  'utf8'
)
const oldMigration = readFileSync(
  new URL(
    '../../../supabase/migrations/20260902020000_player_mapping_rls_recursion_repair_general.sql',
    import.meta.url
  ),
  'utf8'
)
const oldHelper = oldMigration.match(
  /CREATE OR REPLACE FUNCTION public\._pm_caller_policy_rows\(\)[\s\S]*?\$fn\$;/
)?.[0]
assert.ok(oldHelper, 'test uses the actual predecessor helper')
const container = `policy-caller-${randomUUID()}`
const subject = '00000000-0000-4000-8000-00000000d201'
const claims = `SET request.jwt.claims='{"sub":"${subject}","role":"service_role"}';`
let checks = 0

function docker(args, input) {
  return spawnSync('docker', args, { input, encoding: 'utf8', timeout: 60_000 })
}
function query(input, user = 'postgres') {
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
      user,
      '-d',
      'postgres'
    ],
    input
  )
}
function sql(input, user) {
  const result = query(input, user)
  assert.equal(result.status, 0, result.error?.message ?? result.stderr)
  return result.stdout.trim()
}
function equal(input, expected, user, label) {
  assert.equal(sql(input, user), expected, label)
  checks += 1
}
function refused(input, user) {
  const result = query(input, user)
  assert.notEqual(result.status, 0, input)
  assert.match(result.stderr, /42501:/, result.stderr)
  checks += 1
}
function snapshot() {
  return sql(
    `SELECT jsonb_build_object('body',pg_get_functiondef(p.oid),'owner',p.proowner,'acl',p.proacl,'comment',obj_description(p.oid,'pg_proc')) FROM pg_proc p WHERE p.oid='public._pm_caller_policy_rows()'::regprocedure;`
  )
}

try {
  const started = docker([
    'run',
    '-d',
    '--network',
    'none',
    '--name',
    container,
    '-e',
    'POSTGRES_PASSWORD=throwaway',
    'postgres:17'
  ])
  assert.equal(started.status, 0, started.stderr)
  let ready = false
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (
      docker(['exec', container, 'pg_isready', '-U', 'postgres']).status === 0
    ) {
      ready = true
      break
    }
    await setTimeout(1000)
  }
  assert.ok(ready)
  sql(`CREATE ROLE anon LOGIN;
    CREATE ROLE authenticated LOGIN;
    CREATE ROLE service_role LOGIN;
    CREATE ROLE authenticator LOGIN NOINHERIT;
    GRANT anon,authenticated,service_role TO authenticator WITH INHERIT FALSE;
    CREATE ROLE analytics_ro LOGIN NOINHERIT;
    GRANT pg_read_all_stats TO analytics_ro;
    CREATE ROLE command_center_rpc_owner NOLOGIN NOINHERIT;
    CREATE ROLE "Authenticated" LOGIN;
    CREATE ROLE "authenticated " LOGIN;
    CREATE SCHEMA auth;
    CREATE SCHEMA supabase_migrations;
    CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now(),statements text[]);
    CREATE TYPE public.app_role AS ENUM ('member','leader');
    CREATE TABLE public.player_mapping(player_id text,user_id uuid,guild_code text,cluster_code varchar,role public.app_role,is_current boolean,is_app_admin boolean);
    INSERT INTO public.player_mapping VALUES ('SYNTHETIC-MEMBER','${subject}','BOUND-A',NULL,'leader',true,false);
    ${oldHelper}
    REVOKE ALL ON FUNCTION public._pm_caller_policy_rows() FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public._pm_caller_policy_rows() TO anon,authenticated,service_role,analytics_ro,command_center_rpc_owner,"Authenticated","authenticated ";
    GRANT USAGE ON SCHEMA public,auth TO PUBLIC;
    COMMENT ON FUNCTION public._pm_caller_policy_rows() IS 'Synthetic original comment';
    CREATE TABLE public.policy_read(guild_code text);
    INSERT INTO public.policy_read VALUES ('BOUND-A');
    ALTER TABLE public.policy_read ENABLE ROW LEVEL SECURITY;
    GRANT SELECT ON public.policy_read TO PUBLIC;
    CREATE POLICY member_read ON public.policy_read TO PUBLIC USING (guild_code IN (SELECT guild_code FROM public._pm_caller_policy_rows()));
    CREATE FUNCTION public.nested_policy_read() RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS 'SELECT count(*) FROM public.policy_read';
    ALTER FUNCTION public.nested_policy_read() OWNER TO command_center_rpc_owner;`)

  // Both documented shim representations, including production's eager UUID
  // casts. The real helper is unchanged between these auth implementation cases.
  for (const eagerCast of [false, true]) {
    sql(`CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE SET search_path='' AS $uid$
      SELECT ${
        eagerCast
          ? "COALESCE(nullif(current_setting('request.jwt.claim.sub',true),'')::uuid,(nullif(current_setting('request.jwt.claims',true),'')::jsonb ->> 'sub')::uuid)"
          : "COALESCE(nullif(current_setting('request.jwt.claim.sub',true),''),(nullif(current_setting('request.jwt.claims',true),'')::jsonb ->> 'sub'))::uuid"
      };
      $uid$;`)
    const before = snapshot()
    equal(
      `${claims} SELECT count(*) FROM public._pm_caller_policy_rows();`,
      '1',
      'analytics_ro',
      'pre-fix forged JSON reaches membership'
    )
    equal(
      `SET request.jwt.claim.sub='${subject}'; SELECT count(*) FROM public._pm_caller_policy_rows();`,
      '1',
      'analytics_ro',
      'pre-fix flat claim reaches membership'
    )
    equal(
      'SELECT count(*) FROM public.policy_read;',
      '0',
      'analytics_ro',
      'pre-fix ordinary readonly policy completes empty'
    )
    sql(migration)
    const after = snapshot()
    for (const role of [
      'analytics_ro',
      'anon',
      'Authenticated',
      'authenticated '
    ]) {
      equal(
        `${claims} SELECT count(*) FROM public._pm_caller_policy_rows();`,
        '0',
        role,
        'untrusted real role cannot use a forged subject'
      )
      equal(
        `SET request.jwt.claim.sub='${subject}'; SET request.jwt.claim.role='authenticated'; SELECT count(*) FROM public._pm_caller_policy_rows();`,
        '0',
        role,
        'flat claims cannot confer authority'
      )
    }
    refused(
      `\\set VERBOSITY verbose\n${claims} SELECT count(*) FROM public._pm_caller_policy_rows();`,
      'authenticator'
    )
    for (const state of [
      'SET ROLE analytics_ro;',
      'SET ROLE NONE;',
      'RESET ROLE;',
      'BEGIN; SET LOCAL ROLE analytics_ro;',
      'SET SESSION AUTHORIZATION analytics_ro;'
    ]) {
      equal(
        `${claims} ${state} SELECT count(*) FROM public._pm_caller_policy_rows();`,
        '0',
        'analytics_ro',
        state
      )
    }
    for (const badClaims of [
      "SET request.jwt.claims='{';",
      "SET request.jwt.claim.sub='bad-uuid';",
      "SET request.jwt.claims='null';"
    ]) {
      equal(
        `${badClaims} SELECT count(*) FROM public._pm_caller_policy_rows();`,
        '0',
        'analytics_ro',
        'deny before parsing hostile claims'
      )
    }
    equal(
      'SELECT count(*) FROM public.policy_read;',
      '0',
      'analytics_ro',
      'ordinary readonly policy remains empty, without a permission error'
    )
    equal(
      `${claims} SELECT count(*) FROM public.policy_read;`,
      '0',
      'analytics_ro',
      'forged subject does not admit policy rows'
    )
    for (const change of [
      'SET ROLE authenticated;',
      'BEGIN; SET LOCAL ROLE service_role;',
      "SELECT set_config('role','authenticated',false);",
      'SET SESSION AUTHORIZATION authenticated;'
    ]) {
      refused(`\\set VERBOSITY verbose\n${change}`, 'analytics_ro')
    }
    // A login may save a role default it cannot actually assume. PostgreSQL
    // must reject/ignore the unauthorized default when the next session starts.
    sql("ALTER ROLE analytics_ro SET role='authenticated';", 'analytics_ro')
    const defaultAttempt = query(
      `\\set VERBOSITY verbose\n${claims} SELECT count(*) FROM public._pm_caller_policy_rows();`,
      'analytics_ro'
    )
    if (defaultAttempt.status === 0) {
      assert.equal(
        defaultAttempt.stdout.trim(),
        '0',
        'saved defaults cannot elevate the login'
      )
    } else {
      assert.match(defaultAttempt.stderr, /permission denied|not permitted/)
    }
    checks += 1
    sql('ALTER ROLE analytics_ro RESET role;')
    // A permitted role change cannot grant new helper privileges either.
    refused(
      `\\set VERBOSITY verbose\nSET ROLE pg_read_all_stats; ${claims} SELECT count(*) FROM public._pm_caller_policy_rows();`,
      'analytics_ro'
    )
    for (const role of ['authenticated', 'service_role']) {
      equal(
        `${claims} SELECT count(*) FROM public._pm_caller_policy_rows();`,
        '1',
        role,
        'direct trusted role uses session-user fallback'
      )
      equal(
        `${claims} SET ROLE ${role}; SELECT count(*) FROM public._pm_caller_policy_rows();`,
        '1',
        'authenticator',
        'gateway-selected real role resolves membership'
      )
      equal(
        `${claims} SET ROLE ${role}; SELECT public.nested_policy_read();`,
        '1',
        'authenticator',
        'nested definer retains the outer trusted role'
      )
      equal(
        `SET ROLE ${role}; SELECT count(*) FROM public._pm_caller_policy_rows();`,
        '0',
        'authenticator',
        'trusted caller without a subject remains empty'
      )
      equal(
        `\\set VERBOSITY verbose\n${claims} SET ROLE ${role}; SELECT count(*) FROM public.policy_read;`,
        '1',
        'authenticator',
        'trusted policy-backed SELECT preserves membership'
      )
      const malformed = query(
        `\\set VERBOSITY verbose\nSET ROLE ${role}; SET request.jwt.claim.sub='bad-uuid'; SELECT count(*) FROM public._pm_caller_policy_rows();`,
        'authenticator'
      )
      assert.notEqual(malformed.status, 0)
      assert.match(malformed.stderr, /22P02:/)
      checks += 1
    }
    sql(migration)
    assert.equal(snapshot(), after, 'repeat apply preserves the candidate')
    sql(rollback)
    assert.equal(
      snapshot(),
      before,
      'rollback restores exact original definition, comment, owner and ACL'
    )
    equal(
      "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20261008001000';",
      '0',
      'postgres',
      'rollback removes only its ledger entry'
    )
    checks += 2
  }
  console.log(
    `policy caller boundary: ${checks} controls passed; two auth claim implementations, genuine login sessions, apply/repeat/rollback`
  )
} finally {
  docker(['rm', '-f', container])
}
