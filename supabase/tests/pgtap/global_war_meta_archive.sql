BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;

SELECT plan(17);

SELECT is(
  (
    SELECT count(*)::integer
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name LIKE 'external_war_meta_%'
      AND column_name ILIKE '%guild%'
  ),
  0,
  'external archive has no guild identity columns'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_constraint
    WHERE conrelid IN (
      'public.external_war_meta_snapshots'::regclass,
      'public.external_war_meta_lineups'::regclass,
      'public.external_war_meta_cores'::regclass,
      'public.external_war_meta_quarantine'::regclass
    )
      AND confrelid IN (
        'public.guild_config'::regclass,
        'public.guild_war_matches'::regclass,
        'public.guild_war_battles'::regclass
      )
  ),
  0,
  'external archive has no guild or guild-war foreign keys'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_class
    WHERE oid IN (
      'public.external_war_meta_snapshots'::regclass,
      'public.external_war_meta_lineups'::regclass,
      'public.external_war_meta_cores'::regclass,
      'public.external_war_meta_quarantine'::regclass
    )
      AND relrowsecurity
  ),
  4,
  'all external archive tables enable RLS'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM (VALUES
      ('public.external_war_meta_snapshots'),
      ('public.external_war_meta_lineups'),
      ('public.external_war_meta_cores'),
      ('public.external_war_meta_quarantine')
    ) AS relation(value)
    WHERE has_table_privilege('anon', relation.value, 'SELECT')
       OR has_table_privilege('authenticated', relation.value, 'SELECT')
       OR has_table_privilege('service_role', relation.value, 'SELECT')
  ),
  0,
  'archive rows are reachable only through service-role RPCs'
);

SELECT ok(
  has_function_privilege(
    'service_role',
    'public.import_external_war_meta_slice(text,text,text,integer,integer,timestamptz,text,integer,text,jsonb,jsonb)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.import_external_war_meta_slice(text,text,text,integer,integer,timestamptz,text,integer,text,jsonb,jsonb)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.import_external_war_meta_slice(text,text,text,integer,integer,timestamptz,text,integer,text,jsonb,jsonb)',
    'EXECUTE'
  ),
  'only service_role can invoke the archive importer'
);

SELECT lives_ok(
  $$
    SELECT public.import_external_war_meta_slice(
      'pgtap', 'lineups', 'offense', 999, 5, now(),
      'https://example.invalid/lineups', 1, repeat('a', 64),
      '[{"lineup_key":"a|b|c|d|e","unit_ids":["a","b","c","d","e"],"uses":20,"wins":15,"losses":5,"win_rate":75,"avg_score":900}]'::jsonb
    )
  $$,
  'lineup aggregate imports atomically'
);

SELECT lives_ok(
  $$
    SELECT public.import_external_war_meta_slice(
      'pgtap', 'cores', 'offense', 999, 5, now(),
      'https://example.invalid/cores', 1, repeat('b', 64),
      '[{"core_key":"a|b|c","unit_ids":["a","b","c"],"uses":20,"wins":15,"win_rate":75,"flex_options":[{"heroKey":"d","uses":10,"wins":8,"winRate":80}]}]'::jsonb
    )
  $$,
  'core aggregate imports atomically'
);

SELECT lives_ok(
  $$
    SELECT public.import_external_war_meta_slice(
      'pgtap', 'lineups', 'offense', 999, 4, now(),
      'https://example.invalid/lineups-unscored', 1, repeat('c', 64),
      '[{"lineup_key":"a|b|c|d|e","unit_ids":["a","b","c","d","e"],"uses":80,"wins":40,"losses":40,"win_rate":50,"avg_score":null}]'::jsonb
    )
  $$,
  'lineup aggregates may omit unavailable score data'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.external_war_meta_snapshots
    WHERE source = 'pgtap' AND season = 999
  ),
  3,
  'one snapshot is stored for each imported metric slice'
);

SELECT is(
  (
    SELECT uses
    FROM public.get_global_war_lineup_stats(
      'offense', ARRAY[999], ARRAY[5], 10, 1, 4
    )
  ),
  20::bigint,
  'global lineup analytics consume the archive'
);

SELECT is(
  (
    SELECT uses
    FROM public.get_global_war_lineup_stats(
      'offense', ARRAY[999], ARRAY[4, 5], 10, 1, 4
    )
  ),
  100::bigint,
  'global lineup analytics merge scored and unscored slices'
);

SELECT is(
  (
    SELECT avg_score
    FROM public.get_global_war_lineup_stats(
      'offense', ARRAY[999], ARRAY[4, 5], 10, 1, 4
    )
  ),
  900.0::numeric,
  'average score excludes uses without score data from its denominator'
);

SELECT is(
  (
    SELECT total_uses
    FROM public.get_global_war_core_compositions(
      'offense', ARRAY[999], ARRAY[5], 10, 1, 4, 3
    )
  ),
  20::bigint,
  'global core analytics consume the archive'
);

SELECT is(
  (
    SELECT core_size
    FROM public.get_global_war_core_compositions(
      'offense', ARRAY[999], ARRAY[5], 10, 1, 4, 3
    )
  ),
  3,
  'global core analytics return exact three-hero cores'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.get_global_war_core_compositions(
      'offense', ARRAY[999], ARRAY[5], 1, 10, 4, 2
    )
  ),
  0,
  'pair synergy does not fabricate pairs from archived trio aggregates'
);

SELECT throws_ok(
  $$
    SELECT *
    FROM public.get_global_war_core_compositions(
      'offense', ARRAY[999], ARRAY[5], 1, 10, 4, 1
    )
  $$,
  '22023',
  'core size must be between 2 and 5',
  'global core analytics reject sizes outside 2-5'
);

SELECT is(
  public.get_global_war_meta_filters()->'seasons' @> '[999]'::jsonb,
  true,
  'filter metadata includes archived seasons'
);

SELECT * FROM finish();
ROLLBACK;
