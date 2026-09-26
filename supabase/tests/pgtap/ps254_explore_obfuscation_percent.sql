-- Acceptance script: the obfuscation honours the percent and cannot be inverted. Run
-- by hand, never during a salt rotation: (f1) row-locks the internal.cron_secrets salt row.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;

SELECT plan(30);

-- Capture as each role, assert after (pgtap is unreachable under those roles).
-- Read every column: count(*) never evaluates the column expression.
SET LOCAL ROLE anon;
CREATE TEMP TABLE ps254_read_anon AS
SELECT count(*) AS n,
       md5(COALESCE(string_agg(
         COALESCE(t.total_damage::text, 'n') ||
         COALESCE(t.average_damage::text, 'n') ||
         COALESCE(t.avg_damage_per_battle::text, 'n') ||
         COALESCE(t.top_boss_hits::text, 'n'), ',' ORDER BY t.guild_code, t.season), '')) AS digest
  FROM public.public_guild_snapshots_explore t;
RESET ROLE;

SET LOCAL ROLE authenticated;
CREATE TEMP TABLE ps254_read_auth AS
SELECT count(*) AS n,
       md5(COALESCE(string_agg(
         COALESCE(t.total_damage::text, 'n') ||
         COALESCE(t.average_damage::text, 'n') ||
         COALESCE(t.avg_damage_per_battle::text, 'n') ||
         COALESCE(t.top_boss_hits::text, 'n'), ',' ORDER BY t.guild_code, t.season), '')) AS digest
  FROM public.public_guild_snapshots_explore t;
RESET ROLE;

SELECT is(
  (SELECT n::int FROM ps254_read_anon),
  (SELECT count(*)::int FROM public.public_guild_snapshots_explore),
  '(0) anon selects the obfuscated COLUMNS of every row, not merely counts them'
);

SELECT is(
  (SELECT digest FROM ps254_read_auth),
  (SELECT digest FROM ps254_read_anon),
  '(0) authenticated reads the same obfuscated figures as anon'
);

SELECT cmp_ok(
  (SELECT n::int FROM ps254_read_anon), '>', 0,
  '(0) positive control: the read returned rows, so the digest is not of nothing'
);

SELECT is(
  (SELECT count(*)::int
     FROM public.public_guild_snapshots b
     LEFT JOIN internal.explore_obfuscation_cache c
       ON c.guild_code = b.guild_code AND c.season = b.season
    WHERE b.explore_privacy_mode @> '["obfuscate_values"]'::jsonb
      AND (c.factor IS NULL OR c.obf_total IS NULL)),
  0,
  '(0) every obfuscating row has a precomputed factor'
);

SELECT has_table(
  'internal', 'explore_obfuscation_cache',
  '(0) the precomputed-factor table exists'
);

SELECT is(
  (SELECT count(*)::int FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) AS r(role)
    WHERE has_table_privilege(r.role, 'internal.explore_obfuscation_cache', 'SELECT')),
  0,
  '(0) no PostgREST role can read the factor table directly'
);

SELECT has_table(
  'internal', 'cron_secrets',
  'the PS-22 secret corridor internal.cron_secrets exists'
);

SELECT is(
  (SELECT count(*)::int FROM internal.cron_secrets
    WHERE name = 'explore_obfuscation_salt' AND length(COALESCE(value, '')) >= 32),
  1,
  'the corridor holds exactly one usable explore_obfuscation_salt row'
);

SELECT hasnt_schema(
  'private',
  'no second secret store: schema private is absent'
);

SELECT has_function(
  'internal', 'explore_obfuscate_amount', ARRAY['numeric', 'integer', 'text'],
  'internal.explore_obfuscate_amount(numeric, integer, text) exists'
);

-- Scoped to the salt: public SECURITY DEFINER wrappers may read other corridor secrets.
SELECT is(
  (SELECT count(*)::int
     FROM pg_catalog.pg_proc p
     JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('public', 'graphql_public')
      AND ( p.proname = 'explore_obfuscate_amount'
            OR COALESCE(p.prosrc, '') ILIKE '%explore_obfuscation_salt%' )),
  0,
  'no function in a PostgREST-exposed schema names the obfuscation salt or its arithmetic'
);

SELECT is(
  (SELECT count(*)::int
     FROM pg_catalog.pg_proc p
     JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE COALESCE(p.prosrc, '') ILIKE '%explore_obfuscation_salt%'
      AND NOT (n.nspname = 'internal' AND p.proname = 'explore_obfuscate_amount')),
  0,
  'internal.explore_obfuscate_amount is the only function anywhere that names the salt'
);

-- Magnitudes include ones where the 25 000 grid is coarse relative to the band.
SELECT is(
  (SELECT count(*)::int
     FROM generate_series(1, 30) AS p,
          LATERAL (SELECT unnest(ARRAY[1000, 24999, 25000, 25001, 100000,
                                       284591, 93915167, 589996405,
                                       733347326]::numeric[]) AS v) a
    WHERE abs(internal.explore_obfuscate_amount(a.v, p, 'pgtap|' || p::text || '|' || a.v::text) - a.v)
            / a.v * 100
          NOT BETWEEN p::numeric / 2 - GREATEST(0.01, 100::numeric / a.v)
                  AND p::numeric     + GREATEST(0.01, 100::numeric / a.v)),
  0,
  '(a) every synthetic amount at every percent lands inside [p/2, p]'
);

SELECT is(
  (SELECT count(*)::int
     FROM public.public_guild_snapshots b
     JOIN public.public_guild_snapshots_explore v
       ON v.guild_code = b.guild_code AND v.season = b.season
     CROSS JOIN LATERAL (
       SELECT least(30, greatest(1, COALESCE(b.explore_obfuscation_percent, 10)))::numeric AS p
     ) k
     CROSS JOIN LATERAL (VALUES
       (b.total_damage,          v.total_damage),
       (b.average_damage,        v.average_damage),
       (b.avg_damage_per_battle, v.avg_damage_per_battle)
     ) AS col(truth, served)
    WHERE b.explore_privacy_mode @> '["obfuscate_values"]'::jsonb
      AND COALESCE(col.truth, 0) > 0
      AND abs(col.served - col.truth)::numeric / col.truth::numeric * 100
          NOT BETWEEN k.p / 2 - GREATEST(0.01, 100::numeric / col.truth::numeric)
                  AND k.p     + GREATEST(0.01, 100::numeric / col.truth::numeric)),
  0,
  '(b) every obfuscating row is served inside its band on all three numeric columns'
);

SELECT is(
  (SELECT count(*)::int
     FROM public.public_guild_snapshots b
     JOIN public.public_guild_snapshots_explore v
       ON v.guild_code = b.guild_code AND v.season = b.season
     CROSS JOIN LATERAL (
       SELECT least(30, greatest(1, COALESCE(b.explore_obfuscation_percent, 10)))::numeric AS p
     ) k
     CROSS JOIN LATERAL jsonb_array_elements(
       CASE WHEN jsonb_typeof(b.top_boss_hits::jsonb) = 'array'
            THEN b.top_boss_hits::jsonb ELSE '[]'::jsonb END) WITH ORDINALITY AS bt(hit, ord)
     CROSS JOIN LATERAL jsonb_array_elements(
       CASE WHEN jsonb_typeof(v.top_boss_hits::jsonb) = 'array'
            THEN v.top_boss_hits::jsonb ELSE '[]'::jsonb END) WITH ORDINALITY AS vt(hit, ord)
    WHERE b.explore_privacy_mode @> '["obfuscate_values"]'::jsonb
      AND NOT (b.explore_privacy_mode @> '["hide_primes"]'::jsonb)
      AND bt.ord = vt.ord
      AND jsonb_typeof(bt.hit -> 'damage') = 'number'
      AND (bt.hit ->> 'damage')::numeric > 0
      AND abs((vt.hit ->> 'damage')::numeric - (bt.hit ->> 'damage')::numeric)
            / (bt.hit ->> 'damage')::numeric * 100
          NOT BETWEEN k.p / 2 - GREATEST(0.01, 100::numeric / (bt.hit ->> 'damage')::numeric)
                  AND k.p     + GREATEST(0.01, 100::numeric / (bt.hit ->> 'damage')::numeric)),
  0,
  '(b) every individual hit of every obfuscating row is served inside the band'
);

SELECT cmp_ok(
  (SELECT count(*)::int FROM public.public_guild_snapshots
    WHERE explore_privacy_mode @> '["obfuscate_values"]'::jsonb
      AND COALESCE(total_damage, 0) > 0),
  '>', 0,
  '(b) positive control: at least one obfuscating row with a positive total exists'
);

SELECT is(
  (SELECT count(*)::int
     FROM public.public_guild_snapshots b
     JOIN public.public_guild_snapshots_explore v
       ON v.guild_code = b.guild_code AND v.season = b.season
     CROSS JOIN LATERAL (
       SELECT least(30, greatest(1, COALESCE(b.explore_obfuscation_percent, 10)))::numeric AS p,
              abs(b.avg_damage_per_battle::numeric * b.total_battles::numeric
                  - b.total_damage::numeric) / b.total_damage::numeric * 100 AS skew
     ) k
    WHERE b.explore_privacy_mode @> '["obfuscate_values"]'::jsonb
      AND COALESCE(b.total_damage, 0) > 0
      AND COALESCE(b.total_battles, 0) > 0
      AND COALESCE(b.avg_damage_per_battle, 0) > 0
      AND abs(v.avg_damage_per_battle::numeric * b.total_battles::numeric
              - b.total_damage::numeric) / b.total_damage::numeric * 100
          NOT BETWEEN k.p / 2 - k.skew - 0.01 AND k.p + k.skew + 0.01),
  0,
  '(c) average x battles reconstructs the SERVED total, inside the band around the truth'
);

SELECT is(
  (SELECT count(*)::int FROM public.public_guild_snapshots_explore
    WHERE explore_privacy_mode @> '["obfuscate_values"]'::jsonb
      AND explore_obfuscation_percent IS NOT NULL),
  0,
  '(d) no obfuscating row serves explore_obfuscation_percent'
);

SELECT is(
  (SELECT count(*)::int FROM public.public_guild_snapshots_explore
    WHERE NOT (explore_privacy_mode @> '["obfuscate_values"]'::jsonb)
      AND explore_obfuscation_percent IS NULL),
  0,
  '(d) non-obfuscating rows keep explore_obfuscation_percent -- this is a redaction, not a broken column'
);

SELECT is(
  (SELECT count(*)::int
     FROM public.public_guild_snapshots_explore v
     CROSS JOIN LATERAL jsonb_array_elements(
       CASE WHEN jsonb_typeof(v.top_boss_hits::jsonb) = 'array'
            THEN v.top_boss_hits::jsonb ELSE '[]'::jsonb END) AS h(hit)
    WHERE v.explore_privacy_mode @> '["obfuscate_values"]'::jsonb
      AND ( h.hit ? 'obfuscationPercent'
            OR ( h.hit ? 'originalDamage'
                 AND h.hit -> 'originalDamage' IS DISTINCT FROM h.hit -> 'damage' ) )),
  0,
  '(d) no served hit carries the band width or a second, different damage figure'
);

SELECT is(
  (SELECT count(*)::int FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) AS r(role)
    WHERE has_schema_privilege(r.role, 'internal', 'USAGE')),
  0,
  '(e) no PostgREST role holds USAGE on schema internal'
);

SELECT is(
  (SELECT count(*)::int FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) AS r(role)
    WHERE has_table_privilege(r.role, 'internal.cron_secrets', 'SELECT')
       OR has_function_privilege(r.role, 'internal.get_secret(text)', 'EXECUTE')),
  0,
  '(e) no PostgREST role can read the corridor table or call its reader'
);

SELECT is(
  (SELECT count(*)::int FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) AS r(role)
    WHERE has_function_privilege(r.role,
            'internal.explore_obfuscate_amount(numeric, integer, text)', 'EXECUTE')),
  0,
  '(e) no PostgREST role may execute the obfuscation function'
);

SELECT ok(
  (SELECT relrowsecurity FROM pg_catalog.pg_class
    WHERE oid = to_regclass('internal.cron_secrets')),
  '(e) row security is still enabled on the corridor table -- the second lock, if a grant ever slips'
);

CREATE TEMP TABLE ps254_before_rotation ON COMMIT DROP AS
SELECT guild_code, season, total_damage, average_damage, avg_damage_per_battle
  FROM public.public_guild_snapshots_explore
 WHERE explore_privacy_mode @> '["obfuscate_values"]'::jsonb;

-- Sibling secrets share the table; (f1) asserts the rotation left them alone.
CREATE TEMP TABLE ps254_siblings_before ON COMMIT DROP AS
SELECT name, md5(value) AS value_md5 FROM internal.cron_secrets
 WHERE name <> 'explore_obfuscation_salt';

UPDATE internal.cron_secrets
   SET value = replace(gen_random_uuid()::text, '-', '')
            || replace(gen_random_uuid()::text, '-', ''),
       rotated_at = now()
 WHERE name = 'explore_obfuscation_salt';

-- The view reads a precomputed factor, so apply the rotation now.
SELECT internal.refresh_explore_obfuscation();

SELECT is(
  (SELECT count(*)::int
     FROM ps254_before_rotation p
     JOIN public.public_guild_snapshots_explore v
       ON v.guild_code = p.guild_code AND v.season = p.season
    WHERE v.total_damage IS NOT DISTINCT FROM p.total_damage),
  0,
  '(f1) rotating the salt moves every obfuscating row -- the served numbers depend on the secret'
);

SELECT is(
  (SELECT count(*)::int
     FROM ps254_siblings_before b
     JOIN internal.cron_secrets c ON c.name = b.name
    WHERE md5(c.value) IS DISTINCT FROM b.value_md5),
  0,
  '(f1) the rotation touched no other secret in the shared corridor table'
);

SELECT cmp_ok(
  (SELECT count(*)::int FROM ps254_before_rotation),
  '>', 0,
  '(f1) positive control: the rotation had obfuscating rows to move'
);

-- (f2) A salt matching the public seed for a row fires this; rotate again.
SELECT is(
  (SELECT count(*)::int
     FROM public.public_guild_snapshots b
     JOIN public.public_guild_snapshots_explore v
       ON v.guild_code = b.guild_code AND v.season = b.season
     CROSS JOIN LATERAL (
       SELECT decode(md5('ps254|' || b.guild_code || '|' || b.season::text
                         || '|total_damage'), 'hex') AS h,
              least(30, greatest(1, COALESCE(b.explore_obfuscation_percent, 10)))::numeric AS p
     ) pub
     CROSS JOIN LATERAL (
       SELECT ( get_byte(pub.h, 0)::numeric * 65536::numeric
              + get_byte(pub.h, 1)::numeric * 256::numeric
              + get_byte(pub.h, 2)::numeric ) / 16777215::numeric AS frac,
              (CASE WHEN get_byte(pub.h, 3) % 2 = 0 THEN 1 ELSE -1 END)::numeric AS sgn
     ) d
    WHERE b.explore_privacy_mode @> '["obfuscate_values"]'::jsonb
      AND COALESCE(b.total_damage, 0) > 0
      AND abs( round( v.total_damage::numeric
                      / (1::numeric + d.sgn * (pub.p / 200::numeric)
                                            * (1::numeric + d.frac)) )
               - b.total_damage::numeric )
          / b.total_damage::numeric
          <= 12500::numeric / b.total_damage::numeric),
  0,
  '(f2) the public-seed inversion cannot pin any row to within half a grid step of the truth'
);

SELECT is(
  (SELECT count(*)::int
     FROM public.public_guild_snapshots_explore a
     JOIN public.public_guild_snapshots_explore b2
       ON b2.guild_code = a.guild_code AND b2.season = a.season
    WHERE a.total_damage IS DISTINCT FROM b2.total_damage
       OR a.average_damage IS DISTINCT FROM b2.average_damage
       OR a.avg_damage_per_battle IS DISTINCT FROM b2.avg_damage_per_battle),
  0,
  '(g) two reads of the view agree on every amount'
);

SELECT ok(
  has_table_privilege('anon', 'public.public_guild_snapshots_explore', 'SELECT')
  AND has_table_privilege('authenticated', 'public.public_guild_snapshots_explore', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.public_guild_snapshots', 'SELECT'),
  '(h) anon and authenticated read the view and not the base table'
);

SELECT * FROM finish();
ROLLBACK;
