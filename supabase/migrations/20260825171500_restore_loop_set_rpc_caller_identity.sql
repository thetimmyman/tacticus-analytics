-- Resolve the caller via the definer projection (restricted columns raise 42501); stays
-- SECURITY INVOKER so EOT_GR_data RLS remains authoritative.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_token_usage_by_loop_and_set(
  p_guild_code text,
  p_season text,
  p_rarities text[] DEFAULT ARRAY['Legendary'::text, 'Mythic'::text]
) RETURNS TABLE(loop_index integer, set_key text, token_count integer)
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_count integer := 0;
  v_guild text;
  v_admin boolean := false;
  v_role text;
  v_caller_cluster uuid;
  v_target_cluster uuid;
BEGIN
  IF COALESCE(
       NULLIF(NULLIF(current_setting('role', true), ''), 'none'),
       NULLIF(session_user, '')
     ) = 'service_role' THEN
    NULL;
  ELSE
    IF v_uid IS NULL THEN
      RETURN;
    END IF;

    SELECT count(*)::integer,
           max(NULLIF(trim(pm.guild_code), '')),
           max(lower(trim(pm.role::text))),
           bool_or(pm.is_app_admin IS TRUE)
      INTO v_count, v_guild, v_role, v_admin
      FROM public._pm_caller_mapping_rows() AS pm
     WHERE pm.is_current IS TRUE;

    IF v_count <> 1
       OR v_guild IS NULL
       OR v_role NOT IN ('member', 'officer', 'leader') THEN
      RETURN;
    END IF;

    IF v_admin OR p_guild_code = v_guild THEN
      NULL;
    ELSE
      SELECT gc.cluster_id
        INTO v_caller_cluster
        FROM public.guild_config AS gc
       WHERE gc.guild_code = v_guild
       LIMIT 1;

      SELECT gc.cluster_id
        INTO v_target_cluster
        FROM public.guild_config AS gc
       WHERE gc.guild_code = p_guild_code
       LIMIT 1;

      IF v_caller_cluster IS NULL
         OR v_target_cluster IS NULL
         OR v_caller_cluster <> v_target_cluster THEN
        RETURN;
      END IF;
    END IF;
  END IF;

  RETURN QUERY
  SELECT d."loopIndex"::integer,
         CASE
           WHEN d.rarity = 'Mythic'
             THEN 'M' || (coalesce(d.set, 0) + 1)::text
           ELSE 'L' || (coalesce(d.set, 0) + 1)::text
         END,
         count(*)::integer
    FROM public."EOT_GR_data" AS d
   WHERE d."Guild" = p_guild_code
     AND d."Season" = p_season
     AND d."damageType" = 'Battle'
     AND d.rarity = ANY(p_rarities)
     AND d."loopIndex" IS NOT NULL
   GROUP BY d."loopIndex",
            CASE
              WHEN d.rarity = 'Mythic'
                THEN 'M' || (coalesce(d.set, 0) + 1)::text
              ELSE 'L' || (coalesce(d.set, 0) + 1)::text
            END
   ORDER BY d."loopIndex", set_key;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_token_usage_by_loop_and_set(text, text, text[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_token_usage_by_loop_and_set(text, text, text[])
  TO authenticated, service_role;

COMMIT;
