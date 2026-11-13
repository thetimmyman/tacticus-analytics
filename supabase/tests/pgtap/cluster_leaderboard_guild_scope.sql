BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;

SELECT plan(33);

-- Guild moves and display-name changes preserve rows and rank each player once.

INSERT INTO public.clusters (id, cluster_code, display_name, created_at)
VALUES ('b2000000-0000-4000-8000-000000000001', 'CLU', 'Test Cluster', now());

INSERT INTO public.guild_config (
  id, guild_code, display_name, cluster_code, cluster_id, created_at, enabled
)
VALUES
  (928001, 'CLU-NEW', 'Test New', 'CLU', 'b2000000-0000-4000-8000-000000000001', now(), true),
  (928002, 'CLU-OLD', 'Test Old', 'CLU', 'b2000000-0000-4000-8000-000000000001', now(), true);

-- Caller identity for the SECURITY DEFINER leaderboard RPC.
ALTER TABLE auth.users DISABLE TRIGGER USER;
INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES ('b2000000-0000-4000-8000-0000000000aa', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'caller@cluster-leaderboard.test');

INSERT INTO public.player_mapping (
  id, player_id, display_name, guild_code, cluster_code, role,
  is_current, is_app_admin, created_at, updated_at
)
VALUES (
  928101,
  'caller-p',
  'Caller',
  'CLU-NEW',
  'CLU',
  'member'::public.app_role,
  true,
  false,
  now(),
  now()
);

-- Current ownership requires an attestation (enforce_player_identity_provenance).
INSERT INTO public.player_identity_attestations (
  id, mapping_id, player_id, subject_user_id, consumed_at, attested_at,
  source, guild_code_snapshot
)
VALUES (
  'b2000000-0000-4000-8000-0000000000ab',
  928101,
  'caller-p',
  'b2000000-0000-4000-8000-0000000000aa',
  clock_timestamp(),
  clock_timestamp(),
  'operator_quarantine_restore',
  'CLU-NEW'
);

UPDATE public.player_mapping
   SET user_id = 'b2000000-0000-4000-8000-0000000000aa',
       ownership_attestation_id = 'b2000000-0000-4000-8000-0000000000ab'
 WHERE id = 928101;

-- Synthetic battles include a guild move, a short season and a rename.
INSERT INTO public."EOT_GR_data" (
  "Guild", "Season", "displayName", "Name", "damageType", "damageDealt",
  "loopIndex", "tier", "set", "maxHp", "remainingHp", "startedOn",
  "completedOn", "encounterId", "rarity", "userId", "encounterIndex",
  "encounterType"
)
SELECT fixture.guild, '901', fixture.display_name, 'BossA', 'Battle', fixture.damage,
       g, 6, 1, 12000, 12000 - fixture.damage,
       now() + (g * interval '1 minute'),
       now() + (g * interval '1 minute') + interval '30 seconds',
       1, 'Legendary', fixture.player_id, 1, 'Boss'
FROM (VALUES
  ('CLU-NEW', 'Mover', 'mover-p1', 12, 2400),
  ('CLU-OLD', 'Mover', 'mover-p1', 1, 3600),
  ('CLU-NEW', 'Short', 'short-p2', 2, 1800),
  ('CLU-NEW', 'Normal', 'normal-p3', 10, 3000),
  ('CLU-NEW', 'New Alias', 'renamed-p4', 6, 2700),
  ('CLU-NEW', 'Old Alias', 'renamed-p4', 2, 4200)
) AS fixture(guild, display_name, player_id, battles, damage)
CROSS JOIN LATERAL generate_series(1, fixture.battles) AS g;

REFRESH MATERIALIZED VIEW public.mv_cluster_season_rankings;

SELECT is(
  (SELECT count(*)::integer FROM public.mv_cluster_season_rankings WHERE season = '901' AND cluster_code = 'CLU' AND stable_key = 'mover-p1'),
  2,
  'matview preserves both mover rows'
);

SELECT is(
  (SELECT battle_count FROM public.mv_cluster_season_rankings WHERE season = '901' AND cluster_code = 'CLU' AND stable_key = 'mover-p1' AND guild = 'CLU-NEW'),
  12,
  'matview keeps new guild battle count'
);

SELECT is(
  (SELECT season_rank IS NOT NULL FROM public.mv_cluster_season_rankings WHERE season = '901' AND cluster_code = 'CLU' AND stable_key = 'mover-p1' AND guild = 'CLU-NEW'),
  true,
  'matview ranks only the primary mover row: new'
);

SELECT is(
  (SELECT battle_count FROM public.mv_cluster_season_rankings WHERE season = '901' AND cluster_code = 'CLU' AND stable_key = 'mover-p1' AND guild = 'CLU-OLD'),
  1,
  'matview keeps old guild battle count'
);

SELECT is(
  (SELECT season_rank IS NULL FROM public.mv_cluster_season_rankings WHERE season = '901' AND cluster_code = 'CLU' AND stable_key = 'mover-p1' AND guild = 'CLU-OLD'),
  true,
  'matview ranks only the primary mover row: old'
);

SELECT is(
  (SELECT season_rank IS NOT NULL FROM public.mv_cluster_season_rankings WHERE season = '901' AND cluster_code = 'CLU' AND stable_key = 'short-p2'),
  true,
  'matview ranks a player with two battles'
);

SELECT is(
  (SELECT count(*)::integer FROM public.mv_cluster_season_rankings WHERE season = '901' AND cluster_code = 'CLU' AND stable_key = 'renamed-p4'),
  2,
  'matview preserves both renamed rows'
);

SELECT is(
  (SELECT count(*)::integer FROM public.mv_cluster_season_rankings WHERE season = '901' AND cluster_code = 'CLU' AND stable_key = 'renamed-p4' AND season_rank IS NOT NULL),
  1,
  'matview ranks the renamed player exactly once'
);

SELECT is(
  (SELECT battle_count FROM public.mv_cluster_season_rankings WHERE season = '901' AND cluster_code = 'CLU' AND stable_key = 'renamed-p4' AND season_rank IS NOT NULL),
  6,
  'matview ranks the larger renamed row'
);

SELECT is(
  (SELECT display_name FROM public.mv_cluster_season_rankings WHERE season = '901' AND cluster_code = 'CLU' AND stable_key = 'renamed-p4' AND season_rank IS NOT NULL),
  'New Alias'::text,
  'matview selects the primary display name'
);

SELECT is(
  (SELECT array_agg(season_rank ORDER BY season_rank) FROM public.mv_cluster_season_rankings WHERE season = '901' AND cluster_code = 'CLU' AND season_rank IS NOT NULL),
  ARRAY[1,2,3,4],
  'matview ranks are contiguous for all four players'
);

SELECT is(
  (SELECT count(*)::integer FROM public.mv_cluster_season_rankings WHERE season = '901' AND cluster_code = 'CLU'),
  (SELECT count(DISTINCT ("userId", "Guild", "displayName"))::integer
   FROM public."EOT_GR_data" WHERE "Season" = '901' AND "Guild" IN ('CLU-NEW', 'CLU-OLD')),
  'matview row count matches inserted performance identities'
);

-- Exercise RPC authorization with the attested caller.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'b2000000-0000-4000-8000-0000000000aa', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

CREATE TEMP TABLE overall_results AS
SELECT * FROM public.get_cluster_overall_leaderboard('901', 'CLU');
CREATE TEMP TABLE historical_results AS
SELECT * FROM public.get_cluster_historical_rankings(ARRAY['901'], 'CLU');

SELECT is(
  (SELECT count(*)::integer FROM overall_results WHERE display_name = 'Mover'),
  2,
  'RPC preserves both mover rows'
);

SELECT is(
  (SELECT battle_count FROM overall_results WHERE display_name = 'Mover' AND guild = 'CLU-NEW'),
  12,
  'RPC keeps new guild battle count'
);

SELECT is(
  (SELECT total_damage FROM overall_results WHERE display_name = 'Mover' AND guild = 'CLU-NEW'),
  28800::bigint,
  'RPC keeps new guild total damage'
);

SELECT is(
  (SELECT current_rank IS NOT NULL FROM overall_results WHERE display_name = 'Mover' AND guild = 'CLU-NEW'),
  true,
  'RPC ranks only the primary mover row: new'
);

SELECT is(
  (SELECT battle_count FROM overall_results WHERE display_name = 'Mover' AND guild = 'CLU-OLD'),
  1,
  'RPC keeps old guild battle count'
);

SELECT is(
  (SELECT total_damage FROM overall_results WHERE display_name = 'Mover' AND guild = 'CLU-OLD'),
  3600::bigint,
  'RPC keeps old guild total damage'
);

SELECT is(
  (SELECT current_rank IS NULL FROM overall_results WHERE display_name = 'Mover' AND guild = 'CLU-OLD'),
  true,
  'RPC ranks only the primary mover row: old'
);

SELECT is(
  (SELECT current_rank IS NOT NULL FROM overall_results WHERE display_name = 'Short'),
  true,
  'RPC ranks a player with two battles'
);

SELECT is(
  (SELECT count(*)::integer FROM overall_results WHERE stable_key = md5('renamed-p4')),
  2,
  'RPC preserves both renamed rows without multiplication'
);

SELECT is(
  (SELECT count(*)::integer FROM overall_results WHERE stable_key = md5('renamed-p4') AND current_rank IS NOT NULL),
  1,
  'RPC ranks the renamed player exactly once'
);

SELECT is(
  (SELECT display_name FROM overall_results WHERE stable_key = md5('renamed-p4') AND current_rank IS NOT NULL),
  'New Alias'::text,
  'RPC ranks the six-battle renamed row'
);

SELECT is(
  (SELECT array_agg(current_rank ORDER BY current_rank) FROM overall_results WHERE current_rank IS NOT NULL),
  ARRAY[1,2,3,4],
  'RPC ranks are contiguous for all four players'
);

SELECT is(
  (SELECT count(*)::integer FROM historical_results),
  4,
  'historical RPC returns four players'
);

SELECT is(
  (SELECT count(DISTINCT stable_key)::integer FROM historical_results),
  4,
  'historical RPC returns each player exactly once'
);

RESET ROLE;

SELECT is(
  (SELECT count(*)::integer FROM overall_results),
  (SELECT count(DISTINCT ("userId", "Guild", "displayName"))::integer
   FROM public."EOT_GR_data" WHERE "Season" = '901' AND "Guild" IN ('CLU-NEW', 'CLU-OLD')),
  'RPC row count matches inserted performance identities'
);

SELECT is(
  (SELECT has_table_privilege('anon', 'public.mv_cluster_season_rankings', 'SELECT')),
  false,
  'anon has no SELECT on the matview'
);

SELECT is(
  (SELECT has_table_privilege('authenticated', 'public.mv_cluster_season_rankings', 'SELECT')),
  false,
  'authenticated has no SELECT on the matview'
);

SELECT is(
  (SELECT has_table_privilege('service_role', 'public.mv_cluster_season_rankings', 'SELECT')),
  true,
  'service_role keeps SELECT on the matview'
);

SELECT is(
  (SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_index WHERE indexrelid = to_regclass('public.idx_mv_cluster_season_rankings_unique') AND indrelid = 'public.mv_cluster_season_rankings'::regclass)),
  true,
  'idx_mv_cluster_season_rankings_unique exists on the matview'
);

SELECT is(
  (SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_index WHERE indexrelid = to_regclass('public.idx_mv_cluster_rankings_lookup') AND indrelid = 'public.mv_cluster_season_rankings'::regclass)),
  true,
  'idx_mv_cluster_rankings_lookup exists on the matview'
);

SELECT lives_ok(
  'REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_cluster_season_rankings',
  'materialized rankings support concurrent refresh'
);

SELECT * FROM finish();

ROLLBACK;
