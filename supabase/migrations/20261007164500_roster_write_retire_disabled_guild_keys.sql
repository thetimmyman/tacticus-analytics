-- target-db: general
-- check_guild_roster_write_health() retires the roster.write.<guild> alert keys of guilds that are
-- no longer enabled. Before this, a disabled guild's key was never refreshed, aged past its
-- expectation and raised a false monitoring.staleness alert about two days later.
-- Rollback: re-apply 20260927220000_roster_write_sync_health_verdict.sql (restores the function
-- without the retirement loop; deleted keys are re-created by the monitor if a guild is re-enabled).

BEGIN;

DO $guard$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION
      'This migration targets the General database only; refusing to run on %',
      current_database();
  END IF;
END;
$guard$;

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.check_guild_roster_write_health(
  p_stale_days integer DEFAULT 7,
  p_min_fresh_fraction numeric DEFAULT 0.5,
  p_min_current_rows integer DEFAULT 3,
  p_quiet boolean DEFAULT false
) RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $$
DECLARE
  r          record;
  firing     integer := 0;
  alert_key  text;
  body       text;
  retired    record;
BEGIN
  FOR r IN
    SELECT * FROM public.guild_roster_write_health(
      p_stale_days, p_min_fresh_fraction, p_min_current_rows)
     ORDER BY guild_code
  LOOP
    alert_key := 'roster.write.' || r.guild_code;

    IF r.verdict IN ('failing', 'stale') THEN
      firing := firing + 1;
      body := format(
        'Guild %s roster write looks DEAD (%s).'
        || E'\n  is_current rows: %s, written in the last %s day(s): %s (fraction %s, floor %s)'
        || E'\n  recorded consecutive roster-write failures: %s'
        || E'\n  last recorded roster write: %s (%s h ago)'
        || E'\n  max(player_mapping.updated_at): %s  <-- deliberately NOT the measure;'
        || E'\n      claim-corridor writes keep this current while the roster stands still'
        || E'\n  sync reporting healthy at the same time: %s',
        r.guild_code, r.verdict,
        r.current_rows,
        GREATEST(COALESCE(p_stale_days, 7), 1),
        r.rows_written_in_window,
        COALESCE(r.fresh_fraction::text, 'n/a'),
        COALESCE(p_min_fresh_fraction, 0.5),
        r.roster_write_failures,
        COALESCE(r.last_roster_write_at::text, 'never recorded'),
        COALESCE(r.roster_write_age_hours::text, 'n/a'),
        COALESCE(r.max_updated_at::text, 'none'),
        r.sync_looks_healthy);

      PERFORM monitoring.notify(
        alert_key, 'firing',
        format('Roster write stalled: %s', r.guild_code),
        body, p_quiet);

    ELSIF r.verdict = 'sync_dead' THEN
      PERFORM monitoring.notify(
        alert_key, 'cleared',
        format('Roster write stalled: %s', r.guild_code),
        format('Roster alert withdrawn for %s: every sync lane skips this guild and no '
               || 'clean sync landed in the last %s day(s), so the stale roster is a sync '
               || 'outage, not a roster-write stall.',
               r.guild_code, GREATEST(COALESCE(p_stale_days, 7), 1)),
        p_quiet);

    ELSIF r.verdict = 'ok' THEN
      PERFORM monitoring.notify(
        alert_key, 'cleared',
        format('Roster write stalled: %s', r.guild_code),
        format('Roster write is landing again for %s: %s of %s is_current rows '
               || 'stamped in the last %s day(s) (fraction %s).',
               r.guild_code, r.rows_written_in_window, r.current_rows,
               GREATEST(COALESCE(p_stale_days, 7), 1),
               COALESCE(r.fresh_fraction::text, 'n/a')),
        p_quiet);

    -- 'too_few_rows' and 'never_synced' are deliberately neither: "cannot tell" is not
    -- "cleared", or a guild that lost its whole roster could silence its own alert.
    END IF;
  END LOOP;

  -- Retire the keys of guilds that are no longer enabled. The loop above only visits enabled
  -- guilds, so a disabled guild's key is never refreshed again: it ages past the roster.write.%
  -- expectation and monitoring.stale_alerts() reports it as a stopped monitor.
  -- Retirement takes two runs for a key that is still firing: this run posts the cleared notice
  -- and notify() records the transition only once it is delivered (a Plane-tracked key records
  -- it without posting), a later run deletes the row. Deleting in the same run would hide the
  -- transition from the tracker and drop a key whose clear failed to deliver. A cleared row is
  -- only deleted once the clear is at least an hour old, long enough for the tracker to see it.
  FOR retired IN
    SELECT s.alert_key, s.status, s.since
      FROM monitoring.alert_state s
     WHERE s.alert_key LIKE 'roster.write.%'
       AND NOT EXISTS (
         SELECT 1
           FROM public.guild_config gc
          WHERE gc.enabled IS TRUE
            AND 'roster.write.' || gc.guild_code = s.alert_key)
     ORDER BY s.alert_key
  LOOP
    -- Re-check right before acting: a guild re-enabled since the snapshot above keeps its key.
    CONTINUE WHEN EXISTS (
      SELECT 1
        FROM public.guild_config gc
       WHERE gc.enabled IS TRUE
         AND 'roster.write.' || gc.guild_code = retired.alert_key);

    IF retired.status = 'firing' THEN
      PERFORM monitoring.notify(
        retired.alert_key, 'cleared',
        format('Roster write stalled: %s', substr(retired.alert_key, 14)),
        format('Roster alert withdrawn for %s: guild disabled, monitoring retired.',
               substr(retired.alert_key, 14)),
        p_quiet);
    ELSIF retired.since <= now() - INTERVAL '1 hour' THEN
      DELETE FROM monitoring.alert_state AS s
       WHERE s.alert_key = retired.alert_key AND s.status = 'cleared';
    END IF;
  END LOOP;

  RETURN firing;
EXCEPTION WHEN OTHERS THEN
  -- Never let the monitor kill its own cron slot.
  RAISE WARNING '[check_guild_roster_write_health] monitor error: %', SQLERRM;
  RETURN -1;
END;
$$;

ALTER FUNCTION public.check_guild_roster_write_health(integer, numeric, integer, boolean)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.check_guild_roster_write_health(integer, numeric, integer, boolean)
  FROM PUBLIC, anon, authenticated;

DO $verify$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     CROSS JOIN unnest(ARRAY['anon', 'authenticated']) AS role_name
     WHERE n.nspname = 'public'
       AND p.proname = 'check_guild_roster_write_health'
       AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name)
       AND has_function_privilege(role_name, p.oid, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'anon or authenticated can execute check_guild_roster_write_health';
  END IF;
END;
$verify$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20261007164500', 'roster_write_retire_disabled_guild_keys')
ON CONFLICT (version) DO NOTHING;

NOTIFY pgrst, 'reload schema';

COMMIT;
