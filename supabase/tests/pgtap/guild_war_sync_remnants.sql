-- Guild-war sync is retired; war_visibility, upload tables and cleanup_long_stale_guilds remain.
-- Residue checks read columns dynamically and return 0 once they are dropped.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;

SELECT NOT EXISTS (
  SELECT 1
  FROM supabase_migrations.schema_migrations
  WHERE version = '20260920010000'
    AND name = 'ps516_drop_guild_war_sync_columns'
) AS tp516_not_applied \gset

\if :tp516_not_applied
SELECT plan(18);
SELECT * FROM skip(
  18,
  'this database predates the war-sync column drop; apply 20260920010000 and this suite executes fully'
);
SELECT * FROM finish();
ROLLBACK;
\else

SELECT plan(18);

-- A static reference to a dropped column fails to parse even on a dead branch.
CREATE FUNCTION pg_temp.tp516_enabled_rows() RETURNS integer
LANGUAGE plpgsql AS $fn$
DECLARE
  v_count integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'guild_config'
       AND column_name = 'war_sync_enabled'
  ) THEN
    RETURN 0;
  END IF;
  EXECUTE 'SELECT count(*)::integer FROM public.guild_config
            WHERE war_sync_enabled IS TRUE' INTO v_count;
  RETURN v_count;
END
$fn$;

CREATE FUNCTION pg_temp.tp516_error_state_rows() RETURNS integer
LANGUAGE plpgsql AS $fn$
DECLARE
  v_count integer;
BEGIN
  IF (
    SELECT count(*) FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'guild_config'
       AND column_name IN (
         'last_war_sync_error_at',
         'last_war_sync_error_reason',
         'last_war_sync_error_details',
         'consecutive_war_sync_failures'
       )
  ) <> 4 THEN
    RETURN 0;
  END IF;
  EXECUTE 'SELECT count(*)::integer FROM public.guild_config
            WHERE last_war_sync_error_at IS NOT NULL
               OR last_war_sync_error_reason IS NOT NULL
               OR last_war_sync_error_details IS NOT NULL
               OR coalesce(consecutive_war_sync_failures, 0) <> 0' INTO v_count;
  RETURN v_count;
END
$fn$;

CREATE FUNCTION pg_temp.tp516_current_db_war_sync_jobs() RETURNS integer
LANGUAGE plpgsql AS $fn$
DECLARE
  v_count integer;
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RETURN 0;
  END IF;
  EXECUTE $sql$
    SELECT count(*)::integer
      FROM cron.job
     WHERE database = current_database()::name
       AND command ~* 'war[-_]sync'
  $sql$ INTO v_count;
  RETURN v_count;
END
$fn$;

-- The ledger row itself, so a suite that matched nothing cannot pass.
SELECT is(
  (SELECT count(*)::integer
     FROM supabase_migrations.schema_migrations
    WHERE version = '20260920010000'
      AND name = 'ps516_drop_guild_war_sync_columns'),
  1,
  '1. the ps516_drop_guild_war_sync_columns migration is recorded exactly once in the ledger'
);

SELECT is(
  (SELECT coalesce(string_agg(c.column_name, ', ' ORDER BY c.column_name), '')
     FROM information_schema.columns AS c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'guild_config'
      AND c.column_name ~ 'war_sync'),
  '',
  '2. public.guild_config carries none of the five retired war-sync columns'
);

SELECT is(
  (SELECT count(*)::integer
     FROM information_schema.columns AS c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'guild_config'
      AND c.column_name = 'war_visibility'),
  1,
  '3. positive control: guild_config.war_visibility survives, so the census in 2 reads a real table'
);

SELECT is(
  (SELECT coalesce(string_agg(p.proname, ', ' ORDER BY p.proname), '')
     FROM pg_catalog.pg_proc AS p
     JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosrc ~* '(war_sync_enabled|consecutive_war_sync_failures|last_war_sync_error_at|last_war_sync_error_reason|last_war_sync_error_details)'),
  '',
  '4. no function body in public still names a war-sync column'
);

SELECT ok(
  (SELECT count(*)
     FROM pg_catalog.pg_proc AS p
     JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosrc ~ 'guild_config') > 0,
  '5. positive control: function bodies in public do name guild_config, so the census in 4 is live'
);

SELECT is(
  pg_temp.tp516_enabled_rows(),
  0,
  '6. negative control: no guild_config row has war_sync_enabled = true (refreshed production count: 17)'
);

SELECT is(
  pg_temp.tp516_error_state_rows(),
  0,
  '7. negative control: no guild_config row carries war-sync error state (refreshed production count: 2)'
);

SELECT is(
  (SELECT count(*)::integer
     FROM (VALUES
       (to_regprocedure('public.enqueue_guild_war_sync(text,text,text)')),
       (to_regprocedure('public.increment_war_sync_failure(text,smallint,boolean)'))
     ) AS retired(oid)
    WHERE retired.oid IS NOT NULL),
  0,
  '8. both retired guild-war sync RPC signatures are absent'
);

SELECT is(
  (SELECT count(*)::integer
     FROM (VALUES
       (to_regprocedure('public.prepare_player_account_deletion(uuid,text)')),
       (to_regprocedure('public.admin_unlink_player_mapping(text,text,text)'))
     ) AS retained(oid)
    WHERE retained.oid IS NOT NULL),
  2,
  '9. both live credential-purge functions survive with their expected signatures'
);

SELECT is(
  pg_temp.tp516_current_db_war_sync_jobs(),
  0,
  '10. no cron job targeting this database references war_sync'
);

-- With only the column migration applied, these are explicitly skipped.
SELECT NOT EXISTS (
  SELECT 1
  FROM supabase_migrations.schema_migrations
  WHERE version = '20260925030000'
    AND name = 'ps516_drop_guild_war_sync_machinery'
) AS tp516_machinery_not_applied \gset

\if :tp516_machinery_not_applied
SELECT * FROM skip(
  8,
  'the ps516_drop_guild_war_sync_machinery migration is not applied; apply 20260925030000 to assert the new state'
);
\else

SELECT is(
  (SELECT coalesce(string_agg(c.relname, ', ' ORDER BY c.relname), '')
     FROM pg_catalog.pg_class AS c
     JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN (
        'guild_war_sync_cooldown',
        'guild_war_sync_leases',
        'guild_war_sync_outcomes',
        'guild_war_raw_events'
      )),
  '',
  '11. all four dead guild-war sync tables are absent'
);

SELECT is(
  (SELECT count(*)::integer
     FROM pg_catalog.pg_proc AS p
     JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'acquire_guild_war_sync_lease',
        'persist_guild_war_session_under_lease',
        'release_guild_war_sync_lease',
        'renew_guild_war_sync_lease',
        'get_guild_war_sync_cooldown',
        'record_guild_war_sync_cooldown',
        'record_guild_war_sync_outcome',
        'requeue_guild_war_sync_job',
        'enqueue_guild_war_sync',
        'increment_war_sync_failure'
      )),
  0,
  '12. all captured guild-war sync RPC names are absent'
);

SELECT is(
  (SELECT coalesce(string_agg(p.proname, ', ' ORDER BY p.proname), '')
     FROM pg_catalog.pg_proc AS p
     JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosrc ~* '(guild_war_sync_cooldown|guild_war_sync_leases|guild_war_sync_outcomes|guild_war_raw_events)'),
  '',
  '13. no public function body names one of the four retired sync tables'
);

SELECT ok(
  (SELECT count(*)
     FROM pg_catalog.pg_proc AS p
     JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosrc ~ 'guild_config') > 0,
  '14. positive control: public function bodies do name guild_config'
);

SELECT is(
  to_regprocedure('public.cleanup_long_stale_guilds(integer,integer)') IS NOT NULL,
  true,
  '15. cleanup_long_stale_guilds still exists with its original signature'
);

SELECT is(
  (SELECT position('guild_war_raw_events' in p.prosrc)
     FROM pg_catalog.pg_proc AS p
    WHERE p.oid = to_regprocedure('public.cleanup_long_stale_guilds(integer,integer)')),
  0,
  '16. cleanup_long_stale_guilds no longer names guild_war_raw_events'
);

SELECT is(
  (SELECT count(*)::integer
     FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN (
        'guild_war_battles',
        'guild_war_matches',
        'guild_war_lineups',
        'guild_war_zones',
        'guild_war_zone_events'
      )),
  5,
  '17. the live manual guild-war upload tables remain present'
);

SELECT ok(
  EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS p
     WHERE p.oid = to_regprocedure('public.cleanup_long_stale_guilds(integer,integer)')
       AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
       AND p.prosecdef
       AND p.proconfig @> ARRAY['search_path=public']::text[]
  ),
  '18. cleanup_long_stale_guilds retains its owner, SECURITY DEFINER, and pinned search_path'
);

\endif

SELECT * FROM finish();
ROLLBACK;
\endif
