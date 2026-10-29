-- target-db: general
-- Rollback for 20261028120000_monitoring_observation_retirement.sql.
--
-- This file never erases audit history. It locks the archive and refuses
-- unless monitoring.alert_retirement exists and is empty. Any archived row
-- stops the rollback before anything is dropped.
--
-- Restoring an archived observation is a separate, reviewed action under a
-- full-row compare-and-swap, not part of this rollback. For one key the shape
-- is:
--
--   INSERT INTO monitoring.alert_state
--   SELECT restored.*
--   FROM monitoring.alert_retirement AS retirement
--   CROSS JOIN LATERAL
--     jsonb_populate_record(NULL::monitoring.alert_state, retirement.original_row) AS restored
--   WHERE retirement.id = '00000000-0000-4000-8000-000000000001'::uuid
--     AND retirement.alert_key = 'synthetic.selected-observation'
--     AND retirement.original_row = '<exact expected full-row JSON>'::jsonb
--   ON CONFLICT (alert_key) DO NOTHING;
--
-- First assert the selected audit UUID, key and full-row JSON match exactly
-- one archive row; missing or ambiguous selection must abort the transaction.
-- Only a key with no active row may be restored that way. If a row is present,
-- compare its complete to_jsonb() with original_row and leave it alone when
-- they differ; never overwrite a newer observation. Preserve archive history
-- after restoration. Once used, this schema rollback deliberately stays blocked.
BEGIN;

DO $guard$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION
      'This rollback targets the General database only; refusing to run on %',
      current_database();
  END IF;
END;
$guard$;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $pre$
DECLARE
  v_archived bigint;
BEGIN
  IF to_regclass('monitoring.alert_retirement') IS NULL THEN
    RAISE EXCEPTION
      'monitoring.alert_retirement is absent; rollback state has drifted';
  END IF;

  -- Hold the archive against new retirements until the drop commits, so the
  -- emptiness check below cannot race a concurrent insert.
  EXECUTE 'LOCK TABLE monitoring.alert_retirement IN EXCLUSIVE MODE';

  SELECT count(*) INTO v_archived FROM monitoring.alert_retirement;
  IF v_archived <> 0 THEN
    RAISE EXCEPTION
      'monitoring.alert_retirement still holds % archived observation(s); refusing to drop audit history',
      v_archived;
  END IF;

  IF to_regprocedure('monitoring.retire_absent_observation(text,jsonb,jsonb,text)') IS NULL THEN
    RAISE EXCEPTION
      'monitoring.retire_absent_observation is absent; rollback state has drifted';
  END IF;
END;
$pre$;

DROP FUNCTION monitoring.retire_absent_observation(text, jsonb, jsonb, text);
DROP TABLE monitoring.alert_retirement;

DELETE FROM supabase_migrations.schema_migrations
WHERE version = '20261028120000'
  AND name = 'monitoring_observation_retirement';

NOTIFY pgrst, 'reload schema';
COMMIT;
