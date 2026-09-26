-- Negative control 1: a suite that fails an assertion, proving `not ok` reaches
-- the exit status. Kept outside supabase/tests/pgtap/ so it is never rostered.
-- Expected: `not ok 2`, runner exits non-zero, verdict FAIL.
BEGIN;

-- Same search_path as the real suites (pgTAP lives in `extensions`).
SET search_path TO extensions, public, pg_catalog;

SELECT plan(2);
SELECT ok(true,  'control: a passing assertion, so the failure below is not the whole run');
SELECT ok(false, 'control: this assertion is meant to fail and the gate must go red');
SELECT * FROM finish();
ROLLBACK;
