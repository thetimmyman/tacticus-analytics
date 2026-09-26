-- Close the remaining direct PII paths from the clean baseline.

BEGIN;

REVOKE ALL ON FUNCTION public.find_orphaned_player_mappings() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_guild_members_debug(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_guild_members_simple() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_player_mapping_debug(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_user_cluster_code(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_user_guild_code(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_user_profile(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_user_support_unread_count(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_users_needing_guild_update() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.find_orphaned_player_mappings() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_guild_members_debug(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_guild_members_simple() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_player_mapping_debug(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_user_cluster_code(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_user_guild_code(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_user_profile(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_user_support_unread_count(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_users_needing_guild_update() TO service_role;

-- Identity resolvers take caller arrays and return account authority: server-only.
REVOKE EXECUTE ON FUNCTION public.get_guild_members_browser_safe() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_user_auth_context(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.resolve_verified_players(uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.resolve_verified_discord_identities(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_verified_players(uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.resolve_verified_discord_identities(text[]) TO service_role;

-- Own profile comes from a self-only security-barrier view, not peer-readable grants.
CREATE OR REPLACE VIEW public.current_user_player_mapping
WITH (security_barrier = true)
AS
SELECT
  mapping.api_key_added_at,
  mapping.api_key_is_valid,
  mapping.api_key_last_verified,
  mapping.assigned_at,
  mapping.assigned_by,
  mapping.assignment_notes,
  mapping.auto_generated,
  mapping.avatar_unit_id,
  mapping.avatar_url,
  mapping.boss_preferences,
  mapping.cluster_code,
  mapping.cluster_id,
  mapping.created_at,
  mapping.discord_user_id,
  mapping.discord_username,
  mapping.display_name,
  mapping.guild_code,
  mapping.has_duplicate_name,
  mapping.id,
  mapping.is_active,
  mapping.is_app_admin,
  mapping.is_current,
  mapping.last_active_at,
  mapping.last_battle_time,
  mapping.last_sync_at,
  mapping.last_sync_bombs,
  mapping.last_sync_tokens,
  mapping.next_bomb_seconds,
  mapping.next_token_seconds,
  mapping.notify_boss_kills,
  mapping.notify_prime_kills,
  mapping.notify_when_capped,
  mapping.original_display_name,
  mapping.player_id,
  mapping.player_level,
  mapping.player_power,
  mapping.preferences_updated_at,
  mapping.primary_boss,
  mapping.primary_team,
  mapping.protected,
  mapping.role,
  mapping.secondary_boss,
  mapping.secondary_team,
  mapping.tacticus_share_url,
  mapping.tertiary_team,
  mapping.theme_preference,
  mapping.timezone,
  mapping.updated_at,
  mapping.user_id,
  mapping.username
FROM public.player_mapping AS mapping
WHERE mapping.user_id = (SELECT auth.uid())
   OR coalesce((SELECT auth.jwt() ->> 'role'), '') = 'service_role'
WITH LOCAL CHECK OPTION;

ALTER VIEW public.current_user_player_mapping OWNER TO postgres;
REVOKE ALL ON TABLE public.current_user_player_mapping FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.current_user_player_mapping TO authenticated, service_role;
GRANT UPDATE (timezone, tacticus_share_url, theme_preference, primary_team,
  secondary_team, tertiary_team, discord_username, boss_preferences,
  preferences_updated_at, last_active_at, discord_user_id, avatar_url,
  display_name)
ON TABLE public.current_user_player_mapping TO authenticated;

-- Peer profiles: the definer reproduces guild/cluster/app-admin scope without
-- reopening user_id on the base table.
CREATE OR REPLACE FUNCTION public.get_scoped_player_profile(p_user_id uuid)
RETURNS TABLE (
  display_name text,
  guild_code text,
  cluster_code text,
  role public.app_role,
  last_sync_at timestamptz,
  is_current boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
  SELECT
    mapping.display_name,
    mapping.guild_code,
    guild.cluster_code::text,
    mapping.role,
    mapping.last_sync_at,
    mapping.is_current
  FROM public.player_mapping AS mapping
  LEFT JOIN public.guild_config AS guild
    ON mapping.guild_code = guild.guild_code
  WHERE mapping.user_id = p_user_id
    AND mapping.is_current IS TRUE
    AND (
      mapping.user_id = (SELECT auth.uid())
      OR mapping.guild_code IN (
        SELECT public._pm_caller_guild_codes()
      )
      OR mapping.guild_code IN (
        SELECT public._pm_caller_cluster_guild_codes()
      )
      OR public._pm_caller_is_app_admin()
      OR coalesce((SELECT auth.jwt() ->> 'role'), '') = 'service_role'
    )
  LIMIT 1;
$function$;

ALTER FUNCTION public.get_scoped_player_profile(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_scoped_player_profile(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_scoped_player_profile(uuid)
  TO authenticated, service_role;

-- Browsers see only their own current row; server SQL and service_role see all.
CREATE OR REPLACE VIEW public.player_with_cluster
WITH (security_barrier = true, security_invoker = false)
AS
SELECT
  mapping.player_id,
  mapping.guild_code,
  mapping.user_id,
  mapping.role,
  mapping.is_current,
  NULL::text AS tacticus_api_key_encrypted,
  mapping.api_key_is_valid,
  mapping.auto_generated,
  mapping.last_sync_tokens,
  mapping.last_sync_bombs,
  mapping.last_sync_at,
  mapping.next_token_seconds,
  mapping.next_bomb_seconds,
  mapping.cluster_id,
  mapping.primary_boss,
  mapping.secondary_boss,
  mapping.theme_preference,
  mapping.display_name,
  guild.cluster_code,
  guild.display_name AS guild_display_name,
  cluster.display_name AS cluster_display_name,
  cluster.is_active AS cluster_is_active
FROM public.player_mapping AS mapping
LEFT JOIN public.guild_config AS guild
  ON mapping.guild_code = guild.guild_code
LEFT JOIN public.clusters AS cluster
  ON guild.cluster_code::text = cluster.cluster_code::text
WHERE mapping.is_current IS TRUE
  AND (
    mapping.user_id = (SELECT auth.uid())
    OR coalesce((SELECT auth.jwt() ->> 'role'), '') = 'service_role'
    OR current_user = 'postgres'
  );

ALTER VIEW public.player_with_cluster OWNER TO postgres;
REVOKE ALL ON TABLE public.player_with_cluster FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.player_with_cluster TO authenticated, service_role;

-- A table-level SELECT bypasses the column allow-list, so revoke all and re-grant.
REVOKE ALL ON TABLE public.player_mapping FROM anon, authenticated;

GRANT INSERT, UPDATE, DELETE ON TABLE public.player_mapping TO authenticated;

GRANT SELECT (id, player_id, display_name, created_at, updated_at,
  guild_code, auto_generated, role, avatar_url, is_active,
  is_current, has_duplicate_name, original_display_name, boss_preferences,
  primary_boss, secondary_boss, assignment_notes, assigned_at,
  last_battle_time, primary_team, secondary_team,
  tertiary_team, last_sync_tokens, last_sync_bombs, last_sync_at,
  next_token_seconds, next_bomb_seconds, cluster_code, cluster_id,
  player_level, avatar_unit_id, player_power, last_active_at)
ON TABLE public.player_mapping TO authenticated;

-- Probes run in the migration so a partial grant/revoke cannot deploy silently.
DO $probe$
DECLARE
  fn text;
  sensitive_column text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.find_orphaned_player_mappings()',
    'public.get_guild_members_debug(text)',
    'public.get_guild_members_simple()',
    'public.get_player_mapping_debug(uuid)',
    'public.get_user_cluster_code(uuid)',
    'public.get_user_guild_code(uuid)',
    'public.get_user_profile(uuid)',
    'public.get_user_support_unread_count(uuid)',
    'public.get_users_needing_guild_update()'
  ]
  LOOP
    IF has_function_privilege('anon', fn, 'EXECUTE')
       OR has_function_privilege('authenticated', fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'PII helper remains client-executable: %', fn;
    END IF;
    IF NOT has_function_privilege('service_role', fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'Service role lost required helper: %', fn;
    END IF;
  END LOOP;

  IF has_table_privilege('anon', 'public.player_mapping', 'SELECT')
     OR has_any_column_privilege('anon', 'public.player_mapping', 'SELECT') THEN
    RAISE EXCEPTION 'anon retains a player_mapping read path';
  END IF;

  IF has_function_privilege(
    'anon',
    'public.get_guild_members_browser_safe()',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'anon retains the browser-safe member directory';
  END IF;
  IF NOT has_function_privilege(
    'authenticated',
    'public.get_guild_members_browser_safe()',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated lost the scoped member directory';
  END IF;
  IF has_function_privilege(
    'authenticated',
    'public.resolve_verified_players(uuid[])',
    'EXECUTE'
  ) OR has_function_privilege(
    'authenticated',
    'public.resolve_verified_discord_identities(text[])',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated retains an arbitrary identity resolver';
  END IF;
  IF has_table_privilege(
    'anon',
    'public.current_user_player_mapping',
    'SELECT'
  ) THEN
    RAISE EXCEPTION 'anon retains the current-user profile projection';
  END IF;
  IF NOT has_table_privilege(
    'authenticated',
    'public.current_user_player_mapping',
    'SELECT'
  ) THEN
    RAISE EXCEPTION 'authenticated lost the current-user profile projection';
  END IF;
  IF has_function_privilege(
    'anon',
    'public.get_scoped_player_profile(uuid)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'authenticated',
    'public.get_scoped_player_profile(uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'scoped peer-profile ACL is invalid';
  END IF;
  IF has_table_privilege('anon', 'public.player_with_cluster', 'SELECT')
     OR NOT has_table_privilege(
       'authenticated',
       'public.player_with_cluster',
       'SELECT'
     ) THEN
    RAISE EXCEPTION 'player_with_cluster self-profile ACL is invalid';
  END IF;
  IF has_table_privilege('authenticated', 'public.player_mapping', 'SELECT') THEN
    RAISE EXCEPTION 'authenticated retains broad player_mapping SELECT';
  END IF;

  FOREACH sensitive_column IN ARRAY ARRAY[
    'discord_user_id',
    'discord_username',
    'officer_notes',
    'ownership_attestation_id',
    'patreon_user_id',
    'player_notes',
    'tacticus_api_key_encrypted',
    'tacticus_share_url',
    'timezone',
    'username',
    'user_id',
    'assigned_by',
    'theme_preference',
    'is_app_admin',
    'preferences_updated_at',
    'api_key_added_at',
    'api_key_last_verified',
    'api_key_is_valid',
    'notify_boss_kills',
    'notify_prime_kills',
    'notify_when_capped',
    'protected'
  ]
  LOOP
    IF has_column_privilege(
      'authenticated',
      'public.player_mapping',
      sensitive_column,
      'SELECT'
    ) THEN
      RAISE EXCEPTION 'authenticated retains sensitive player_mapping column: %', sensitive_column;
    END IF;
  END LOOP;

  IF NOT has_column_privilege(
    'authenticated',
    'public.player_mapping',
    'display_name',
    'SELECT'
  ) THEN
    RAISE EXCEPTION 'authenticated lost safe player_mapping reads';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.player_mapping', 'UPDATE') THEN
    RAISE EXCEPTION 'authenticated lost RLS-controlled profile updates';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.player_mapping', 'SELECT') THEN
    RAISE EXCEPTION 'service_role lost full player_mapping reads';
  END IF;
END;
$probe$;

COMMIT;
