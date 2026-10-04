-- target-db: general
--
-- sync.queue.drain fired ~27 times over 9 days, mostly on brief self-draining
-- bursts: live data (2026-10-04) shows the "saturated"/"over-ceiling" condition
-- recurring many times a DAY (not only on a single nightly batch), each burst
-- lasting a few minutes before the queue drains on its own. The existing
-- "top 3 recent runs" gate (sync_queue_drain_health, unchanged here) correctly
-- tells "is something backed up right now" from "is it keeping up", but it
-- does not distinguish a multi-minute burst from a condition that keeps
-- reproducing itself run after run -- the "sustained vs burst" distinction
-- this migration adds.
--
-- This migration does not touch sync_queue_drain_health()'s verdict logic (all
-- 39 existing pgtap assertions on verdict strings keep passing unmodified).
-- It only changes check_sync_queue_drain_health(): when the verdict is
-- 'saturated' or 'backlog', it now also asks "has this been going on for a
-- while", by sampling a WIDER window of recorded sync_drain_runs and checking
-- what fraction of them breached.
--
-- IMPORTANT design note (found by reading monitoring.notify()'s actual state
-- machine, not just assuming it): notify() only posts to Discord, and only
-- sets last_notified_at, on a real status TRANSITION (or on a reminder for an
-- alert that has ALREADY posted at least once). If a burst were recorded as
-- 'firing' with p_quiet=true, the alert_key would sit at status='firing' with
-- last_notified_at=NULL forever -- a LATER run that proves the same pattern
-- IS sustained would see prev_status='firing' == p_status='firing' (no
-- transition) and, since prev_notified is still NULL, skip the post
-- entirely. That is a worse bug than the noise this migration fixes: a
-- genuinely sustained condition would never page. So an unsustained burst is instead
-- treated exactly like the existing 'ok' leg -- notify('cleared', ...,
-- p_quiet) -- which is always safe (a cleared->cleared call never posts) and
-- correctly resolves a previously-loud alert if the pattern has subsided.
-- Only once the breach is the dominant pattern across the wider window does
-- it take the 'firing' path and transition/page loud. The raw per-run detail
-- a digest might want is already in sync_drain_runs directly; alert_state no
-- longer needs to carry a quiet "firing" row for it.
--
-- 'stalled' (the oldest pending row actually exceeding the age bound) is
-- untouched and always loud on a single sample: that leg already behaves
-- correctly (it fired exactly once in 9 days, on a real stall), and the
-- sustained gate must never delay a real stuck-job page.
--
-- Never alert at 0 pending: unchanged, already fixed by the 'drained' verdict
-- in 20260928150000.

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

-- Fraction of sync_drain_runs rows in the last p_lookback_minutes that
-- breached (saturated OR queue_depth_start over p_pending_ceiling). Returns
-- is_sustained = false whenever there are fewer than p_min_samples rows to
-- judge from -- insufficient evidence reads as "not proven sustained", not as
-- "sustained", which is the quieter failure mode and matches how 'no_runs' /
-- 'runs_stale' already treat sparse data one level up.
CREATE OR REPLACE FUNCTION public.sync_queue_drain_sustained(
  p_lookback_minutes integer DEFAULT 20,
  p_pending_ceiling integer DEFAULT 20,
  p_min_samples integer DEFAULT 8,
  p_min_fraction numeric DEFAULT 0.6
) RETURNS TABLE(
  is_sustained boolean,
  samples integer,
  breaching_samples integer,
  breach_fraction numeric,
  window_started_at timestamp with time zone
)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $$
  WITH v AS (
    SELECT GREATEST(COALESCE(p_lookback_minutes, 20), 1) AS lookback_minutes,
           GREATEST(COALESCE(p_pending_ceiling, 20), 0) AS ceiling,
           GREATEST(COALESCE(p_min_samples, 8), 1) AS min_samples,
           LEAST(GREATEST(COALESCE(p_min_fraction, 0.6), 0), 1) AS min_fraction
  ),
  recent AS (
    SELECT r.ran_at,
           (r.saturated OR r.queue_depth_start > v.ceiling) AS breach
      FROM public.sync_drain_runs r, v
     WHERE r.ran_at >= now() - make_interval(mins => v.lookback_minutes)
  ),
  agg AS (
    SELECT count(*)::integer AS n,
           count(*) FILTER (WHERE breach)::integer AS nb,
           min(ran_at) AS started_at
      FROM recent
  )
  SELECT
    (agg.n >= v.min_samples
       AND agg.nb::numeric / NULLIF(agg.n, 0) >= v.min_fraction),
    agg.n,
    agg.nb,
    CASE WHEN agg.n > 0 THEN round(agg.nb::numeric / agg.n, 3) ELSE NULL END,
    agg.started_at
    FROM agg CROSS JOIN v;
$$;

ALTER FUNCTION public.sync_queue_drain_sustained(integer, integer, integer, numeric)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.sync_queue_drain_sustained(integer, integer, integer, numeric)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_queue_drain_sustained(integer, integer, integer, numeric)
  TO service_role;

CREATE OR REPLACE FUNCTION public.check_sync_queue_drain_health(
  p_consecutive_runs integer DEFAULT 3,
  p_pending_ceiling integer DEFAULT 20,
  p_max_oldest_minutes integer DEFAULT 10,
  p_quiet boolean DEFAULT false,
  p_sustained_lookback_minutes integer DEFAULT 20,
  p_sustained_min_samples integer DEFAULT 8,
  p_sustained_min_fraction numeric DEFAULT 0.6
) RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $$
DECLARE
  h          record;
  s          record;
  alert_key  text := 'sync.queue.drain';
  body       text;
  is_sustained boolean;
  sustain_note text;
BEGIN
  SELECT * INTO h FROM public.sync_queue_drain_health(
    p_consecutive_runs, p_pending_ceiling, p_max_oldest_minutes);

  IF h.verdict = 'stalled' THEN
    -- A single sample already means a job has sat unclaimed past the age
    -- bound. No sustained gate: stays loud exactly as before.
    body := format(
      'The sync_queue drain is behind (%s).'
      || E'\n  pending depth now: %s (ceiling %s)'
      || E'\n  oldest pending row: %s s old (bound %s min)'
      || E'\n  runs considered: %s of %s -- saturated %s, over-ceiling %s'
      || E'\n  last run: %s, %s ms of a %s ms window (utilisation %s)'
      || E'\n  The window is WORKER_CONFIG.workerTimeout minus the lane tail'
      || E'\n  reserve, NOT a statement_timeout and not the cron minute.',
      h.verdict,
      h.pending_depth, GREATEST(COALESCE(p_pending_ceiling, 20), 0),
      round(COALESCE(h.oldest_pending_age_seconds, 0)),
      GREATEST(COALESCE(p_max_oldest_minutes, 10), 1),
      h.runs_considered, GREATEST(COALESCE(p_consecutive_runs, 3), 1),
      h.saturated_runs, h.backlog_runs,
      COALESCE(h.last_run_at::text,
               format('none in the last %s min', GREATEST(COALESCE(p_max_oldest_minutes, 10), 1))),
      COALESCE(h.last_duration_ms::text, 'n/a'),
      COALESCE(h.last_window_ms::text, 'n/a'),
      COALESCE(h.window_utilisation::text, 'n/a'));

    PERFORM monitoring.notify(
      alert_key, 'firing', 'sync_queue drain is behind', body, p_quiet);
    RETURN 1;

  ELSIF h.verdict IN ('saturated', 'backlog') THEN
    body := format(
      'The sync_queue drain is behind (%s).'
      || E'\n  pending depth now: %s (ceiling %s)'
      || E'\n  oldest pending row: %s s old (bound %s min)'
      || E'\n  runs considered: %s of %s -- saturated %s, over-ceiling %s'
      || E'\n  last run: %s, %s ms of a %s ms window (utilisation %s)'
      || E'\n  The window is WORKER_CONFIG.workerTimeout minus the lane tail'
      || E'\n  reserve, NOT a statement_timeout and not the cron minute.',
      h.verdict,
      h.pending_depth, GREATEST(COALESCE(p_pending_ceiling, 20), 0),
      round(COALESCE(h.oldest_pending_age_seconds, 0)),
      GREATEST(COALESCE(p_max_oldest_minutes, 10), 1),
      h.runs_considered, GREATEST(COALESCE(p_consecutive_runs, 3), 1),
      h.saturated_runs, h.backlog_runs,
      COALESCE(h.last_run_at::text,
               format('none in the last %s min', GREATEST(COALESCE(p_max_oldest_minutes, 10), 1))),
      COALESCE(h.last_duration_ms::text, 'n/a'),
      COALESCE(h.last_window_ms::text, 'n/a'),
      COALESCE(h.window_utilisation::text, 'n/a'));

    IF p_quiet THEN
      -- Caller explicitly asked for quiet. The only such callers are tests
      -- exercising sync_queue_drain_health()'s verdict/transition logic
      -- without a live webhook configured -- preserve that contract exactly
      -- (always a firing condition, recorded quietly) rather than running it
      -- through the sustained gate below, which exists for real (loud-intent)
      -- calls only.
      PERFORM monitoring.notify(
        alert_key, 'firing', 'sync_queue drain is behind', body, true);
      RETURN 1;
    END IF;

    -- A real call (pg_cron always calls with p_quiet=false). Only treat the
    -- breach as a firing condition once it is the dominant pattern across a
    -- wider lookback, not just the latest p_consecutive_runs sample -- see
    -- the migration header for why an unsustained burst takes the 'cleared'
    -- path (notify() only posts on an actual status transition or a due
    -- reminder on an alert that has already posted once; a quietly-recorded
    -- 'firing' row would never be able to escalate to loud later).
    SELECT * INTO s FROM public.sync_queue_drain_sustained(
      p_sustained_lookback_minutes, p_pending_ceiling,
      p_sustained_min_samples, p_sustained_min_fraction);
    is_sustained := COALESCE(s.is_sustained, false);

    sustain_note := format(
      E'\n  sustained check: %s of %s run(s) breached over the last %s min (%s) -- %s',
      COALESCE(s.breaching_samples, 0), COALESCE(s.samples, 0),
      GREATEST(COALESCE(p_sustained_lookback_minutes, 20), 1),
      COALESCE(s.breach_fraction::text, 'n/a'),
      CASE WHEN is_sustained THEN 'paging'
           ELSE 'below the sustained bar, treated as a self-draining burst' END);
    body := body || sustain_note;

    IF is_sustained THEN
      PERFORM monitoring.notify(
        alert_key, 'firing', 'sync_queue drain is behind', body, false);
      RETURN 1;
    ELSE
      -- Not yet sustained: behave exactly like the 'ok' leg below (always
      -- safe -- a cleared alert_key that gets 'cleared' again never posts --
      -- and correctly resolves a previously-loud alert whose pattern has
      -- since thinned out to isolated bursts).
      PERFORM monitoring.notify(
        alert_key, 'cleared', 'sync_queue drain is behind', body, false);
      RETURN 0;
    END IF;

  ELSIF h.verdict = 'ok' THEN
    PERFORM monitoring.notify(
      alert_key, 'cleared', 'sync_queue drain is behind',
      format('The drain is keeping up: pending depth %s, oldest pending %s s, '
             || 'last run %s ms of a %s ms window.',
             h.pending_depth, round(COALESCE(h.oldest_pending_age_seconds, 0)),
             COALESCE(h.last_duration_ms::text, 'n/a'),
             COALESCE(h.last_window_ms::text, 'n/a')),
      p_quiet);
    RETURN 0;

  ELSIF h.verdict = 'runs_stale' THEN
    PERFORM monitoring.notify(
      alert_key, 'cleared', 'sync_queue drain is behind',
      format('No drain run recorded in the last %s min (newest %s), so no run '
             || 'evidence is current. Live queue: pending depth %s, oldest pending %s s.',
             GREATEST(COALESCE(p_max_oldest_minutes, 10), 1),
             COALESCE((SELECT max(r.ran_at) FROM public.sync_drain_runs r)::text, 'never'),
             h.pending_depth, round(COALESCE(h.oldest_pending_age_seconds, 0))),
      p_quiet);
    RETURN 0;

  END IF;

  -- 'no_runs' or 'drained': cannot tell from this sample. Neither leg.
  RETURN 0;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[check_sync_queue_drain_health] monitor error: %', SQLERRM;
  RETURN -1;
END;
$$;

ALTER FUNCTION public.check_sync_queue_drain_health(
  integer, integer, integer, boolean, integer, integer, numeric)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.check_sync_queue_drain_health(
  integer, integer, integer, boolean, integer, integer, numeric)
  FROM PUBLIC, anon, authenticated;

-- The old 4-arg signature is gone (CREATE OR REPLACE cannot add trailing
-- DEFAULTed params onto an existing signature's identity the way a bare
-- re-declare can when only defaults change -- here the param LIST is the
-- same prefix, so this IS an in-place replace, not a new overload; drop the
-- stale entry only if Postgres ever left one behind under a different arg
-- count, which would otherwise shadow pg_cron's zero-arg call).
DO $cleanup$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'check_sync_queue_drain_health'
       AND p.pronargs = 4
  ) THEN
    DROP FUNCTION public.check_sync_queue_drain_health(integer, integer, integer, boolean);
  END IF;
END;
$cleanup$;

-- The monitor must still evaluate here and stay closed to client roles.
DO $verify$
DECLARE
  v_verdict text;
BEGIN
  PERFORM 1 FROM public.sync_queue_drain_sustained();
  SELECT verdict INTO v_verdict FROM public.sync_queue_drain_health();
  IF v_verdict IS NULL THEN
    RAISE EXCEPTION 'sync_queue_drain_health() returned no row';
  END IF;

  -- pg_cron calls check_sync_queue_drain_health() with no arguments.
  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'check_sync_queue_drain_health'
     AND p.pronargdefaults = p.pronargs;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'PS verify: check_sync_queue_drain_health() is not callable with zero arguments, so the cron command cannot run';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     CROSS JOIN unnest(ARRAY['anon', 'authenticated']) AS role_name
     WHERE n.nspname = 'public'
       AND p.proname IN ('sync_queue_drain_health', 'check_sync_queue_drain_health',
                          'sync_queue_drain_sustained')
       AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name)
       AND has_function_privilege(role_name, p.oid, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'anon or authenticated can execute a sync drain monitor function';
  END IF;
END;
$verify$;

NOTIFY pgrst, 'reload schema';

COMMIT;
