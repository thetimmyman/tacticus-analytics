-- Claims are exclusive across dblink sessions, which cannot see this transaction, so their fixture
-- is committed and removed by them. notify runs quiet: no webhook on replay.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;
SET LOCAL timezone TO 'UTC';

SELECT plan(32);

SELECT is(
  current_database()::text,
  'postgres'::text,
  '1. this suite runs against the general database'
);

SELECT is(
  (SELECT count(*)::integer FROM supabase_migrations.schema_migrations
    WHERE version = '20260919121000'),
  1,
  '2. the sync queue drain lanes migration is recorded as applied'
);

-- pg_cron calls it with no arguments; missing defaults fail silently.
SELECT is(
  (SELECT (p.pronargdefaults = p.pronargs)
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'check_sync_queue_drain_health'),
  true,
  '3. check_sync_queue_drain_health() is callable with zero arguments (the pg_cron command)'
);

SELECT is(
  (SELECT pg_get_functiondef(p.oid) ~* 'FOR\s+UPDATE\s+SKIP\s+LOCKED'
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'claim_next_job'),
  true,
  '4. claim_next_job still claims FOR UPDATE SKIP LOCKED -- the premise parallel lanes rest on'
);

-- unique_active_job is per guild and job_type; distinct priority makes claim order deterministic.
CREATE TEMP TABLE tp80_claims(k text PRIMARY KEY, v text);

DO $sessions$
DECLARE
  v_fixture text := $fx$
    INSERT INTO public.guild_config (guild_code, display_name, cluster_code)
    VALUES ('TP80DRAIN', 'Test drain fixture', NULL)
    ON CONFLICT (guild_code) DO NOTHING;
    INSERT INTO public.sync_queue (guild_code, job_type, status, priority, scheduled_for, attempts, max_attempts)
    VALUES ('TP80DRAIN', 'incremental_sync', 'pending', 1, now() - INTERVAL '1 minute', 0, 3),
           ('TP80DRAIN', 'player_sync',      'pending', 2, now() - INTERVAL '1 minute', 0, 3);
  $fx$;
BEGIN
  PERFORM dblink_connect('tp80_a', 'dbname=' || current_database());
  PERFORM dblink_connect('tp80_b', 'dbname=' || current_database());

  PERFORM dblink_exec('tp80_a', v_fixture);

  -- A's claimed row stays locked while its transaction is open.
  PERFORM dblink_exec('tp80_a', 'BEGIN');
  INSERT INTO tp80_claims
  SELECT 'a', t.x FROM dblink('tp80_a',
    'SELECT (public.claim_next_job(''tp80-l0'')).id::text') AS t(x text);

  -- SKIP LOCKED is the only reason B gets the other row instead of blocking.
  PERFORM dblink_exec('tp80_b', 'BEGIN');
  INSERT INTO tp80_claims
  SELECT 'b', t.x FROM dblink('tp80_b',
    'SELECT (public.claim_next_job(''tp80-l1'')).id::text') AS t(x text);

  -- Negative control: both rows are locked, so a third claim comes back empty.
  INSERT INTO tp80_claims
  SELECT 'c', t.x FROM dblink('tp80_b',
    'SELECT (public.claim_next_job(''tp80-l2'')).id::text') AS t(x text);

  PERFORM dblink_exec('tp80_a', 'ROLLBACK');
  PERFORM dblink_exec('tp80_b', 'ROLLBACK');

  PERFORM dblink_exec('tp80_a',
    $td$DELETE FROM public.sync_queue WHERE guild_code = 'TP80DRAIN';
       DELETE FROM public.guild_config WHERE guild_code = 'TP80DRAIN';$td$);

  INSERT INTO tp80_claims
  SELECT 'left', t.x FROM dblink('tp80_a',
    'SELECT count(*)::text FROM public.sync_queue WHERE guild_code = ''TP80DRAIN''') AS t(x text);

  PERFORM dblink_disconnect('tp80_a');
  PERFORM dblink_disconnect('tp80_b');
END;
$sessions$;

SELECT is(
  (SELECT count(*)::integer FROM tp80_claims),
  4,
  '5. positive control: the three-session exchange ran and recorded every observation'
);

SELECT isnt(
  (SELECT v FROM tp80_claims WHERE k = 'a'),
  NULL,
  '6. session A claimed a job'
);

SELECT isnt(
  (SELECT v FROM tp80_claims WHERE k = 'b'),
  (SELECT v FROM tp80_claims WHERE k = 'a'),
  '7. a CONCURRENT claim in another session never returns the row session A holds'
);

SELECT is(
  (SELECT v FROM tp80_claims WHERE k = 'c'),
  NULL,
  '8. negative control: with every eligible row locked, a further concurrent claim returns nothing rather than re-handing a locked row'
);

SELECT is(
  (SELECT v FROM tp80_claims WHERE k = 'left'),
  '0',
  '9. the cross-session fixture was cleaned up and left nothing behind'
);

-- The queue is empty here, so the age leg stays quiet until the aged fixture.
SELECT is(
  (SELECT verdict FROM public.sync_queue_drain_health()),
  'no_runs'::text,
  '10. with no recorded run, the verdict is "no_runs" -- cannot tell, which is not "ok"'
);

INSERT INTO public.sync_drain_runs
  (ran_at, worker_id, lanes, budget_ms, window_ms, duration_ms, jobs_drained,
   queue_depth_start, saturated)
SELECT now() - (g || ' minutes')::interval, 'tp80-w' || g, 2, 45000, 40000,
       40100, 12, 3, true
  FROM generate_series(1, 3) AS g;

-- A live backlog still sitting in the queue, so "saturated" reflects the queue NOW,
-- not only its history.
INSERT INTO public.guild_config (guild_code, display_name, cluster_code)
VALUES ('TP80SATLIVE', 'Test live-backlog fixture', NULL)
ON CONFLICT (guild_code) DO NOTHING;
INSERT INTO public.sync_queue
  (guild_code, job_type, status, priority, scheduled_for, created_at, attempts, max_attempts)
VALUES ('TP80SATLIVE', 'incremental_sync', 'pending', 5, now(), now(), 0, 3);

SELECT is(
  (SELECT verdict FROM public.sync_queue_drain_health()),
  'saturated'::text,
  '11. three consecutive runs that used their whole window, with a live backlog, read as "saturated"'
);

SELECT is(
  public.check_sync_queue_drain_health(3, 20, 10, true),
  1,
  '12. the firing leg: the monitor reports one firing condition'
);

SELECT is(
  (SELECT status FROM monitoring.alert_state WHERE alert_key = 'sync.queue.drain'),
  'firing'::text,
  '13. the firing transition was recorded on the sync.queue.drain alert key'
);

-- The same three saturated runs, but the burst that produced them has now drained:
-- an alert kept firing on that stale run history alone would flap on every burst,
-- so this must clear, not fire.
DELETE FROM public.sync_queue WHERE guild_code = 'TP80SATLIVE';
DELETE FROM public.guild_config WHERE guild_code = 'TP80SATLIVE';

SELECT is(
  (SELECT verdict FROM public.sync_queue_drain_health()),
  'drained'::text,
  '13a. once the live queue empties, three saturated runs read as "drained", not "saturated"'
);

SELECT is(
  public.check_sync_queue_drain_health(3, 20, 10, true),
  0,
  '13b. the monitor reports no firing condition once the queue the saturated runs described has drained'
);

SELECT is(
  (SELECT status FROM monitoring.alert_state WHERE alert_key = 'sync.queue.drain'),
  'cleared'::text,
  '13c. the alert clears instead of continuing to flap on stale saturated-run history'
);

-- Runs older than the age bound no longer describe the drain, so the alert above must clear.
DELETE FROM public.sync_drain_runs;
INSERT INTO public.sync_drain_runs
  (ran_at, worker_id, lanes, budget_ms, window_ms, duration_ms, jobs_drained,
   queue_depth_start, saturated)
SELECT now() - (30 + g || ' minutes')::interval, 'tp80-old' || g, 2, 45000, 40000,
       40100, 12, 41, true
  FROM generate_series(1, 3) AS g;

SELECT is(
  (SELECT verdict FROM public.sync_queue_drain_health()),
  'runs_stale'::text,
  '14. saturated, over-ceiling runs older than the age bound read as "runs_stale", not "saturated"'
);

SELECT is(
  public.check_sync_queue_drain_health(3, 20, 10, true),
  0,
  '15. runs that have aged out report no firing condition'
);

SELECT is(
  (SELECT status FROM monitoring.alert_state WHERE alert_key = 'sync.queue.drain'),
  'cleared'::text,
  '16. an alert raised from runs that have since aged out is cleared'
);

SELECT ok(
  (SELECT last_body FROM monitoring.alert_state WHERE alert_key = 'sync.queue.drain')
    ~ 'No drain run recorded in the last 10 min',
  '17. the cleared body says why: no run inside the age bound'
);

-- The queue is filled in bursts; a young burst over the ceiling is not a stall.
INSERT INTO public.guild_config (guild_code, display_name, cluster_code)
SELECT 'TP80BURST' || g, 'Drain burst fixture', NULL
  FROM generate_series(1, 25) AS g
ON CONFLICT (guild_code) DO NOTHING;
INSERT INTO public.sync_queue
  (guild_code, job_type, status, priority, scheduled_for, created_at, attempts, max_attempts)
SELECT 'TP80BURST' || g, 'incremental_sync', 'pending', 5, now(), now(), 0, 3
  FROM generate_series(1, 25) AS g;

SELECT ok(
  (SELECT pending_depth FROM public.sync_queue_drain_health(3, 20, 10)) > 20,
  '18. positive control: the young burst is deeper than the ceiling'
);

SELECT is(
  (SELECT verdict FROM public.sync_queue_drain_health(3, 20, 10)),
  'runs_stale'::text,
  '19. a young burst over the ceiling does not turn aged-out runs into a firing verdict'
);

DELETE FROM public.sync_queue WHERE guild_code LIKE 'TP80BURST%';
DELETE FROM public.guild_config WHERE guild_code LIKE 'TP80BURST%';

UPDATE public.sync_drain_runs SET ran_at = now() - INTERVAL '1 minute'
 WHERE worker_id = 'tp80-old1';

SELECT is(
  (SELECT verdict FROM public.sync_queue_drain_health()),
  'ok'::text,
  '20. one recent saturated run plus two aged ones is not three consecutive saturated runs'
);

DELETE FROM public.sync_drain_runs;
INSERT INTO public.sync_drain_runs
  (ran_at, worker_id, lanes, budget_ms, window_ms, duration_ms, jobs_drained,
   queue_depth_start, saturated)
VALUES
  (now() - INTERVAL '1 minute', 'tp80-n1', 2, 45000, 40000, 40100, 12, 3, true),
  (now() - INTERVAL '2 minutes', 'tp80-n2', 2, 45000, 40000, 40100, 12, 3, true),
  (now() - INTERVAL '3 minutes', 'tp80-n3', 2, 45000, 40000,  9000,  4, 3, false);

SELECT is(
  (SELECT verdict FROM public.sync_queue_drain_health()),
  'ok'::text,
  '21. negative control: two saturated runs out of the three the threshold requires is NOT firing'
);

SELECT is(
  public.check_sync_queue_drain_health(3, 20, 10, true),
  0,
  '22. the clearing leg: the monitor reports no firing condition once the drain keeps up'
);

SELECT is(
  (SELECT status FROM monitoring.alert_state WHERE alert_key = 'sync.queue.drain'),
  'cleared'::text,
  '23. the cleared transition was recorded -- a monitor that cannot clear is a pager nobody can answer'
);

DELETE FROM public.sync_drain_runs;
INSERT INTO public.sync_drain_runs
  (ran_at, worker_id, lanes, budget_ms, window_ms, duration_ms, jobs_drained,
   queue_depth_start, saturated)
SELECT now() - (g || ' minutes')::interval, 'tp80-b' || g, 2, 45000, 40000,
       9000, 4, 41, false
  FROM generate_series(1, 3) AS g;

INSERT INTO public.guild_config (guild_code, display_name, cluster_code)
VALUES ('TP80BACKLIVE', 'Test live-backlog fixture', NULL)
ON CONFLICT (guild_code) DO NOTHING;
INSERT INTO public.sync_queue
  (guild_code, job_type, status, priority, scheduled_for, created_at, attempts, max_attempts)
VALUES ('TP80BACKLIVE', 'incremental_sync', 'pending', 5, now(), now(), 0, 3);

SELECT is(
  (SELECT verdict FROM public.sync_queue_drain_health(3, 20, 10)),
  'backlog'::text,
  '24. three consecutive runs handed more than twice the ceiling, with a live backlog, read as "backlog"'
);

DELETE FROM public.sync_queue WHERE guild_code = 'TP80BACKLIVE';
DELETE FROM public.guild_config WHERE guild_code = 'TP80BACKLIVE';

SELECT is(
  (SELECT verdict FROM public.sync_queue_drain_health(3, 20, 10)),
  'drained'::text,
  '24a. the same over-ceiling run history reads as "drained", not "backlog", once the live queue empties'
);

UPDATE public.sync_drain_runs SET queue_depth_start = NULL;

SELECT is(
  (SELECT verdict FROM public.sync_queue_drain_health(3, 20, 10)),
  'ok'::text,
  '25. negative control: a run whose queue depth was never measured (NULL) does not count toward the backlog leg'
);

-- The age leg reads sync_queue directly, so it fires even when drain runs stop.
DELETE FROM public.sync_drain_runs;
INSERT INTO public.sync_drain_runs
  (ran_at, worker_id, lanes, budget_ms, window_ms, duration_ms, jobs_drained,
   queue_depth_start, saturated)
SELECT now() - (g || ' minutes')::interval, 'tp80-h' || g, 2, 45000, 40000,
       9000, 4, 1, false
  FROM generate_series(1, 3) AS g;

INSERT INTO public.guild_config (guild_code, display_name, cluster_code)
VALUES ('TP80AGED', 'Test aged fixture', NULL)
ON CONFLICT (guild_code) DO NOTHING;
INSERT INTO public.sync_queue
  (guild_code, job_type, status, priority, scheduled_for, created_at, attempts, max_attempts)
VALUES ('TP80AGED', 'incremental_sync', 'pending', 5,
        now() - INTERVAL '30 minutes', now() - INTERVAL '30 minutes', 0, 3);

SELECT is(
  (SELECT verdict FROM public.sync_queue_drain_health(3, 20, 10)),
  'stalled'::text,
  '26. a pending job older than the age bound reads as "stalled" even while every recorded run looks healthy'
);

SELECT is(
  public.check_sync_queue_drain_health(3, 20, 10, true),
  1,
  '27. the age leg fires the same alert key, so a drain that stopped reporting is still paged'
);

UPDATE public.sync_drain_runs SET ran_at = ran_at - INTERVAL '1 hour';

SELECT is(
  (SELECT verdict FROM public.sync_queue_drain_health(3, 20, 10)),
  'stalled'::text,
  '28. the age leg still fires when every recorded run has aged out'
);

SELECT * FROM finish();
ROLLBACK;
