-- net.http_post is replaced by a recording stub; not quiet mode, which never reminds.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;
SET LOCAL timezone TO 'UTC';

SELECT plan(21);

SELECT is(
  current_database()::text,
  'postgres'::text,
  '1. this suite runs against the postgres database'
);

SELECT is(
  (SELECT count(*)::integer FROM supabase_migrations.schema_migrations
    WHERE version = '20260919011000'),
  1,
  '2. the alert staleness and re-notify migration is recorded as applied'
);

SELECT is(
  (SELECT pg_get_function_result(p.oid)
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'monitoring'
      AND p.oid = to_regprocedure('monitoring.check_staleness(integer)')),
  'boolean',
  '3. monitoring.check_staleness(integer) returns the CronJob BOOLEAN contract'
);

SELECT is(
  (SELECT count(*)::integer
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'monitoring'
      AND p.proname = 'check_staleness'),
  1,
  '4. no zero-argument check_staleness overload remains; the integer default serves the call'
);

SELECT is(
  (SELECT pg_get_function_result(p.oid)
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'monitoring' AND p.proname = 'stale_alerts'),
  'TABLE(alert_key text, status text, last_seen_at timestamp with time zone, expected_interval interval, overdue_by interval)',
  '5. monitoring.stale_alerts() returns the five declared columns, in order'
);

SELECT is(
  (SELECT expected_interval FROM monitoring.alert_expectation WHERE key_pattern = '%'),
  INTERVAL '7 days',
  '6. the conservative catch-all expectation is seeded'
);

CREATE TABLE public.tp411_posts (
  id      serial PRIMARY KEY,
  payload jsonb NOT NULL,
  at      timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- notify() decides what to post, so failing the sink is the only way to fail a delivery.
CREATE TABLE public.tp411_http_fail (fail boolean NOT NULL);
INSERT INTO public.tp411_http_fail VALUES (false);

-- pg_net's function clashes with the stub's named arguments; ROLLBACK restores it.
DROP EXTENSION IF EXISTS pg_net;

DO $stub$
BEGIN
  IF to_regnamespace('net') IS NULL THEN
    CREATE SCHEMA net;
  END IF;
END
$stub$;

CREATE OR REPLACE FUNCTION net.http_post(
  url text, headers jsonb DEFAULT '{}'::jsonb, body jsonb DEFAULT '{}'::jsonb)
RETURNS bigint LANGUAGE plpgsql AS $stub$
BEGIN
  IF (SELECT fail FROM public.tp411_http_fail) THEN
    RAISE EXCEPTION 'tp411 stub: simulated delivery failure';
  END IF;
  INSERT INTO public.tp411_posts (payload) VALUES (body);
  RETURN 1;
END
$stub$;

INSERT INTO internal.cron_secrets (name, value)
VALUES ('monitoring_webhook_url', 'https://tp411.invalid/webhook')
ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value;

DELETE FROM monitoring.alert_state
 WHERE alert_key LIKE 'tp411.%'
    OR alert_key = 'monitoring.staleness';
INSERT INTO monitoring.alert_state
  (alert_key, status, since, last_seen_at, last_title, last_body)
VALUES
  ('tp411.stopped.monitor', 'cleared', now() - INTERVAL '30 days',
   now() - INTERVAL '17 days', 'stopped monitor', 'last words'),
  ('tp411.healthy.monitor', 'cleared', now() - INTERVAL '30 days',
   now() - INTERVAL '4 minutes', 'healthy monitor', 'all good');

SELECT is(
  (SELECT count(*)::integer FROM monitoring.stale_alerts()
    WHERE alert_key = 'tp411.stopped.monitor'),
  1,
  '7. a key last written 17 days ago is stale under the 7-day catch-all'
);

SELECT is(
  (SELECT count(*)::integer FROM monitoring.stale_alerts()
    WHERE alert_key = 'tp411.healthy.monitor'),
  0,
  '8. a key written four minutes ago is not stale'
);

SELECT is(
  (SELECT monitoring.check_staleness()),
  true,
  '9. check_staleness() returns notify''s true/false verdict (this posting returns true)'
);

SELECT is(
  (SELECT status FROM monitoring.alert_state WHERE alert_key = 'monitoring.staleness'),
  'firing',
  '10. the rollup key fires'
);

SELECT ok(
  (SELECT last_body FROM monitoring.alert_state WHERE alert_key = 'monitoring.staleness')
    LIKE '%tp411.stopped.monitor%',
  '11. the rollup body NAMES the monitor that stopped'
);

SELECT ok(
  (SELECT last_body FROM monitoring.alert_state WHERE alert_key = 'monitoring.staleness')
    NOT LIKE '%tp411.healthy.monitor%',
  '12. the rollup body does not name the monitor that is still reporting'
);

SELECT ok(
  (SELECT last_seen_at FROM monitoring.alert_state WHERE alert_key = 'monitoring.staleness')
    > now() - INTERVAL '1 minute',
  '13. the sweep refreshed its own last_seen_at'
);

-- One notify() per statement: AND operands evaluate in any order, so a folded ok() could read
-- state before the call.
DELETE FROM public.tp411_posts;

CREATE TABLE public.tp411_ret (label text PRIMARY KEY, ret boolean);

INSERT INTO monitoring.alert_state
  (alert_key, status, since, last_seen_at, last_title, last_body,
   last_notified_at, renotify_count)
VALUES
  ('tp411.firing.old', 'firing', now() - INTERVAL '3 days',
   now() - INTERVAL '5 minutes', 'still broken', 'body',
   now() - INTERVAL '90 minutes', 0),
  ('tp411.firing.fresh', 'firing', now() - INTERVAL '3 days',
   now() - INTERVAL '5 minutes', 'still broken', 'body',
   now() - INTERVAL '10 minutes', 0),
  ('tp411.cleared.old', 'cleared', now() - INTERVAL '3 days',
   now() - INTERVAL '5 minutes', 'fine', 'body',
   now() - INTERVAL '3 days', 0);

INSERT INTO public.tp411_ret
SELECT 'reminder-1', monitoring.notify('tp411.firing.old', 'firing', 'still broken', 'body');

SELECT is(
  (SELECT ret FROM public.tp411_ret WHERE label = 'reminder-1'),
  true,
  '14. an unchanged firing alert last posted 90 minutes ago re-notifies (first reminder is due at 1h)'
);

SELECT is(
  (SELECT count(*)::integer FROM public.tp411_posts
    WHERE payload::text LIKE '%STILL FIRING (reminder 1)%'),
  1,
  '15. exactly one reminder was delivered, and it is marked as a reminder'
);

INSERT INTO public.tp411_ret
SELECT 'reminder-2', monitoring.notify('tp411.firing.old', 'firing', 'still broken', 'body');

SELECT is(
  (SELECT ret FROM public.tp411_ret WHERE label = 'reminder-2'),
  false,
  '16. a second immediate call does not re-notify (renotify_count 1 -> next due at 6h)'
);

SELECT is(
  (SELECT renotify_count FROM monitoring.alert_state WHERE alert_key = 'tp411.firing.old'),
  1,
  '17. one reminder was counted, not two'
);

INSERT INTO public.tp411_ret
SELECT 'not-due', monitoring.notify('tp411.firing.fresh', 'firing', 'still broken', 'body');

SELECT ok(
  (SELECT ret FROM public.tp411_ret WHERE label = 'not-due') = false
  AND (SELECT last_seen_at FROM monitoring.alert_state WHERE alert_key = 'tp411.firing.fresh')
      >= now()
  AND (SELECT renotify_count FROM monitoring.alert_state WHERE alert_key = 'tp411.firing.fresh') = 0,
  '18. unchanged-and-not-due returns false, refreshes liveness and reminds nothing'
);

INSERT INTO public.tp411_ret
SELECT 'cleared', monitoring.notify('tp411.cleared.old', 'cleared', 'fine', 'body');
INSERT INTO public.tp411_ret
SELECT 'quiet', monitoring.notify('tp411.firing.old', 'firing', 'still broken', 'body', true);

SELECT ok(
  (SELECT ret FROM public.tp411_ret WHERE label = 'cleared') = false
  AND (SELECT renotify_count FROM monitoring.alert_state WHERE alert_key = 'tp411.cleared.old') = 0
  AND (SELECT ret FROM public.tp411_ret WHERE label = 'quiet') = false
  AND (SELECT renotify_count FROM monitoring.alert_state WHERE alert_key = 'tp411.firing.old') = 1,
  '19. cleared never reminds, and quiet mode never reminds'
);

UPDATE monitoring.alert_state
   SET last_notified_at = now() - INTERVAL '2 days', renotify_count = 2
 WHERE alert_key = 'tp411.firing.old';

UPDATE public.tp411_http_fail SET fail = true;

INSERT INTO public.tp411_ret
SELECT 'undeliverable', monitoring.notify('tp411.firing.old', 'firing', 'still broken', 'body');

CREATE TABLE public.tp411_after_fail AS
SELECT last_notified_at, renotify_count
  FROM monitoring.alert_state WHERE alert_key = 'tp411.firing.old';

UPDATE public.tp411_http_fail SET fail = false;

INSERT INTO public.tp411_ret
SELECT 'retry', monitoring.notify('tp411.firing.old', 'firing', 'still broken', 'body');

SELECT ok(
  (SELECT ret FROM public.tp411_ret WHERE label = 'undeliverable') = false
  AND (SELECT last_notified_at FROM public.tp411_after_fail) < now() - INTERVAL '1 day'
  AND (SELECT renotify_count FROM public.tp411_after_fail) = 2
  AND (SELECT ret FROM public.tp411_ret WHERE label = 'retry') = true
  AND (SELECT renotify_count FROM monitoring.alert_state WHERE alert_key = 'tp411.firing.old') = 3,
  '20. a failed reminder leaves last_notified_at and the count untouched, and the next call delivers it'
);

INSERT INTO public.tp411_ret
SELECT 'transition', monitoring.notify('tp411.firing.old', 'cleared', 'fixed', 'body');

SELECT ok(
  (SELECT ret FROM public.tp411_ret WHERE label = 'transition') = true
  AND (SELECT renotify_count FROM monitoring.alert_state WHERE alert_key = 'tp411.firing.old') = 0
  AND (SELECT last_notified_at FROM monitoring.alert_state WHERE alert_key = 'tp411.firing.old')
      >= now(),
  '21. a transition resets the reminder counter and restamps the clock'
);

SELECT * FROM finish();
ROLLBACK;
