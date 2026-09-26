-- Server-side member-stats aggregate; the client version truncated at 1,000 rows.
-- target-db: general
-- SECURITY INVOKER keeps EOT_GR_data RLS authoritative; the caller resolves via
-- _pm_caller_mapping_rows() (sensitive columns raise 42501). Gate: one current mapping,
-- known role, then same guild, app admin or same cluster; service_role skips it.

BEGIN;

DO $guard$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION
      'This migration targets the General database only; refusing to run on %',
      current_database();
  END IF;
END;
$guard$;

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.get_guild_member_stats(
  p_guild_code text,
  p_season text DEFAULT NULL
)
RETURNS TABLE(
  display_name text,
  guild_code text,
  role text,
  player_id text,
  is_current boolean,
  theme_preference text,
  primary_boss text,
  secondary_boss text,
  last_profile_update timestamptz,
  total_damage bigint,
  battle_count integer,
  bomb_count integer,
  tokens_used integer,
  average_damage double precision,
  max_damage bigint,
  last_active timestamptz,
  token_status text,
  legendary_battles integer,
  unique_bosses_fought integer,
  battles_last_7_days integer,
  token_offender_threshold integer,
  token_abuser_threshold integer,
  config_guild_code text
)
LANGUAGE plpgsql
STABLE
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
  v_season text := p_season;
  v_offender integer;
  v_abuser integer;
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
      SELECT gc.cluster_id INTO v_caller_cluster
        FROM public.guild_config AS gc WHERE gc.guild_code = v_guild LIMIT 1;
      SELECT gc.cluster_id INTO v_target_cluster
        FROM public.guild_config AS gc WHERE gc.guild_code = p_guild_code LIMIT 1;

      IF v_caller_cluster IS NULL
         OR v_target_cluster IS NULL
         OR v_caller_cluster <> v_target_cluster THEN
        RETURN;
      END IF;
    END IF;
  END IF;

  -- Same season resolution the hook used: newest season seen in the last 30
  -- days. Kept server-side so the client stops making a separate round trip.
  IF v_season IS NULL THEN
    SELECT d."Season" INTO v_season
      FROM public."EOT_GR_data" AS d
     WHERE d."timestamp" > now() - interval '30 days'
     ORDER BY d."timestamp" DESC
     LIMIT 1;
    v_season := COALESCE(v_season, 'Season 13');
  END IF;

  SELECT gc.token_offender_threshold, gc.token_abuser_threshold
    INTO v_offender, v_abuser
    FROM public.guild_config AS gc
   WHERE gc.guild_code = p_guild_code
   LIMIT 1;

  -- Defaults match the hook's `|| 40` / `|| 50` fallbacks.
  v_offender := COALESCE(v_offender, 40);
  v_abuser := COALESCE(v_abuser, 50);

  RETURN QUERY
  WITH roster AS (
    SELECT pm.player_id,
           pm.display_name,
           pm.guild_code,
           lower(trim(pm.role::text)) AS role,
           pm.is_current,
           pm.primary_boss,
           pm.secondary_boss,
           pm.updated_at
      FROM public.player_mapping AS pm
     WHERE pm.guild_code = p_guild_code
       AND pm.is_current IS TRUE
       AND pm.player_id IS NOT NULL
  ),
  battles AS (
    SELECT d."userId" AS player_id,
           sum(COALESCE(d."damageDealt", 0))::bigint AS total_damage,
           count(*) FILTER (WHERE d."damageType" = 'Battle')::integer AS battle_count,
           count(*) FILTER (WHERE d."damageType" = 'Bomb')::integer AS bomb_count,
           max(COALESCE(d."damageDealt", 0))::bigint AS max_damage,
           count(*) FILTER (WHERE d.rarity IN ('Legendary', 'Mythic'))::integer AS legendary_battles,
           count(DISTINCT d."Name") FILTER (WHERE d."Name" IS NOT NULL)::integer AS unique_bosses_fought,
           count(*) FILTER (WHERE d."timestamp" > now() - interval '7 days')::integer AS battles_last_7_days,
           max(d."timestamp") AS last_battle_at
      FROM public."EOT_GR_data" AS d
     WHERE d."Guild" = p_guild_code
       AND d."Season" = v_season
       AND d."userId" IS NOT NULL
     GROUP BY d."userId"
  )
  SELECT r.display_name,
         COALESCE(r.guild_code, p_guild_code),
         r.role,
         r.player_id,
         COALESCE(r.is_current, true),
         -- A peer's private UI preference is not part of guild statistics.
         NULL::text,
         r.primary_boss,
         r.secondary_boss,
         r.updated_at,
         COALESCE(b.total_damage, 0)::bigint,
         COALESCE(b.battle_count, 0),
         COALESCE(b.bomb_count, 0),
         -- tokens_used tracks battle rows, matching the hook's counter.
         COALESCE(b.battle_count, 0),
         -- double precision, not numeric: PostgREST serialization of numeric
         -- is not reliably a JSON number, and the client contract is `number`.
         CASE WHEN COALESCE(b.battle_count, 0) > 0
              THEN (b.total_damage::double precision / b.battle_count::double precision)
              ELSE 0::double precision END,
         COALESCE(b.max_damage, 0)::bigint,
         GREATEST(r.updated_at, b.last_battle_at),
         CASE
           WHEN COALESCE(b.battle_count, 0) > v_abuser THEN 'abuser'
           WHEN COALESCE(b.battle_count, 0) > v_offender THEN 'offender'
           ELSE 'normal'
         END,
         COALESCE(b.legendary_battles, 0),
         COALESCE(b.unique_bosses_fought, 0),
         COALESCE(b.battles_last_7_days, 0),
         v_offender,
         v_abuser,
         p_guild_code
    FROM roster AS r
    LEFT JOIN battles AS b ON b.player_id = r.player_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_guild_member_stats(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_guild_member_stats(text, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_guild_member_stats(text, text) IS
  'Per-member guild raid aggregate for one guild-season. Replaces a client-side reduction over up to 1,000 raw EOT_GR_data rows: no row cap, no raw battle rows leave the database. SECURITY INVOKER so EOT_GR_data RLS stays authoritative; caller gated to own guild, own cluster, or app admin.';

COMMIT;
