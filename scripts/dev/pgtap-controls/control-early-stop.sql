-- Negative control 2: a suite that stops early. A statement error aborts the
-- transaction silently (psql exits 0, no `not ok`), so only plan-vs-produced
-- catches it. Expected: plan 4, produced 1, runner exits non-zero.
BEGIN;

SET search_path TO extensions, public, pg_catalog;

SELECT plan(4);
SELECT ok(true, 'control: this one runs');
SELECT * FROM public.this_relation_does_not_exist_and_aborts_the_transaction;
SELECT ok(true, 'control: this one is swallowed by the aborted transaction');
SELECT ok(true, 'control: so is this one');
SELECT ok(true, 'control: and this one');
SELECT * FROM finish();
ROLLBACK;
