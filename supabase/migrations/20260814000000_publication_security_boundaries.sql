-- These objects return credentials, dispatch credentialed requests, bridge auth.users
-- or expose private analytics: service-role only, never PostgREST.

BEGIN;

REVOKE ALL ON FUNCTION public.get_cron_secret() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_service_role_key() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_tacticus_api_key() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.call_edge_function(text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_add_alpha_tester(text, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_remove_alpha_tester(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.generate_boss_assignments(text, text, boolean, integer, boolean, text[], text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.analyze_inactive_guilds() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_core_compositions(text, text, integer, integer, integer, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_war_stats(text, text) FROM PUBLIC, anon, authenticated;

-- A retired helper may linger until 20260814200000 drops it; harden conditionally.
DO $block$
BEGIN
  IF to_regprocedure('public.process_raw_api_to_structured()') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.process_raw_api_to_structured() FROM PUBLIC, anon, authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.process_raw_api_to_structured() TO service_role';
  END IF;
END;
$block$;

GRANT EXECUTE ON FUNCTION public.get_cron_secret() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_service_role_key() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_tacticus_api_key() TO service_role;
GRANT EXECUTE ON FUNCTION public.call_edge_function(text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_add_alpha_tester(text, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_remove_alpha_tester(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.generate_boss_assignments(text, text, boolean, integer, boolean, text[], text) TO service_role;
GRANT EXECUTE ON FUNCTION public.analyze_inactive_guilds() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_core_compositions(text, text, integer, integer, integer, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_war_stats(text, text) TO service_role;

REVOKE ALL ON TABLE public.auth_user_emails FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.api_key_coverage FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.boss_leaderboard_canonical FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.auth_user_emails TO service_role;
GRANT SELECT ON TABLE public.api_key_coverage TO service_role;
GRANT SELECT ON TABLE public.boss_leaderboard_canonical TO service_role;


CREATE OR REPLACE FUNCTION public.consume_discord_bot_invite(
  p_invite_code text,
  p_discord_guild_id text,
  p_discord_user_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_invite public.discord_invite_codes%ROWTYPE;
  v_guild public.guild_config%ROWTYPE;
  v_prior_mapping public.discord_server_guilds%ROWTYPE;
  v_existing_mapping public.discord_server_guilds%ROWTYPE;
BEGIN
  IF NULLIF(btrim(p_invite_code), '') IS NULL
     OR NULLIF(btrim(p_discord_guild_id), '') IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  SELECT invite.*
    INTO v_invite
    FROM public.discord_invite_codes AS invite
   WHERE invite.invite_code = p_invite_code
   FOR UPDATE;

  IF NOT FOUND OR v_invite.is_active IS DISTINCT FROM true THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  IF COALESCE(v_invite.current_uses, 0) >= COALESCE(v_invite.max_uses, 0) THEN
    RETURN jsonb_build_object('status', 'exhausted');
  END IF;

  IF v_invite.expires_at IS NOT NULL AND v_invite.expires_at <= now() THEN
    RETURN jsonb_build_object('status', 'expired');
  END IF;

  SELECT config.*
    INTO v_guild
    FROM public.guild_config AS config
   WHERE config.guild_code = v_invite.guild_code;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'guild_missing');
  END IF;

  SELECT mapping.*
    INTO v_prior_mapping
    FROM public.discord_server_guilds AS mapping
   WHERE mapping.invited_with_code = p_invite_code
     AND mapping.is_active = true
   ORDER BY mapping.id
   LIMIT 1;

  IF FOUND
     AND (
       v_prior_mapping.discord_guild_id <> p_discord_guild_id
       OR v_prior_mapping.game_guild_code <> v_invite.guild_code
     ) THEN
    RETURN jsonb_build_object('status', 'already_used');
  END IF;

  SELECT mapping.*
    INTO v_existing_mapping
    FROM public.discord_server_guilds AS mapping
   WHERE mapping.discord_guild_id = p_discord_guild_id
     AND mapping.game_guild_code = v_invite.guild_code
     AND mapping.is_active = true;

  IF FOUND THEN
    UPDATE public.discord_invite_codes AS invite
       SET current_uses = COALESCE(invite.current_uses, 0) + 1,
           is_active = false
     WHERE invite.id = v_invite.id;

    RETURN jsonb_build_object(
      'status', 'already_linked',
      'guild_code', v_invite.guild_code
    );
  END IF;

  INSERT INTO public.discord_server_guilds (
    discord_guild_id,
    game_guild_code,
    cluster_code,
    invited_with_code,
    linked_by_user_id,
    is_active
  ) VALUES (
    p_discord_guild_id,
    v_invite.guild_code,
    v_guild.cluster_code,
    p_invite_code,
    p_discord_user_id,
    true
  )
  ON CONFLICT (discord_guild_id, game_guild_code)
  DO UPDATE SET
    cluster_code = EXCLUDED.cluster_code,
    invited_with_code = EXCLUDED.invited_with_code,
    linked_by_user_id = EXCLUDED.linked_by_user_id,
    is_active = true,
    linked_at = now();

  UPDATE public.discord_invite_codes AS invite
     SET current_uses = COALESCE(invite.current_uses, 0) + 1,
         is_active = false
   WHERE invite.id = v_invite.id;

  RETURN jsonb_build_object(
    'status', 'linked',
    'guild_code', v_invite.guild_code
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.consume_discord_bot_invite(text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_discord_bot_invite(text, text, text)
  TO service_role;


COMMIT;
