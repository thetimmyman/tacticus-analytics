BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;
SET LOCAL timezone TO 'UTC';

-- Bomb alert and quiet-hours columns: bounds, all-or-nothing quiet hours, RLS/grants, GDPR export.
-- auth.users is a stub; auth.uid() reads request.jwt.claim.sub.

SELECT plan(37);

-- One string so a failure names type, nullability and default at once.
CREATE FUNCTION pg_temp.col_sig(p_table text, p_col text) RETURNS text
LANGUAGE sql STABLE AS $fn$
  SELECT coalesce(
    (SELECT c.data_type || '|' || c.is_nullable || '|' || coalesce(c.column_default, '-')
     FROM information_schema.columns c
     WHERE c.table_schema = 'public'
       AND c.table_name = p_table
       AND c.column_name = p_col),
    'MISSING')
$fn$;


SELECT is(pg_temp.col_sig('user_token_alert_prefs', 'alert_on_bomb_ready'),
  'boolean|NO|false',
  'alert_on_bomb_ready is boolean NOT NULL DEFAULT false');

SELECT is(pg_temp.col_sig('user_token_alert_prefs', 'alert_before_bomb_ready'),
  'boolean|NO|false',
  'alert_before_bomb_ready is boolean NOT NULL DEFAULT false');

SELECT is(pg_temp.col_sig('user_token_alert_prefs', 'alert_before_bomb_ready_minutes'),
  'integer|NO|120',
  'alert_before_bomb_ready_minutes is integer NOT NULL DEFAULT 120');

SELECT is(pg_temp.col_sig('user_token_alert_prefs', 'quiet_hours_start'),
  'smallint|YES|-',
  'quiet_hours_start is a nullable smallint with no default');

SELECT is(pg_temp.col_sig('user_token_alert_prefs', 'quiet_hours_end'),
  'smallint|YES|-',
  'quiet_hours_end is a nullable smallint with no default');

SELECT is(pg_temp.col_sig('user_token_alert_prefs', 'quiet_hours_timezone'),
  'text|YES|-',
  'quiet_hours_timezone is nullable text with no default');

-- Nullable, no default: "never observed" must differ from 0.

SELECT is(pg_temp.col_sig('user_token_alert_state', 'last_bombs'),
  'integer|YES|-',
  'last_bombs is a nullable integer with no default');

SELECT is(pg_temp.col_sig('user_token_alert_state', 'last_time_to_bomb_seconds'),
  'integer|YES|-',
  'last_time_to_bomb_seconds is a nullable integer with no default');

SELECT is(pg_temp.col_sig('user_token_alert_state', 'last_bomb_ready_alert_at'),
  'timestamp with time zone|YES|-',
  'last_bomb_ready_alert_at is a nullable timestamptz with no default');

SELECT is(pg_temp.col_sig('user_token_alert_state', 'last_bomb_prewarn_alert_at'),
  'timestamp with time zone|YES|-',
  'last_bomb_prewarn_alert_at is a nullable timestamptz with no default');

-- A default would look permanently armed.
SELECT is(pg_temp.col_sig('user_token_alert_state', 'quiet_hours_deferred_since'),
  'timestamp with time zone|YES|-',
  'quiet_hours_deferred_since is a nullable timestamptz with no default');

-- Inline CHECKs on ADD COLUMN IF NOT EXISTS are skipped on re-run, so they are added out-of-line.

CREATE FUNCTION pg_temp.has_check(p_conname text) RETURNS boolean
LANGUAGE sql STABLE AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.user_token_alert_prefs'::regclass
      AND conname = p_conname
      AND contype = 'c'
  )
$fn$;

SELECT ok(pg_temp.has_check('user_token_alert_prefs_bomb_minutes_range'),
  'CHECK user_token_alert_prefs_bomb_minutes_range exists on the table');

SELECT ok(pg_temp.has_check('user_token_alert_prefs_quiet_start_range'),
  'CHECK user_token_alert_prefs_quiet_start_range exists on the table');

SELECT ok(pg_temp.has_check('user_token_alert_prefs_quiet_end_range'),
  'CHECK user_token_alert_prefs_quiet_end_range exists on the table');

SELECT ok(pg_temp.has_check('user_token_alert_prefs_quiet_tz_length'),
  'CHECK user_token_alert_prefs_quiet_tz_length exists on the table');

SELECT ok(pg_temp.has_check('user_token_alert_prefs_quiet_hours_complete'),
  'CHECK user_token_alert_prefs_quiet_hours_complete exists on the table');

GRANT USAGE ON SCHEMA public TO authenticated, anon, service_role;
GRANT USAGE ON SCHEMA extensions TO authenticated, anon, service_role;

INSERT INTO auth.users (id) VALUES
  ('00000000-0000-0000-0000-0000000040a0'::uuid),
  ('00000000-0000-0000-0000-0000000040b0'::uuid),
  ('00000000-0000-0000-0000-0000000040c0'::uuid)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_token_alert_prefs (user_id, alert_on_bomb_ready)
VALUES ('00000000-0000-0000-0000-0000000040b0', true);

INSERT INTO public.user_token_alert_state (user_id, last_bombs, last_bomb_ready_alert_at)
VALUES ('00000000-0000-0000-0000-0000000040b0', 1, now());


SELECT throws_ok(
  $$INSERT INTO public.user_token_alert_prefs (user_id, alert_before_bomb_ready_minutes)
    VALUES ('00000000-0000-0000-0000-0000000040c0', 14)$$,
  '23514', NULL,
  'bomb prewarn minutes below 15 violates the range CHECK');

SELECT throws_ok(
  $$INSERT INTO public.user_token_alert_prefs (user_id, alert_before_bomb_ready_minutes)
    VALUES ('00000000-0000-0000-0000-0000000040c0', 961)$$,
  '23514', NULL,
  'bomb prewarn minutes above 960 violates the range CHECK');

-- 1080 min = one bomb regen period: an always-satisfied window.
SELECT throws_ok(
  $$INSERT INTO public.user_token_alert_prefs (user_id, alert_before_bomb_ready_minutes)
    VALUES ('00000000-0000-0000-0000-0000000040c0', 1080)$$,
  '23514', NULL,
  '1080 (one full bomb regen period) is rejected — degenerate always-on window');

SELECT lives_ok(
  $$INSERT INTO public.user_token_alert_prefs (user_id, alert_before_bomb_ready_minutes)
    VALUES ('00000000-0000-0000-0000-0000000040c0', 960);
    DELETE FROM public.user_token_alert_prefs
    WHERE user_id = '00000000-0000-0000-0000-0000000040c0'$$,
  '960 is accepted — the upper bound is inclusive');


SELECT throws_ok(
  $$INSERT INTO public.user_token_alert_prefs
      (user_id, quiet_hours_start, quiet_hours_end, quiet_hours_timezone)
    VALUES ('00000000-0000-0000-0000-0000000040c0', 24, 6, 'UTC')$$,
  '23514', NULL,
  'quiet_hours_start above 23 violates the range CHECK');

SELECT throws_ok(
  $$INSERT INTO public.user_token_alert_prefs
      (user_id, quiet_hours_start, quiet_hours_end, quiet_hours_timezone)
    VALUES ('00000000-0000-0000-0000-0000000040c0', -1, 6, 'UTC')$$,
  '23514', NULL,
  'quiet_hours_start below 0 violates the range CHECK');

SELECT throws_ok(
  $$INSERT INTO public.user_token_alert_prefs
      (user_id, quiet_hours_start, quiet_hours_end, quiet_hours_timezone)
    VALUES ('00000000-0000-0000-0000-0000000040c0', 22, 24, 'UTC')$$,
  '23514', NULL,
  'quiet_hours_end above 23 violates the range CHECK');

SELECT throws_ok(
  $$INSERT INTO public.user_token_alert_prefs
      (user_id, quiet_hours_start, quiet_hours_end, quiet_hours_timezone)
    VALUES ('00000000-0000-0000-0000-0000000040c0', 22, -1, 'UTC')$$,
  '23514', NULL,
  'quiet_hours_end below 0 violates the range CHECK');


SELECT throws_ok(
  $$INSERT INTO public.user_token_alert_prefs
      (user_id, quiet_hours_start, quiet_hours_end)
    VALUES ('00000000-0000-0000-0000-0000000040c0', 22, 6)$$,
  '23514', NULL,
  'quiet hours without a timezone is rejected (no zone to evaluate the window in)');

SELECT throws_ok(
  $$INSERT INTO public.user_token_alert_prefs
      (user_id, quiet_hours_timezone)
    VALUES ('00000000-0000-0000-0000-0000000040c0', 'America/New_York')$$,
  '23514', NULL,
  'a timezone without a start/end window is rejected');

SELECT lives_ok(
  $$INSERT INTO public.user_token_alert_prefs
      (user_id, quiet_hours_start, quiet_hours_end, quiet_hours_timezone)
    VALUES ('00000000-0000-0000-0000-0000000040c0', 22, 6, 'America/New_York');
    DELETE FROM public.user_token_alert_prefs
    WHERE user_id = '00000000-0000-0000-0000-0000000040c0'$$,
  'all three quiet-hours columns together is accepted');


SELECT set_config('request.jwt.claim.sub',  '00000000-0000-0000-0000-0000000040a0', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SET ROLE authenticated;

SELECT lives_ok(
  $$INSERT INTO public.user_token_alert_prefs
      (user_id, alert_on_bomb_ready, alert_before_bomb_ready,
       alert_before_bomb_ready_minutes, quiet_hours_start, quiet_hours_end,
       quiet_hours_timezone)
    VALUES ('00000000-0000-0000-0000-0000000040a0', true, true, 240, 23, 7, 'Europe/London')$$,
  'owner can write their own bomb + quiet-hours prefs');

SELECT is(
  (SELECT count(*) FROM public.user_token_alert_prefs
   WHERE user_id = '00000000-0000-0000-0000-0000000040b0'),
  0::bigint,
  'cross-user prefs read still returns nothing after the new columns');

SELECT throws_ok(
  $$UPDATE public.user_token_alert_state
    SET last_bomb_ready_alert_at = NULL, last_bombs = 0$$,
  '42501', NULL,
  'authenticated still cannot UPDATE state (cannot forge bomb alert stamps)');

RESET ROLE;

SELECT set_config('request.jwt.claim.sub',  '', true);
SELECT set_config('request.jwt.claim.role', 'anon', true);
SET ROLE anon;

SELECT throws_ok(
  'SELECT alert_on_bomb_ready FROM public.user_token_alert_prefs',
  '42501', NULL,
  'anon still has no read on user_token_alert_prefs');

SELECT throws_ok(
  'SELECT last_bombs FROM public.user_token_alert_state',
  '42501', NULL,
  'anon still has no read on user_token_alert_state');

RESET ROLE;
SELECT set_config('request.jwt.claim.sub',  '', true);
SELECT set_config('request.jwt.claim.role', '', true);

-- Checks cron.job.command text only; enqueue behaviour needs manual verification. Dynamic SQL
-- because a static cron.job reference fails to parse without the schema.

CREATE FUNCTION pg_temp.cron_guard_status() RETURNS text
LANGUAGE plpgsql STABLE AS $fn$
DECLARE
  v_cmd text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RETURN 'SKIPPED-NO-CRON-SCHEMA';
  END IF;
  EXECUTE $q$SELECT command FROM cron.job WHERE jobname = 'user-token-alert-scan-queue'$q$
    INTO v_cmd;
  IF v_cmd IS NULL THEN
    RETURN 'FAIL-JOB-NOT-SCHEDULED';
  END IF;
  IF v_cmd NOT LIKE '%p.alert_on_bomb_ready%' THEN
    RETURN 'FAIL-GUARD-MISSING-alert_on_bomb_ready';
  END IF;
  IF v_cmd NOT LIKE '%p.alert_before_bomb_ready%' THEN
    RETURN 'FAIL-GUARD-MISSING-alert_before_bomb_ready';
  END IF;
  RETURN 'OK-GUARD-NAMES-BOTH-BOMB-TOGGLES';
END
$fn$;

SELECT ok(
  pg_temp.cron_guard_status() IN
    ('OK-GUARD-NAMES-BOTH-BOMB-TOGGLES', 'SKIPPED-NO-CRON-SCHEMA'),
  'cron opt-in guard names both bomb toggles [' || pg_temp.cron_guard_status() || ']');

-- The GDPR export cannot run here: its body projects each table whole-row, which now has the keys.

SELECT ok(
  (SELECT pg_get_functiondef('public.get_user_data_for_export(uuid)'::regprocedure)
     LIKE '%to_jsonb(utap.*)%'),
  'export projects user_token_alert_prefs whole-row (new columns automatic)');

SELECT ok(
  (SELECT pg_get_functiondef('public.get_user_data_for_export(uuid)'::regprocedure)
     LIKE '%to_jsonb(utas.*)%'),
  'export projects user_token_alert_state whole-row (new columns automatic)');

SELECT is(
  (SELECT to_jsonb(utap.*) ?& ARRAY[
     'alert_on_bomb_ready', 'alert_before_bomb_ready',
     'alert_before_bomb_ready_minutes', 'quiet_hours_start',
     'quiet_hours_end', 'quiet_hours_timezone']
   FROM public.user_token_alert_prefs utap
   WHERE utap.user_id = '00000000-0000-0000-0000-0000000040b0'),
  true,
  'whole-row prefs projection carries every new WI-4000 prefs column');

SELECT is(
  (SELECT to_jsonb(utas.*) ?& ARRAY[
     'last_bombs', 'last_time_to_bomb_seconds',
     'last_bomb_ready_alert_at', 'last_bomb_prewarn_alert_at',
     'quiet_hours_deferred_since']
   FROM public.user_token_alert_state utas
   WHERE utas.user_id = '00000000-0000-0000-0000-0000000040b0'),
  true,
  'whole-row state projection carries every new WI-4000 state column');

SELECT finish();
ROLLBACK;
