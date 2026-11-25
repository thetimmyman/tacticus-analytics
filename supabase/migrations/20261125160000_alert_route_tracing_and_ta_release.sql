-- target-db: general
-- Route tracing alerts explicitly to homelab and TA release drift alerts to ta.
-- Longest matching LIKE pattern wins in monitoring.alert_channel().
-- Existing operator overrides are preserved via ON CONFLICT DO UPDATE only for
-- these two new patterns (no other rows are touched).

-- Rollback: DELETE FROM monitoring.alert_route WHERE pattern IN ('tracing.%', 'deploy-drift.ta-release%');

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $guard$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION
      'This migration targets the General database (postgres); refusing to run on %',
      current_database();
  END IF;
END;
$guard$;

DO $route$
BEGIN
  IF to_regclass('monitoring.alert_route') IS NULL THEN
    RAISE NOTICE 'monitoring.alert_route is absent; routes were not added';
  ELSE
    INSERT INTO monitoring.alert_route(pattern, channel, note) VALUES
      ('tracing.%',                'homelab', 'Observability tracing alerts'),
      ('deploy-drift.ta-release%', 'ta',      'Application release drift alerts')
    ON CONFLICT (pattern) DO UPDATE
      SET channel = EXCLUDED.channel,
          note    = EXCLUDED.note;
  END IF;
END
$route$;

COMMIT;
