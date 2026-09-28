-- target-db: general
-- A stale roster on a guild whose sync is not running (API key invalid, auto sync off,
-- or batch sync gave up) reads 'sync_dead', not 'stale': it cannot move until sync
-- does, so the roster alert clears and guild sync health owns the problem.

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

CREATE OR REPLACE FUNCTION public.guild_roster_write_health(
  p_stale_days integer DEFAULT 7,
  p_min_fresh_fraction numeric DEFAULT 0.5,
  p_min_current_rows integer DEFAULT 3
) RETURNS TABLE(
  guild_code text,
  current_rows integer,
  rows_written_in_window integer,
  fresh_fraction numeric,
  max_updated_at timestamp with time zone,
  last_roster_write_at timestamp with time zone,
  roster_write_age_hours numeric,
  roster_write_failures integer,
  sync_looks_healthy boolean,
  verdict text
)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $$
  WITH bounds AS (
    SELECT now() - make_interval(days => GREATEST(COALESCE(p_stale_days, 7), 1))
             AS window_start
  ),
  per_guild AS (
    SELECT gc.guild_code                                            AS guild_code,
           gc.last_successful_sync                                  AS last_successful_sync,
           gc.api_key_is_valid                                      AS api_key_is_valid,
           gc.auto_sync_enabled                                     AS auto_sync_enabled,
           COALESCE(gc.consecutive_sync_failures, 0)                AS consecutive_sync_failures,
           COUNT(pm.id) FILTER (WHERE pm.is_current)                AS current_rows,
           COUNT(pm.id) FILTER (
             WHERE pm.is_current AND pm.updated_at >= b.window_start
           )                                                        AS rows_written_in_window,
           MAX(pm.updated_at) FILTER (WHERE pm.is_current)          AS max_updated_at,
           sh.last_roster_write_at                                  AS last_roster_write_at,
           COALESCE(sh.roster_write_failures, 0)                    AS roster_write_failures
      FROM public.guild_config gc
      CROSS JOIN bounds b
      LEFT JOIN public.player_mapping pm
             ON pm.guild_code = gc.guild_code
      LEFT JOIN public.sync_health sh
             ON sh.guild_code = gc.guild_code
     WHERE gc.enabled IS TRUE
     GROUP BY gc.guild_code, gc.last_successful_sync,
              gc.consecutive_sync_failures, gc.api_key_is_valid,
              gc.auto_sync_enabled, sh.last_roster_write_at,
              sh.roster_write_failures
  )
  SELECT g.guild_code,
         g.current_rows::integer,
         g.rows_written_in_window::integer,
         CASE WHEN g.current_rows > 0
              THEN ROUND(g.rows_written_in_window::numeric / g.current_rows, 4)
         END AS fresh_fraction,
         g.max_updated_at,
         g.last_roster_write_at,
         CASE WHEN g.last_roster_write_at IS NOT NULL
              THEN ROUND(
                EXTRACT(EPOCH FROM (now() - g.last_roster_write_at))::numeric / 3600,
                2)
         END AS roster_write_age_hours,
         g.roster_write_failures::integer,
         -- A stalled roster looks exactly like this: sync reports healthy while
         -- the roster stands still.
         (g.consecutive_sync_failures = 0
          AND g.last_successful_sync IS NOT NULL
          AND g.last_successful_sync >= now() - INTERVAL '6 hours') AS sync_looks_healthy,
         CASE
           WHEN g.roster_write_failures > 0 THEN 'failing'
           WHEN g.last_successful_sync IS NULL THEN 'never_synced'
           WHEN g.current_rows < GREATEST(COALESCE(p_min_current_rows, 3), 1)
             THEN 'too_few_rows'
           -- Only a would-be 'stale' is reclassified, using batch sync's own skip rule
           -- (invalid key, auto sync not true, 5+ failures): that roster cannot move.
           WHEN g.rows_written_in_window::numeric / g.current_rows
                  < COALESCE(p_min_fresh_fraction, 0.5) THEN
             CASE
               WHEN g.api_key_is_valid IS FALSE
                 OR g.auto_sync_enabled IS NOT TRUE
                 OR g.consecutive_sync_failures >= 5 THEN 'sync_dead'
               ELSE 'stale'
             END
           ELSE 'ok'
         END AS verdict
    FROM per_guild g
$$;

ALTER FUNCTION public.guild_roster_write_health(integer, numeric, integer)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.guild_roster_write_health(integer, numeric, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guild_roster_write_health(integer, numeric, integer)
  TO service_role;

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
        format('Roster alert withdrawn for %s: the guild sync itself is not running '
               || '(API key invalid, auto sync off, or batch sync gave up), '
               || 'which guild sync health reports.', r.guild_code),
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

-- Both monitor functions must stay closed to client roles.
DO $verify$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     CROSS JOIN unnest(ARRAY['anon', 'authenticated']) AS role_name
     WHERE n.nspname = 'public'
       AND p.proname IN ('guild_roster_write_health', 'check_guild_roster_write_health')
       AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name)
       AND has_function_privilege(role_name, p.oid, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'anon or authenticated can execute a roster write monitor function';
  END IF;
END;
$verify$;

COMMIT;
