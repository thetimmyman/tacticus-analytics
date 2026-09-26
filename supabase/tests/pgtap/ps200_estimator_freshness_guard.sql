BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;
SET LOCAL timezone TO 'UTC';

SELECT plan(20);

-- Leg (c) excludes late-arrival audit rows from the 70%/8% verdict. notify() records
-- only on delivery, so each phase forces the status and reads last_title/last_body.

SELECT has_function(
  'public', 'run_token_invariant_monitor', ARRAY[]::text[],
  'run_token_invariant_monitor() exists with the zero-argument signature pg_cron calls'
);

-- sha256 of pg_proc.prosrc keeps both databases' bodies identical;
-- tests/security/ps200-monitor-body-pin.test.ts derives it from the migration.
SELECT is(
  (SELECT encode(sha256(convert_to(p.prosrc, 'UTF8')), 'hex')
     FROM pg_proc p
    WHERE p.oid = 'public.run_token_invariant_monitor()'::regprocedure),
  '74192b4a8552a5dd1fe50b931ea3820a76935cfc332c85d9657600af5560c279',
  'the deployed body is the pinned shared body (sha256 over pg_proc.prosrc, verbatim UTF-8)'
);

-- CREATE OR REPLACE rewrites proconfig, so a replace can drop the bound.
SELECT ok(
  (SELECT proconfig FROM pg_proc
    WHERE oid = 'public.run_token_invariant_monitor()'::regprocedure)
    @> ARRAY['statement_timeout=10min'],
  'the 10-minute statement_timeout survived the PS-200 replace'
);

SELECT ok(
  NOT (SELECT prosecdef FROM pg_proc
        WHERE oid = 'public.run_token_invariant_monitor()'::regprocedure),
  'still SECURITY INVOKER — a definer cannot SET ROLE, which C1 requires'
);

-- grantee 0 is PUBLIC.
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
     WHERE p.oid = 'public.run_token_invariant_monitor()'::regprocedure
       AND a.grantee = 0
  ),
  'EXECUTE is still not granted to PUBLIC'
);

-- Production service_role bypasses RLS (no policies here); without these grants every
-- assertion passes over zero rows. Phase 4 revokes the EOT_GR_data read.
ALTER ROLE service_role BYPASSRLS;

GRANT EXECUTE ON FUNCTION public.get_player_token_state(text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.find_token_accrual_violations(text) TO service_role;
GRANT SELECT ON TABLE public."EOT_GR_data" TO service_role;

-- Phase 1: 10 fresh exact rows + 10 late delta-3 rows. Unguarded (n=20) breaches
-- both limits; guarded (n=10) clears. `id` is the insert clock, so order matters.

INSERT INTO public.token_audit_snapshots
  (created_at, guild_code, player_id, display_name, season, mode,
   live_tokens, live_tokens_max, live_regen_delay_seconds,
   replay_tokens_delta, rpc_tokens_delta, cpta_tokens_delta,
   battle_rows_seen, constants_ok)
SELECT now() - interval '1 hour', 'G200', 'p-fresh', 'Fresh', 'S200', 'daily',
       3, 10, 1800, 0, 0, 0, 5, true
  FROM generate_series(1, 10);

INSERT INTO public.token_audit_snapshots
  (created_at, guild_code, player_id, display_name, season, mode,
   live_tokens, live_tokens_max, live_regen_delay_seconds,
   replay_tokens_delta, rpc_tokens_delta, cpta_tokens_delta,
   battle_rows_seen, constants_ok)
SELECT now() - interval '1 hour', 'G200', 'p-late', 'Late', 'S200', 'daily',
       0, 10, 1800, 3, 0, 0, 5, true
  FROM generate_series(1, 10);

INSERT INTO public."EOT_GR_data" ("Guild", "Season", "userId", "displayName",
                                  "encounterId", "encounterIndex", "damageType",
                                  "damageDealt", "timestamp")
VALUES ('G200', 'S200', 'p-fresh', 'Fresh', 1, 0, 'Battle', 1, now() - interval '5 hours');

INSERT INTO public."EOT_GR_data" ("Guild", "Season", "userId", "displayName",
                                  "encounterId", "encounterIndex", "damageType",
                                  "damageDealt", "timestamp")
VALUES ('G200', 'S200', 'p-late', 'Late', 1, 0, 'Battle', 1, now() - interval '5 hours');
-- The late arrival, inserted last so it holds the higher id.
INSERT INTO public."EOT_GR_data" ("Guild", "Season", "userId", "displayName",
                                  "encounterId", "encounterIndex", "damageType",
                                  "damageDealt", "timestamp")
VALUES ('G200', 'S200', 'p-late', 'Late', 2, 0, 'Battle', 1, now() - interval '10 minutes');

UPDATE monitoring.alert_state SET status = 'cleared' WHERE alert_key = 'tokens.estimator';

SELECT lives_ok(
  'SELECT public.run_token_invariant_monitor()',
  'the monitor completes with the freshness guard active'
);

SELECT is(
  (SELECT last_title FROM monitoring.alert_state WHERE alert_key = 'tokens.estimator'),
  format('Token estimator rates within thresholds on %s', current_database()),
  'leg (c) CLEARS once the 10 late-arrival rows are excluded from the verdict'
);

SELECT ok(
  strpos((SELECT last_body FROM monitoring.alert_state WHERE alert_key = 'tokens.estimator'), 'n=10 rated of 20 seen') > 0,
  'the alert text reports the rated count and the seen count separately'
);

SELECT ok(
  strpos((SELECT last_body FROM monitoring.alert_state WHERE alert_key = 'tokens.estimator'),
         'freshness guard (PS-200): 10 of 20 in-window audit row(s) excluded as late-arrival (50.0% of the window), 10 rated.') > 0,
  'the excluded count and share are reported on their own informational line'
);

SELECT ok(
  strpos((SELECT last_body FROM monitoring.alert_state WHERE alert_key = 'tokens.estimator'), 'never itself a breach') > 0,
  'the informational line says out loud that an exclusion is not a breach'
);

SELECT ok(
  strpos((SELECT last_body FROM monitoring.alert_state WHERE alert_key = 'tokens.estimator'), 'fell below the 70% floor') = 0
  AND strpos((SELECT last_body FROM monitoring.alert_state WHERE alert_key = 'tokens.estimator'), 'exceeds the 8% ceiling') = 0,
  'no breach sentence is emitted for the excluded rows'
);

-- The blind key clears only when every leg completed, or a raising leg (c) leaves a stale value.
SELECT is(
  (SELECT last_title FROM monitoring.alert_state WHERE alert_key = 'tokens.monitor.blind'),
  format('Token invariant monitor is looking again on %s', current_database()),
  'no leg raised — the guard query did not blind leg (c)'
);

SELECT is(
  array_length(public.token_estimator_rate_breaches('replay', 20, 10, 10), 1),
  2,
  'the same window rated UNGUARDED (n=20, exact 10, gross 10) breaches both boundaries'
);

-- Phase 2: the guard is not a mute button. 10 fresh delta-3 rows + 90 late
-- exact rows: unguarded (n=100, 90% exact) is silent, guarded (n=10) fires.

DELETE FROM public.token_audit_snapshots;
DELETE FROM public."EOT_GR_data" WHERE "Guild" = 'G200';

INSERT INTO public.token_audit_snapshots
  (created_at, guild_code, player_id, display_name, season, mode,
   live_tokens, live_tokens_max, live_regen_delay_seconds,
   replay_tokens_delta, rpc_tokens_delta, cpta_tokens_delta,
   battle_rows_seen, constants_ok)
SELECT now() - interval '1 hour', 'G200', 'p-fresh', 'Fresh', 'S200', 'daily',
       3, 10, 1800, 3, 0, 0, 5, true
  FROM generate_series(1, 10);

INSERT INTO public.token_audit_snapshots
  (created_at, guild_code, player_id, display_name, season, mode,
   live_tokens, live_tokens_max, live_regen_delay_seconds,
   replay_tokens_delta, rpc_tokens_delta, cpta_tokens_delta,
   battle_rows_seen, constants_ok)
SELECT now() - interval '1 hour', 'G200', 'p-late', 'Late', 'S200', 'daily',
       0, 10, 1800, 0, 0, 0, 5, true
  FROM generate_series(1, 90);

INSERT INTO public."EOT_GR_data" ("Guild", "Season", "userId", "displayName",
                                  "encounterId", "encounterIndex", "damageType",
                                  "damageDealt", "timestamp")
VALUES ('G200', 'S200', 'p-fresh', 'Fresh', 1, 0, 'Battle', 1, now() - interval '5 hours');
INSERT INTO public."EOT_GR_data" ("Guild", "Season", "userId", "displayName",
                                  "encounterId", "encounterIndex", "damageType",
                                  "damageDealt", "timestamp")
VALUES ('G200', 'S200', 'p-late', 'Late', 1, 0, 'Battle', 1, now() - interval '5 hours');
INSERT INTO public."EOT_GR_data" ("Guild", "Season", "userId", "displayName",
                                  "encounterId", "encounterIndex", "damageType",
                                  "damageDealt", "timestamp")
VALUES ('G200', 'S200', 'p-late', 'Late', 2, 0, 'Battle', 1, now() - interval '10 minutes');

-- Force `firing` so notify() takes the unchanged-status path and records the body.
UPDATE monitoring.alert_state SET status = 'firing' WHERE alert_key = 'tokens.estimator';

SELECT public.run_token_invariant_monitor();

SELECT is(
  (SELECT last_title FROM monitoring.alert_state WHERE alert_key = 'tokens.estimator'),
  format('Token estimator regression on %s', current_database()),
  'leg (c) still FIRES when the rated rows breach, guard or no guard'
);

SELECT ok(
  strpos((SELECT last_body FROM monitoring.alert_state WHERE alert_key = 'tokens.estimator'),
         'replay estimator exact-match 0.0% fell below the 70% floor (n=10)') > 0,
  'the breach is stated over the RATED rows (n=10), not the whole window'
);

SELECT ok(
  strpos((SELECT last_body FROM monitoring.alert_state WHERE alert_key = 'tokens.estimator'),
         'freshness guard (PS-200): 90 of 100 in-window audit row(s) excluded as late-arrival (90.0% of the window), 10 rated.') > 0,
  'the exclusion count and share are reported on a firing run too'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM unnest(public.token_estimator_rate_breaches('replay', 100, 90, 10)) b
     WHERE strpos(b, 'fell below the 70% floor') > 0
  ),
  'the same window rated UNGUARDED (n=100, exact 90) is SILENT on the floor'
);

-- Phase 3: excluding every row is not a pass; the key stays untouched.

DELETE FROM public.token_audit_snapshots;

INSERT INTO public.token_audit_snapshots
  (created_at, guild_code, player_id, display_name, season, mode,
   live_tokens, live_tokens_max, live_regen_delay_seconds,
   replay_tokens_delta, rpc_tokens_delta, cpta_tokens_delta,
   battle_rows_seen, constants_ok)
SELECT now() - interval '1 hour', 'G200', 'p-late', 'Late', 'S200', 'daily',
       0, 10, 1800, 3, 0, 0, 5, true
  FROM generate_series(1, 10);

UPDATE monitoring.alert_state
   SET last_title = 'SENTINEL — must not be overwritten',
       last_body  = 'SENTINEL'
 WHERE alert_key = 'tokens.estimator';

SELECT public.run_token_invariant_monitor();

SELECT is(
  (SELECT last_title FROM monitoring.alert_state WHERE alert_key = 'tokens.estimator'),
  'SENTINEL — must not be overwritten',
  'with every in-window row excluded, leg (c) rates nothing and leaves its key untouched'
);

-- Phase 4: without EOT_GR_data access the guard degrades to unguarded rating, not a raise.

REVOKE SELECT ON TABLE public."EOT_GR_data" FROM service_role;

UPDATE monitoring.alert_state
   SET status = 'firing', last_title = 'SENTINEL', last_body = 'SENTINEL'
 WHERE alert_key = 'tokens.estimator';

SELECT public.run_token_invariant_monitor();

SELECT ok(
  strpos((SELECT last_body FROM monitoring.alert_state WHERE alert_key = 'tokens.estimator'), 'freshness guard (PS-200): UNAVAILABLE (') > 0,
  'a guard that cannot read EOT_GR_data reports UNAVAILABLE with the reason, instead of raising'
);

SELECT ok(
  strpos((SELECT last_body FROM monitoring.alert_state WHERE alert_key = 'tokens.estimator'),
         '0 rows excluded, all 10 in-window row(s) rated exactly as before the guard.') > 0,
  'an unavailable guard excludes nothing and rates the whole window, exactly as before PS-200'
);

SELECT finish();
ROLLBACK;
