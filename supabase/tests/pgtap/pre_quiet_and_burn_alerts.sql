BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;

SELECT plan(16);


SELECT ok(
  (
    SELECT count(*) = 4
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_token_alert_prefs'
      AND column_name IN (
        'alert_before_quiet_hours',
        'alert_before_quiet_hours_minutes',
        'alert_before_burn',
        'alert_before_burn_minutes'
      )
  ),
  'all four pre-quiet and pre-burn preference columns exist'
);

SELECT ok(
  (
    SELECT count(*) = 2
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_token_alert_prefs'
      AND column_name IN ('alert_before_quiet_hours', 'alert_before_burn')
      AND is_nullable = 'NO'
      AND column_default = 'false'
  ),
  'both new toggles are NOT NULL and default OFF — nobody is opted in by a migration'
);

SELECT ok(
  (
    SELECT count(*) = 2
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_token_alert_prefs'
      AND column_name IN (
        'alert_before_quiet_hours_minutes',
        'alert_before_burn_minutes'
      )
      AND data_type = 'integer'
      AND is_nullable = 'NO'
      AND column_default = '30'
  ),
  'both lead times are NOT NULL integers defaulting to 30 minutes'
);


SELECT ok(
  (
    SELECT count(*) = 3
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_token_alert_state'
      AND column_name IN (
        'capped_since',
        'last_pre_quiet_alert_at',
        'last_burn_prewarn_alert_at'
      )
      AND data_type = 'timestamp with time zone'
      AND is_nullable = 'YES'
  ),
  'the burn anchor and both dedupe stamps exist as nullable timestamptz'
);

-- Separate from last_full_alert_at, or the two cadences would suppress each other.
SELECT ok(
  (
    SELECT count(DISTINCT column_name) = 5
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_token_alert_state'
      AND column_name IN (
        'last_full_alert_at',
        'last_prewarn_alert_at',
        'last_bomb_ready_alert_at',
        'last_pre_quiet_alert_at',
        'last_burn_prewarn_alert_at'
      )
  ),
  'every alert kind keeps its OWN delivery stamp'
);


SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.user_token_alert_prefs'::regclass
      AND conname = 'user_token_alert_prefs_pre_quiet_minutes_range'
      AND contype = 'c'
  ),
  'pre-quiet lead range CHECK exists'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.user_token_alert_prefs'::regclass
      AND conname = 'user_token_alert_prefs_burn_minutes_range'
      AND contype = 'c'
  ),
  'burn lead range CHECK exists'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.user_token_alert_prefs'::regclass
      AND conname = 'user_token_alert_prefs_pre_quiet_requires_quiet_hours'
      AND contype = 'c'
  ),
  'pre-quiet dependency CHECK exists'
);


INSERT INTO auth.users (id) VALUES
  ('00000000-0000-0000-0000-000000049200'::uuid),
  ('00000000-0000-0000-0000-000000049201'::uuid),
  ('00000000-0000-0000-0000-000000049202'::uuid),
  ('00000000-0000-0000-0000-000000049203'::uuid),
  ('00000000-0000-0000-0000-000000049204'::uuid),
  ('00000000-0000-0000-0000-000000049205'::uuid),
  ('00000000-0000-0000-0000-000000049206'::uuid)
ON CONFLICT (id) DO NOTHING;

SELECT throws_ok(
  $$INSERT INTO public.user_token_alert_prefs
      (user_id, alert_before_quiet_hours)
    VALUES ('00000000-0000-0000-0000-000000049200', true)$$,
  '23514',
  NULL,
  'the pre-quiet toggle cannot be enabled without a quiet-hours window'
);

SELECT lives_ok(
  $$INSERT INTO public.user_token_alert_prefs
      (user_id, alert_before_quiet_hours, quiet_hours_start, quiet_hours_end,
       quiet_hours_timezone)
    VALUES ('00000000-0000-0000-0000-000000049201', true, 22, 7,
            'America/New_York')$$,
  'the pre-quiet toggle is accepted alongside a configured window'
);

SELECT throws_ok(
  $$INSERT INTO public.user_token_alert_prefs
      (user_id, alert_before_quiet_hours_minutes)
    VALUES ('00000000-0000-0000-0000-000000049202', 10)$$,
  '23514',
  NULL,
  'a pre-quiet lead below the 15-minute floor is rejected'
);

SELECT throws_ok(
  $$INSERT INTO public.user_token_alert_prefs
      (user_id, alert_before_quiet_hours_minutes)
    VALUES ('00000000-0000-0000-0000-000000049203', 181)$$,
  '23514',
  NULL,
  'a pre-quiet lead above 180 minutes is rejected'
);

-- The lead must stay under the 11-hour burn re-alert hysteresis, or a burn warning is swallowed.
SELECT throws_ok(
  $$INSERT INTO public.user_token_alert_prefs
      (user_id, alert_before_burn, alert_before_burn_minutes)
    VALUES ('00000000-0000-0000-0000-000000049204', true, 361)$$,
  '23514',
  NULL,
  'a burn lead above the 360-minute ceiling is rejected'
);

SELECT lives_ok(
  $$INSERT INTO public.user_token_alert_prefs
      (user_id, alert_before_burn, alert_before_burn_minutes)
    VALUES ('00000000-0000-0000-0000-000000049205', true, 15);
    UPDATE public.user_token_alert_prefs
    SET alert_before_burn_minutes = 360
    WHERE user_id = '00000000-0000-0000-0000-000000049205'$$,
  'both inclusive burn-lead bounds are accepted'
);

SELECT lives_ok(
  $$INSERT INTO public.user_token_alert_prefs
      (user_id, alert_on_full, alert_before_burn)
    VALUES ('00000000-0000-0000-0000-000000049206', false, true)$$,
  'a burn-only opt-in is representable with every other toggle off'
);

-- The GDPR export projects both tables whole-row; an explicit column list would drop new columns.

SELECT ok(
  (
    SELECT prosrc LIKE '%to_jsonb(utap.*)%'
       AND prosrc LIKE '%to_jsonb(utas.*)%'
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'get_user_data_for_export'
    LIMIT 1
  ),
  'the GDPR export still projects both alert tables whole-row, so the preference columns are covered'
);

SELECT * FROM finish();
ROLLBACK;
