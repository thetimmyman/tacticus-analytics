BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;
SET LOCAL timezone TO 'UTC';

SELECT plan(42);

-- The verdict is global, so requests already open in this database are closed first;
-- the surrounding transaction rolls that back.
UPDATE public.gdpr_data_exports SET status = 'completed' WHERE status IN ('pending', 'processing', 'failed');
UPDATE public.gdpr_deletion_requests SET status = 'completed' WHERE status IN ('pending', 'scheduled');

INSERT INTO auth.users (id, email, aud, role) VALUES
  ('00000000-0000-4000-8000-0000000000a1', 'gdpr-a@example.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000a2', 'gdpr-b@example.invalid', 'authenticated', 'authenticated');

SELECT is((SELECT verdict FROM public.gdpr_request_health()), 'ok'::text,
  '1. an empty fixture has an ok verdict');
SELECT is((SELECT failed_exports + stuck_exports + overdue_deletions FROM public.gdpr_request_health()), 0,
  '2. an empty fixture has zero counts');
SELECT is(public.check_gdpr_request_health(true), 0,
  '3. an empty fixture records a cleared result');
SELECT is((SELECT status FROM monitoring.alert_state WHERE alert_key = 'gdpr.requests'), 'cleared'::text,
  '4. the empty check records the cleared alert state');

INSERT INTO public.gdpr_data_exports(request_id, user_id, requested_at, status) VALUES
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000a1', now() - interval '2 days', 'failed'),
  ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000ff', now() - interval '2 days', 'failed'),
  ('00000000-0000-4000-8000-0000000000b3', '00000000-0000-4000-8000-0000000000a1', now() - interval '2 hours', 'processing'),
  ('00000000-0000-4000-8000-0000000000b4', '00000000-0000-4000-8000-0000000000a1', now() - interval '5 minutes', 'processing'),
  ('00000000-0000-4000-8000-0000000000b5', '00000000-0000-4000-8000-0000000000a1', now() - interval '2 days', 'completed');
INSERT INTO public.gdpr_deletion_requests(request_id, user_id, request_type, requested_at, scheduled_for, status) VALUES
  ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000a2', 'complete', now() - interval '3 days', now() - interval '2 days', 'scheduled'),
  ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000a2', 'complete', now(), now() + interval '2 days', 'scheduled'),
  ('00000000-0000-4000-8000-0000000000c3', '00000000-0000-4000-8000-0000000000a2', 'complete', now() - interval '3 days', now() - interval '2 days', 'completed'),
  ('00000000-0000-4000-8000-0000000000c4', '00000000-0000-4000-8000-0000000000a2', 'complete', now() - interval '3 days', now() - interval '2 days', 'cancelled');

SELECT is((SELECT verdict FROM public.gdpr_request_health()), 'unfulfilled'::text,
  '5. open requests produce an unfulfilled verdict');
SELECT is((SELECT failed_exports FROM public.gdpr_request_health()), 1,
  '6. a failed export for a live account is counted');
SELECT ok((SELECT '00000000-0000-4000-8000-0000000000b1'::uuid = ANY(sample_export_request_ids)
              AND '00000000-0000-4000-8000-0000000000c1'::uuid = ANY(sample_deletion_request_ids)
              AND NOT '00000000-0000-4000-8000-0000000000b2'::uuid = ANY(sample_export_request_ids)
            FROM public.gdpr_request_health()),
  '7. failed export and overdue deletion ids are sampled; an erased account''s export is not');
SELECT is((SELECT stuck_exports FROM public.gdpr_request_health()), 1,
  '8. the old processing export counts while fresh and completed exports do not');
SELECT is((SELECT overdue_deletions FROM public.gdpr_request_health()), 1,
  '9. only the overdue scheduled deletion is counted');
SELECT is(public.check_gdpr_request_health(true), 1,
  '10. the monitor reports a firing result');
SELECT is((SELECT status FROM monitoring.alert_state WHERE alert_key = 'gdpr.requests'), 'firing'::text,
  '11. the monitor records firing state');
SELECT ok((SELECT position('Failed exports: 1; stuck exports: 1; overdue deletions: 1.' in last_body) > 0
                 AND position('00000000-0000-4000-8000-0000000000b1' in last_body) = 0
                 AND position('00000000-0000-4000-8000-0000000000a1' in last_body) = 0
            FROM monitoring.alert_state WHERE alert_key = 'gdpr.requests'),
  '12. alert body carries the counts but no request or account id');
SELECT ok((SELECT last_title LIKE 'GDPR requests unfulfilled%' FROM monitoring.alert_state WHERE alert_key = 'gdpr.requests'),
  '12a. the firing title says the requests are unfulfilled');
SELECT ok((SELECT oldest_open_request_at < now() - interval '1 day' FROM public.gdpr_request_health()),
  '13. oldest open request time reflects the oldest counted request');

UPDATE public.gdpr_data_exports SET status = 'completed'
 WHERE request_id IN ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000b3');
UPDATE public.gdpr_deletion_requests SET status = 'completed'
 WHERE request_id = '00000000-0000-4000-8000-0000000000c1';
SELECT is((SELECT verdict FROM public.gdpr_request_health()), 'ok'::text,
  '14. resolving the offending rows returns the monitor to ok');
SELECT is(public.check_gdpr_request_health(true), 0,
  '15. the next monitor check clears the alert');
SELECT is((SELECT status FROM monitoring.alert_state WHERE alert_key = 'gdpr.requests'), 'cleared'::text,
  '16. resolved requests leave a cleared alert state');

SELECT ok(NOT has_function_privilege('anon', 'public.gdpr_request_health(integer,integer)', 'EXECUTE'),
  '17. anon cannot execute the health function');
SELECT ok(NOT has_function_privilege('authenticated', 'public.gdpr_request_health(integer,integer)', 'EXECUTE'),
  '18. authenticated cannot execute the health function');
SELECT ok(NOT has_function_privilege('anon', 'public.check_gdpr_request_health(boolean)', 'EXECUTE'),
  '19. anon cannot execute the check function');
SELECT ok(NOT has_function_privilege('authenticated', 'public.check_gdpr_request_health(boolean)', 'EXECUTE'),
  '20. authenticated cannot execute the check function');
SELECT ok(has_function_privilege('service_role', 'public.gdpr_request_health(integer,integer)', 'EXECUTE'),
  '21. service_role can execute the health function');
SELECT ok(has_function_privilege('service_role', 'public.check_gdpr_request_health(boolean)', 'EXECUTE'),
  '22. service_role can execute the check function');
SELECT is((SELECT pronargdefaults = pronargs FROM pg_proc WHERE oid = 'public.check_gdpr_request_health(boolean)'::regprocedure), true,
  '23. the scheduled check is callable with no arguments');
SELECT is((SELECT monitoring.alert_channel('gdpr.requests')), 'ta'::text,
  '24. GDPR alerts route to the TA channel');

-- Pin the default deletion grace window (24h) so a change to it fails this test rather
-- than silently shifting Article 12(3) enforcement.
INSERT INTO public.gdpr_deletion_requests(request_id, user_id, request_type, requested_at, scheduled_for, status) VALUES
  ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000a2', 'complete',
   now() - interval '2 days', now() - interval '23 hours 55 minutes', 'scheduled');

SELECT is((SELECT overdue_deletions FROM public.gdpr_request_health()), 0,
  '25. pins the deletion grace window: 5 minutes under 24 hours past scheduled_for is not yet overdue');

UPDATE public.gdpr_deletion_requests SET scheduled_for = now() - interval '24 hours 5 minutes'
 WHERE request_id = '00000000-0000-4000-8000-0000000000d1';

SELECT is((SELECT overdue_deletions FROM public.gdpr_request_health()), 1,
  '26. pins the deletion grace window: 5 minutes over 24 hours past scheduled_for is overdue');

UPDATE public.gdpr_deletion_requests SET status = 'completed'
 WHERE request_id = '00000000-0000-4000-8000-0000000000d1';

SELECT is((SELECT verdict FROM public.gdpr_request_health()), 'ok'::text,
  '27. resolving the boundary row returns the monitor to ok');

-- Re-drive claim: decides and stamps in one UPDATE, on the same stuck line the monitor uses.
INSERT INTO public.gdpr_data_exports(request_id, user_id, requested_at, created_at, status) VALUES
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000a1', now() - interval '2 days', now() - interval '2 days', 'failed'),
  ('00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-0000000000a1', NULL, now() - interval '2 hours', 'processing'),
  ('00000000-0000-4000-8000-0000000000e3', '00000000-0000-4000-8000-0000000000a1', now() - interval '5 minutes', now() - interval '5 minutes', 'pending'),
  ('00000000-0000-4000-8000-0000000000e4', '00000000-0000-4000-8000-0000000000a1', now() - interval '2 days', now() - interval '2 days', 'completed');

SELECT is(public.claim_gdpr_export_redrive('00000000-0000-4000-8000-0000000000e1'), true,
  '28. a failed export is claimed for re-drive');
SELECT ok((SELECT status = 'processing' AND processing_started_at = now()
             FROM public.gdpr_data_exports WHERE request_id = '00000000-0000-4000-8000-0000000000e1'),
  '29. the claim moves the row to processing and stamps processing_started_at');
SELECT is(public.claim_gdpr_export_redrive('00000000-0000-4000-8000-0000000000e1'), false,
  '30. a second claim is refused while the first re-drive is live, despite the old requested_at');
SELECT is((SELECT stuck_exports FROM public.gdpr_request_health()), 1,
  '31. a live re-drive is not counted stuck; only the old processing row with a NULL requested_at is');
SELECT is(public.claim_gdpr_export_redrive('00000000-0000-4000-8000-0000000000e2'), true,
  '32. a stuck row with a NULL requested_at falls back to created_at, as the monitor does');
SELECT is(public.claim_gdpr_export_redrive('00000000-0000-4000-8000-0000000000e3'), false,
  '33. a fresh pending row is refused');
SELECT is(public.claim_gdpr_export_redrive('00000000-0000-4000-8000-0000000000e4'), false,
  '34. a completed row is refused: it holds a URL the subject can still use');
SELECT is(public.claim_gdpr_export_redrive('00000000-0000-4000-8000-0000000000ff'), false,
  '35. an unknown request id is refused');
SELECT is(public.claim_gdpr_export_redrive('00000000-0000-4000-8000-0000000000e3', 1), true,
  '36. the stuck line is a parameter: the 5 minute old pending row is stuck under a 1 minute line');

UPDATE public.gdpr_data_exports SET status = 'failed'
 WHERE request_id = '00000000-0000-4000-8000-0000000000e1';
SELECT is(public.check_gdpr_request_health(true), 1,
  '37. a failed export fires the monitor again');
SELECT ok((SELECT position('Re-drive a failed or stuck export' in last_body) > 0
             FROM monitoring.alert_state WHERE alert_key = 'gdpr.requests'),
  '38. the alert names re-drive as the recovery path for failed and stuck exports');

SELECT ok(NOT has_function_privilege('anon', 'public.claim_gdpr_export_redrive(uuid,integer)', 'EXECUTE'),
  '39. anon cannot execute the re-drive claim');
SELECT ok(NOT has_function_privilege('authenticated', 'public.claim_gdpr_export_redrive(uuid,integer)', 'EXECUTE'),
  '40. authenticated cannot execute the re-drive claim');
SELECT ok(has_function_privilege('service_role', 'public.claim_gdpr_export_redrive(uuid,integer)', 'EXECUTE'),
  '41. service_role can execute the re-drive claim');

ROLLBACK;
