-- Remove the dead guild-war sync tables and RPCs; manual upload stays. IF EXISTS
-- only, no CASCADE: an undeclared dependency must fail.
-- target-db: general
BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- The live body with only its guild_war_raw_events DELETE removed.
CREATE OR REPLACE FUNCTION public.cleanup_long_stale_guilds(p_sync_staleness_days integer DEFAULT 30, p_user_activity_days integer DEFAULT 30)
 RETURNS TABLE(cleaned_count integer, guild_codes text[])
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    cleaned_guilds TEXT[] := ARRAY[]::TEXT[];
    guild_record RECORD;
    total_cleaned INTEGER := 0;
    sync_threshold INTERVAL;
    activity_threshold INTERVAL;
    failed_count INTEGER := 0;
BEGIN
    sync_threshold := (p_sync_staleness_days || ' days')::INTERVAL;
    activity_threshold := (p_user_activity_days || ' days')::INTERVAL;

    -- Note: we deliberately do NOT call is_protected_guild() here. That
    -- function's "any claimed user" + ">100 historical rows" clauses are
    -- correct for cleanup_orphaned_guilds (24h abandoned-onboarding) but
    -- WRONG for long-stale: long-stale guilds by definition have claimed
    -- users AND historical battle data — we're catching the case where the
    -- leader's API key broke and the guild went dormant. The right
    -- safeguard is auth.users.last_sign_in_at (no recent logins from any
    -- member) which we check below. Only keep the EOT-cluster carve-out as
    -- a hard protection.
    FOR guild_record IN
        SELECT
            gc.guild_code,
            gc.display_name,
            gc.last_successful_sync,
            gc.api_key_is_valid
        FROM guild_config gc
        WHERE
          -- Protect EOT cluster (dev/test guilds)
          NOT EXISTS (
            SELECT 1 FROM clusters c
            WHERE c.id = gc.cluster_id AND c.cluster_code = 'EOT'
          )
          -- Broken / unverified API key
          AND gc.api_key_is_valid IS DISTINCT FROM TRUE  -- false OR null
          -- Sync staleness threshold
          AND (
            gc.last_successful_sync IS NULL
            OR gc.last_successful_sync < (now() - sync_threshold)
          )
          -- Skip if any member of this guild has signed into the site
          -- within the activity window. Honest dormancy only.
          AND NOT EXISTS (
            SELECT 1
            FROM player_mapping pm
            JOIN auth.users u ON u.id = pm.user_id
            WHERE pm.guild_code = gc.guild_code
              AND u.last_sign_in_at IS NOT NULL
              AND u.last_sign_in_at > (now() - activity_threshold)
            LIMIT 1
          )
    LOOP
      -- PER-GUILD SUBTRANSACTION (review, PR #2010). Everything below runs in
      -- its own BEGIN..EXCEPTION block so ONE guild can never abort the reap for
      -- every other guild. Two concrete reasons, not hypotheticals:
      --
      --   * the IF EXISTS check below and the DELETE further down take separate
      --     READ COMMITTED snapshots, so a mapping that gains an un-revoked
      --     attestation BETWEEN them still reaches
      --     enforce_player_identity_provenance() and raises;
      --   * any other per-guild error (FK, lock timeout) had the same
      --     all-or-nothing blast radius — which is exactly how a single mapping
      --     took down the whole 06:30Z run on 2026-08-12.
      --
      -- Cheap: this loop processes ~1 guild/day.
      BEGIN
        -- 2026-08-12: an un-revoked ownership attestation OUTRANKS a staleness
        -- reap. enforce_player_identity_provenance() would RAISE on the
        -- player_mapping delete below and abort the WHOLE function (one
        -- transaction), so a single attested mapping otherwise blocks cleanup
        -- for every guild, not just its own. Skip the guild ENTIRELY — the
        -- deletes below are not ordered to be safely partial, and a
        -- half-reaped guild is worse than an unreaped one.
        IF EXISTS (
            SELECT 1
            FROM player_mapping pm
            WHERE pm.guild_code = guild_record.guild_code
              AND pm.ownership_attestation_id IS NOT NULL
              AND NOT EXISTS (
                SELECT 1
                FROM player_identity_attestation_revocations r
                WHERE r.attestation_id = pm.ownership_attestation_id
              )
        ) THEN
            -- Idempotent, same as the cleaned-guild log below: this guild is
            -- skipped on EVERY run until a human resolves it, so refresh the
            -- row instead of colliding on UNIQUE (log_type, message).
            INSERT INTO system_logs (log_type, message, metadata)
            VALUES (
                'cleanup_long_stale_guilds_skipped',
                format(
                    'Skipped long-stale guild %s (%s): un-revoked ownership attestation',
                    guild_record.guild_code,
                    COALESCE(guild_record.display_name, '<no display_name>')
                ),
                jsonb_build_object(
                    'guild_code', guild_record.guild_code,
                    'display_name', guild_record.display_name,
                    'last_successful_sync', guild_record.last_successful_sync,
                    'reason', 'unrevoked_ownership_attestation'
                )
            )
            ON CONFLICT (log_type, message) DO UPDATE
            SET metadata   = EXCLUDED.metadata,
                created_at = now();

            CONTINUE;
        END IF;

        -- Battle data (no FK to guild_config; matched by Guild column).
        -- WI-827 floor: preserve season >= 71 history; only reap pre-71
        -- or non-numeric season strings.
        DELETE FROM "EOT_GR_data" WHERE "Guild" = guild_record.guild_code AND ("Season" !~ '^[0-9]+$' OR "Season"::int < 71);

        -- RESTRICT / NO ACTION children must be cleared first
        DELETE FROM player_mapping              WHERE guild_code = guild_record.guild_code;
        DELETE FROM player_invite_codes         WHERE guild_code = guild_record.guild_code;
        DELETE FROM guild_war_defensive_lineups WHERE guild_code = guild_record.guild_code;
        DELETE FROM guild_war_leaderboards      WHERE guild_code = guild_record.guild_code;
        DELETE FROM guild_war_matches           WHERE guild_code = guild_record.guild_code;
        DELETE FROM guild_war_settings          WHERE guild_code = guild_record.guild_code;
        DELETE FROM guild_war_zone_assignment_entries
            WHERE guild_code = guild_record.guild_code;
        DELETE FROM guild_war_zone_assignments  WHERE guild_code = guild_record.guild_code;
        DELETE FROM war_player_lineups          WHERE guild_code = guild_record.guild_code;
        DELETE FROM webhook_config              WHERE guild_code = guild_record.guild_code;
        DELETE FROM upcoming_season_assignments WHERE guild_code = guild_record.guild_code;
        DELETE FROM upcoming_season_bosses      WHERE guild_code = guild_record.guild_code;

        -- The remaining 23 FKs are ON DELETE CASCADE; they auto-clean
        DELETE FROM guild_config WHERE guild_code = guild_record.guild_code;

        -- WI-900: idempotent log write. If a guild_code re-onboards after a
        -- prior cleanup and goes stale again, refresh the existing row
        -- rather than aborting the whole transaction on the UNIQUE
        -- (log_type, message) collision.
        INSERT INTO system_logs (log_type, message, metadata)
        VALUES (
            'cleanup_long_stale_guilds',
            format(
                'Cleaned long-stale guild %s (%s); last sync %s; api_key_is_valid=%s',
                guild_record.guild_code,
                COALESCE(guild_record.display_name, '<no display_name>'),
                COALESCE(guild_record.last_successful_sync::TEXT, 'NEVER'),
                COALESCE(guild_record.api_key_is_valid::TEXT, 'NULL')
            ),
            jsonb_build_object(
                'guild_code', guild_record.guild_code,
                'display_name', guild_record.display_name,
                'last_successful_sync', guild_record.last_successful_sync,
                'sync_staleness_days', p_sync_staleness_days,
                'user_activity_days', p_user_activity_days
            )
        )
        ON CONFLICT (log_type, message) DO UPDATE
        SET metadata   = EXCLUDED.metadata,
            created_at = now();

        -- CREDIT THE GUILD LAST (review, PR #2012). PL/pgSQL local variables
        -- are NOT rolled back by the subtransaction — only database work is. If
        -- these ran before the log write above and that write failed, the
        -- handler would roll the deletes back and the function would still
        -- RETURN this guild in guild_codes and count it as cleaned. Assign only
        -- after the last statement that can raise.
        cleaned_guilds := array_append(cleaned_guilds, guild_record.guild_code);
        total_cleaned := total_cleaned + 1;
      EXCEPTION WHEN OTHERS THEN
        failed_count := failed_count + 1;
        -- Record and carry on. The subtransaction rolls back THIS guild's
        -- partial deletes only, so the guild is left whole and retried
        -- tomorrow. SQLERRM/SQLSTATE go in metadata, never in `message` —
        -- message is half the ON CONFLICT key and must stay stable per guild
        -- or the log grows a row per distinct error text.
        -- BEST-EFFORT (review, PR #2012). An error raised INSIDE an exception
        -- handler is not caught by that same handler — it escapes the function
        -- and rolls back every guild already processed, defeating the isolation
        -- this block exists for. That is not hypothetical: if the per-guild
        -- failure was system_logs itself (lock timeout, a failing trigger),
        -- writing the diagnostic there is precisely what fails. Nest it.
        BEGIN
        INSERT INTO system_logs (log_type, message, metadata)
        VALUES (
            'cleanup_long_stale_guilds_error',
            format(
                'Failed to clean long-stale guild %s (%s)',
                guild_record.guild_code,
                COALESCE(guild_record.display_name, '<no display_name>')
            ),
            jsonb_build_object(
                'guild_code', guild_record.guild_code,
                'display_name', guild_record.display_name,
                'sqlstate', SQLSTATE,
                'sqlerrm', SQLERRM
            )
        )
        ON CONFLICT (log_type, message) DO UPDATE
        SET metadata   = EXCLUDED.metadata,
            created_at = now();
        EXCEPTION WHEN OTHERS THEN
          -- Nothing left to do but keep going; failed_count still carries the
          -- signal and the systemic check below still fires.
          NULL;
        END;
      END;
    END LOOP;

    -- SYSTEMIC FAILURE MUST STAY LOUD (review, PR #2012). Per-guild isolation
    -- has an obvious failure mode: a schema-wide problem (a child table renamed
    -- or dropped) fails EVERY guild, and WHEN OTHERS would quietly turn that
    -- into log rows while pg_cron records a successful run. Nothing in the tree
    -- consumes 'cleanup_long_stale_guilds_error', so cleanup would be totally
    -- broken and silent — the exact false-green class this repo keeps getting
    -- bitten by.
    --
    -- Raise only when NOTHING succeeded, which is the systemic shape and also
    -- the only case where raising costs nothing: with total_cleaned = 0 there is
    -- no completed work for the rollback to throw away. A mixed run (some
    -- cleaned, some failed) returns normally and keeps its progress; the failed
    -- guilds are retried tomorrow. This reuses the EXISTING pg_cron failure
    -- alert rather than inventing a consumer.
    IF failed_count > 0 AND total_cleaned = 0 THEN
      RAISE EXCEPTION
        'cleanup_long_stale_guilds: all % candidate guild(s) failed; nothing cleaned — see system_logs.cleanup_long_stale_guilds_error',
        failed_count
        USING ERRCODE = 'data_exception';
    END IF;

    RETURN QUERY SELECT total_cleaned, cleaned_guilds;
END;
$function$;

-- Pin the owner; CREATE OR REPLACE kept the live ACL.
ALTER FUNCTION public.cleanup_long_stale_guilds(integer, integer) OWNER TO postgres;

DROP FUNCTION IF EXISTS public.acquire_guild_war_sync_lease(text, text, integer);
DROP FUNCTION IF EXISTS public.persist_guild_war_session_under_lease(text, text, uuid, bigint);
DROP FUNCTION IF EXISTS public.release_guild_war_sync_lease(text, uuid, bigint);
DROP FUNCTION IF EXISTS public.renew_guild_war_sync_lease(text, uuid, bigint, integer);
DROP FUNCTION IF EXISTS public.get_guild_war_sync_cooldown();
DROP FUNCTION IF EXISTS public.record_guild_war_sync_cooldown(integer);
DROP FUNCTION IF EXISTS public.record_guild_war_sync_outcome(text, text, text, text, bigint, integer, integer, integer, timestamp with time zone);
DROP FUNCTION IF EXISTS public.requeue_guild_war_sync_job(bigint, text, integer, text);

DROP TABLE IF EXISTS public.guild_war_sync_cooldown;
DROP TABLE IF EXISTS public.guild_war_sync_leases;
DROP TABLE IF EXISTS public.guild_war_sync_outcomes;
DROP TABLE IF EXISTS public.guild_war_raw_events;

NOTIFY pgrst, 'reload schema';

DO $ps516_verify$
DECLARE
  v_tables text;
  v_functions text;
  v_bodies text;
  v_body_control integer;
  v_owner text;
  v_definer boolean;
  v_config text[];
BEGIN
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname)
    INTO v_tables
    FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname IN (
       'guild_war_sync_cooldown',
       'guild_war_sync_leases',
       'guild_war_sync_outcomes',
       'guild_war_raw_events'
     );

  IF v_tables IS NOT NULL THEN
    RAISE EXCEPTION
      'PS-516: retired guild-war sync table(s) still exist: %', v_tables;
  END IF;

  SELECT string_agg(
           p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
           ', ' ORDER BY p.proname, pg_get_function_identity_arguments(p.oid)
         )
    INTO v_functions
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
     );

  IF v_functions IS NOT NULL THEN
    RAISE EXCEPTION
      'PS-516: retired guild-war sync function(s) still exist: %', v_functions;
  END IF;

  SELECT string_agg(
           p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
           ', ' ORDER BY p.proname, pg_get_function_identity_arguments(p.oid)
         )
    INTO v_bodies
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.prosrc ~* '(guild_war_sync_cooldown|guild_war_sync_leases|guild_war_sync_outcomes|guild_war_raw_events)';

  IF v_bodies IS NOT NULL THEN
    RAISE EXCEPTION
      'PS-516: public function body/bodies still reference a retired guild-war sync table: %',
      v_bodies;
  END IF;

  -- Positive control: the body census above must have read a real public
  -- function population, rather than finding no functions at all.
  SELECT count(*)::integer
    INTO v_body_control
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.prosrc ~ 'guild_config';

  IF v_body_control = 0 THEN
    RAISE EXCEPTION
      'PS-516: positive control failed -- no public function body names guild_config';
  END IF;

  IF to_regprocedure('public.cleanup_long_stale_guilds(integer,integer)') IS NULL THEN
    RAISE EXCEPTION
      'PS-516: cleanup_long_stale_guilds is missing after replacement';
  END IF;

  SELECT pg_get_userbyid(p.proowner), p.prosecdef, p.proconfig
    INTO v_owner, v_definer, v_config
    FROM pg_catalog.pg_proc AS p
   WHERE p.oid = to_regprocedure('public.cleanup_long_stale_guilds(integer,integer)');

  IF v_owner IS DISTINCT FROM 'postgres'
     OR v_definer IS DISTINCT FROM true
     OR coalesce(v_config @> ARRAY['search_path=public']::text[], false) IS NOT TRUE THEN
    RAISE EXCEPTION
      'PS-516: cleanup_long_stale_guilds lost its owner, SECURITY DEFINER setting, or pinned search_path (owner=%, security_definer=%, config=%)',
      v_owner, v_definer, v_config;
  END IF;

  RAISE NOTICE
    'PS-516: guild-war sync machinery removed; cleanup_long_stale_guilds remains (% public function bodies name guild_config)',
    v_body_control;
END;
$ps516_verify$;


REVOKE ALL ON FUNCTION public.cleanup_long_stale_guilds(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_long_stale_guilds(integer, integer) TO service_role;

COMMIT;
