-- target-db: general
-- Per-guild monitor over the roster write, which can fail silently while sync
-- signals stay green. It measures the fraction of is_current rows stamped in the
-- window, since max(updated_at) stays fresh via profile claims.

BEGIN;

ALTER TABLE public.sync_health
  ADD COLUMN IF NOT EXISTS last_roster_write_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS roster_rows_written_last_pass integer,
  ADD COLUMN IF NOT EXISTS roster_write_failures integer DEFAULT 0 NOT NULL;

COMMENT ON COLUMN public.sync_health.last_roster_write_at IS
  'PS-513: when the roster writer last completed a pass for this guild. NULL = never observed since PS-513 shipped, which is not evidence of health.';
COMMENT ON COLUMN public.sync_health.roster_rows_written_last_pass IS
  'PS-513: rows the last successful roster pass upserted. Zero on a guild with members is the dead-writer shape.';
COMMENT ON COLUMN public.sync_health.roster_write_failures IS
  'PS-513: consecutive roster-write failures. Incremented by record_roster_write_outcome on the leg the sync swallows as non-fatal; reset to 0 by a successful pass.';

-- DEFINER so it does not depend on sync_health's RLS; never raises, so it cannot fail raid ingest.

CREATE OR REPLACE FUNCTION public.record_roster_write_outcome(
  p_guild_code text,
  p_ok boolean,
  p_rows_written integer DEFAULT NULL,
  p_reason text DEFAULT NULL
) RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $$
BEGIN
  IF p_guild_code IS NULL OR btrim(p_guild_code) = '' THEN
    RETURN;
  END IF;

  INSERT INTO public.sync_health AS sh (
    guild_code,
    last_roster_write_at,
    roster_rows_written_last_pass,
    roster_write_failures,
    updated_at
  )
  VALUES (
    p_guild_code,
    CASE WHEN p_ok THEN now() ELSE NULL END,
    CASE WHEN p_ok THEN GREATEST(COALESCE(p_rows_written, 0), 0) ELSE NULL END,
    CASE WHEN p_ok THEN 0 ELSE 1 END,
    now()
  )
  ON CONFLICT (guild_code) DO UPDATE
     SET last_roster_write_at =
           CASE WHEN p_ok THEN now() ELSE sh.last_roster_write_at END,
         roster_rows_written_last_pass =
           CASE WHEN p_ok THEN GREATEST(COALESCE(p_rows_written, 0), 0)
                ELSE sh.roster_rows_written_last_pass END,
         roster_write_failures =
           CASE WHEN p_ok THEN 0
                ELSE LEAST(COALESCE(sh.roster_write_failures, 0) + 1, 1000000) END,
         updated_at = now();

  IF NOT p_ok THEN
    RAISE WARNING '[record_roster_write_outcome] % roster write FAILED: %',
      p_guild_code, COALESCE(p_reason, 'no reason given');
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[record_roster_write_outcome] could not record % (ok=%): %',
    p_guild_code, p_ok, SQLERRM;
END;
$$;

ALTER FUNCTION public.record_roster_write_outcome(text, boolean, integer, text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_roster_write_outcome(text, boolean, integer, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_roster_write_outcome(text, boolean, integer, text)
  TO service_role;

-- Pure, so pgTAP can assert it. too_few_rows and never_synced are deliberately not 'ok'.

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
              gc.consecutive_sync_failures, sh.last_roster_write_at,
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
         -- The point of the incident in one column: every guild below was
         -- reporting exactly this shape while its roster stood still.
         (g.consecutive_sync_failures = 0
          AND g.last_successful_sync IS NOT NULL
          AND g.last_successful_sync >= now() - INTERVAL '6 hours') AS sync_looks_healthy,
         CASE
           WHEN g.roster_write_failures > 0 THEN 'failing'
           WHEN g.last_successful_sync IS NULL THEN 'never_synced'
           WHEN g.current_rows < GREATEST(COALESCE(p_min_current_rows, 3), 1)
             THEN 'too_few_rows'
           WHEN g.rows_written_in_window::numeric / g.current_rows
                  < COALESCE(p_min_fresh_fraction, 0.5) THEN 'stale'
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

-- One alert key per guild; p_quiet records transitions without delivery.

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

    -- 'too_few_rows' and 'never_synced' are deliberately neither. "I cannot
    -- tell" is not "cleared": clearing on them would let a guild that lost its
    -- whole roster silence its own alert.
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

-- Guarded and dynamic: the replay lane has no pg_cron.

DO $schedule$
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE NOTICE
      'PS-513: pg_cron is not installed on database % -- the monitor functions are created but NOT scheduled here. This is expected on the pgTAP replay lane and is a hard miss anywhere else.',
      current_database();
    RETURN;
  END IF;

  EXECUTE $sql$
    SELECT cron.unschedule(jobid) FROM cron.job
     WHERE jobname = 'guild-roster-write-monitor'
  $sql$;

  EXECUTE $sql$
    SELECT cron.schedule(
      'guild-roster-write-monitor',
      '47 9 * * *',
      'SELECT public.check_guild_roster_write_health();')
  $sql$;

  RAISE NOTICE 'PS-513: scheduled guild-roster-write-monitor on %', current_database();
END;
$schedule$;

DO $verify$
DECLARE
  v_missing text;
  v_scheduled boolean;
  v_anon_can boolean;
BEGIN
  SELECT string_agg(c, ', ') INTO v_missing
    FROM unnest(ARRAY['last_roster_write_at',
                      'roster_rows_written_last_pass',
                      'roster_write_failures']) AS c
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'sync_health'
        AND column_name = c);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'PS-513 verify: sync_health is missing %', v_missing;
  END IF;

  -- The zero-argument call is what pg_cron issues. If the defaults do not make
  -- it resolvable, the scheduled command fails every night in silence.
  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'check_guild_roster_write_health'
     AND p.pronargdefaults = p.pronargs;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'PS-513 verify: check_guild_roster_write_health() is not callable with zero arguments, so the cron command cannot run';
  END IF;

  -- Fresh functions inherit anon EXECUTE from ALTER DEFAULT PRIVILEGES on this
  -- estate. Assert the revoke actually took.
  SELECT bool_or(has_function_privilege(role_name, p.oid, 'EXECUTE'))
    INTO v_anon_can
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN unnest(ARRAY['anon', 'authenticated']) AS role_name
   WHERE n.nspname = 'public'
     AND p.proname IN ('record_roster_write_outcome',
                       'guild_roster_write_health',
                       'check_guild_roster_write_health')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name);
  IF COALESCE(v_anon_can, false) THEN
    RAISE EXCEPTION
      'PS-513 verify: anon or authenticated retains EXECUTE on a PS-513 function';
  END IF;

  IF to_regclass('cron.job') IS NOT NULL THEN
    EXECUTE $sql$
      SELECT EXISTS (SELECT 1 FROM cron.job
                      WHERE jobname = 'guild-roster-write-monitor'
                        AND command ~ 'check_guild_roster_write_health')
    $sql$ INTO v_scheduled;
    IF NOT v_scheduled THEN
      RAISE EXCEPTION
        'PS-513 verify: the monitor is not scheduled -- an unwired monitor is an orphan';
    END IF;
  END IF;
END;
$verify$;

COMMIT;
