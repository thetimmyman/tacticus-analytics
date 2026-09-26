BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;

-- Policies inlining player_mapping must not need the caller's SELECT on it. It fails closed (anon
-- RAISES), so assert anon returns, and returns nothing. Set role AND claim.sub, or tests go vacuous.

SELECT plan(15);

INSERT INTO public.clusters (id, cluster_code, display_name, created_at)
VALUES ('00000000-0000-0000-0000-0000005620a0', 'ZW5', 'WI5620 Cluster', now());

INSERT INTO public.guild_config (
  id, guild_code, display_name, cluster_code, cluster_id, created_at, enabled
)
VALUES
  (562001, 'WI5620-A', 'Guild A', 'ZW5', '00000000-0000-0000-0000-0000005620a0', now(), true),
  (562002, 'WI5620-B', 'Guild B', 'ZW5', '00000000-0000-0000-0000-0000005620a0', now(), true);

ALTER TABLE auth.users DISABLE TRIGGER USER;
INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES
  ('00000000-0000-0000-0000-000000562001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'member-a@example.test'),
  ('00000000-0000-0000-0000-000000562002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'member-b@example.test');

INSERT INTO public.player_mapping (
  id, user_id, player_id, display_name, guild_code, cluster_code, role,
  is_current, is_app_admin, created_at, updated_at
)
VALUES
  (562101, '00000000-0000-0000-0000-000000562001', 'wi5620-a', 'Member A',
   'WI5620-A', 'ZW5', 'member'::public.app_role, true, false, now(), now()),
  (562102, '00000000-0000-0000-0000-000000562002', 'wi5620-b', 'Member B',
   'WI5620-B', 'ZW5', 'member'::public.app_role, true, false, now(), now());

-- One war match per guild, so a cross-guild leak shows as a row.
INSERT INTO public.guild_war_matches (
  war_id, guild_code, opponent_guild_name, war_status, war_season,
  battlefield_level
)
VALUES
  ('wi5620-war-a', 'WI5620-A', 'Opponent A', 'completed', 100, 5),
  ('wi5620-war-b', 'WI5620-B', 'Opponent B', 'completed', 100, 5);

SELECT ok(
  (SELECT p.prosecdef
   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = '_pm_caller_mapping_rows'),
  '_pm_caller_mapping_rows is SECURITY DEFINER (this is what lets a caller '
  'without player_mapping SELECT evaluate the policy)'
);

SELECT ok(
  has_function_privilege('anon', 'public._pm_caller_mapping_rows()', 'EXECUTE'),
  'anon can EXECUTE the helper'
);

SELECT ok(
  has_function_privilege('authenticated', 'public._pm_caller_mapping_rows()', 'EXECUTE'),
  'authenticated can EXECUTE the helper'
);

-- Re-granting anon SELECT is not the fix; gated on a remediation marker a stray re-grant cannot erase.
SELECT ok(
  CASE WHEN NOT (has_any_column_privilege('authenticated', 'public.player_mapping', 'SELECT')
                 AND NOT has_table_privilege('authenticated', 'public.player_mapping', 'SELECT'))
       THEN true  -- remediation never applied in this environment; nothing to regress
       ELSE has_table_privilege('anon', 'public.player_mapping', 'SELECT') = false
            AND has_any_column_privilege('anon', 'public.player_mapping', 'SELECT') = false
  END,
  'anon still holds NO table- or column-level SELECT on player_mapping '
  '(WI-4450 boundary intact -- the fix is indirection, not a re-grant)'
);

-- A partial rewrite that missed a sibling fails.
SELECT is(
  (SELECT count(*)::int
   FROM pg_policy p
   WHERE 0 = ANY (p.polroles)
     AND p.polcmd IN ('r', '*')
     AND pg_get_expr(p.polqual, p.polrelid) ~ '(FROM|JOIN)\s+player_mapping\M'
     AND EXISTS (
       SELECT 1 FROM pg_policy p2
       WHERE p2.polrelid = p.polrelid
         AND pg_get_expr(p2.polqual, p2.polrelid) ~ '_pm_caller_mapping_rows')),
  0,
  'no policy on a managed table still reads player_mapping as a base relation '
  '(no partial rewrite)'
);

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.sub', '', true);

SELECT lives_ok(
  'SELECT count(*) FROM public.guild_war_matches',
  'anon: guild_war_matches SELECT returns instead of raising permission denied '
  '(the exact WI-5620 reproduction)'
);

SELECT is(
  (SELECT count(*)::int FROM public.guild_war_matches),
  0,
  'anon: and still sees zero rows -- fail-closed became zero-rows, not a leak'
);

SELECT lives_ok(
  'SELECT count(*) FROM public.guild_war_zones',
  'anon: guild_war_zones SELECT returns (same defect class, different table)'
);

SELECT lives_ok(
  'SELECT count(*) FROM public.token_burn_state',
  'anon: token_burn_state SELECT returns (non-war table in the same class)'
);

RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000562001', true);

SELECT is(
  (SELECT count(*)::int FROM public.guild_war_matches
   WHERE war_id IN ('wi5620-war-a', 'wi5620-war-b')),
  1,
  'authenticated member of WI5620-A sees exactly their own guild''s match'
);

SELECT is(
  (SELECT guild_code FROM public.guild_war_matches
   WHERE war_id IN ('wi5620-war-a', 'wi5620-war-b')),
  'WI5620-A',
  'authenticated: and it is guild A''s row, not guild B''s (no cross-guild widening)'
);

SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000562002', true);

SELECT is(
  (SELECT guild_code FROM public.guild_war_matches
   WHERE war_id IN ('wi5620-war-a', 'wi5620-war-b')),
  'WI5620-B',
  'authenticated member of WI5620-B symmetrically sees only guild B'
);

-- No jwt claim must see nothing, not everything.
SELECT set_config('request.jwt.claim.sub', '', true);

SELECT is(
  (SELECT count(*)::int FROM public.guild_war_matches
   WHERE war_id IN ('wi5620-war-a', 'wi5620-war-b')),
  0,
  'authenticated with no subject claim sees zero rows (helper returns nothing '
  'when auth.uid() is NULL -- it does not fall open)'
);

RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000562001', true);

SELECT is(
  (SELECT count(*)::int FROM public._pm_caller_mapping_rows()
   WHERE user_id <> '00000000-0000-0000-0000-000000562001'),
  0,
  'the helper returns ONLY the calling user''s mapping rows'
);

SELECT set_config('request.jwt.claim.sub', '', true);
RESET ROLE;

-- Globally; player_mapping's own policies excluded. Same gate as 4.
SELECT is(
  (SELECT CASE
     WHEN NOT (has_any_column_privilege('authenticated', 'public.player_mapping', 'SELECT')
               AND NOT has_table_privilege('authenticated', 'public.player_mapping', 'SELECT'))
     THEN 0  -- remediation never applied here; the global form is not meaningful
     ELSE (SELECT count(*)::int
           FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
           WHERE 0 = ANY (p.polroles)
             AND p.polcmd IN ('r', '*')
             AND c.relname <> 'player_mapping'
             AND has_table_privilege('anon', c.oid, 'SELECT')
             AND pg_get_expr(p.polqual, p.polrelid) ~ '(FROM|JOIN)\s+player_mapping\M')
   END),
  0,
  'globally, no anon-reachable policy reads player_mapping as a base relation'
);

SELECT * FROM finish();
ROLLBACK;
