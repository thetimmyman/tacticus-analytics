-- guild_config credential and bearer columns are server-only: authenticated reads the rest
-- through column grants, never a table-level SELECT. Matches the production ACL (a no-op
-- there); a database rebuilt from migrations would otherwise expose these columns.
-- target-db: general

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $hide_credentials$
DECLARE
  v_hidden text[] := ARRAY[
    'session_id', 'session_refreshed_at', 'client_secret', 'client_secret_uploaded_by',
    'client_secret_uploaded_at', 'api_key_encrypted', 'API_Owner', 'contact_discord',
    'discord_webhook_url', 'bomb_alert_webhook_url', 'last_roster_refresh_at',
    'last_raid_write_at'
  ];
  v_column text;
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'guild_config column grants require postgres, got %', current_database();
  END IF;

  -- A table-level REVOKE also drops every column grant, so the visible set is re-granted after it.
  REVOKE SELECT ON public.guild_config FROM authenticated;

  FOR v_column IN
    SELECT attname FROM pg_attribute
     WHERE attrelid = 'public.guild_config'::regclass AND attnum > 0 AND NOT attisdropped
       AND attname <> ALL (v_hidden)
  LOOP
    EXECUTE format('GRANT SELECT (%I) ON public.guild_config TO authenticated', v_column);
  END LOOP;

  FOREACH v_column IN ARRAY v_hidden LOOP
    IF EXISTS (
      SELECT 1 FROM pg_attribute
       WHERE attrelid = 'public.guild_config'::regclass AND attname = v_column
         AND NOT attisdropped
         AND has_column_privilege('authenticated', attrelid, attnum, 'SELECT')
    ) THEN
      RAISE EXCEPTION 'authenticated can still read guild_config.%', v_column;
    END IF;
  END LOOP;
END
$hide_credentials$;

COMMIT;
