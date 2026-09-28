BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;
SET LOCAL timezone TO 'UTC';

SELECT plan(11);

-- A row is late only for a battle that happened before the audit but landed after it.
-- Live-only functions (scripts/dev/lib/replay-unappliable.txt): dark on replay.

-- The sha256 over pg_proc.prosrc matches tests/security/estimator-monitor-body-pin.test.ts.

SELECT has_function(
  'public', 'run_token_invariant_monitor', ARRAY[]::text[],
  'run_token_invariant_monitor() exists with the zero-argument signature pg_cron calls'
);

SELECT is(
  (SELECT encode(digest(p.prosrc, 'sha256'), 'hex')
     FROM pg_proc p
    WHERE p.oid = to_regprocedure('public.run_token_invariant_monitor()')),
  '01caa2e66dd0a0b8921f68cab9718e10c5d47db74b5672bef1c5407d2824a403',
  'the installed body is byte-for-byte the pinned shared body'
);

SELECT ok(
  (SELECT p.prosrc LIKE '%startedOn%'
     FROM pg_proc p
    WHERE p.oid = to_regprocedure('public.run_token_invariant_monitor()')),
  'leg (c) reads the BATTLE clock -- without "startedOn" the test is still the whole-history form'
);

-- Production service_role has BYPASSRLS.
ALTER ROLE service_role BYPASSRLS;

GRANT EXECUTE ON FUNCTION public.get_player_token_state(text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.find_token_accrual_violations(text) TO service_role;
GRANT SELECT ON TABLE public."EOT_GR_data" TO service_role;

-- Phase 1: nothing arrived late, so all 10 rows are rated and the leg fires.

INSERT INTO public.token_audit_snapshots
  (created_at, guild_code, player_id, display_name, season, mode,
   live_tokens, live_tokens_max, live_regen_delay_seconds,
   replay_tokens_delta, rpc_tokens_delta, cpta_tokens_delta,
   battle_rows_seen, constants_ok)
SELECT now() - interval '1 hour', 'G293', 'p-active', 'Active', '293', 'daily',
       3, 10, 1800, 3, 0, 0, 1, true
  FROM generate_series(1, 10);

INSERT INTO public."EOT_GR_data" ("Guild", "Season", "userId", "displayName",
                                  "encounterId", "encounterIndex", "damageType",
                                  "damageDealt", "startedOn", "timestamp")
VALUES ('G293', '293', 'p-active', 'Active', 1, 0, 'Battle', 1,
        now() - interval '5 hours', now() - interval '5 hours');
INSERT INTO public."EOT_GR_data" ("Guild", "Season", "userId", "displayName",
                                  "encounterId", "encounterIndex", "damageType",
                                  "damageDealt", "startedOn", "timestamp")
VALUES ('G293', '293', 'p-active', 'Active', 2, 0, 'Battle', 1,
        now() - interval '30 minutes', now() - interval '30 minutes');

-- No webhook, so notify() records no transition; SENTINEL survives only if the leg rated nothing.
UPDATE monitoring.alert_state
   SET status = 'firing',
       last_title = 'SENTINEL — leg (c) rated nothing',
       last_body  = 'SENTINEL'
 WHERE alert_key = 'tokens.estimator';

SELECT lives_ok(
  'SELECT public.run_token_invariant_monitor()',
  'the monitor completes with the narrowed freshness guard active'
);

SELECT is(
  (SELECT last_title FROM monitoring.alert_state WHERE alert_key = 'tokens.estimator'),
  format('Token estimator regression on %s', current_database()),
  'leg (c) FIRES on rows whose only post-audit battle is an ordinary later one (all excluded, key left at SENTINEL)'
);

SELECT ok(
  strpos((SELECT last_body FROM monitoring.alert_state WHERE alert_key = 'tokens.estimator'),
         'freshness guard (PS-200): 0 of 10 in-window audit row(s) excluded as late-arrival (0.0% of the window), 10 rated.') > 0,
  'a later battle is not a late arrival: 0 of 10 excluded, all 10 rated'
);

SELECT ok(
  strpos((SELECT last_body FROM monitoring.alert_state WHERE alert_key = 'tokens.estimator'),
         'replay estimator exact-match 0.0% fell below the 70% floor (n=10)') > 0,
  'the breach is stated over all 10 rated rows'
);

-- Phase 2: the 10 late arrivals are excluded; clear.

DELETE FROM public.token_audit_snapshots;
DELETE FROM public."EOT_GR_data" WHERE "Guild" = 'G293';

INSERT INTO public.token_audit_snapshots
  (created_at, guild_code, player_id, display_name, season, mode,
   live_tokens, live_tokens_max, live_regen_delay_seconds,
   replay_tokens_delta, rpc_tokens_delta, cpta_tokens_delta,
   battle_rows_seen, constants_ok)
SELECT now() - interval '1 hour', 'G293', 'p-fresh', 'Fresh', '293', 'daily',
       3, 10, 1800, 0, 0, 0, 1, true
  FROM generate_series(1, 10);

INSERT INTO public.token_audit_snapshots
  (created_at, guild_code, player_id, display_name, season, mode,
   live_tokens, live_tokens_max, live_regen_delay_seconds,
   replay_tokens_delta, rpc_tokens_delta, cpta_tokens_delta,
   battle_rows_seen, constants_ok)
SELECT now() - interval '1 hour', 'G293', 'p-late-ts', 'LateTs', '293', 'daily',
       0, 10, 1800, 3, 0, 0, 1, true
  FROM generate_series(1, 10);

INSERT INTO public."EOT_GR_data" ("Guild", "Season", "userId", "displayName",
                                  "encounterId", "encounterIndex", "damageType",
                                  "damageDealt", "startedOn", "timestamp")
VALUES ('G293', '293', 'p-fresh', 'Fresh', 1, 0, 'Battle', 1,
        now() - interval '5 hours', now() - interval '5 hours');
INSERT INTO public."EOT_GR_data" ("Guild", "Season", "userId", "displayName",
                                  "encounterId", "encounterIndex", "damageType",
                                  "damageDealt", "startedOn", "timestamp")
VALUES ('G293', '293', 'p-late-ts', 'LateTs', 1, 0, 'Battle', 1,
        now() - interval '5 hours', now() - interval '5 hours');
INSERT INTO public."EOT_GR_data" ("Guild", "Season", "userId", "displayName",
                                  "encounterId", "encounterIndex", "damageType",
                                  "damageDealt", "startedOn", "timestamp")
VALUES ('G293', '293', 'p-late-ts', 'LateTs', 2, 0, 'Battle', 1,
        now() - interval '90 minutes', now() - interval '10 minutes');

UPDATE monitoring.alert_state SET status = 'cleared' WHERE alert_key = 'tokens.estimator';

SELECT public.run_token_invariant_monitor();

SELECT is(
  (SELECT last_title FROM monitoring.alert_state WHERE alert_key = 'tokens.estimator'),
  format('Token estimator rates within thresholds on %s', current_database()),
  'leg (c) CLEARS once the 10 genuinely late rows are excluded'
);

SELECT ok(
  strpos((SELECT last_body FROM monitoring.alert_state WHERE alert_key = 'tokens.estimator'),
         'freshness guard (PS-200): 10 of 20 in-window audit row(s) excluded as late-arrival (50.0% of the window), 10 rated.') > 0,
  'a battle played before the audit and stored after it still excludes its row'
);

SELECT is(
  array_length(public.token_estimator_rate_breaches('replay', 20, 10, 10), 1),
  2,
  'the same window rated UNGUARDED (n=20, exact 10, gross 10) breaches both boundaries'
);

-- Phase 3: only p-late-ts's 10 rows are excluded.
DELETE FROM public.token_audit_snapshots WHERE player_id = 'p-fresh';

INSERT INTO public.token_audit_snapshots
  (created_at, guild_code, player_id, display_name, season, mode,
   live_tokens, live_tokens_max, live_regen_delay_seconds,
   replay_tokens_delta, rpc_tokens_delta, cpta_tokens_delta,
   battle_rows_seen, constants_ok)
SELECT now() - interval '1 hour', 'G293', 'p-active', 'Active', '293', 'daily',
       3, 10, 1800, 0, 0, 0, 1, true
  FROM generate_series(1, 10);

INSERT INTO public."EOT_GR_data" ("Guild", "Season", "userId", "displayName",
                                  "encounterId", "encounterIndex", "damageType",
                                  "damageDealt", "startedOn", "timestamp")
VALUES ('G293', '293', 'p-active', 'Active', 1, 0, 'Battle', 1,
        now() - interval '5 hours', now() - interval '5 hours');
INSERT INTO public."EOT_GR_data" ("Guild", "Season", "userId", "displayName",
                                  "encounterId", "encounterIndex", "damageType",
                                  "damageDealt", "startedOn", "timestamp")
VALUES ('G293', '293', 'p-active', 'Active', 2, 0, 'Battle', 1,
        now() - interval '30 minutes', now() - interval '30 minutes');

UPDATE monitoring.alert_state SET status = 'cleared' WHERE alert_key = 'tokens.estimator';

SELECT public.run_token_invariant_monitor();

SELECT ok(
  strpos((SELECT last_body FROM monitoring.alert_state WHERE alert_key = 'tokens.estimator'),
         'freshness guard (PS-200): 10 of 20 in-window audit row(s) excluded as late-arrival (50.0% of the window), 10 rated.') > 0,
  'only the late player is excluded; the active player beside it stays rated'
);

SELECT finish();
ROLLBACK;
