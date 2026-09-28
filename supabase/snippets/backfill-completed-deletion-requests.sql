-- One-shot fix: close `scheduled` gdpr_deletion_requests whose auth.users row is
-- gone. Rolls back and reports the count unless flipped to COMMIT.

BEGIN;

-- Pure SQL (no psql meta-commands) so it runs from any console.
DO $$
DECLARE
  v_expected constant integer := 3;
  v_actual   integer;
BEGIN
  UPDATE public.gdpr_deletion_requests r
     SET status = 'completed',
         -- Per-row timestamp: the erasure is at least as old as the request's
         -- own schedule, so use that rather than one now() for every row.
         -- COALESCE keeps an already-set completed_at authoritative.
         completed_at = COALESCE(r.completed_at, r.scheduled_for, r.requested_at)
   WHERE r.status = 'scheduled'
     AND NOT EXISTS (
           SELECT 1
             FROM auth.users u
            WHERE u.id = r.user_id
         );

  GET DIAGNOSTICS v_actual = ROW_COUNT;

  IF v_actual <> v_expected THEN
    RAISE EXCEPTION
      'deletion-request backfill matched % row(s), expected % -- refusing to proceed. Re-check the incident scope before changing v_expected.',
      v_actual, v_expected;
  END IF;

  RAISE NOTICE 'deletion-request backfill: % row(s) closed (status=completed).', v_actual;
END
$$;

SELECT count(*) AS still_open_over_absent_subject
  FROM public.gdpr_deletion_requests r
 WHERE r.status = 'scheduled'
   AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = r.user_id);

-- Flip to COMMIT only after the NOTICE and the count above are as expected.
ROLLBACK;
-- COMMIT;
