-- Replacement accounts may not bind a banned identity; app_role matches case-insensitively;
-- cluster damage rank is computed in SQL, outside PostgREST's row cap.

BEGIN;

CREATE OR REPLACE FUNCTION public.prevent_active_ban_identity_binding()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT'
     OR OLD.user_id IS DISTINCT FROM NEW.user_id
     OR OLD.player_id IS DISTINCT FROM NEW.player_id
     OR OLD.discord_user_id IS DISTINCT FROM NEW.discord_user_id THEN
    IF EXISTS (
      SELECT 1
      FROM public.user_bans AS ban
      WHERE ban.lifted_at IS NULL
        AND (ban.expires_at IS NULL OR ban.expires_at > now())
        AND (
          (ban.subject_type = 'user_id'
            AND ban.subject_value = lower(NEW.user_id::text))
          OR (NEW.player_id IS NOT NULL
            AND ban.subject_type = 'player_id'
            AND ban.subject_value = lower(btrim(NEW.player_id)))
          OR (NEW.discord_user_id IS NOT NULL
            AND ban.subject_type = 'discord_user_id'
            AND ban.subject_value = lower(btrim(NEW.discord_user_id)))
        )
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '42501',
        MESSAGE = 'Account suspended';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.prevent_active_ban_identity_binding()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS prevent_active_ban_identity_binding
  ON public.player_mapping;
CREATE TRIGGER prevent_active_ban_identity_binding
  BEFORE INSERT OR UPDATE OF user_id, player_id, discord_user_id
  ON public.player_mapping
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_active_ban_identity_binding();

DROP POLICY IF EXISTS boss_target_tokens_write
  ON public.boss_target_tokens;
CREATE POLICY boss_target_tokens_write
  ON public.boss_target_tokens
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public._pm_caller_mapping_rows() AS pm
      WHERE pm.guild_code = boss_target_tokens.guild_code
        AND pm.is_current = true
        AND lower(pm.role::text) IN ('leader', 'officer')
    )
    OR EXISTS (
      SELECT 1
      FROM public._pm_caller_mapping_rows() AS pm
      JOIN public.guild_config AS gc_user
        ON gc_user.guild_code = pm.guild_code
      JOIN public.guild_config AS gc_target
        ON gc_target.guild_code = boss_target_tokens.guild_code
      WHERE pm.is_current = true
        AND lower(pm.role::text) = 'leader'
        AND gc_user.cluster_code IS NOT NULL
        AND gc_user.cluster_code::text = gc_target.cluster_code::text
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public._pm_caller_mapping_rows() AS pm
      WHERE pm.guild_code = boss_target_tokens.guild_code
        AND pm.is_current = true
        AND lower(pm.role::text) IN ('leader', 'officer')
    )
    OR EXISTS (
      SELECT 1
      FROM public._pm_caller_mapping_rows() AS pm
      JOIN public.guild_config AS gc_user
        ON gc_user.guild_code = pm.guild_code
      JOIN public.guild_config AS gc_target
        ON gc_target.guild_code = boss_target_tokens.guild_code
      WHERE pm.is_current = true
        AND lower(pm.role::text) = 'leader'
        AND gc_user.cluster_code IS NOT NULL
        AND gc_user.cluster_code::text = gc_target.cluster_code::text
    )
  );

CREATE OR REPLACE FUNCTION public._pm_caller_can_manage_player_meta(
  p_target_user_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.player_mapping AS pm_caller
    JOIN public.player_mapping AS pm_target
      ON pm_caller.guild_code = pm_target.guild_code
    WHERE pm_caller.user_id = auth.uid()
      AND pm_caller.is_current = true
      AND lower(pm_caller.role::text) IN ('officer', 'leader')
      AND pm_target.user_id = p_target_user_id
      AND pm_target.is_current = true
  )
$function$;

REVOKE ALL ON FUNCTION public._pm_caller_can_manage_player_meta(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._pm_caller_can_manage_player_meta(uuid)
  TO authenticated, service_role;

DROP POLICY IF EXISTS player_meta_roles_leader_write
  ON public.player_meta_roles;
CREATE POLICY player_meta_roles_leader_write
  ON public.player_meta_roles
  TO authenticated
  USING (
    source = 'leader_override'
    AND public._pm_caller_can_manage_player_meta(player_meta_roles.user_id)
  )
  WITH CHECK (
    source = 'leader_override'
    AND public._pm_caller_can_manage_player_meta(player_meta_roles.user_id)
  );

DROP FUNCTION IF EXISTS public.get_cluster_damage_rank(text, text, bigint);

CREATE OR REPLACE FUNCTION public.get_cluster_damage_rank(
  p_season text,
  p_cluster_code text,
  p_player_id text
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_rank integer;
BEGIN
  IF p_season IS NULL
     OR p_cluster_code IS NULL
     OR p_player_id IS NULL
     OR btrim(p_player_id) = '' THEN
    RETURN NULL;
  END IF;

  IF COALESCE(auth.role(), '') <> 'service_role'
     AND NOT public._pm_caller_is_app_admin() AND NOT EXISTS (
    SELECT 1
    FROM public.player_mapping AS pm
    JOIN public.guild_config AS gc_user
      ON gc_user.guild_code = pm.guild_code
    WHERE pm.user_id = auth.uid()
      AND pm.is_current = true
      AND gc_user.cluster_code = p_cluster_code
  ) THEN
    RETURN NULL;
  END IF;

  WITH player_totals AS (
    SELECT
      battle."userId" AS player_id,
      sum(battle."damageDealt") AS total_damage
    FROM public."EOT_GR_data" AS battle
    WHERE battle.cluster_code = p_cluster_code
      AND battle."Season" = p_season
      AND battle."damageType" = 'Battle'
      AND battle."userId" IS NOT NULL
    GROUP BY battle."userId"
  ),
  target_total AS (
    SELECT total_damage
    FROM player_totals
    WHERE player_id = p_player_id
  )
  SELECT CASE
    WHEN count(target_total.total_damage) = 0 THEN NULL
    ELSE count(*) FILTER (
      WHERE player_totals.total_damage > target_total.total_damage
    )::integer + 1
  END
  INTO v_rank
  FROM target_total
  CROSS JOIN player_totals;

  RETURN v_rank;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_cluster_damage_rank(text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_cluster_damage_rank(text, text, text)
  TO authenticated, service_role;

-- ban_duration does not revoke issued JWTs; the pre-request hook stops direct requests.
CREATE OR REPLACE FUNCTION public.enforce_request_user_ban()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL OR COALESCE(auth.role(), '') <> 'authenticated' THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.user_bans AS ban
    WHERE ban.lifted_at IS NULL
      AND (ban.expires_at IS NULL OR ban.expires_at > now())
      AND (
        ban.auth_user_id = v_user_id
        OR (
          ban.subject_type = 'user_id'
          AND ban.subject_value = lower(v_user_id::text)
        )
        OR (
          ban.subject_type = 'email'
          AND ban.subject_value = lower(COALESCE((
            SELECT auth_user.email
            FROM auth.users AS auth_user
            WHERE auth_user.id = v_user_id
          ), ''))
        )
        OR EXISTS (
          SELECT 1
          FROM public.player_mapping AS mapping
          WHERE mapping.user_id = v_user_id
            AND mapping.is_current = true
            AND (
              (
                ban.subject_type = 'player_id'
                AND ban.subject_value = lower(btrim(mapping.player_id))
              )
              OR (
                mapping.discord_user_id IS NOT NULL
                AND ban.subject_type = 'discord_user_id'
                AND ban.subject_value = lower(btrim(mapping.discord_user_id))
              )
            )
        )
        OR (
          ban.subject_type = 'discord_user_id'
          AND EXISTS (
            SELECT 1
            FROM auth.identities AS identity
            WHERE identity.user_id = v_user_id
              AND identity.provider = 'discord'
              AND ban.subject_value = lower(COALESCE(
                identity.identity_data ->> 'provider_id',
                identity.identity_data ->> 'sub',
                identity.identity_data ->> 'id',
                ''
              ))
          )
        )
      )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Account suspended';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_request_user_ban()
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enforce_request_user_ban()
  TO anon, authenticated, service_role;

ALTER ROLE authenticator
  SET pgrst.db_pre_request TO 'public.enforce_request_user_ban';
NOTIFY pgrst, 'reload config';

COMMIT;
