-- target-db: general
-- discord_message_tracking.webhook_url holds Discord webhook URLs, which are bearer credentials.
-- Only service_role uses the table (its sole RLS policy), so client roles hold no SELECT on it.

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $guard$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION
      'This migration targets the General database only; refusing to run on %',
      current_database();
  END IF;
END;
$guard$;

REVOKE SELECT ON public.discord_message_tracking FROM anon, authenticated;

DO $verify$
BEGIN
  IF has_any_column_privilege('anon', 'public.discord_message_tracking', 'SELECT')
     OR has_any_column_privilege('authenticated', 'public.discord_message_tracking', 'SELECT') THEN
    RAISE EXCEPTION 'a client role can still read public.discord_message_tracking';
  END IF;
END;
$verify$;

COMMIT;
