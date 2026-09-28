BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;

SELECT plan(10);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_token_alert_prefs'
      AND column_name = 'alert_on_full_repeat_hours'
  ),
  'repeat-hours preference exists'
);

SELECT ok(
  (
    SELECT data_type = 'integer'
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_token_alert_prefs'
      AND column_name = 'alert_on_full_repeat_hours'
  ),
  'repeat-hours preference is integer'
);

SELECT ok(
  (
    SELECT is_nullable = 'YES'
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_token_alert_prefs'
      AND column_name = 'alert_on_full_repeat_hours'
  ),
  'repeat-hours preference is nullable (NULL means disabled)'
);

SELECT ok(
  (
    SELECT column_default IS NULL
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_token_alert_prefs'
      AND column_name = 'alert_on_full_repeat_hours'
  ),
  'existing and new users default to repeats disabled'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.user_token_alert_prefs'::regclass
      AND conname = 'user_token_alert_prefs_full_repeat_hours_range'
      AND contype = 'c'
  ),
  'repeat-hours range CHECK exists'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.user_token_alert_prefs'::regclass
      AND conname = 'user_token_alert_prefs_full_repeat_requires_full'
      AND contype = 'c'
  ),
  'repeat-requires-full CHECK exists'
);

INSERT INTO auth.users (id) VALUES
  ('00000000-0000-0000-0000-000000004310'::uuid),
  ('00000000-0000-0000-0000-000000004311'::uuid),
  ('00000000-0000-0000-0000-000000004312'::uuid),
  ('00000000-0000-0000-0000-000000004313'::uuid)
ON CONFLICT (id) DO NOTHING;

SELECT throws_ok(
  $$INSERT INTO public.user_token_alert_prefs
      (user_id, alert_on_full, alert_on_full_repeat_hours)
    VALUES ('00000000-0000-0000-0000-000000004310', true, 10)$$,
  '23514',
  NULL,
  'cadence below the 11-hour anti-flap window is rejected'
);

SELECT throws_ok(
  $$INSERT INTO public.user_token_alert_prefs
      (user_id, alert_on_full, alert_on_full_repeat_hours)
    VALUES ('00000000-0000-0000-0000-000000004311', true, 169)$$,
  '23514',
  NULL,
  'cadence above one week is rejected'
);

SELECT throws_ok(
  $$INSERT INTO public.user_token_alert_prefs
      (user_id, alert_on_full, alert_on_full_repeat_hours)
    VALUES ('00000000-0000-0000-0000-000000004312', false, 12)$$,
  '23514',
  NULL,
  'repeat cadence cannot be enabled when the main full alert is off'
);

SELECT lives_ok(
  $$INSERT INTO public.user_token_alert_prefs
      (user_id, alert_on_full, alert_on_full_repeat_hours)
    VALUES ('00000000-0000-0000-0000-000000004313', true, 11);
    UPDATE public.user_token_alert_prefs
    SET alert_on_full_repeat_hours = 168
    WHERE user_id = '00000000-0000-0000-0000-000000004313';
    DELETE FROM public.user_token_alert_prefs
    WHERE user_id = '00000000-0000-0000-0000-000000004313'$$,
  'both inclusive cadence bounds are accepted'
);

SELECT * FROM finish();
ROLLBACK;
