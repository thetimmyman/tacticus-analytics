BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;

SELECT plan(53);

-- Identity-bearing helpers are server-only: no client role or PUBLIC may call them.
SELECT ok(NOT has_function_privilege('anon', 'public.find_orphaned_player_mappings()', 'EXECUTE'), 'anon cannot enumerate orphaned mappings');
SELECT ok(NOT has_function_privilege('authenticated', 'public.find_orphaned_player_mappings()', 'EXECUTE'), 'authenticated cannot enumerate orphaned mappings');
SELECT ok(NOT has_function_privilege('anon', 'public.get_guild_members_simple()', 'EXECUTE'), 'anon cannot call legacy member directory');
SELECT ok(NOT has_function_privilege('authenticated', 'public.get_guild_members_simple()', 'EXECUTE'), 'authenticated cannot call legacy member directory');
SELECT ok(NOT has_function_privilege('anon', 'public.get_player_mapping_debug(uuid)', 'EXECUTE'), 'anon cannot inspect arbitrary mappings');
SELECT ok(NOT has_function_privilege('authenticated', 'public.get_player_mapping_debug(uuid)', 'EXECUTE'), 'authenticated cannot inspect arbitrary mappings');
SELECT ok(NOT has_function_privilege('anon', 'public.get_user_cluster_code(uuid)', 'EXECUTE'), 'anon cannot map users to clusters');
SELECT ok(NOT has_function_privilege('authenticated', 'public.get_user_cluster_code(uuid)', 'EXECUTE'), 'authenticated cannot map arbitrary users to clusters');
SELECT ok(NOT has_function_privilege('anon', 'public.get_user_guild_code(uuid)', 'EXECUTE'), 'anon cannot map users to guilds');
SELECT ok(NOT has_function_privilege('authenticated', 'public.get_user_guild_code(uuid)', 'EXECUTE'), 'authenticated cannot map arbitrary users to guilds');
SELECT ok(NOT has_function_privilege('anon', 'public.get_user_profile(uuid)', 'EXECUTE'), 'anon cannot inspect arbitrary profiles');
SELECT ok(NOT has_function_privilege('authenticated', 'public.get_user_profile(uuid)', 'EXECUTE'), 'authenticated cannot inspect arbitrary profiles');
SELECT ok(NOT has_function_privilege('anon', 'public.get_user_support_unread_count(uuid)', 'EXECUTE'), 'anon cannot probe support activity');
SELECT ok(NOT has_function_privilege('authenticated', 'public.get_user_support_unread_count(uuid)', 'EXECUTE'), 'authenticated cannot probe another user support activity');
SELECT ok(NOT has_function_privilege('anon', 'public.get_users_needing_guild_update()', 'EXECUTE'), 'anon cannot enumerate stale guild identities');
SELECT ok(NOT has_function_privilege('authenticated', 'public.get_users_needing_guild_update()', 'EXECUTE'), 'authenticated cannot enumerate stale guild identities');

SELECT ok(has_function_privilege('service_role', 'public.get_user_profile(uuid)', 'EXECUTE'), 'service role keeps profile helper');
SELECT ok(has_function_privilege('service_role', 'public.get_guild_members_simple()', 'EXECUTE'), 'service role keeps legacy helper for compatibility');
SELECT ok(NOT has_function_privilege('anon', 'public.get_guild_members_browser_safe()', 'EXECUTE'), 'anon cannot call the authenticated member directory');
SELECT ok(has_function_privilege('authenticated', 'public.get_guild_members_browser_safe()', 'EXECUTE'), 'authenticated keeps the scoped member directory');
SELECT ok(NOT has_function_privilege('authenticated', 'public.resolve_verified_players(uuid[])', 'EXECUTE'), 'authenticated cannot resolve arbitrary account UUIDs');
SELECT ok(NOT has_function_privilege('authenticated', 'public.resolve_verified_discord_identities(text[])', 'EXECUTE'), 'authenticated cannot resolve arbitrary Discord identities');
SELECT ok(has_function_privilege('service_role', 'public.resolve_verified_players(uuid[])', 'EXECUTE'), 'service role keeps canonical player resolution');
SELECT ok(has_function_privilege('service_role', 'public.resolve_verified_discord_identities(text[])', 'EXECUTE'), 'service role keeps canonical Discord resolution');

-- No broad reads; authenticated keeps the safe-column surface and RLS writes.
SELECT ok(NOT has_table_privilege('anon', 'public.player_mapping', 'SELECT'), 'anon has no broad player_mapping read');
SELECT ok(NOT has_table_privilege('authenticated', 'public.player_mapping', 'SELECT'), 'authenticated has no broad player_mapping read');
SELECT ok(has_column_privilege('authenticated', 'public.player_mapping', 'display_name', 'SELECT'), 'authenticated keeps safe display-name reads');
SELECT ok(has_column_privilege('authenticated', 'public.player_mapping', 'guild_code', 'SELECT'), 'authenticated keeps safe guild reads');
SELECT ok(NOT has_column_privilege('authenticated', 'public.player_mapping', 'tacticus_api_key_encrypted', 'SELECT'), 'authenticated cannot read encrypted API keys');
SELECT ok(NOT has_column_privilege('authenticated', 'public.player_mapping', 'officer_notes', 'SELECT'), 'authenticated cannot read officer notes');
SELECT ok(NOT has_column_privilege('authenticated', 'public.player_mapping', 'user_id', 'SELECT'), 'authenticated cannot map peer account UUIDs through the base table');
SELECT ok(has_table_privilege('authenticated', 'public.player_mapping', 'UPDATE'), 'authenticated keeps RLS-controlled updates');
SELECT ok(has_table_privilege('service_role', 'public.player_mapping', 'SELECT'), 'service role keeps full reads');
SELECT ok(NOT has_table_privilege('anon', 'public.current_user_player_mapping', 'SELECT'), 'anon cannot read the self-profile view');
SELECT ok(has_table_privilege('authenticated', 'public.current_user_player_mapping', 'SELECT'), 'authenticated can read the self-profile view');
SELECT ok(has_column_privilege('authenticated', 'public.current_user_player_mapping', 'discord_user_id', 'SELECT'), 'authenticated can read their own Discord identity through the self-profile view');
SELECT ok(NOT has_table_privilege('anon', 'public.player_with_cluster', 'SELECT'), 'anon cannot read the compatibility profile view');
SELECT ok(has_table_privilege('authenticated', 'public.player_with_cluster', 'SELECT'), 'authenticated keeps the compatibility self-profile view');
SELECT ok(NOT has_function_privilege('anon', 'public.get_scoped_player_profile(uuid)', 'EXECUTE'), 'anon cannot query scoped peer profiles');
SELECT ok(has_function_privilege('authenticated', 'public.get_scoped_player_profile(uuid)', 'EXECUTE'), 'authenticated can query scoped peer profiles');
SELECT ok(has_function_privilege('service_role', 'public.get_scoped_player_profile(uuid)', 'EXECUTE'), 'service role can query scoped peer profiles');

-- Trigger bypass is limited to these rolled-back fixtures (not an identity test).
SET LOCAL session_replication_role = replica;
INSERT INTO public.player_mapping
  (player_id, display_name, guild_code, user_id, is_current, discord_user_id)
VALUES
  ('pii-self-player', 'PII Self', 'PIITEST',
   '11111111-1111-4111-8111-111111111111', true, '11111111111111111'),
  ('pii-peer-player', 'PII Peer', 'PIITEST',
   '22222222-2222-4222-8222-222222222222', true, '22222222222222222'),
  ('pii-outside-player', 'PII Outside', 'OTHERTEST',
   '33333333-3333-4333-8333-333333333333', true, '33333333333333333');
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT * FROM public.resolve_verified_players(
      ARRAY['22222222-2222-4222-8222-222222222222'::uuid]
    )$$,
  '42501', NULL,
  'authenticated cannot invoke the account identity resolver'
);
SELECT throws_ok(
  $$SELECT * FROM public.resolve_verified_discord_identities(
      ARRAY['22222222222222222'::text]
    )$$,
  '42501', NULL,
  'authenticated cannot invoke the Discord identity resolver'
);
SELECT is(
  (SELECT count(*)::integer FROM public.current_user_player_mapping),
  1,
  'self-profile view excludes a same-guild peer'
);
SELECT is(
  (SELECT count(*)::integer FROM public.player_with_cluster),
  1,
  'compatibility profile view excludes a same-guild peer'
);
SELECT lives_ok(
  $$SELECT guild_code, theme_preference
      FROM public.player_with_cluster
     WHERE user_id = auth.uid()$$,
  'compatibility profile fields remain readable by the current user'
);
SELECT is(
  (SELECT count(*)::integer
     FROM public.get_scoped_player_profile(
       '22222222-2222-4222-8222-222222222222'::uuid
     )),
  1,
  'scoped peer profile preserves same-guild profile navigation'
);
SELECT is(
  (SELECT count(*)::integer
     FROM public.get_scoped_player_profile(
       '33333333-3333-4333-8333-333333333333'::uuid
     )),
  0,
  'scoped peer profile rejects an unrelated account UUID'
);
SELECT is(
  (SELECT user_id FROM public.current_user_player_mapping),
  '11111111-1111-4111-8111-111111111111'::uuid,
  'self-profile view returns only the caller account'
);
SELECT is(
  (SELECT discord_user_id::text FROM public.current_user_player_mapping),
  '11111111111111111',
  'self-profile view preserves the caller Discord-linked flow'
);
SELECT lives_ok(
  $$SELECT api_key_added_at, api_key_is_valid, api_key_last_verified,
      assigned_at, assigned_by, assignment_notes, auto_generated,
      avatar_unit_id, avatar_url, boss_preferences, cluster_code, cluster_id,
      created_at, discord_user_id, discord_username, display_name, guild_code,
      has_duplicate_name, id, is_active, is_app_admin, is_current,
      last_active_at, last_battle_time, last_sync_at, last_sync_bombs,
      last_sync_tokens, next_bomb_seconds, next_token_seconds,
      notify_boss_kills, notify_prime_kills, notify_when_capped,
      original_display_name, player_id, player_level, player_power,
      preferences_updated_at, primary_boss, primary_team, protected, role,
      secondary_boss, secondary_team, tacticus_share_url, tertiary_team,
      theme_preference, timezone, updated_at, user_id, username
    FROM public.current_user_player_mapping$$,
  'the exact application profile projection is executable as authenticated'
);
SELECT lives_ok(
  $$UPDATE public.current_user_player_mapping
      SET timezone = 'Etc/UTC'
    WHERE user_id = '11111111-1111-4111-8111-111111111111'::uuid
      AND is_current IS TRUE$$,
  'existing self-service profile updates remain executable'
);
SELECT is(
  (SELECT timezone FROM public.current_user_player_mapping),
  'Etc/UTC',
  'the self-service profile update reaches the caller row'
);
RESET ROLE;
SET LOCAL session_replication_role = origin;

SELECT * FROM finish();
ROLLBACK;
