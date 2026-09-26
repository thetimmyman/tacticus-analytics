BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;
SET LOCAL timezone TO 'UTC';

-- Prefs are owner-only CRUD; state is owner SELECT with service_role-only writes (no forged stamps
-- or self-cleared DM block). auth.users is a stub and auth.uid() reads request.jwt.claim.sub.

SELECT plan(22);


SELECT has_table('public', 'user_token_alert_prefs',
  'user_token_alert_prefs exists');
SELECT has_table('public', 'user_token_alert_state',
  'user_token_alert_state exists');

SELECT ok(
  (SELECT relrowsecurity FROM pg_class
   WHERE oid = 'public.user_token_alert_prefs'::regclass),
  'RLS enabled on user_token_alert_prefs');
SELECT ok(
  (SELECT relrowsecurity FROM pg_class
   WHERE oid = 'public.user_token_alert_state'::regclass),
  'RLS enabled on user_token_alert_state');

-- A ...39a0 acts; B ...39b0 owns prefs and a DM-blocked state row; C ...39c0 has none.

GRANT USAGE ON SCHEMA public TO authenticated, anon, service_role;
GRANT USAGE ON SCHEMA extensions TO authenticated, anon, service_role;

INSERT INTO auth.users (id) VALUES
  ('00000000-0000-0000-0000-0000000039a0'::uuid),
  ('00000000-0000-0000-0000-0000000039b0'::uuid),
  ('00000000-0000-0000-0000-0000000039c0'::uuid)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_token_alert_prefs (user_id, alert_on_full)
VALUES ('00000000-0000-0000-0000-0000000039b0', true);

INSERT INTO public.user_token_alert_state
  (user_id, last_tokens, consecutive_dm_failures, dm_blocked_at)
VALUES ('00000000-0000-0000-0000-0000000039b0', 2, 3, now());

SELECT throws_ok(
  $$INSERT INTO public.user_token_alert_prefs (user_id, alert_before_full_minutes)
    VALUES ('00000000-0000-0000-0000-0000000039c0', 14)$$,
  '23514', NULL,
  'minutes below 15 violates the range CHECK');

SELECT throws_ok(
  $$INSERT INTO public.user_token_alert_prefs (user_id, alert_before_full_minutes)
    VALUES ('00000000-0000-0000-0000-0000000039c0', 721)$$,
  '23514', NULL,
  'minutes above 720 violates the range CHECK');

SELECT set_config('request.jwt.claim.sub',  '00000000-0000-0000-0000-0000000039a0', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SET ROLE authenticated;

SELECT lives_ok(
  $$INSERT INTO public.user_token_alert_prefs
      (user_id, alert_on_full, alert_before_full, alert_before_full_minutes)
    VALUES ('00000000-0000-0000-0000-0000000039a0', true, true, 120)$$,
  'owner can insert their own prefs row');

SELECT is(
  (SELECT count(*) FROM public.user_token_alert_prefs),
  1::bigint,
  'owner sees exactly their own prefs row (B''s row invisible)');

SELECT is(
  (SELECT count(*) FROM public.user_token_alert_prefs
   WHERE user_id = '00000000-0000-0000-0000-0000000039b0'),
  0::bigint,
  'cross-user prefs read returns nothing');

SELECT throws_ok(
  $$INSERT INTO public.user_token_alert_prefs (user_id, alert_on_full)
    VALUES ('00000000-0000-0000-0000-0000000039c0', true)$$,
  '42501', NULL,
  'inserting a prefs row for another user_id is blocked (WITH CHECK)');

SELECT lives_ok(
  $$UPDATE public.user_token_alert_prefs
    SET alert_before_full_minutes = 60, updated_at = now()
    WHERE user_id = '00000000-0000-0000-0000-0000000039a0'$$,
  'owner can update their own prefs row');

-- Cross-user UPDATE/DELETE silently affect zero rows; the service_role section proves it.
SELECT lives_ok(
  $$UPDATE public.user_token_alert_prefs
    SET alert_on_full = false
    WHERE user_id = '00000000-0000-0000-0000-0000000039b0'$$,
  'cross-user prefs UPDATE executes (silently filtered)');

SELECT lives_ok(
  $$DELETE FROM public.user_token_alert_prefs
    WHERE user_id = '00000000-0000-0000-0000-0000000039b0'$$,
  'cross-user prefs DELETE executes (silently filtered)');

SELECT is(
  (SELECT count(*) FROM public.user_token_alert_state
   WHERE user_id = '00000000-0000-0000-0000-0000000039b0'),
  0::bigint,
  'cross-user state read returns nothing');

SELECT throws_ok(
  $$INSERT INTO public.user_token_alert_state (user_id, last_tokens)
    VALUES ('00000000-0000-0000-0000-0000000039a0', 3)$$,
  '42501', NULL,
  'authenticated cannot INSERT state (service-only writes)');

SELECT throws_ok(
  $$UPDATE public.user_token_alert_state
    SET dm_blocked_at = NULL, consecutive_dm_failures = 0$$,
  '42501', NULL,
  'authenticated cannot UPDATE state (cannot clear their own DM block)');

SELECT lives_ok(
  $$DELETE FROM public.user_token_alert_prefs
    WHERE user_id = '00000000-0000-0000-0000-0000000039a0'$$,
  'owner can delete their own prefs row');

RESET ROLE;

SELECT set_config('request.jwt.claim.sub',  '', true);
SELECT set_config('request.jwt.claim.role', 'anon', true);
SET ROLE anon;

SELECT throws_ok(
  'SELECT count(*) FROM public.user_token_alert_prefs',
  '42501', NULL,
  'anon has no read on user_token_alert_prefs');

SELECT throws_ok(
  'SELECT count(*) FROM public.user_token_alert_state',
  '42501', NULL,
  'anon has no read on user_token_alert_state');

RESET ROLE;

SELECT set_config('request.jwt.claim.sub',  '', true);
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SET ROLE service_role;

SELECT is(
  (SELECT alert_on_full FROM public.user_token_alert_prefs
   WHERE user_id = '00000000-0000-0000-0000-0000000039b0'),
  true,
  'B''s row untouched by A''s cross-user UPDATE');

SELECT is(
  (SELECT count(*) FROM public.user_token_alert_prefs),
  1::bigint,
  'B''s row survived A''s cross-user DELETE (A deleted only their own)');

SELECT lives_ok(
  $$UPDATE public.user_token_alert_state
    SET dm_blocked_at = NULL, consecutive_dm_failures = 0, updated_at = now()
    WHERE user_id = '00000000-0000-0000-0000-0000000039b0'$$,
  'service_role can clear a DM block');

RESET ROLE;

SELECT set_config('request.jwt.claim.sub',  '', true);
SELECT set_config('request.jwt.claim.role', '', true);

SELECT finish();
ROLLBACK;
