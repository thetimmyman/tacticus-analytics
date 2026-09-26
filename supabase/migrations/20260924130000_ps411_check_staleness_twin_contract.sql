-- monitoring.check_staleness() returns BOOLEAN (true = notified), as the shared
-- heartbeat job expects from both databases.
-- target-db: postgres  (Tacticus Analytics / tacticusanalytics.com)

BEGIN;

DO $guard$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION
      'PS-411 twin contract requires database postgres, got %', current_database();
  END IF;

  IF to_regprocedure('monitoring.check_staleness()') IS NULL THEN
    RAISE EXCEPTION
      'PS-411 twin contract requires the zero-argument integer function from 20260919011000';
  END IF;

  IF to_regprocedure('monitoring.notify(text,text,text,text,boolean)') IS NULL
     OR (SELECT prorettype
           FROM pg_proc
          WHERE oid = to_regprocedure('monitoring.notify(text,text,text,text,boolean)'))
        <> 'boolean'::regtype THEN
    RAISE EXCEPTION
      'PS-411 twin contract requires monitoring.notify(text,text,text,text,boolean) to return boolean';
  END IF;

  IF to_regprocedure('monitoring.stale_alerts()') IS NULL THEN
    RAISE EXCEPTION
      'PS-411 twin contract requires monitoring.stale_alerts() from 20260919011000';
  END IF;
END;
$guard$;

-- A zero-argument overload would make the scheduled call ambiguous.
DROP FUNCTION monitoring.check_staleness();

CREATE FUNCTION monitoring.check_staleness(p_limit integer DEFAULT 20)
RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $fn$
DECLARE
  v_total  integer;
  v_keys   integer;
  v_lines  text;
  v_body   text;
BEGIN
  SELECT count(*) INTO v_keys  FROM monitoring.alert_state;
  SELECT count(*) INTO v_total FROM monitoring.stale_alerts();

  IF v_total = 0 THEN
    RETURN monitoring.notify(
      'monitoring.staleness', 'cleared',
      'Every monitor is still reporting',
      format('All %s alert keys were refreshed inside their expected interval.', v_keys));
  END IF;

  SELECT string_agg(line, E'\n')
    INTO v_lines
    FROM (
      SELECT format('- %s: last reported %s ago, expected every %s (currently reads %s)',
                    a.alert_key,
                    justify_interval(now() - a.last_seen_at),
                    coalesce(a.expected_interval::text, 'NO EXPECTATION REGISTERED'),
                    a.status) AS line
        FROM monitoring.stale_alerts() a
       LIMIT greatest(coalesce(p_limit, 20), 1)
    ) t;

  v_body := format(
    '%s of %s alert keys have not reported inside their expected interval. A stale last_seen_at means THE MONITOR STOPPED RUNNING — the status each key still shows is whatever it last said and proves nothing about now.%s%s',
    v_total, v_keys, E'\n\n', v_lines);

  IF v_total > greatest(coalesce(p_limit, 20), 1) THEN
    v_body := v_body || format(E'\n... and %s more (see monitoring.stale_alerts()).',
                               v_total - greatest(coalesce(p_limit, 20), 1));
  END IF;

  RETURN monitoring.notify(
    'monitoring.staleness', 'firing',
    format('%s monitor(s) stopped reporting', v_total),
    v_body);
END;
$fn$;

ALTER FUNCTION monitoring.check_staleness(integer) OWNER TO postgres;

COMMENT ON FUNCTION monitoring.check_staleness(integer) IS
  'PS-411: evaluate monitoring.stale_alerts() and return the BOOLEAN result of monitoring.notify() for the single monitoring.staleness rollup. The default limit of 20 makes monitoring.check_staleness() callable by the shared heartbeat CronJob; true means posted and false means deduplicated or deferred.';

-- Only postgres and definer callers; per-role revokes defeat default privileges.
REVOKE ALL ON FUNCTION monitoring.check_staleness(integer) FROM PUBLIC;

DO $acl$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION monitoring.check_staleness(integer) FROM %I', r);
    END IF;
  END LOOP;
END;
$acl$;

-- The exact signature and BOOLEAN return are what the heartbeat job observes.
DO $verify$
DECLARE
  v_bad text;
BEGIN
  IF to_regprocedure('monitoring.check_staleness(integer)') IS NULL THEN
    RAISE EXCEPTION
      'PS-411 twin contract verify: monitoring.check_staleness(integer) does not exist';
  END IF;

  IF (SELECT prorettype
        FROM pg_proc
       WHERE oid = to_regprocedure('monitoring.check_staleness(integer)'))
      <> 'boolean'::regtype THEN
    RAISE EXCEPTION
      'PS-411 twin contract verify: monitoring.check_staleness(integer) does not return boolean';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_proc AS p
      JOIN pg_namespace AS n ON n.oid = p.pronamespace
     WHERE n.nspname = 'monitoring'
       AND p.proname = 'check_staleness'
       AND p.pronargs = 0) THEN
    RAISE EXCEPTION
      'PS-411 twin contract verify: a zero-argument check_staleness overload remains';
  END IF;

  IF (SELECT count(*)
        FROM pg_proc AS p
        JOIN pg_namespace AS n ON n.oid = p.pronamespace
       WHERE n.nspname = 'monitoring'
         AND p.proname = 'check_staleness'
         AND p.pronargs = 1
         AND p.pronargdefaults = 1) <> 1 THEN
    RAISE EXCEPTION
      'PS-411 twin contract verify: check_staleness does not have exactly one integer-default overload';
  END IF;

  SELECT string_agg(n.nspname || '.' || p.proname, ', ') INTO v_bad
    FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
   WHERE n.nspname = 'monitoring'
     AND p.proname = 'check_staleness'
     AND (NOT p.prosecdef
          OR pg_get_userbyid(p.proowner) <> 'postgres'
          OR NOT (p.proconfig::text[] @> ARRAY['search_path=public']));
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION
      'PS-411 twin contract verify: % lost SECURITY DEFINER / postgres owner / pinned search_path', v_bad;
  END IF;

  SELECT string_agg(r.rolname, ', ') INTO v_bad
    FROM (VALUES ('anon'), ('authenticated'), ('service_role')) AS r(rolname)
   WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r.rolname)
     AND has_function_privilege(r.rolname,
           'monitoring.check_staleness(integer)', 'EXECUTE');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION
      'PS-411 twin contract verify: client-reachable EXECUTE granted to %', v_bad;
  END IF;
END;
$verify$;

COMMIT;
