-- Every public-reachable carrier of a guild total obeys explore_privacy_mode = obfuscate_values.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;

-- Gate only on this migration's ledger row; gating on 20260904200000 too would disable every leak check.
SELECT NOT EXISTS (
  SELECT 1
  FROM supabase_migrations.schema_migrations
  WHERE version = '20260904140000'
    AND name = 'ps291_guild_total_carriers_obey_privacy'
) AS tp291_not_applied \gset

SELECT CASE WHEN EXISTS (
  SELECT 1
  FROM supabase_migrations.schema_migrations
  WHERE version = '20260904200000'
    AND name = 'ps308_drop_global_leaderboard_view'
) THEN 0 ELSE 1 END AS tp308_expected_relcount \gset

\if :tp291_not_applied
SELECT plan(21);
SELECT * FROM skip(
  21,
  'this database predates the guild-total carrier grants; the replay lane applies 20260904100000 then 20260904140000 and executes this suite fully'
);
SELECT * FROM finish();
ROLLBACK;
\else

SELECT plan(21);

SELECT is(
  (SELECT count(*)::integer
     FROM supabase_migrations.schema_migrations
    WHERE version = '20260904140000'
      AND name = 'ps291_guild_total_carriers_obey_privacy'),
  1,
  '1. the ps291_guild_total_carriers_obey_privacy migration is recorded exactly once in the ledger'
);

SELECT ok(
  NOT has_function_privilege('anon', 'public.get_guild_showcase(text)', 'EXECUTE'),
  '2. anon cannot execute get_guild_showcase, which joins public_guild_snapshots with no privacy branch'
);

SELECT ok(
  NOT has_function_privilege('authenticated', 'public.get_guild_showcase(text)', 'EXECUTE'),
  '3. authenticated cannot execute get_guild_showcase'
);

SELECT ok(
  has_function_privilege('service_role', 'public.get_guild_showcase(text)', 'EXECUTE'),
  '4. service_role keeps EXECUTE on get_guild_showcase; only the public roles were meant to move'
);

SELECT isnt(
  to_regprocedure('public.get_guild_showcase(text)')::text,
  NULL,
  '5. get_guild_showcase still exists; the guild-total carrier migration moves grants, it does not drop the function'
);

-- CASE, not OR: has_table_privilege on a dropped relation raises 42P01.
SELECT ok(
  CASE
    WHEN to_regclass('public.global_leaderboard') IS NULL THEN true
    ELSE NOT (
         has_table_privilege('anon', 'public.global_leaderboard', 'SELECT')
      OR has_table_privilege('authenticated', 'public.global_leaderboard', 'SELECT')
    )
  END,
  '6. no application role can read public.global_leaderboard: the guild-total carrier migration revoked anon and authenticated, ps308_drop_global_leaderboard_view retires the view outright, and neither state is readable'
);

SELECT is(
  (SELECT count(*)::integer
     FROM pg_catalog.pg_class c
     JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'global_leaderboard'
      AND NOT (n.nspname = 'public' AND :'tp308_expected_relcount'::int = 1)),
  0,
  '7. no relation named global_leaderboard survives anywhere it should not: dropped outright once ps308_drop_global_leaderboard_view is applied, and never moved or copied out of public before that'
);

SELECT ok(
  to_regprocedure('public.get_public_global_leaderboard(integer)') IS NOT NULL
  AND has_function_privilege('service_role', 'public.get_public_global_leaderboard(integer)', 'EXECUTE'),
  '8. public.get_public_global_leaderboard(integer) survives as the only leaderboard carrier, executable by service_role'
);

SELECT ok(
  (SELECT prosecdef FROM pg_catalog.pg_proc
    WHERE oid = to_regprocedure('public.get_public_global_leaderboard(integer)'))
  AND (SELECT pg_get_userbyid(proowner) FROM pg_catalog.pg_proc
        WHERE oid = to_regprocedure('public.get_public_global_leaderboard(integer)')) = 'postgres',
  '9. get_public_global_leaderboard is still SECURITY DEFINER owned by postgres, which is the role the obfuscation-helper migration granted the helper to'
);

SELECT ok(
  has_function_privilege('anon', 'public.get_public_global_leaderboard(integer)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.get_public_global_leaderboard(integer)', 'EXECUTE'),
  '10. anon and authenticated keep EXECUTE on get_public_global_leaderboard; it is the privacy-aware read path and CREATE OR REPLACE preserved the ACL'
);

SELECT ok(
  pg_get_functiondef(to_regprocedure('public.get_public_global_leaderboard(integer)'))
    ILIKE '%internal.explore_obfuscate_amount%',
  '11. get_public_global_leaderboard calls the internal.explore_obfuscate_amount helper rather than carrying a second obfuscation body'
);

SELECT ok(
  pg_get_functiondef(to_regprocedure('public.get_public_global_leaderboard(integer)'))
    NOT ILIKE '%25000%',
  '12. the superseded 25 000 rounding grid is gone from get_public_global_leaderboard'
);

-- Two factors on one guild would leak their ratio, so the totals must match exactly.
SELECT is(
  (SELECT count(*)::integer
     FROM public.public_guild_snapshots b
     JOIN public.public_guild_snapshots_explore x
       ON x.guild_code = b.guild_code AND x.season = b.season
     CROSS JOIN LATERAL (
       SELECT least(30, greatest(1,
         round(COALESCE(b.explore_obfuscation_percent, 10)::numeric)::int)) AS pct
     ) m
    WHERE b.explore_privacy_mode @> '["obfuscate_values"]'::jsonb
      AND COALESCE(b.total_damage, 0) > 0
      AND internal.explore_obfuscate_amount(
            b.total_damage::numeric, m.pct,
            b.guild_code || '|' || b.season::text || '|row')
          IS DISTINCT FROM x.total_damage),
  0,
  '13. every obfuscating guild draws the SAME factor here as public_guild_snapshots_explore serves; two factors on one guild would leak their ratio'
);

SELECT cmp_ok(
  (SELECT count(*)::integer FROM public.public_guild_snapshots
    WHERE explore_privacy_mode @> '["obfuscate_values"]'::jsonb),
  '>', 0,
  '14. at least one guild runs obfuscate_values, so assertions 13 and 15-17 are not vacuous'
);

SELECT is(
  (WITH obf AS (
     SELECT b.guild_code, b.season, b.total_damage AS truth,
            least(30, greatest(1,
              round(COALESCE(b.explore_obfuscation_percent, 10)::numeric)::int)) AS pct
       FROM public.public_guild_snapshots b
      WHERE b.explore_privacy_mode @> '["obfuscate_values"]'::jsonb
        AND COALESCE(b.total_damage, 0) > 0
   )
   SELECT count(*)::integer
     FROM obf
     CROSS JOIN LATERAL (
       SELECT internal.explore_obfuscate_amount(
                obf.truth::numeric, obf.pct,
                obf.guild_code || '|' || obf.season::text || '|row')::numeric AS served
     ) s
    WHERE s.served = obf.truth::numeric
       OR abs(s.served - obf.truth::numeric) < floor(obf.truth::numeric * obf.pct / 200::numeric)
       OR abs(s.served - obf.truth::numeric) > ceil(obf.truth::numeric * obf.pct / 100::numeric)),
  0,
  '15. no obfuscating guild is served its true total, and every served total sits inside the requested band'
);

SELECT is(
  (WITH cs AS (SELECT max(e.season_num) AS season_num FROM public."EOT_GR_data" e),
   fac AS (
     SELECT b.guild_code,
            internal.explore_obfuscate_amount(
              b.total_damage::numeric,
              least(30, greatest(1,
                round(COALESCE(b.explore_obfuscation_percent, 10)::numeric)::int)),
              b.guild_code || '|' || b.season::text || '|row')::numeric
            / b.total_damage::numeric AS factor
       FROM public.public_guild_snapshots b
       CROSS JOIN cs
      WHERE b.season = cs.season_num
        AND b.explore_privacy_mode @> '["obfuscate_values"]'::jsonb
        AND COALESCE(b.total_damage, 0) > 0
   ),
   expected AS (
     SELECT GREATEST(round(sum(e."damageDealt") * f.factor), 0::numeric) AS total_damage
       FROM public."EOT_GR_data" e
       CROSS JOIN cs
       JOIN fac f ON f.guild_code = e."Guild"
      WHERE e.season_num = cs.season_num AND e."damageDealt" > 0
      GROUP BY e."displayName", e."Guild", e.cluster_code, f.factor
   )
   SELECT count(*)::integer
     FROM public.get_public_global_leaderboard(25) l
    WHERE l.is_obfuscated
      AND l.total_damage IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM expected x WHERE x.total_damage = l.total_damage)),
  0,
  '16. every obfuscated total the public leaderboard serves is the guild factor applied to a real player total, not the truth and not a second draw'
);

SELECT is(
  (WITH cs AS (SELECT max(e.season_num) AS season_num FROM public."EOT_GR_data" e),
   truth AS (
     SELECT sum(e."damageDealt") AS total_damage
       FROM public."EOT_GR_data" e
       CROSS JOIN cs
       JOIN public.public_guild_snapshots b
         ON b.guild_code = e."Guild" AND b.season = cs.season_num
      WHERE e.season_num = cs.season_num AND e."damageDealt" > 0
        AND b.explore_privacy_mode @> '["obfuscate_values"]'::jsonb
      GROUP BY e."displayName", e."Guild", e.cluster_code
   )
   SELECT count(*)::integer
     FROM public.get_public_global_leaderboard(25) l
     JOIN truth t ON t.total_damage = l.total_damage
    WHERE l.is_obfuscated),
  0,
  '17. no row the public leaderboard flags as obfuscated carries its true player total'
);

SELECT is(
  (SELECT count(*)::integer
     FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) AS r(role)
    WHERE has_function_privilege(r.role,
            'internal.explore_obfuscate_amount(numeric, integer, text)', 'EXECUTE')
       OR has_table_privilege(r.role, 'internal.cron_secrets', 'SELECT')),
  0,
  '18. no application role can execute the obfuscation helper or read the salt it draws from'
);

-- During a snapshot refresh a flagged guild can have no factor; it must be served NULL with
-- is_obfuscated = true.
CREATE TEMP TABLE tp291_probe_season(season_num integer, season_text text) ON COMMIT DROP;
INSERT INTO tp291_probe_season
SELECT max(e.season_num) + 1, (max(e.season_num) + 1)::text FROM public."EOT_GR_data" e;

CREATE TEMP TABLE tp291_probe_guilds(guild_code text, flagged boolean) ON COMMIT DROP;
INSERT INTO tp291_probe_guilds
  (SELECT gc.guild_code, true
     FROM public.guild_config gc
    WHERE gc.explore_privacy_mode @> '["obfuscate_values"]'::jsonb
      AND EXISTS (SELECT 1 FROM public."EOT_GR_data" e
                   WHERE e."Guild" = gc.guild_code AND e."damageDealt" > 0)
    ORDER BY gc.guild_code LIMIT 1)
  UNION ALL
  (SELECT gc.guild_code, false
     FROM public.guild_config gc
    WHERE NOT COALESCE(gc.explore_privacy_mode, '["public"]'::jsonb) ? 'obfuscate_values'
      AND NOT COALESCE(gc.explore_privacy_mode, '["public"]'::jsonb) ? 'hide_all'
      AND EXISTS (SELECT 1 FROM public."EOT_GR_data" e
                   WHERE e."Guild" = gc.guild_code AND e."damageDealt" > 0)
    ORDER BY gc.guild_code LIMIT 1);

-- season_num is GENERATED ALWAYS (writing it raises 428C9), hence the explicit column list.
CREATE TEMP TABLE tp291_seed ON COMMIT DROP AS
SELECT e.* FROM public."EOT_GR_data" e
 WHERE e.id IN (
   SELECT (SELECT e2.id FROM public."EOT_GR_data" e2
            WHERE e2."Guild" = pg.guild_code AND e2."damageDealt" > 0
            ORDER BY e2.id LIMIT 1)
     FROM tp291_probe_guilds pg);

UPDATE tp291_seed t
   SET id = m.new_id,
       "Season" = (SELECT season_text FROM tp291_probe_season)
  FROM (SELECT id,
               (SELECT max(e.id) FROM public."EOT_GR_data" e)
               + row_number() OVER (ORDER BY id) AS new_id
          FROM tp291_seed) m
 WHERE m.id = t.id;

DO $guard$
DECLARE
  v_live text;
  v_here text := 'id,Guild,Season,displayName,Name,damageType,damageDealt,loopIndex,tier,set,startedOn,completedOn,timestamp,encounterId,rarity,userId,encounterIndex,encounterType,globalConfigHash,heroDetails,machineOfWarDetails,unitId,type,cluster_code,cluster_id,maxHp,remainingHp';
BEGIN
  SELECT string_agg(column_name, ',' ORDER BY ordinal_position) INTO v_live
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'EOT_GR_data'
     AND is_generated = 'NEVER' AND is_identity = 'NO';
  IF v_live IS DISTINCT FROM v_here THEN
    RAISE EXCEPTION
      'guild-total carriers suite: the writable column list of public."EOT_GR_data" has drifted. Live: %. This file: %. Update the INSERT column list below (every column whose is_generated is NEVER and is_identity is NO, in ordinal order) and re-run.',
      v_live, v_here;
  END IF;
END;
$guard$;

INSERT INTO public."EOT_GR_data" (
  id, "Guild", "Season", "displayName", "Name", "damageType", "damageDealt",
  "loopIndex", tier, set, "startedOn", "completedOn", "timestamp", "encounterId",
  rarity, "userId", "encounterIndex", "encounterType", "globalConfigHash",
  "heroDetails", "machineOfWarDetails", "unitId", type, cluster_code, cluster_id,
  "maxHp", "remainingHp")
SELECT
  id, "Guild", "Season", "displayName", "Name", "damageType", "damageDealt",
  "loopIndex", tier, set, "startedOn", "completedOn", "timestamp", "encounterId",
  rarity, "userId", "encounterIndex", "encounterType", "globalConfigHash",
  "heroDetails", "machineOfWarDetails", "unitId", type, cluster_code, cluster_id,
  "maxHp", "remainingHp"
FROM tp291_seed;

SELECT is(
  (SELECT count(*)::integer FROM public.get_public_global_leaderboard(25)),
  2,
  '19a. the seeded season presents exactly the two probe guilds, so assertions 19 and 20 are not vacuous'
);

SELECT is(
  (SELECT count(*)::integer FROM public.get_public_global_leaderboard(25) l
    WHERE l.is_obfuscated
      AND l.total_damage IS NULL AND l.avg_damage IS NULL AND l.max_damage IS NULL),
  1,
  '19. a guild flagged obfuscate_values with no snapshot row for the season is served NULL amounts with is_obfuscated = true, not its true total'
);

SELECT is(
  (SELECT count(*)::integer FROM public.get_public_global_leaderboard(25) l
    WHERE NOT l.is_obfuscated
      AND l.total_damage = (SELECT sum(e."damageDealt")::numeric
                              FROM public."EOT_GR_data" e
                              JOIN tp291_probe_guilds pg
                                ON pg.guild_code = e."Guild" AND NOT pg.flagged
                             WHERE e.season_num = (SELECT season_num FROM tp291_probe_season)
                               AND e."damageDealt" > 0)),
  1,
  '20. negative control: an UNflagged guild with no snapshot row for the same season is served its true total, so assertion 19 is the flag doing the work rather than the missing snapshot'
);

SELECT * FROM finish();
ROLLBACK;
\endif
