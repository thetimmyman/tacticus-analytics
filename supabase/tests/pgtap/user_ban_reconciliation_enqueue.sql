BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;

SELECT plan(8);

SELECT ok(
  NOT has_function_privilege(
    'anon',
    'public.enqueue_user_ban_reconciliation_jobs(jsonb)',
    'EXECUTE'
  ),
  'anon cannot enqueue user-ban reconciliation jobs'
);

SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.enqueue_user_ban_reconciliation_jobs(jsonb)',
    'EXECUTE'
  ),
  'authenticated cannot enqueue user-ban reconciliation jobs'
);

SELECT ok(
  has_function_privilege(
    'service_role',
    'public.enqueue_user_ban_reconciliation_jobs(jsonb)',
    'EXECUTE'
  ),
  'service_role can enqueue an atomic reconciliation batch'
);

SELECT is(
  public.enqueue_user_ban_reconciliation_jobs(
    '[
      {
        "dedupeKey": "user-ban-reconcile:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        "payload": {
          "lockUserIds": ["cccccccc-cccc-4ccc-8ccc-cccccccccccc"],
          "adminCandidateUserIds": [],
          "credentialUserIds": ["cccccccc-cccc-4ccc-8ccc-cccccccccccc"]
        }
      },
      {
        "dedupeKey": "user-ban-reconcile:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
        "payload": {
          "lockUserIds": ["dddddddd-dddd-4ddd-8ddd-dddddddddddd"],
          "adminCandidateUserIds": ["dddddddd-dddd-4ddd-8ddd-dddddddddddd"],
          "credentialUserIds": []
        }
      }
    ]'::jsonb
  ),
  2,
  'the complete two-identity repair batch is inserted'
);

SELECT is(
  public.enqueue_user_ban_reconciliation_jobs(
    '[
      {
        "dedupeKey": "user-ban-reconcile:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        "payload": {
          "lockUserIds": ["cccccccc-cccc-4ccc-8ccc-cccccccccccc"],
          "adminCandidateUserIds": [],
          "credentialUserIds": ["cccccccc-cccc-4ccc-8ccc-cccccccccccc"]
        }
      }
    ]'::jsonb
  ),
  0,
  'an active per-identity dedupe conflict is an idempotent no-op'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.work_queue
    WHERE dedupe_key IN (
      'user-ban-reconcile:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      'user-ban-reconcile:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'
    )
      AND job_type = 'user-ban-reconcile'
      AND job_class = 'verify'
      AND max_attempts = 32767
  ),
  2,
  'the atomic batch persists exactly one correctly classified job per identity'
);

UPDATE public.work_queue
SET status = 'processing',
    claimed_by = 'pgtap-worker',
    claimed_at = now()
WHERE dedupe_key =
  'user-ban-reconcile:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';

SELECT is(
  public.enqueue_user_ban_reconciliation_jobs(
    '[
      {
        "dedupeKey": "user-ban-reconcile:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        "payload": {
          "lockUserIds": ["cccccccc-cccc-4ccc-8ccc-cccccccccccc"],
          "adminCandidateUserIds": [],
          "credentialUserIds": ["cccccccc-cccc-4ccc-8ccc-cccccccccccc"]
        }
      }
    ]'::jsonb
  ),
  1,
  'a processing reconciliation does not suppress a pending successor'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.work_queue
    WHERE status = 'pending'
      AND dedupe_key LIKE
        'user-ban-reconcile:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc:successor:%'
  ),
  1,
  'the processing-window repair is durable under a distinct dedupe key'
);

SELECT * FROM finish();
ROLLBACK;
