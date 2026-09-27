-- Battle history is kept for every season, so guild cleanup jobs no longer delete EOT_GR_data rows.
-- target-db: general
-- EOT_GR_data has no foreign key to guild_config, so the rest of each cleanup is unchanged.

CREATE OR REPLACE FUNCTION public.cleanup_orphaned_guilds() RETURNS TABLE(cleaned_count integer, guild_codes text[])
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $_$
DECLARE
    cleanup_threshold INTERVAL := '24 hours';
    cleaned_guilds TEXT[] := ARRAY[]::TEXT[];
    guild_record RECORD;
    total_cleaned INTEGER := 0;
    v_claimed_remaining INTEGER := 0;
BEGIN
    FOR guild_record IN
        SELECT
            gc.guild_code,
            gc.display_name,
            gc.onboarding_started_at,
            gc.last_successful_sync
        FROM guild_config gc
        WHERE gc.onboarding_started_at < (now() - cleanup_threshold)
          AND NOT is_protected_guild(gc.guild_code)
          AND gc.last_successful_sync IS NOT NULL
          -- Any attestation proves a mapping was claimed, even after the
          -- claimant leaves and claim columns are cleared; retain that history.
          AND NOT EXISTS (
              SELECT 1
              FROM player_mapping pm
              JOIN player_identity_attestations pia
                ON pia.mapping_id = pm.id
              WHERE pm.guild_code = gc.guild_code
              LIMIT 1
          )
          AND gc.cluster_id IS NULL
    LOOP
        -- Recheck claimed mappings before deletion so a concurrent claim
        -- preserves the guild and its mapping history.
        SELECT count(*) INTO v_claimed_remaining
        FROM player_mapping pm
        WHERE pm.guild_code = guild_record.guild_code
          AND (pm.user_id IS NOT NULL
               OR pm.ownership_attestation_id IS NOT NULL
               OR EXISTS (
                   SELECT 1
                   FROM player_identity_attestations pia
                   WHERE pia.mapping_id = pm.id
               ));

        IF v_claimed_remaining > 0 THEN
            INSERT INTO system_logs (log_type, message, metadata)
            VALUES (
                'cleanup_orphaned_guilds',
                format('Skipped orphan cleanup for guild %s: %s claimed mapping(s) present',
                       guild_record.guild_code, v_claimed_remaining),
                jsonb_build_object(
                    'guild_code', guild_record.guild_code,
                    'claimed_mappings', v_claimed_remaining,
                    'cleanup_time', now()
                )
            )
            ON CONFLICT DO NOTHING;
            CONTINUE;
        END IF;

        -- Battle history (EOT_GR_data) is permanent for every season; cleanup never deletes it.

        -- Delete guild war leaderboards (FK constraint fix)
        DELETE FROM guild_war_leaderboards WHERE guild_code = guild_record.guild_code;

        -- Delete player mappings (unclaimed profiles only -- the predicate
        -- above already proved no claimed row exists, so this removes exactly
        -- the same set it always did for a true orphan, and nothing else).
        DELETE FROM player_mapping pm
        WHERE pm.guild_code = guild_record.guild_code
          AND pm.user_id IS NULL
          AND pm.ownership_attestation_id IS NULL
          AND NOT EXISTS (
              SELECT 1
              FROM player_identity_attestations pia
              WHERE pia.mapping_id = pm.id
          );

        -- Delete any pending invite codes
        DELETE FROM player_invite_codes WHERE guild_code = guild_record.guild_code;

        -- Delete the guild config
        DELETE FROM guild_config WHERE guild_code = guild_record.guild_code;

        cleaned_guilds := array_append(cleaned_guilds, guild_record.guild_code);
        total_cleaned := total_cleaned + 1;

        INSERT INTO system_logs (log_type, message, metadata)
        VALUES (
            'cleanup_orphaned_guilds',
            format('Cleaned up orphaned guild %s (synced but no users claimed profiles)', guild_record.guild_code),
            jsonb_build_object(
                'guild_code', guild_record.guild_code,
                'display_name', guild_record.display_name,
                'onboarding_started_at', guild_record.onboarding_started_at,
                'last_successful_sync', guild_record.last_successful_sync,
                'cleanup_time', now(),
                'reason', 'No users claimed profiles within 24 hours of registration'
            )
        )
        ON CONFLICT DO NOTHING;
    END LOOP;

    IF total_cleaned > 0 THEN
        INSERT INTO system_logs (log_type, message, metadata)
        VALUES (
            'cleanup_orphaned_guilds',
            format('Orphaned guild cleanup completed: %s guilds removed', total_cleaned),
            jsonb_build_object(
                'total_cleaned', total_cleaned,
                'guild_codes', cleaned_guilds,
                'cleanup_time', now()
            )
        )
        ON CONFLICT DO NOTHING;
    END IF;

    RETURN QUERY SELECT total_cleaned, cleaned_guilds;
END;
$_$;


REVOKE EXECUTE ON FUNCTION public.cleanup_orphaned_guilds() FROM PUBLIC, anon;

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
      --     all-or-nothing blast radius across every guild.
      --
      -- Cheap: this loop processes ~1 guild/day.
      BEGIN
        -- An un-revoked ownership attestation OUTRANKS a staleness
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

        -- Battle history (EOT_GR_data) is kept for every season; it has no FK to guild_config.

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

        -- Idempotent log write. If a guild_code re-onboards after a
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


ALTER FUNCTION public.cleanup_long_stale_guilds(integer, integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.cleanup_long_stale_guilds(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_long_stale_guilds(integer, integer) TO service_role;
