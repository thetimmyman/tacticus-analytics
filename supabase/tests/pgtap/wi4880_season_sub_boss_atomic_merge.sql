BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;

GRANT USAGE ON SCHEMA extensions TO authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA extensions TO authenticated, service_role;

SELECT set_config('request.jwt.claims', '', true);
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', '', true);

-- The merge stays a shallow `stored || patch` and SECURITY INVOKER: callers use the user client,
-- so table RLS is the second authority layer and DEFINER would let any authenticated user write.

SELECT plan(27);

SELECT is(
  (
    SELECT count(*)::integer
    FROM supabase_migrations.schema_migrations
    WHERE version = '20260803000000'
      AND name = 'wi4880_atomic_season_sub_boss_merge'
  ),
  1,
  'the WI-4880 atomic-merge migration is recorded exactly once'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_catalog.pg_proc AS function
    WHERE function.pronamespace = 'public'::regnamespace
      AND function.proname = 'merge_season_boss_sub_bosses'
  ),
  1,
  'exactly one merge_season_boss_sub_bosses overload exists (no shadow copy)'
);

SELECT is(
  (
    SELECT pg_catalog.oidvectortypes(function.proargtypes)
    FROM pg_catalog.pg_proc AS function
    WHERE function.oid =
      'public.merge_season_boss_sub_bosses(text,text,text,jsonb,uuid)'::regprocedure
  ),
  'text, text, text, jsonb, uuid',
  'the input argument types and order are unchanged'
);

SELECT is(
  (
    SELECT function.prosecdef
    FROM pg_catalog.pg_proc AS function
    WHERE function.oid =
      'public.merge_season_boss_sub_bosses(text,text,text,jsonb,uuid)'::regprocedure
  ),
  false,
  'the merge RPC is SECURITY INVOKER, so upcoming_season_bosses RLS stays in force'
);

SELECT is(
  (
    SELECT function.proconfig
    FROM pg_catalog.pg_proc AS function
    WHERE function.oid =
      'public.merge_season_boss_sub_bosses(text,text,text,jsonb,uuid)'::regprocedure
  ),
  ARRAY['search_path=public']::text[],
  'the merge RPC pins its search_path'
);

-- Default privileges grant anon EXECUTE, so REVOKE FROM PUBLIC alone leaks.
SELECT ok(
  NOT has_function_privilege(
    'anon',
    'public.merge_season_boss_sub_bosses(text,text,text,jsonb,uuid)',
    'EXECUTE'
  ),
  'anon cannot execute the season sub-boss write RPC'
);

SELECT ok(
  has_function_privilege(
    'authenticated',
    'public.merge_season_boss_sub_bosses(text,text,text,jsonb,uuid)',
    'EXECUTE'
  ),
  'authenticated callers retain execution (the season-config routes are user-scoped)'
);

SELECT ok(
  has_function_privilege(
    'service_role',
    'public.merge_season_boss_sub_bosses(text,text,text,jsonb,uuid)',
    'EXECUTE'
  ),
  'service_role retains execution'
);

ALTER TABLE auth.users DISABLE TRIGGER USER;
INSERT INTO auth.users (id)
VALUES
  ('48800000-0000-4000-8000-000000000001'),
  ('48800000-0000-4000-8000-000000000002');

INSERT INTO public.guild_config (guild_code, display_name, enabled)
VALUES ('WI4880A', 'WI-4880 fixture guild', true);

SELECT is(
  (
    SELECT row.boss_name
    FROM public.merge_season_boss_sub_bosses(
      'WI4880A', '999', 'L4',
      '{"sub1_skip": true}'::jsonb,
      '48800000-0000-4000-8000-000000000001'
    ) AS row
  ),
  '__pending__',
  'a brand-new planner row gets the __pending__ sentinel boss_name'
);

SELECT is(
  (
    SELECT row.sub_bosses
    FROM public.upcoming_season_bosses AS row
    WHERE row.guild_code = 'WI4880A' AND row.season_number = '999' AND row.level = 'L4'
  ),
  '{"sub1_skip": true}'::jsonb,
  'the first patch lands verbatim as the whole document'
);

SELECT is(
  (
    SELECT row.selected_by
    FROM public.upcoming_season_bosses AS row
    WHERE row.guild_code = 'WI4880A' AND row.season_number = '999' AND row.level = 'L4'
  ),
  '48800000-0000-4000-8000-000000000001'::uuid,
  'the insert path stamps selected_by'
);

-- Lost update: the RPC reads and writes in one statement, so a concurrent patch survives.
UPDATE public.upcoming_season_bosses
   SET sub_bosses = sub_bosses || '{"sub2_skip": true}'::jsonb
 WHERE guild_code = 'WI4880A' AND season_number = '999' AND level = 'L4';

SELECT is(
  (
    SELECT row.sub_bosses
    FROM public.merge_season_boss_sub_bosses(
      'WI4880A', '999', 'L4',
      '{"sub1_skip": false}'::jsonb,
      '48800000-0000-4000-8000-000000000002'
    ) AS row
  ),
  '{"sub1_skip": false, "sub2_skip": true}'::jsonb,
  'a concurrent sibling-key write survives the merge (the lost-update regression)'
);

UPDATE public.upcoming_season_bosses
   SET boss_name = 'Szarekh',
       sub_bosses = sub_bosses || '{"sub1": "Prime A", "sub2": "Prime B"}'::jsonb
 WHERE guild_code = 'WI4880A' AND season_number = '999' AND level = 'L4';

SELECT is(
  (
    SELECT row.boss_name
    FROM public.merge_season_boss_sub_bosses(
      'WI4880A', '999', 'L4',
      '{"sub1_kill_threshold_pct": 12.5}'::jsonb,
      '48800000-0000-4000-8000-000000000001'
    ) AS row
  ),
  'Szarekh',
  'a chosen boss_name is NOT reset to the __pending__ sentinel by a patch'
);

SELECT is(
  (
    SELECT row.sub_bosses
    FROM public.upcoming_season_bosses AS row
    WHERE row.guild_code = 'WI4880A' AND row.season_number = '999' AND row.level = 'L4'
  ),
  '{"sub1": "Prime A", "sub2": "Prime B", "sub1_skip": false, "sub2_skip": true, "sub1_kill_threshold_pct": 12.5}'::jsonb,
  'planner-owned sub1/sub2 boss names and both prime flags survive an unrelated patch'
);

SELECT is(
  (
    SELECT row.sub_bosses -> 'sub1_skip'
    FROM public.merge_season_boss_sub_bosses(
      'WI4880A', '999', 'L4',
      '{"sub1_skip": true}'::jsonb,
      '48800000-0000-4000-8000-000000000001'
    ) AS row
  ),
  'true'::jsonb,
  'a patch to an existing key overwrites that key'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.upcoming_season_bosses
    WHERE guild_code = 'WI4880A' AND season_number = '999' AND level = 'L4'
  ),
  1,
  'repeated merges never fan out into duplicate rows for the same key'
);

-- sub_bosses is nullable and `NULL || x` is NULL, so without the coalesce the merge erases it.
UPDATE public.upcoming_season_bosses
   SET sub_bosses = NULL
 WHERE guild_code = 'WI4880A' AND season_number = '999' AND level = 'L4';

SELECT is(
  (
    SELECT row.sub_bosses
    FROM public.merge_season_boss_sub_bosses(
      'WI4880A', '999', 'L4',
      '{"ping_mode": "per_side"}'::jsonb,
      '48800000-0000-4000-8000-000000000001'
    ) AS row
  ),
  '{"ping_mode": "per_side"}'::jsonb,
  'a NULL stored document is coalesced to {} rather than propagating NULL'
);

INSERT INTO public.upcoming_season_bosses
  (guild_code, season_number, level, boss_name, sub_bosses)
VALUES
  ('WI4880A', '999', 'L5', 'Ghazghkull', '{"sub1_skip": true}'::jsonb),
  ('WI4880A', '998', 'L4', 'Tervigon',   '{"sub2_skip": true}'::jsonb);

SELECT public.merge_season_boss_sub_bosses(
  'WI4880A', '999', 'L4', '{"main_notes": "focus adds"}'::jsonb,
  '48800000-0000-4000-8000-000000000001'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.upcoming_season_bosses
    WHERE guild_code = 'WI4880A'
      AND (
        (season_number = '999' AND level = 'L5' AND sub_bosses = '{"sub1_skip": true}'::jsonb
         AND boss_name = 'Ghazghkull')
        OR
        (season_number = '998' AND level = 'L4' AND sub_bosses = '{"sub2_skip": true}'::jsonb
         AND boss_name = 'Tervigon')
      )
  ),
  2,
  'sibling stage and sibling season rows are untouched by a merge'
);

SELECT is(
  (
    SELECT row.sub_bosses
    FROM public.merge_season_boss_sub_bosses(
      'WI4880A', '999', 'L4', '{}'::jsonb,
      '48800000-0000-4000-8000-000000000002'
    ) AS row
  ),
  '{"ping_mode": "per_side", "main_notes": "focus adds"}'::jsonb,
  'an empty patch leaves the stored document byte-identical'
);

SELECT is(
  (
    SELECT row.selected_by
    FROM public.upcoming_season_bosses AS row
    WHERE row.guild_code = 'WI4880A' AND row.season_number = '999' AND row.level = 'L4'
  ),
  '48800000-0000-4000-8000-000000000002'::uuid,
  'the conflict branch reassigns selected_by, matching the JS helper'
);

-- Deliberately NOT STRICT: STRICT would turn a NULL argument into a silent no-op.
SELECT throws_ok(
  $$SELECT public.merge_season_boss_sub_bosses(
      'WI4880A', '999', 'L4', '"not-an-object"'::jsonb,
      '48800000-0000-4000-8000-000000000001'
    )$$,
  '22023',
  NULL,
  'a scalar patch is rejected instead of corrupting the document'
);

SELECT throws_ok(
  $$SELECT public.merge_season_boss_sub_bosses(
      'WI4880A', '999', 'L4', 'null'::jsonb,
      '48800000-0000-4000-8000-000000000001'
    )$$,
  '22023',
  NULL,
  'a JSON null patch is rejected (jsonb null is not an object)'
);

SELECT throws_ok(
  $$SELECT public.merge_season_boss_sub_bosses(
      '   ', '999', 'L4', '{}'::jsonb,
      '48800000-0000-4000-8000-000000000001'
    )$$,
  '22023',
  NULL,
  'a blank guild_code is rejected rather than creating an orphan row'
);

SELECT throws_ok(
  $$SELECT public.merge_season_boss_sub_bosses(
      'WI4880A', '999', NULL, '{}'::jsonb,
      '48800000-0000-4000-8000-000000000001'
    )$$,
  '22023',
  NULL,
  'a NULL level is rejected, not silently swallowed by STRICT semantics'
);

-- 42501 is also a missing-grant error, so step A proves the grants suffice and step B attributes
-- the denial to RLS.
DROP POLICY IF EXISTS "Officers can manage their guild boss selections"
  ON public.upcoming_season_bosses;
DROP POLICY IF EXISTS upcoming_season_bosses_member_read
  ON public.upcoming_season_bosses;
ALTER TABLE public.upcoming_season_bosses DISABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.upcoming_season_bosses TO authenticated;

SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$SELECT public.merge_season_boss_sub_bosses(
      'WI4880A', '999', 'L4', '{"side1_notes": "invoker baseline"}'::jsonb,
      '48800000-0000-4000-8000-000000000001'
    )$$,
  'baseline: with table grants and RLS off, an authenticated caller may merge'
);
RESET ROLE;

-- Step B: a DEFINER function would pass through.

ALTER TABLE public.upcoming_season_bosses ENABLE ROW LEVEL SECURITY;

SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT public.merge_season_boss_sub_bosses(
      'WI4880A', '999', 'L4', '{"side2_notes": "must be denied"}'::jsonb,
      '48800000-0000-4000-8000-000000000001'
    )$$,
  '42501',
  NULL,
  'SECURITY INVOKER: a caller no RLS policy admits is denied THROUGH the RPC'
);
RESET ROLE;

SELECT is(
  (
    SELECT row.sub_bosses -> 'side2_notes'
    FROM public.upcoming_season_bosses AS row
    WHERE row.guild_code = 'WI4880A' AND row.season_number = '999' AND row.level = 'L4'
  ),
  NULL::jsonb,
  'the RLS-denied merge wrote nothing'
);

SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', '', true);
SELECT finish();
ROLLBACK;
