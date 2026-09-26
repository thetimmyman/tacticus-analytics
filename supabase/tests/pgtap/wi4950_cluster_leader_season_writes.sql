BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;

-- Builds on wi4950-season-writes-fixture.sql. The FOR ALL write policies gain a cluster-leader
-- branch (no app-admin branch). A USING-denied UPDATE affects zero rows; a denied INSERT raises 42501.

SELECT plan(53);

-- The supabase image grants these, bare postgres does not.
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;

SELECT is(
  (
    SELECT count(*)::integer FROM supabase_migrations.schema_migrations
    WHERE version = '20260805000000' AND name = 'wi4950_manage_season_assignments_merge'
  ),
  1,
  'the manage_season_assignments merge migration is recorded exactly once'
);

SELECT is(
  (
    SELECT count(*)::integer FROM supabase_migrations.schema_migrations
    WHERE version = '20260805010000' AND name = 'wi4950_backfill_blank_sub_boss_notes'
  ),
  1,
  'the blank-notes backfill migration is recorded exactly once'
);

SELECT is(
  (
    SELECT count(*)::integer FROM supabase_migrations.schema_migrations
    WHERE version = '20260805020000' AND name = 'wi4950_cluster_leader_season_writes'
  ),
  1,
  'the cluster-leader RLS widening migration is recorded exactly once'
);

SELECT is(
  (
    SELECT count(*)::integer FROM pg_catalog.pg_class
    WHERE relnamespace = 'public'::regnamespace
      AND relname IN ('upcoming_season_bosses', 'boss_target_tokens')
      AND relrowsecurity IS TRUE
  ),
  2,
  'RLS is enabled on both season-write tables'
);

-- The gc_target join fingerprints the cluster branch.
SELECT is(
  (
    SELECT count(*)::integer FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'upcoming_season_bosses'
      AND policyname = 'Officers can manage their guild boss selections'
      AND cmd = 'ALL'
      AND roles = ARRAY['authenticated']::name[]
      AND qual LIKE '%gc_target%'
      AND with_check LIKE '%gc_target%'
  ),
  1,
  'upcoming_season_bosses write policy is FOR ALL TO authenticated with the cluster branch in USING and WITH CHECK'
);

SELECT is(
  (
    SELECT count(*)::integer FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'boss_target_tokens'
      AND policyname = 'boss_target_tokens_write'
      AND cmd = 'ALL'
      AND roles = ARRAY['authenticated']::name[]
      AND qual LIKE '%gc_target%'
      AND with_check LIKE '%gc_target%'
  ),
  1,
  'boss_target_tokens write policy is FOR ALL TO authenticated with the cluster branch in USING and WITH CHECK'
);

SELECT is(
  (
    SELECT count(*)::integer FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('upcoming_season_bosses', 'boss_target_tokens')
      AND (qual LIKE '%is_app_admin%' OR with_check LIKE '%is_app_admin%')
  ),
  0,
  'no policy on either table carries an app-admin branch (C7: route-level only)'
);

SELECT is(
  (
    SELECT count(*)::integer FROM pg_catalog.pg_proc AS f
    WHERE f.oid = 'public.manage_season_assignments(text,text,text,jsonb,jsonb,jsonb)'::regprocedure
      AND f.prosecdef IS TRUE
      AND f.proconfig @> ARRAY['search_path=public']
      AND pg_get_functiondef(f.oid)
          LIKE '%coalesce(upcoming_season_bosses.sub_bosses, ''{}''::jsonb) || coalesce(excluded.sub_bosses, ''{}''::jsonb)%'
  ),
  1,
  'manage_season_assignments is SECURITY DEFINER, search_path=public, with the NULL-safe merge conflict clause (C1/C2)'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) AS p(priv)
    WHERE NOT has_table_privilege('authenticated', 'public.upcoming_season_bosses', p.priv)
  ),
  'authenticated holds SELECT/INSERT/UPDATE/DELETE on upcoming_season_bosses'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) AS p(priv)
    WHERE NOT has_table_privilege('authenticated', 'public.boss_target_tokens', p.priv)
  ),
  'authenticated holds SELECT/INSERT/UPDATE/DELETE on boss_target_tokens'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM (VALUES
      ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
      ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')
    ) AS p(priv)
    WHERE has_table_privilege('anon', 'public.upcoming_season_bosses', p.priv)
  ),
  'anon holds NO privilege of any kind on upcoming_season_bosses (live parity, 2026-07-31)'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM (VALUES ('INSERT'), ('UPDATE'), ('DELETE')) AS p(priv)
    WHERE has_table_privilege('anon', 'public.boss_target_tokens', p.priv)
  ),
  'anon holds no write privilege on boss_target_tokens'
);

-- Default privileges hand out anon EXECUTE, leaving the in-body check as the only wall.
SELECT ok(
  NOT has_function_privilege(
    'anon',
    'public.manage_season_assignments(text,text,text,jsonb,jsonb,jsonb)',
    'EXECUTE'
  ),
  'anon holds NO EXECUTE on manage_season_assignments (explicit default-priv grant revoked)'
);

SELECT ok(
  has_function_privilege(
    'authenticated',
    'public.manage_season_assignments(text,text,text,jsonb,jsonb,jsonb)',
    'EXECUTE'
  ),
  'authenticated holds EXECUTE on manage_season_assignments'
);

SELECT ok(
  NOT (
    (SELECT sub_bosses FROM public.upcoming_season_bosses
     WHERE guild_code = 'WI4950B' AND season_number = '107' AND level = 'L4')
    ? 'main_notes'
  ),
  'the backfill REMOVED the blank "" main_notes key (fallback now reachable)'
);

SELECT is(
  (
    SELECT sub_bosses -> 'side1_notes' FROM public.upcoming_season_bosses
    WHERE guild_code = 'WI4950B' AND season_number = '107' AND level = 'L4'
  ),
  '"keep me"'::jsonb,
  'the backfill left the real side1_notes value untouched'
);

-- As service_role, which skips the in-body authz block.
SELECT set_config('request.jwt.claim.role', 'service_role', true);

-- Planner-autosave shape: 1-key sub_bosses plus a boss_name change.
SELECT lives_ok(
  $$SELECT public.manage_season_assignments(
      'WI4950B', '107', 'upcoming',
      '[{"level": "L4", "boss_name": "Ghazghkull", "sub_bosses": {"sub1_skip": true}}]'::jsonb
    )$$,
  'a planner-shaped save through the RPC succeeds'
);

SELECT is(
  (
    SELECT sub_bosses FROM public.upcoming_season_bosses
    WHERE guild_code = 'WI4950B' AND season_number = '107' AND level = 'L4'
  ),
  '{"sub1": "Prime A", "side1_notes": "keep me", "sub2_skip": true, "sub1_skip": true}'::jsonb,
  'THE REGRESSION: a planner autosave payload merges — notes and sibling keys survive'
);

SELECT is(
  (
    SELECT boss_name FROM public.upcoming_season_bosses
    WHERE guild_code = 'WI4950B' AND season_number = '107' AND level = 'L4'
  ),
  'Ghazghkull',
  'boss_name is still replaced wholesale (only sub_bosses semantics changed)'
);

-- An omitted sub_bosses key is NULL; COALESCE on EXCLUDED keeps the stored doc.
SELECT public.manage_season_assignments(
  'WI4950B', '107', 'upcoming',
  '[{"level": "L4", "boss_name": "Ghazghkull"}]'::jsonb
);

SELECT is(
  (
    SELECT sub_bosses FROM public.upcoming_season_bosses
    WHERE guild_code = 'WI4950B' AND season_number = '107' AND level = 'L4'
  ),
  '{"sub1": "Prime A", "side1_notes": "keep me", "sub2_skip": true, "sub1_skip": true}'::jsonb,
  'a payload with NO sub_bosses key leaves the stored document intact (C1 NULL-safety)'
);

-- WI4950A has no planner rows, so WI4950B counts are unaffected.
SELECT public.manage_season_assignments(
  'WI4950A', '107', 'upcoming',
  '[{"level": "L1", "boss_name": "Avatar", "sub_bosses": {"sub1": "Prime X", "side1_notes": "to be cleared"}}]'::jsonb
);

SELECT is(
  (
    SELECT sub_bosses FROM public.upcoming_season_bosses
    WHERE guild_code = 'WI4950A' AND season_number = '107' AND level = 'L1'
  ),
  '{"sub1": "Prime X", "side1_notes": "to be cleared"}'::jsonb,
  'the INSERT branch creates the row when no (guild, season, level) row exists (F9)'
);

SELECT public.manage_season_assignments(
  'WI4950A', '107', 'upcoming',
  '[{"level": "L1", "boss_name": "Avatar", "sub_bosses": {"side1_notes": null}}]'::jsonb
);

SELECT is(
  (
    SELECT sub_bosses FROM public.upcoming_season_bosses
    WHERE guild_code = 'WI4950A' AND season_number = '107' AND level = 'L1'
  ),
  '{"sub1": "Prime X", "side1_notes": null}'::jsonb,
  'an explicit JSON null still overwrites its key; omitted siblings survive (F9)'
);

SELECT set_config('request.jwt.claim.role', '', true);

SELECT set_config('request.jwt.claim.sub',  '00000000-0000-0000-0000-000000495001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;

-- RPC RETURNING and the fallback's read-before-update rely on USING admitting the leader.
SELECT is(
  (
    SELECT count(*)::integer FROM public.upcoming_season_bosses
    WHERE guild_code = 'WI4950B'
  ),
  1,
  'peer-guild leader can SELECT the peer row through the widened ALL policy'
);

-- Data-modifying CTEs cannot be subqueries.
UPDATE public.upcoming_season_bosses
   SET sub_bosses = sub_bosses || '{"main_notes": "leader A wrote this"}'::jsonb
 WHERE guild_code = 'WI4950B' AND season_number = '107' AND level = 'L4';

SELECT is(
  (
    SELECT sub_bosses -> 'main_notes' FROM public.upcoming_season_bosses
    WHERE guild_code = 'WI4950B' AND season_number = '107' AND level = 'L4'
  ),
  '"leader A wrote this"'::jsonb,
  'peer-guild leader UPDATE on upcoming_season_bosses touches the row'
);

SELECT lives_ok(
  $$INSERT INTO public.upcoming_season_bosses
      (guild_code, season_number, level, boss_name, sub_bosses)
    VALUES ('WI4950B', '107', 'L5', 'Tervigon', '{"sub1_skip": true}'::jsonb)$$,
  'peer-guild leader INSERT on upcoming_season_bosses passes WITH CHECK'
);

SELECT lives_ok(
  $$INSERT INTO public.boss_target_tokens
      (guild_code, boss_name, rarity, set, encounter_id, target_tokens, source)
    VALUES ('WI4950B', 'Tervigon', 'Legendary', 2, 0, 15, 'officer_manual')$$,
  'peer-guild leader INSERT on boss_target_tokens passes WITH CHECK'
);

UPDATE public.boss_target_tokens
   SET target_tokens = 25
 WHERE guild_code = 'WI4950B' AND boss_name = 'Szarekh';

SELECT is(
  (
    SELECT target_tokens FROM public.boss_target_tokens
    WHERE guild_code = 'WI4950B' AND boss_name = 'Szarekh'
      AND rarity = 'Legendary' AND set = 1 AND encounter_id = 0
  ),
  25::numeric,
  'peer-guild leader UPDATE on boss_target_tokens touches the row'
);

RESET ROLE;

SELECT set_config('request.jwt.claim.sub',  '00000000-0000-0000-0000-000000495002', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;

UPDATE public.upcoming_season_bosses
   SET sub_bosses = sub_bosses || '{"side2_notes": "officer B"}'::jsonb
 WHERE guild_code = 'WI4950B' AND season_number = '107' AND level = 'L4';

SELECT is(
  (
    SELECT sub_bosses -> 'side2_notes' FROM public.upcoming_season_bosses
    WHERE guild_code = 'WI4950B' AND season_number = '107' AND level = 'L4'
  ),
  '"officer B"'::jsonb,
  'an officer still writes their own guild rows (officer branch intact)'
);

RESET ROLE;

SELECT set_config('request.jwt.claim.sub',  '00000000-0000-0000-0000-000000495004', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$INSERT INTO public.upcoming_season_bosses
      (guild_code, season_number, level, boss_name, sub_bosses)
    VALUES ('WI4950B', '107', 'M1', 'Loki', '{}'::jsonb)$$,
  '42501',
  NULL,
  'other-cluster leader INSERT on upcoming_season_bosses violates WITH CHECK'
);

SELECT throws_ok(
  $$INSERT INTO public.boss_target_tokens
      (guild_code, boss_name, rarity, set, encounter_id, target_tokens, source)
    VALUES ('WI4950B', 'Loki', 'Mythic', 1, 0, 10, 'officer_manual')$$,
  '42501',
  NULL,
  'other-cluster leader INSERT on boss_target_tokens violates WITH CHECK'
);

-- Verified after dropping the role.
UPDATE public.upcoming_season_bosses
   SET sub_bosses = '{}'::jsonb
 WHERE guild_code = 'WI4950B';

RESET ROLE;

SELECT is(
  (
    SELECT count(*)::integer FROM public.upcoming_season_bosses
    WHERE guild_code = 'WI4950B' AND sub_bosses = '{}'::jsonb
  ),
  0,
  'other-cluster leader UPDATE on upcoming_season_bosses silently touched ZERO rows'
);

-- The branch is leader-only.
SELECT set_config('request.jwt.claim.sub',  '00000000-0000-0000-0000-000000495005', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$INSERT INTO public.upcoming_season_bosses
      (guild_code, season_number, level, boss_name, sub_bosses)
    VALUES ('WI4950B', '107', 'M2', 'Rogal Dorn', '{}'::jsonb)$$,
  '42501',
  NULL,
  'same-cluster OFFICER INSERT on a peer guild is denied (cluster branch is leader-only)'
);

SELECT throws_ok(
  $$INSERT INTO public.boss_target_tokens
      (guild_code, boss_name, rarity, set, encounter_id, target_tokens, source)
    VALUES ('WI4950B', 'Rogal Dorn', 'Legendary', 3, 0, 12, 'officer_manual')$$,
  '42501',
  NULL,
  'same-cluster OFFICER INSERT on peer boss_target_tokens is denied'
);

RESET ROLE;

SELECT set_config('request.jwt.claim.sub',  '00000000-0000-0000-0000-000000495003', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$INSERT INTO public.upcoming_season_bosses
      (guild_code, season_number, level, boss_name, sub_bosses)
    VALUES ('WI4950B', '107', 'M3', 'Magnus', '{}'::jsonb)$$,
  '42501',
  NULL,
  'plain member INSERT on their own guild is still denied'
);

-- Members can read via boss_target_tokens_read, but USING filters their UPDATE.
UPDATE public.boss_target_tokens
   SET target_tokens = 99
 WHERE guild_code = 'WI4950B';

RESET ROLE;

SELECT is(
  (
    SELECT count(*)::integer FROM public.boss_target_tokens
    WHERE guild_code = 'WI4950B' AND target_tokens = 99
  ),
  0,
  'plain member UPDATE on boss_target_tokens silently touched ZERO rows'
);

-- NULL-cluster guilds: `gc_user.cluster_code IS NOT NULL` alone stops mutual writes.
SELECT set_config('request.jwt.claim.sub',  '00000000-0000-0000-0000-000000495006', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;

UPDATE public.upcoming_season_bosses
   SET sub_bosses = sub_bosses || '{"main_notes": "n1 leader own write"}'::jsonb
 WHERE guild_code = 'WI4950N1' AND season_number = '107' AND level = 'L1';

SELECT is(
  (
    SELECT sub_bosses -> 'main_notes' FROM public.upcoming_season_bosses
    WHERE guild_code = 'WI4950N1' AND season_number = '107' AND level = 'L1'
  ),
  '"n1 leader own write"'::jsonb,
  'a NULL-cluster leader still writes their OWN guild (officer branch; denials below are non-vacuous)'
);

SELECT throws_ok(
  $$INSERT INTO public.upcoming_season_bosses
      (guild_code, season_number, level, boss_name, sub_bosses)
    VALUES ('WI4950N2', '107', 'L2', 'Avatar', '{}'::jsonb)$$,
  '42501',
  NULL,
  'NULL-cluster leader INSERT into the OTHER NULL-cluster guild is denied (N1 -> N2)'
);

UPDATE public.boss_target_tokens
   SET target_tokens = 77
 WHERE guild_code = 'WI4950N2';

RESET ROLE;

SELECT is(
  (
    SELECT count(*)::integer FROM public.boss_target_tokens
    WHERE guild_code = 'WI4950N2' AND target_tokens = 77
  ),
  0,
  'NULL-cluster leader UPDATE on peer boss_target_tokens silently touched ZERO rows (N1 -> N2)'
);

SELECT set_config('request.jwt.claim.sub',  '00000000-0000-0000-0000-000000495007', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;

UPDATE public.upcoming_season_bosses
   SET sub_bosses = sub_bosses || '{"main_notes": "n2 leader own write"}'::jsonb
 WHERE guild_code = 'WI4950N2' AND season_number = '107' AND level = 'L1';

SELECT is(
  (
    SELECT sub_bosses -> 'main_notes' FROM public.upcoming_season_bosses
    WHERE guild_code = 'WI4950N2' AND season_number = '107' AND level = 'L1'
  ),
  '"n2 leader own write"'::jsonb,
  'the N2 NULL-cluster leader also writes their OWN guild (N2 -> N1 denials non-vacuous)'
);

SELECT throws_ok(
  $$INSERT INTO public.boss_target_tokens
      (guild_code, boss_name, rarity, set, encounter_id, target_tokens, source)
    VALUES ('WI4950N1', 'Avatar', 'Mythic', 1, 0, 9, 'officer_manual')$$,
  '42501',
  NULL,
  'NULL-cluster leader INSERT into peer boss_target_tokens is denied (N2 -> N1)'
);

UPDATE public.upcoming_season_bosses
   SET sub_bosses = '{"main_notes": "stolen"}'::jsonb
 WHERE guild_code = 'WI4950N1';

RESET ROLE;

SELECT is(
  (
    SELECT count(*)::integer FROM public.upcoming_season_bosses
    WHERE guild_code = 'WI4950N1' AND sub_bosses -> 'main_notes' = '"stolen"'::jsonb
  ),
  0,
  'NULL-cluster leader UPDATE on peer upcoming_season_bosses silently touched ZERO rows (N2 -> N1)'
);

SELECT set_config('request.jwt.claim.sub',  '', true);
SELECT set_config('request.jwt.claim.role', 'anon', true);
SET LOCAL ROLE anon;

SELECT throws_ok(
  $$INSERT INTO public.upcoming_season_bosses
      (guild_code, season_number, level, boss_name, sub_bosses)
    VALUES ('WI4950B', '107', 'M4', 'Mortarion', '{}'::jsonb)$$,
  '42501',
  NULL,
  'anon INSERT on upcoming_season_bosses is denied by RLS default-deny'
);

SELECT throws_ok(
  $$INSERT INTO public.boss_target_tokens
      (guild_code, boss_name, rarity, set, encounter_id, target_tokens, source)
    VALUES ('WI4950B', 'Mortarion', 'Mythic', 2, 0, 8, 'officer_manual')$$,
  '42501',
  NULL,
  'anon INSERT on boss_target_tokens is denied'
);

RESET ROLE;

-- anon fails on the ACL first, so 'Auth required' uses authenticated with no uid.
SELECT set_config('request.jwt.claim.sub',  '', true);
SELECT set_config('request.jwt.claim.role', 'anon', true);
SET LOCAL ROLE anon;

SELECT throws_ok(
  $$SELECT public.manage_season_assignments('WI4950B', '107', 'upcoming', '[]'::jsonb)$$,
  '42501',
  NULL,
  'anon cannot even CALL manage_season_assignments (the F1 revoke is the outer wall)'
);

RESET ROLE;

SELECT set_config('request.jwt.claim.sub',  '', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$SELECT public.manage_season_assignments('WI4950B', '107', 'upcoming', '[]'::jsonb)$$,
  'P0001',
  'Auth required',
  'a caller with no uid claim hits the Auth required arm'
);

RESET ROLE;

SELECT set_config('request.jwt.claim.sub',  '00000000-0000-0000-0000-000000495003', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$SELECT public.manage_season_assignments('WI4950B', '107', 'upcoming', '[]'::jsonb)$$,
  'P0001',
  'Insufficient permissions',
  'a plain member hits the Insufficient permissions arm'
);

RESET ROLE;

SELECT set_config('request.jwt.claim.sub',  '00000000-0000-0000-0000-000000495005', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$SELECT public.manage_season_assignments('WI4950B', '107', 'upcoming', '[]'::jsonb)$$,
  'P0001',
  'Access denied for guild',
  'an officer of ANOTHER guild hits the Access denied for guild arm'
);

RESET ROLE;

SELECT set_config('request.jwt.claim.sub',  '00000000-0000-0000-0000-000000495004', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$SELECT public.manage_season_assignments('WI4950B', '107', 'upcoming', '[]'::jsonb)$$,
  'P0001',
  'Access denied for cluster',
  'a leader of another CLUSTER hits the Access denied for cluster arm'
);

RESET ROLE;

SELECT set_config('request.jwt.claim.sub',  '00000000-0000-0000-0000-000000495006', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$SELECT public.manage_season_assignments('WI4950N2', '107', 'upcoming', '[]'::jsonb)$$,
  'P0001',
  'Access denied for cluster',
  'a NULL-cluster leader targeting another NULL-cluster guild is denied by the RPC too'
);

RESET ROLE;

SELECT set_config('request.jwt.claim.sub',  '00000000-0000-0000-0000-000000495001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$SELECT public.manage_season_assignments(
      'WI4950B', '107', 'upcoming',
      '[{"level": "M5", "boss_name": "Silent King", "sub_bosses": {"sub1_skip": true}}]'::jsonb
    )$$,
  'a SAME-cluster leader passes the whole authz block and the save succeeds'
);

RESET ROLE;

SELECT is(
  (
    SELECT boss_name FROM public.upcoming_season_bosses
    WHERE guild_code = 'WI4950B' AND season_number = '107' AND level = 'M5'
  ),
  'Silent King',
  'the same-cluster leader RPC save actually landed'
);

SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', '', true);

-- No trigger or constraint reshaped the leader's writes.
SELECT is(
  (
    SELECT sub_bosses -> 'main_notes' FROM public.upcoming_season_bosses
    WHERE guild_code = 'WI4950B' AND season_number = '107' AND level = 'L4'
  ),
  '"leader A wrote this"'::jsonb,
  'the peer-guild leader note write persisted'
);

SELECT is(
  (
    SELECT target_tokens FROM public.boss_target_tokens
    WHERE guild_code = 'WI4950B' AND boss_name = 'Szarekh'
      AND rarity = 'Legendary' AND set = 1 AND encounter_id = 0
  ),
  25::numeric,
  'the peer-guild leader target_tokens write persisted'
);

SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', '', true);
SELECT finish();
ROLLBACK;
