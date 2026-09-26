-- Re-scope terminus-maximus replays to 'cluster': RLS lets any signed-in user read 'public'.
-- target-db: general
-- Keep the ingest cron suspended until the 'cluster' writer ships, or new rows regress.

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
SET LOCAL statement_timeout = '60s';

UPDATE public.boss_playbook_replays
SET visibility = 'cluster'
WHERE source_system = 'terminus-maximus'
  AND visibility = 'public';

-- Read-only negative control for before the UPDATE; it proves the predicate matches rows.

DO $verify$
DECLARE
  v_total  bigint;
  v_public bigint;
BEGIN
  IF to_regclass('public.boss_playbook_replays') IS NULL THEN
    RAISE EXCEPTION
      'PS-18 verify: relation public.boss_playbook_replays does not exist; this check cannot pass vacuously';
  END IF;

  SELECT count(*) INTO v_total
  FROM public.boss_playbook_replays
  WHERE source_system = 'terminus-maximus';

  IF v_total = 0 THEN
    RAISE EXCEPTION
      'PS-18 verify: zero rows with source_system = ''terminus-maximus'' in public.boss_playbook_replays; the predicate matches nothing, so a zero public count would be meaningless';
  END IF;

  SELECT count(*) INTO v_public
  FROM public.boss_playbook_replays
  WHERE source_system = 'terminus-maximus'
    AND visibility = 'public';

  IF v_public > 0 THEN
    RAISE EXCEPTION
      'PS-18 verify: % of % terminus-maximus replay row(s) are still visibility = public',
      v_public, v_total;
  END IF;

  RAISE NOTICE
    'PS-18 verify: OK -- % terminus-maximus row(s), 0 with visibility = public',
    v_total;
END
$verify$;

COMMIT;
