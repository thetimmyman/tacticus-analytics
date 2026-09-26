-- Onboarding/orphan cleanup stops treating a guild whose members all left as one
-- that never had a roster, so departed members' mappings survive.
-- target-db: general
-- "Ever claimed" comes from the attestation trail, which deactivation never erases.

CREATE OR REPLACE FUNCTION public.cleanup_incomplete_registrations() RETURNS TABLE(cleaned_count integer, guild_codes text[])
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'auth'
    AS $$
DECLARE
    cleanup_threshold INTERVAL := '24 hours';
    cleaned_guilds TEXT[] := ARRAY[]::TEXT[];
    guild_record RECORD;
    total_cleaned INTEGER := 0;
BEGIN
    -- Find candidates for cleanup: abandoned registrations with no data
    FOR guild_record IN
        SELECT gc.guild_code, gc.onboarding_started_at
        FROM guild_config gc
        WHERE gc.onboarding_completed = false
          AND gc.onboarding_completed_at IS NULL
          AND gc.api_key_encrypted IS NULL  -- No API key ever set
          AND gc.onboarding_started_at < (now() - cleanup_threshold)
          AND NOT is_protected_guild(gc.guild_code)
          -- No battle data exists
          AND NOT EXISTS (
              SELECT 1 FROM "EOT_GR_data"
              WHERE "Guild" = gc.guild_code
              LIMIT 1
          )
          -- PS-669: no player mappings exist AT ALL. This deliberately does
          -- NOT filter on is_current: a row left behind by a member who
          -- departed is retained mapping history, not an absence of history,
          -- and a guild that owns any is proof a roster was once observed.
          AND NOT EXISTS (
              SELECT 1 FROM player_mapping pm
              WHERE pm.guild_code = gc.guild_code
              LIMIT 1
          )
    LOOP
        -- Delete the incomplete registration
        DELETE FROM guild_config
        WHERE guild_code = guild_record.guild_code;

        -- Track what we cleaned
        cleaned_guilds := array_append(cleaned_guilds, guild_record.guild_code);
        total_cleaned := total_cleaned + 1;

        -- Log the cleanup action
        INSERT INTO system_logs (log_type, message, metadata)
        VALUES (
            'cleanup_incomplete_registrations',
            format('Cleaned up abandoned onboarding for guild %s (age: %s)',
                   guild_record.guild_code,
                   age(now(), guild_record.onboarding_started_at)),
            jsonb_build_object(
                'guild_code', guild_record.guild_code,
                'onboarding_started_at', guild_record.onboarding_started_at,
                'cleanup_time', now(),
                'threshold', '24 hours'
            )
        );
    END LOOP;

    -- Log summary if anything was cleaned
    IF total_cleaned > 0 THEN
        INSERT INTO system_logs (log_type, message, metadata)
        VALUES (
            'cleanup_incomplete_registrations',
            format('Cleanup completed: %s abandoned guilds removed', total_cleaned),
            jsonb_build_object(
                'total_cleaned', total_cleaned,
                'guild_codes', cleaned_guilds,
                'cleanup_time', now(),
                'threshold', '24 hours'
            )
        );
    END IF;

    RETURN QUERY SELECT total_cleaned, cleaned_guilds;
END;
$$;

CREATE OR REPLACE FUNCTION public.cleanup_abandoned_onboarding(p_dry_run boolean DEFAULT false, p_hours_threshold integer DEFAULT 24) RETURNS TABLE(type text, code text, name text, hours_since_start numeric)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    guild_record RECORD;
    cluster_record RECORD;
BEGIN
    -- Find abandoned guild registrations
    FOR guild_record IN
        SELECT
            gc.guild_code,
            gc.display_name,
            EXTRACT(EPOCH FROM (now() - gc.onboarding_started_at)) / 3600 as hours_old
        FROM guild_config gc
        WHERE gc.onboarding_completed = false
          AND gc.onboarding_completed_at IS NULL
          AND gc.api_key_encrypted IS NULL
          AND gc.onboarding_started_at < (now() - (p_hours_threshold || ' hours')::INTERVAL)
          AND NOT is_protected_guild(gc.guild_code)
          -- No data exists
          AND NOT EXISTS (
              SELECT 1 FROM "EOT_GR_data" WHERE "Guild" = gc.guild_code LIMIT 1
          )
          -- PS-669: see cleanup_incomplete_registrations above -- any mapping
          -- row, current or departed, means this guild had a roster.
          AND NOT EXISTS (
              SELECT 1 FROM player_mapping pm
              WHERE pm.guild_code = gc.guild_code LIMIT 1
          )
    LOOP
        IF NOT p_dry_run THEN
            DELETE FROM guild_config WHERE guild_code = guild_record.guild_code;

            -- Use ON CONFLICT to ignore duplicate log entries
            INSERT INTO system_logs (log_type, message, metadata)
            VALUES (
                'cleanup_abandoned_onboarding',
                format('Deleted abandoned guild: %s', guild_record.guild_code),
                jsonb_build_object(
                    'guild_code', guild_record.guild_code,
                    'hours_old', guild_record.hours_old
                )
            )
            ON CONFLICT (log_type, message) DO NOTHING;
        END IF;

        RETURN QUERY SELECT
            'guild'::TEXT,
            guild_record.guild_code::TEXT,
            guild_record.display_name::TEXT,
            guild_record.hours_old::NUMERIC;
    END LOOP;

    -- Find abandoned cluster registrations (clusters with no guilds)
    FOR cluster_record IN
        SELECT
            c.cluster_code,
            c.display_name,
            EXTRACT(EPOCH FROM (now() - c.created_at)) / 3600 as hours_old
        FROM clusters c
        WHERE c.created_at < (now() - (p_hours_threshold || ' hours')::INTERVAL)
          -- No guilds in this cluster
          AND NOT EXISTS (
              SELECT 1 FROM guild_config gc WHERE gc.cluster_id = c.id LIMIT 1
          )
    LOOP
        IF NOT p_dry_run THEN
            DELETE FROM clusters WHERE cluster_code = cluster_record.cluster_code;

            -- Use ON CONFLICT to ignore duplicate log entries
            INSERT INTO system_logs (log_type, message, metadata)
            VALUES (
                'cleanup_abandoned_onboarding',
                format('Deleted abandoned cluster: %s', cluster_record.cluster_code),
                jsonb_build_object(
                    'cluster_code', cluster_record.cluster_code,
                    'hours_old', cluster_record.hours_old
                )
            )
            ON CONFLICT (log_type, message) DO NOTHING;
        END IF;

        RETURN QUERY SELECT
            'cluster'::TEXT,
            cluster_record.cluster_code::TEXT,
            cluster_record.display_name::TEXT,
            cluster_record.hours_old::NUMERIC;
    END LOOP;
END;
$$;

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
          -- PS-669: a claim that has LAPSED is still a claim. The row of a
          -- claimant who has since left the guild carries user_id /
          -- ownership_attestation_id with is_current = false; gating this
          -- probe on is_current = true made such a guild look unclaimed and
          -- sent its whole mapping history -- the only record of which
          -- display_name belonged to which player_id -- to the DELETE below.
          --
          -- ...and the claim columns alone are not enough evidence. When the
          -- LAST claimed member leaves, deactivate_player_mappings_legacy_impl
          -- (20260820220000) NULLs user_id AND ownership_attestation_id while
          -- setting is_current = false, so a once-claimed guild becomes
          -- indistinguishable from a never-claimed one and the DELETE below
          -- would still destroy exactly the history this migration exists to
          -- retain. player_identity_attestations is evidence deactivation
          -- cannot erase: roster deactivation only APPENDS a revocation
          -- (append_player_identity_revocation), the attestation row itself
          -- survives, has no FK to player_mapping, and is protected from
          -- deletion by ON DELETE RESTRICT from its revocations.
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
        -- PS-669 fail-closed backstop: never delete an identity-bearing
        -- mapping from a cleanup job. If one appeared between the candidate
        -- SELECT and here, skip this guild entirely and leave everything --
        -- guild_config included -- in place.
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

        -- Delete battle data first
        DELETE FROM "EOT_GR_data" WHERE "Guild" = guild_record.guild_code AND ("Season" !~ '^[0-9]+$' OR "Season"::int < 71);

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
