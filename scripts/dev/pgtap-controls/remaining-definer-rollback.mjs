import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { setTimeout } from 'node:timers/promises'

// Exercise the actual SQL in an isolated, network-disabled disposable database.
const migrationUrl = new URL(
  '../../../supabase/migrations/20261007200000_revoke_remaining_public_definer_execute.sql',
  import.meta.url
)
const rollbackUrl = new URL(
  '../../../supabase/snippets/20261007200000_rollback_remaining_public_definer_execute.sql',
  import.meta.url
)
const migration = readFileSync(process.argv[2] ?? migrationUrl, 'utf8')
const rollback = readFileSync(process.argv[3] ?? rollbackUrl, 'utf8')
const signatures = [...migration.matchAll(/\('(public\.[^']+)', true\)/g)].map(
  (match) => match[1]
)
assert.equal(signatures.length, 21)
const container = `definer-rollback-${randomUUID()}`
const literal = (value) => `'${value.replaceAll("'", "''")}'`
const targets = `ARRAY[${signatures.map(literal).join(',')}]`

function docker(args, input) {
  const result = spawnSync('docker', args, {
    input,
    encoding: 'utf8',
    timeout: 60_000
  })
  assert.equal(result.status, 0, result.error?.message ?? result.stderr)
  return result.stdout.trim()
}
function sql(input) {
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
      'postgres'
    ],
    input
  )
}
function snapshot() {
  return JSON.parse(
    sql(`SELECT jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'grantee',a.grantee,'grantor',a.grantor,'privilege',a.privilege_type,'grantable',a.is_grantable,'body',pg_get_functiondef(p.oid)) ORDER BY p.oid::regprocedure::text,a.grantee,a.grantor,a.privilege_type)
    FROM pg_proc p, LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    WHERE p.oid IN (SELECT to_regprocedure(s) FROM unnest(${targets}) s);`)
  )
}

try {
  docker([
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
  let ready = false
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (
      spawnSync('docker', ['exec', container, 'pg_isready', '-U', 'postgres'])
        .status === 0
    ) {
      ready = true
      break
    }
    await setTimeout(1000)
  }
  assert.ok(ready, 'disposable PostgreSQL must become ready')
  sql(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE ROLE direct_probe LOGIN;
    CREATE SCHEMA supabase_migrations;`)

  for (const ledgerShape of ['standard', 'legacy']) {
    for (const [name, hardened] of [
      ['all PUBLIC', []],
      ['one already hardened', ['public.get_auth_uid()']],
      ['all already hardened', signatures]
    ]) {
      sql(`DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT USAGE ON SCHEMA public TO PUBLIC;
      DROP TABLE IF EXISTS supabase_migrations.schema_migrations;
      CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY, name text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()${ledgerShape === 'standard' ? ', statements text[]' : ''});
      INSERT INTO supabase_migrations.schema_migrations(version,name) VALUES ('20261001000000','synthetic_prior');
      ${ledgerShape === 'standard' ? "UPDATE supabase_migrations.schema_migrations SET statements=ARRAY['SELECT 1'];" : ''}
      ${signatures.map((signature) => `CREATE FUNCTION ${signature} RETURNS integer LANGUAGE sql SECURITY DEFINER AS 'SELECT 1'; GRANT EXECUTE ON FUNCTION ${signature} TO anon,authenticated,service_role;`).join('\n')}
      ${hardened.map((signature) => `REVOKE EXECUTE ON FUNCTION ${signature} FROM PUBLIC;`).join('\n')}`)
      const before = snapshot()
      const priorRowQuery = `SELECT ${ledgerShape === 'standard' ? 'to_jsonb(m)' : "to_jsonb(m)-'statements'"} FROM supabase_migrations.schema_migrations m WHERE version='20261001000000';`
      const priorLedgerRow = JSON.parse(sql(priorRowQuery))
      sql(migration)
      const ledger = JSON.parse(
        sql(
          "SELECT to_json(statements) FROM supabase_migrations.schema_migrations WHERE version='20261007200000';"
        )
      )
      assert.equal(
        ledger.length,
        signatures.length - hardened.length,
        `${name}: record only previously held PUBLIC grants`
      )
      for (const signature of hardened) {
        assert.ok(
          !ledger.includes(
            `REVOKE EXECUTE ON FUNCTION ${signature.replace(/^public\./, '')} FROM PUBLIC`
          ),
          `${name}: omit previously hardened function`
        )
      }
      assert.equal(
        sql(
          `SELECT count(*) FROM unnest(${targets}) s WHERE has_function_privilege('direct_probe',to_regprocedure(s),'EXECUTE');`
        ),
        '0'
      )
      assert.equal(
        sql(
          `SELECT bool_and(has_function_privilege(r,to_regprocedure(s),'EXECUTE')) FROM unnest(${targets}) s CROSS JOIN unnest(ARRAY['anon','authenticated','service_role']) r;`
        ),
        't'
      )
      const after = snapshot()
      sql(migration)
      assert.deepEqual(
        snapshot(),
        after,
        `${name}: repeat preserves ACLs and bodies`
      )
      assert.deepEqual(
        JSON.parse(
          sql(
            "SELECT to_json(statements) FROM supabase_migrations.schema_migrations WHERE version='20261007200000';"
          )
        ),
        ledger,
        `${name}: repeat preserves rollback ledger`
      )
      sql(rollback)
      assert.deepEqual(
        snapshot(),
        before,
        `${name}: rollback exactly restores prior ACLs and bodies`
      )
      assert.equal(
        sql(
          "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20261007200000';"
        ),
        '0'
      )
      assert.deepEqual(
        JSON.parse(sql(priorRowQuery)),
        priorLedgerRow,
        'prior ledger row is unchanged'
      )
      assert.equal(
        sql(
          "SELECT format_type(atttypid,atttypmod) FROM pg_attribute WHERE attrelid='supabase_migrations.schema_migrations'::regclass AND attname='statements' AND NOT attisdropped;"
        ),
        'text[]',
        'nullable compatibility column remains available'
      )
      console.log(
        JSON.stringify({
          case: name,
          ledgerShape,
          result: 'PASS',
          restoredPublicGrants: ledger.length
        })
      )
    }
  }
} finally {
  spawnSync('docker', ['rm', '-f', container], {
    stdio: 'ignore',
    timeout: 60_000
  })
}
