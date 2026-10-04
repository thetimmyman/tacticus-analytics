-- pg_net is stubbed. A timeout carries no status code, so a status-only classifier calls it success.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;
SET LOCAL timezone TO 'UTC';

SELECT plan(31);

SELECT is(
  current_database()::text,
  'postgres'::text,
  '1. this suite runs against the general database'
);

SELECT is(
  (SELECT count(*)::integer FROM supabase_migrations.schema_migrations
    WHERE version = '20260926010000'),
  1,
  '2. the pgnet outcome ledger migration is recorded as applied'
);

-- If the defaults stop covering every parameter, the cron reaper fails silently.
SELECT is(
  (SELECT (p.pronargdefaults = p.pronargs)
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'monitoring' AND p.proname = 'reap_pgnet_outcomes'),
  true,
  '3. monitoring.reap_pgnet_outcomes() is callable with zero arguments (the pg_cron command)'
);

-- call_edge_function()'s three-column INSERT must keep working (no new NOT NULL without default).
INSERT INTO monitoring.pgnet_request_ledger (request_id, function_name, url)
VALUES (422901, 'tp422-legacy-shape', 'https://tp422.invalid/legacy');

SELECT is(
  (SELECT outcome FROM monitoring.pgnet_request_ledger WHERE request_id = 422901),
  'pending'::text,
  '4. the three-column INSERT call_edge_function() already performs still works and defaults to pending'
);

SELECT throws_ok(
  $$UPDATE monitoring.pgnet_request_ledger SET outcome = 'probably fine' WHERE request_id = 422901$$,
  '23514',
  NULL,
  '5. the CHECK constraint refuses an outcome outside the four known states'
);

SELECT is(monitoring.classify_pgnet_outcome(200, false, NULL), 'succeeded'::text,
  '6. a 2xx with no timeout and no transport error is succeeded');

SELECT is(monitoring.classify_pgnet_outcome(404, false, NULL), 'failed'::text,
  '7. NEGATIVE CONTROL: a 404 is failed, not succeeded');

SELECT is(monitoring.classify_pgnet_outcome(500, false, NULL), 'failed'::text,
  '8. a 500 is failed');

SELECT is(monitoring.classify_pgnet_outcome(NULL, true, NULL), 'failed'::text,
  '9. a timeout is failed even though it carries no status code');

SELECT is(monitoring.classify_pgnet_outcome(NULL, false, 'connection refused'), 'failed'::text,
  '10. a transport error is failed even though it carries no status code');

CREATE TABLE public.tp422_posts (
  id bigserial PRIMARY KEY, url text NOT NULL, body jsonb);

DO $stub$
BEGIN
  IF to_regnamespace('net') IS NULL THEN
    CREATE SCHEMA net;
  END IF;

  IF to_regclass('net._http_response') IS NULL THEN
    CREATE TABLE net._http_response (
      id bigint PRIMARY KEY,
      status_code integer,
      content_type text,
      headers jsonb,
      content text,
      timed_out boolean,
      error_msg text,
      created timestamptz NOT NULL DEFAULT now()
    );
  END IF;
END
$stub$;

CREATE OR REPLACE FUNCTION net.http_post(
  url text,
  body jsonb DEFAULT '{}'::jsonb,
  headers jsonb DEFAULT '{}'::jsonb,
  timeout_milliseconds integer DEFAULT 5000)
RETURNS bigint LANGUAGE plpgsql AS $stub$
DECLARE
  v_id bigint;
BEGIN
  INSERT INTO public.tp422_posts (url, body)
  VALUES (http_post.url, http_post.body)
  RETURNING 422950 + id INTO v_id;
  RETURN v_id;
END
$stub$;

SELECT is(
  (SELECT monitoring.http_post_recorded(
            'tp422-wrapped-job',
            'https://tp422.invalid/wrapped',
            '{"tp422": true}'::jsonb) IS NOT NULL),
  true,
  '11. http_post_recorded() posts through pg_net and returns a request id'
);

SELECT is(
  (SELECT count(*)::integer FROM public.tp422_posts
    WHERE url = 'https://tp422.invalid/wrapped'),
  1,
  '12. the post actually reached net.http_post (the recording stub saw it), so 11 is not judging a no-op'
);

SELECT is(
  (SELECT outcome FROM monitoring.pgnet_request_ledger
    WHERE function_name = 'tp422-wrapped-job'),
  'pending'::text,
  '13. http_post_recorded() left an emit-time ledger row in the pending state'
);

-- 404 failed; 200 succeeded; timeout failed; no response 10 min pending, 3 h unknown.
DELETE FROM monitoring.pgnet_request_ledger WHERE request_id BETWEEN 422801 AND 422805;
DELETE FROM net._http_response WHERE id BETWEEN 422801 AND 422805;

INSERT INTO monitoring.pgnet_request_ledger (request_id, function_name, url, called_at)
VALUES
  (422801, 'tp422-gdpr-twin',    'https://tp422.invalid/gdpr',   now() - INTERVAL '10 minutes'),
  (422802, 'tp422-capped-twin',  'https://tp422.invalid/capped', now() - INTERVAL '10 minutes'),
  (422803, 'tp422-votlw-twin',   'https://tp422.invalid/votlw',  now() - INTERVAL '10 minutes'),
  (422804, 'tp422-in-flight',    'https://tp422.invalid/slow',   now() - INTERVAL '10 minutes'),
  (422805, 'tp422-pruned',       'https://tp422.invalid/gone',   now() - INTERVAL '3 hours');

INSERT INTO net._http_response (id, status_code, timed_out, error_msg, content, created)
VALUES
  (422801, 404,  false, NULL,              'Not Found', now() - INTERVAL '9 minutes'),
  (422802, 200,  false, NULL,              'ok',        now() - INTERVAL '9 minutes'),
  (422803, NULL, true,  'timeout reached', NULL,        now() - INTERVAL '9 minutes');

CREATE TEMP TABLE tp422_reap_1 AS
SELECT monitoring.reap_pgnet_outcomes() AS touched;

SELECT isnt(
  (SELECT touched FROM tp422_reap_1),
  -1,
  '14. the reaper did not fall into its own exception handler'
);

SELECT is(
  (SELECT touched FROM tp422_reap_1),
  4,
  '15. the reaper touched exactly four rows: three settled from the response table, one given up on'
);

SELECT is(
  (SELECT outcome FROM monitoring.pgnet_request_ledger WHERE request_id = 422801),
  'failed'::text,
  '16. NEGATIVE CONTROL: the request that came back 404 is recorded as failed'
);

SELECT is(
  (SELECT status_code FROM monitoring.pgnet_request_ledger WHERE request_id = 422801),
  404,
  '17. NEGATIVE CONTROL: the 404 itself is recorded, not just the verdict'
);

SELECT is(
  (SELECT outcome FROM monitoring.pgnet_request_ledger WHERE request_id = 422802),
  'succeeded'::text,
  '18. the request that came back 200 is recorded as succeeded'
);

SELECT is(
  (SELECT outcome || '/' || COALESCE(timed_out::text, 'null')
     FROM monitoring.pgnet_request_ledger WHERE request_id = 422803),
  'failed/true'::text,
  '19. the request that timed out is recorded as failed, with the timeout flag kept'
);

SELECT is(
  (SELECT outcome FROM monitoring.pgnet_request_ledger WHERE request_id = 422804),
  'pending'::text,
  '20. a request with no response yet, inside the give-up window, is left in flight and NOT marked succeeded'
);

SELECT is(
  (SELECT outcome FROM monitoring.pgnet_request_ledger WHERE request_id = 422805),
  'unknown'::text,
  '21. a request whose response never arrived before the give-up window is recorded as unknown, which is not success'
);

-- net._http_response is UNLOGGED and pruned within hours; the verdict must survive.
DELETE FROM net._http_response;

SELECT is(
  (SELECT outcome || ' ' || status_code::text
     FROM monitoring.pgnet_request_ledger WHERE request_id = 422801),
  'failed 404'::text,
  '22. the failed outcome survives the deletion of every row of net._http_response'
);

SELECT is(
  monitoring.reap_pgnet_outcomes(),
  0,
  '23. a second reap settles nothing: a recorded outcome is never re-judged, and the in-flight row is still not touched'
);

-- call_edge_function()'s ON CONFLICT does not touch outcome, so the re-emit trigger resets it.
UPDATE monitoring.pgnet_request_ledger
   SET function_name = 'tp422-reemit', called_at = now()
 WHERE request_id = 422801;

SELECT is(
  (SELECT outcome || '|' || coalesce(status_code::text, 'null') || '|' || coalesce(settled_at::text, 'null')
     FROM monitoring.pgnet_request_ledger WHERE request_id = 422801),
  'pending|null|null'::text,
  '24. a re-emitted request id (called_at moved) resets the settled outcome so the reaper judges the new response'
);

ALTER TABLE net._http_response RENAME COLUMN status_code TO status_code_tp422_broken;
SELECT throws_ok(
  'SELECT monitoring.reap_pgnet_outcomes()',
  '42703',
  NULL,
  '25. a reaper failure is re-raised, so pg_cron records the run as failed instead of a silent success'
);
ALTER TABLE net._http_response RENAME COLUMN status_code_tp422_broken TO status_code;

-- A reused request id may leave its earlier response row in pg_net. After the
-- ledger emit timestamp moves, only a response created at or after that emit
-- can settle the new pending attempt.
INSERT INTO monitoring.pgnet_request_ledger (request_id, function_name, url, called_at)
VALUES
  (880101, 'outcome-correlation-old-success', 'https://example.invalid/old-success', now() - INTERVAL '1 minute'),
  (880102, 'outcome-correlation-old-failure', 'https://example.invalid/old-failure', now() - INTERVAL '1 minute'),
  (880103, 'outcome-correlation-fresh-failure', 'https://example.invalid/fresh-failure', now() - INTERVAL '2 minutes'),
  (880104, 'outcome-correlation-equal-timestamp', 'https://example.invalid/equal-timestamp', now()),
  (880105, 'outcome-correlation-aged-old-response', 'https://example.invalid/aged-old-response', now() - INTERVAL '3 hours');

INSERT INTO net._http_response (id, status_code, timed_out, error_msg, content, created)
VALUES
  (880101, 200, false, NULL, 'old success', now() - INTERVAL '30 seconds'),
  (880102, 404, false, NULL, 'old failure', now() - INTERVAL '30 seconds'),
  (880103, 404, false, NULL, 'fresh failure', now() - INTERVAL '1 minute'),
  (880104, 404, false, NULL, 'equal timestamp', now()),
  (880105, 500, false, NULL, 'older than the re-emission', now() - INTERVAL '4 hours');

UPDATE monitoring.pgnet_request_ledger
   SET called_at = now()
 WHERE request_id IN (880101, 880102);

SELECT is(
  monitoring.reap_pgnet_outcomes(),
  3,
  'only the fresh failure, equal-timestamp response, and aged give-up are touched'
);

SELECT is(
  (SELECT outcome || '|' || coalesce(status_code::text, 'null') || '|' || coalesce(error_msg, 'null') || '|' || coalesce(timed_out::text, 'null') || '|' || coalesce(settled_at::text, 'null')
     FROM monitoring.pgnet_request_ledger WHERE request_id = 880101),
  'pending|null|null|null|null'::text,
  'a retained old 200 response cannot settle a reused request id'
);

SELECT is(
  (SELECT outcome || '|' || coalesce(status_code::text, 'null') || '|' || coalesce(error_msg, 'null') || '|' || coalesce(timed_out::text, 'null') || '|' || coalesce(settled_at::text, 'null')
     FROM monitoring.pgnet_request_ledger WHERE request_id = 880102),
  'pending|null|null|null|null'::text,
  'a retained old 404 response cannot fail a reused request id'
);

SELECT is(
  (SELECT outcome || '|' || status_code::text
     FROM monitoring.pgnet_request_ledger WHERE request_id = 880103),
  'failed|404'::text,
  'a fresh 404 response settles the current emission as failed'
);

SELECT is(
  (SELECT outcome || '|' || status_code::text
     FROM monitoring.pgnet_request_ledger WHERE request_id = 880104),
  'failed|404'::text,
  'a response with created exactly equal to called_at is eligible'
);

SELECT is(
  (SELECT outcome || '|' || coalesce(status_code::text, 'null') || '|' || coalesce(error_msg, 'null') || '|' || coalesce(timed_out::text, 'null')
     FROM monitoring.pgnet_request_ledger WHERE request_id = 880105),
  'unknown|null|null|null'::text,
  'an aged emission with only a pre-emission response gives up without borrowing its status'
);

SELECT * FROM finish();
ROLLBACK;
