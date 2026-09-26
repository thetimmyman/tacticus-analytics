-- The single-row eraser is live-only, so 9-11 prove the wrapper's contract without a real erasure.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;
SET LOCAL timezone TO 'UTC';

SELECT plan(12);

SELECT is(
  current_database()::text,
  'postgres'::text,
  '1. this suite runs against the general database'
);

SELECT is(
  (SELECT count(*)::integer FROM supabase_migrations.schema_migrations
    WHERE version = '20260920100000'),
  1,
  '2. the PS-398 migration is recorded as applied'
);

SELECT ok(
  to_regprocedure('public.sweep_orphaned_quarantine_pii()') IS NOT NULL,
  '3. public.sweep_orphaned_quarantine_pii() exists'
);

SELECT is(
  (SELECT p.prosecdef
     FROM pg_proc p
    WHERE p.oid = to_regprocedure('public.sweep_orphaned_quarantine_pii()')),
  true,
  '4. the sweep is SECURITY DEFINER'
);

-- aclexplode(NULL proacl) returns no rows, so 5 requires a non-NULL proacl.
SELECT ok(
  (SELECT p.proacl IS NOT NULL
     FROM pg_proc p
    WHERE p.oid = to_regprocedure('public.sweep_orphaned_quarantine_pii()')),
  '5. the sweep carries an explicit ACL, so 6-8 are not a vacuous pass against PUBLIC default privileges'
);

SELECT ok(
  NOT has_function_privilege('anon', 'public.sweep_orphaned_quarantine_pii()', 'EXECUTE'),
  '6. anon holds no EXECUTE on the sweep'
);

SELECT ok(
  NOT has_function_privilege('authenticated', 'public.sweep_orphaned_quarantine_pii()', 'EXECUTE'),
  '7. authenticated holds no EXECUTE on the sweep'
);

SELECT ok(
  has_function_privilege('postgres', 'public.sweep_orphaned_quarantine_pii()', 'EXECUTE'),
  '8. postgres -- the pg_cron execution role and the operator''s own role -- holds EXECUTE'
);

DO $seed$
BEGIN
  INSERT INTO public.player_identity_quarantine_evidence
    (id, classification, had_user_binding, had_discord_binding,
     invite_match_count, discord_identity_match_count)
  VALUES
    ('39800000-0000-4000-8000-000000000001', 'ps398-fixture', true, true, 0, 0);

  INSERT INTO public.player_identity_quarantine_pii
    (quarantine_id, mapping_id, prior_user_id, prior_discord_user_id,
     prior_discord_username, player_id, guild_code)
  VALUES
    ('39800000-0000-4000-8000-000000000001', 999398001,
     '39800000-0000-4000-8000-00000000000f', 'ps398-discord-id',
     'ps398_fixture_user', 'player-ps398-fixture', NULL);
END;
$seed$;

SELECT is(
  (SELECT count(*)::integer FROM public.player_identity_quarantine_pii q
    WHERE q.quarantine_id = '39800000-0000-4000-8000-000000000001'
      AND q.prior_user_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = q.prior_user_id)),
  1,
  '9. the orphan predicate finds the fixture row: prior_user_id is set and matches no auth.users row'
);

-- With the eraser absent the sweep is a soft no-op: returns 0 and leaves the row.
SELECT is(
  (SELECT public.sweep_orphaned_quarantine_pii()),
  0,
  '10. sweep_orphaned_quarantine_pii() returns 0 on this lane -- the eraser it calls is absent here, and it must not raise'
);

SELECT is(
  (SELECT count(*)::integer FROM public.player_identity_quarantine_pii
    WHERE quarantine_id = '39800000-0000-4000-8000-000000000001'),
  1,
  '11. the fixture row is untouched -- nothing was deleted, because the sweep could not reach the (absent) eraser'
);

-- TRUE when cron.job is absent (replay lane).
DO $cron_probe$
DECLARE
  v_ok boolean;
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    v_ok := true;
  ELSE
    EXECUTE $sql$
      SELECT EXISTS (
        SELECT 1 FROM cron.job
         WHERE jobname = 'quarantine-pii-orphan-sweep'
           AND schedule = '33 4 * * *'
           AND active
           AND command LIKE '%sweep_orphaned_quarantine_pii%'
      )
    $sql$ INTO v_ok;
  END IF;

  CREATE TEMP TABLE ps398_cron_probe (ok boolean) ON COMMIT DROP;
  INSERT INTO ps398_cron_probe VALUES (v_ok);
END;
$cron_probe$;

SELECT ok(
  (SELECT ok FROM ps398_cron_probe),
  '12. the cron row exists with the expected schedule when pg_cron is installed (vacuously true on this lane, which has none)'
);

SELECT * FROM finish();
ROLLBACK;
