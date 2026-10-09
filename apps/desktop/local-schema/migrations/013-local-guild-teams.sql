-- Add the source-pinned canonical team-roster projection and scoped local reader.
CREATE FUNCTION public.get_guild_team_roster(p_guild_code text, p_unit_ids text[]) RETURNS TABLE(player_display_name text, guild_role text, unit_id text, hero_display_name text, category text, web_icon_url text, stars integer, progression_index integer, rarity text, rank_name text, xp_level integer, active_ability_level integer, passive_ability_level integer, synced_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_effective_role text := COALESCE(
    NULLIF(
      NULLIF(pg_catalog.current_setting('role', true), ''),
      'none'
    ),
    NULLIF(session_user, '')
  );
  v_uid uuid;
  v_mapping_count integer := 0;
  v_mapping record;
  v_caller_guild_code text;
  v_caller_role text;
  v_caller_is_app_admin boolean := false;
  v_caller_config_count integer := 0;
  v_caller_config record;
  v_caller_cluster_id uuid;
  v_target_config_count integer := 0;
  v_target_config record;
  v_target_cluster_id uuid;
  v_self_only boolean := false;
BEGIN
  -- Malformed or unscoped requests never enter the private roster query.
  IF p_guild_code IS NULL
     OR p_unit_ids IS NULL
     OR pg_catalog.cardinality(p_unit_ids) = 0 THEN
    RETURN;
  END IF;

  -- A target must resolve to exactly one server-owned guild_config row.
  BEGIN
    FOR v_target_config IN
      SELECT gc.cluster_id
      FROM public.guild_config AS gc
      WHERE gc.guild_code = p_guild_code
    LOOP
      v_target_config_count := v_target_config_count + 1;
      IF v_target_config_count > 1 THEN
        RETURN;
      END IF;
      v_target_cluster_id := v_target_config.cluster_id;
    END LOOP;
  EXCEPTION
    WHEN OTHERS THEN
      RETURN;
  END;

  IF v_target_config_count <> 1 THEN
    RETURN;
  END IF;

  IF v_effective_role <> 'service_role' THEN
    -- auth.uid() and membership lookup errors fail closed before roster reads.
    BEGIN
      v_uid := auth.uid();
      IF v_uid IS NULL THEN
        RETURN;
      END IF;

      FOR v_mapping IN
        SELECT
          pm.guild_code,
          pg_catalog.lower(pg_catalog.btrim(pm.role::text)) AS normalized_role,
          COALESCE(pm.is_app_admin, false) AS is_app_admin
        FROM public.player_mapping AS pm
        WHERE pm.user_id = v_uid
          AND pm.is_current IS TRUE
      LOOP
        v_mapping_count := v_mapping_count + 1;
        IF v_mapping_count > 1 THEN
          RETURN;
        END IF;
        v_caller_guild_code := v_mapping.guild_code;
        v_caller_role := v_mapping.normalized_role;
        v_caller_is_app_admin := v_mapping.is_app_admin;
      END LOOP;
    EXCEPTION
      WHEN OTHERS THEN
        RETURN;
    END;

    IF v_mapping_count <> 1
       OR v_caller_guild_code IS NULL
       OR v_caller_role IS NULL
       OR v_caller_role NOT IN ('member', 'officer', 'leader') THEN
      RETURN;
    END IF;

    IF v_caller_is_app_admin THEN
      -- Current app-admins retain the full requested-guild projection.
      NULL;
    ELSIF v_caller_role = 'member' THEN
      -- Ordinary members may see only their own row in their own guild.
      IF p_guild_code IS DISTINCT FROM v_caller_guild_code THEN
        RETURN;
      END IF;
      v_self_only := true;
    ELSIF p_guild_code IS DISTINCT FROM v_caller_guild_code THEN
      -- Officer/leader foreign-guild access requires an exact, non-null,
      -- server-derived cluster match for the current and target guilds.
      BEGIN
        FOR v_caller_config IN
          SELECT gc.cluster_id
          FROM public.guild_config AS gc
          WHERE gc.guild_code = v_caller_guild_code
        LOOP
          v_caller_config_count := v_caller_config_count + 1;
          IF v_caller_config_count > 1 THEN
            RETURN;
          END IF;
          v_caller_cluster_id := v_caller_config.cluster_id;
        END LOOP;
      EXCEPTION
        WHEN OTHERS THEN
          RETURN;
      END;

      IF v_caller_config_count <> 1
         OR v_caller_cluster_id IS NULL
         OR v_target_cluster_id IS NULL
         OR v_caller_cluster_id IS DISTINCT FROM v_target_cluster_id THEN
        RETURN;
      END IF;
    END IF;
  END IF;

  RETURN QUERY
    SELECT
      pm.display_name,
      pm.role::text,
      hm.unit_id,
      hm.display_name,
      hm.category,
      hm.web_icon_url,
      pr.stars,
      pr.progression_index,
      pr.rarity,
      pr.rank_name,
      pr.xp_level,
      pr.active_ability_level,
      pr.passive_ability_level,
      pr.synced_at
    FROM public.player_mapping AS pm
    CROSS JOIN public.hero_mappings AS hm
    LEFT JOIN LATERAL (
      SELECT
        r.stars,
        r.progression_index,
        r.rarity,
        r.rank_name,
        r.xp_level,
        r.active_ability_level,
        r.passive_ability_level,
        r.synced_at
      FROM public.player_roster AS r
      WHERE r.hero_mapping_id = hm.id
        AND (
          r.player_mapping_id = pm.id
          OR (
            r.player_mapping_id IS NULL
            AND pm.user_id IS NOT NULL
            AND r.user_id = pm.user_id
          )
        )
      ORDER BY
        r.synced_at DESC NULLS LAST,
        ((r.player_mapping_id = pm.id) IS TRUE) DESC
      LIMIT 1
    ) AS pr ON true
    WHERE pm.guild_code = p_guild_code
      AND pm.is_current IS TRUE
      AND hm.unit_id = ANY(p_unit_ids)
      AND (NOT v_self_only OR pm.user_id = v_uid)
    ORDER BY pm.display_name, hm.display_name;
END;
$$;

-- The canonical team projection keeps its own non-login, non-bypass reader.
-- Only the RPC can use this role; its member branch remains self-only.
CREATE ROLE desktop_team_reader NOLOGIN NOSUPERUSER NOBYPASSRLS;
GRANT USAGE ON SCHEMA public,auth TO desktop_team_reader;
GRANT EXECUTE ON FUNCTION auth.uid(),public._pm_caller_guild_codes(),public._pm_caller_cluster_guild_codes(),public._pm_caller_is_app_admin() TO desktop_team_reader;
GRANT SELECT ON public.player_mapping,public.guild_config,public.hero_mappings,public.player_roster TO desktop_team_reader;
CREATE POLICY desktop_team_mapping ON public.player_mapping FOR SELECT TO desktop_team_reader USING (
 user_id=auth.uid() OR guild_code IN (SELECT public._pm_caller_guild_codes()) OR guild_code IN (SELECT public._pm_caller_cluster_guild_codes())
);
CREATE POLICY desktop_team_guild ON public.guild_config FOR SELECT TO desktop_team_reader USING (
 guild_code IN (SELECT public._pm_caller_guild_codes()) OR guild_code IN (SELECT public._pm_caller_cluster_guild_codes())
);
CREATE POLICY desktop_team_catalog ON public.hero_mappings FOR SELECT TO desktop_team_reader USING (true);
CREATE POLICY desktop_team_roster ON public.player_roster FOR SELECT TO desktop_team_reader USING (
 EXISTS (SELECT 1 FROM public.player_mapping pm WHERE pm.is_current AND
   (pm.id=player_roster.player_mapping_id OR (player_roster.player_mapping_id IS NULL AND pm.user_id=player_roster.user_id)) AND
   (pm.guild_code IN (SELECT public._pm_caller_guild_codes()) OR pm.guild_code IN (SELECT public._pm_caller_cluster_guild_codes())))
);
ALTER FUNCTION public.get_guild_team_roster(text,text[]) OWNER TO desktop_team_reader;
REVOKE ALL ON FUNCTION public.get_guild_team_roster(text,text[]) FROM PUBLIC,anon,authenticated,service_role,desktop_rpc_reader;
GRANT EXECUTE ON FUNCTION public.get_guild_team_roster(text,text[]) TO authenticated;

-- Add canonical cached-token and season-scoped target closure.


CREATE TABLE public.season_calendar (
    season_id integer NOT NULL,
    season_label text,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    tokens_per_player_cap integer DEFAULT 28 NOT NULL,
    regen_interval_hours integer DEFAULT 12 NOT NULL,
    regen_tokens_per_interval integer DEFAULT 1 NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE FUNCTION public.calculate_player_tokens_by_user(p_user_id text, p_guild_code text, p_season text DEFAULT NULL::text) RETURNS TABLE(player_user_id text, guild_code text, tokens_available integer, battles_today integer, last_battle_time timestamp with time zone, time_until_next_token interval, is_capped boolean)
    LANGUAGE plpgsql
    AS $_$
DECLARE
    v_season TEXT;
    v_battle_count INT;
    v_max_tokens INT := 3;
    v_initial_tokens INT := 2;
    v_twelve_hours_secs BIGINT := 12 * 60 * 60;
    v_now_secs BIGINT;
    v_token_count INT;
    v_refresh_time BIGINT;
    v_anchor_ts BIGINT := NULL;
    v_n_recharged INT;
    v_time_since_refresh BIGINT;
    v_time_until_next INTERVAL := NULL;
    v_last_battle TIMESTAMPTZ;
    v_battle RECORD;
    v_battle_ts BIGINT;
    v_prev_count INT;
BEGIN
    v_now_secs := EXTRACT(EPOCH FROM NOW())::BIGINT;

    IF p_season IS NULL THEN
        SELECT MAX(season_num)::text INTO v_season
        FROM "EOT_GR_data"
        WHERE "Guild" = p_guild_code;
    ELSE
        v_season := p_season;
    END IF;

    SELECT COUNT(DISTINCT "startedOn")
    INTO v_battle_count
    FROM "EOT_GR_data"
    WHERE "userId" = p_user_id
    AND "Guild" = p_guild_code
    AND "Season" = v_season
    AND "damageType" = 'Battle';

    IF v_season ~ '^\d+$' THEN
        SELECT EXTRACT(EPOCH FROM sc.starts_at)::BIGINT INTO v_anchor_ts
        FROM public.season_calendar sc
        WHERE sc.season_id = (v_season::INT - 1);

        IF v_anchor_ts IS NULL THEN
            SELECT EXTRACT(EPOCH FROM sc.starts_at)::BIGINT INTO v_anchor_ts
            FROM public.season_calendar sc
            WHERE sc.season_id = v_season::INT;
        END IF;

        IF v_anchor_ts IS NOT NULL AND v_anchor_ts > v_now_secs THEN
            v_anchor_ts := NULL;
        END IF;
    END IF;

    v_token_count := v_initial_tokens;
    v_refresh_time := NULL;

    FOR v_battle IN
        SELECT DISTINCT "startedOn"::TIMESTAMPTZ as battle_time
        FROM "EOT_GR_data"
        WHERE "userId" = p_user_id
        AND "Guild" = p_guild_code
        AND "damageType" = 'Battle'
        AND "startedOn" IS NOT NULL
        AND "Season" IN (v_season, (v_season::INT - 1)::TEXT)
        ORDER BY "startedOn"::TIMESTAMPTZ ASC
    LOOP
        v_battle_ts := EXTRACT(EPOCH FROM v_battle.battle_time)::BIGINT;
        v_last_battle := v_battle.battle_time;

        IF v_refresh_time IS NULL THEN
            v_refresh_time := LEAST(COALESCE(v_anchor_ts, v_battle_ts), v_battle_ts);
        END IF;

        IF v_token_count < v_max_tokens THEN
            v_n_recharged := FLOOR((v_battle_ts - v_refresh_time)::NUMERIC / v_twelve_hours_secs);

            IF v_n_recharged + v_token_count >= v_max_tokens THEN
                v_token_count := v_max_tokens;
                v_refresh_time := v_battle_ts;
            ELSE
                v_token_count := v_token_count + v_n_recharged;
                v_refresh_time := v_refresh_time + (v_n_recharged * v_twelve_hours_secs);
            END IF;
        END IF;

        v_prev_count := v_token_count;
        v_token_count := v_token_count - 1;

        IF v_prev_count = v_max_tokens THEN
            v_refresh_time := v_battle_ts;
        END IF;

        IF v_token_count <= 0 THEN
            v_token_count := 0;
        END IF;
    END LOOP;

    IF v_refresh_time IS NULL AND v_anchor_ts IS NOT NULL THEN
        v_refresh_time := v_anchor_ts;
    END IF;

    IF v_token_count < v_max_tokens AND v_refresh_time IS NOT NULL THEN
        v_n_recharged := FLOOR((v_now_secs - v_refresh_time)::NUMERIC / v_twelve_hours_secs);

        IF v_n_recharged + v_token_count >= v_max_tokens THEN
            v_token_count := v_max_tokens;
            v_refresh_time := v_now_secs;
        ELSE
            v_token_count := v_token_count + v_n_recharged;
            v_refresh_time := v_refresh_time + (v_n_recharged * v_twelve_hours_secs);
        END IF;
    END IF;

    IF v_token_count < v_max_tokens AND v_refresh_time IS NOT NULL THEN
        v_time_since_refresh := v_now_secs - v_refresh_time;
        v_time_until_next := make_interval(secs => (v_twelve_hours_secs - (v_time_since_refresh % v_twelve_hours_secs)));
    END IF;

    v_token_count := LEAST(v_max_tokens, GREATEST(0, v_token_count));

    RETURN QUERY
    SELECT
        p_user_id,
        p_guild_code,
        v_token_count,
        v_battle_count,
        v_last_battle,
        v_time_until_next,
        v_token_count = v_max_tokens;
END;
$_$;

CREATE FUNCTION public.project_token_snapshot(p_count integer, p_next_seconds integer, p_snapshot_at timestamp with time zone, p_spends timestamp with time zone[], p_now timestamp with time zone, p_cap integer, p_regen_secs bigint) RETURNS TABLE(available integer, next_in_seconds integer)
    LANGUAGE plpgsql STABLE
    AS $$
DECLARE
  pts_now_secs bigint;
  pts_snap_secs bigint;
  pts_count int;
  pts_refresh bigint;      -- NULL while paused at cap with no spend yet
  pts_spend_ts timestamptz;
  pts_spend_secs bigint;
  pts_recharged int;
  pts_prev_count int;
  pts_elapsed bigint;
BEGIN
  IF p_count IS NULL OR p_snapshot_at IS NULL OR p_now IS NULL
     OR p_cap IS NULL OR p_cap <= 0
     OR p_regen_secs IS NULL OR p_regen_secs <= 0 THEN
    available := NULL;
    next_in_seconds := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  pts_now_secs := EXTRACT(EPOCH FROM p_now)::bigint;
  pts_snap_secs := EXTRACT(EPOCH FROM p_snapshot_at)::bigint;
  pts_count := LEAST(p_cap, GREATEST(0, p_count));

  IF pts_count >= p_cap THEN
    pts_refresh := NULL;
  ELSIF p_next_seconds IS NULL OR p_next_seconds <= 0 THEN
    pts_refresh := pts_snap_secs;
  ELSE
    pts_refresh := pts_snap_secs + p_next_seconds - p_regen_secs;
  END IF;

  FOR pts_spend_ts IN
    SELECT u.spend_ts
    FROM unnest(p_spends) AS u(spend_ts)
    WHERE u.spend_ts IS NOT NULL
      AND u.spend_ts > p_snapshot_at
    ORDER BY u.spend_ts ASC
  LOOP
    pts_spend_secs := EXTRACT(EPOCH FROM pts_spend_ts)::bigint;

    IF pts_count < p_cap THEN
      pts_recharged := GREATEST(
        0,
        FLOOR((pts_spend_secs - pts_refresh)::numeric / p_regen_secs)
      )::int;

      IF pts_recharged + pts_count >= p_cap THEN
        pts_count := p_cap;
        pts_refresh := pts_spend_secs;
      ELSE
        pts_count := pts_count + pts_recharged;
        pts_refresh := pts_refresh + (pts_recharged::bigint * p_regen_secs);
      END IF;
    END IF;

    pts_prev_count := pts_count;
    pts_count := GREATEST(0, pts_count - 1);
    IF pts_prev_count = p_cap THEN
      pts_refresh := pts_spend_secs;
    END IF;
  END LOOP;

  IF pts_count < p_cap AND pts_refresh IS NOT NULL THEN
    pts_recharged := GREATEST(
      0,
      FLOOR((pts_now_secs - pts_refresh)::numeric / p_regen_secs)
    )::int;

    IF pts_recharged + pts_count >= p_cap THEN
      pts_count := p_cap;
      pts_refresh := pts_now_secs;
    ELSE
      pts_count := pts_count + pts_recharged;
      pts_refresh := pts_refresh + (pts_recharged::bigint * p_regen_secs);
    END IF;
  END IF;

  available := LEAST(p_cap, GREATEST(0, pts_count));

  IF available >= p_cap OR pts_refresh IS NULL THEN
    next_in_seconds := NULL;
  ELSE
    pts_elapsed := GREATEST(0, pts_now_secs - pts_refresh);
    next_in_seconds := (p_regen_secs - (pts_elapsed % p_regen_secs))::int;
  END IF;

  RETURN NEXT;
END;
$$;

CREATE FUNCTION public.get_player_token_state(p_guild_code text, p_season text DEFAULT NULL::text, p_cluster_code text DEFAULT NULL::text, p_player_id text DEFAULT NULL::text) RETURNS TABLE(player_id text, display_name text, discord_user_id text, tokens_available integer, is_capped boolean, time_to_next_token interval, data_source text, token_next_in_seconds integer, last_sync_at timestamp with time zone, tokens_used integer, max_possible integer, burned_tokens integer, time_over_cap_seconds integer, last_battle_time timestamp with time zone, bombs_available integer, bomb_next_in_seconds integer, post_snapshot_spends integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'auth'
    AS $_$
declare
  v_season text;
  v_is_service boolean := COALESCE(
    NULLIF(NULLIF(current_setting('role', true), ''), 'none'),
    NULLIF(session_user, '')
  ) = 'service_role';
  v_requester_id uuid := auth.uid();
  v_requester_role text := null;
  v_requester_guild text := null;
  v_requester_cluster text := null;
  v_target_cluster text := null;
begin
  if not v_is_service then
    if v_requester_id is null then
      return;
    end if;

    select pm.guild_code, pm.cluster_code, pm.role
      into v_requester_guild, v_requester_cluster, v_requester_role
    from public.player_with_cluster pm
    where pm.user_id = v_requester_id
      and pm.is_current = true
    limit 1;

    select gc.cluster_code::text
      into v_target_cluster
    from public.guild_config gc
    where gc.guild_code = p_guild_code
    limit 1;

    if v_requester_guild is distinct from p_guild_code then
      if v_requester_role not in ('officer', 'admin') then
        return;
      end if;
      if v_target_cluster is null or v_requester_cluster is distinct from v_target_cluster then
        return;
      end if;
    end if;
  end if;

  if p_season is null or trim(p_season) = '' then
    select max(d.season_num)::text into v_season
    from "EOT_GR_data" d
    where d."Guild" = p_guild_code
      and (p_cluster_code is null or d.cluster_code = p_cluster_code);
  else
    v_season := trim(p_season);
  end if;

  if v_season is null then
    return;
  end if;

  return query
  with members as (
    select
      pm.player_id,
      pm.display_name,
      pm.discord_user_id::text as discord_user_id,
      pm.last_sync_tokens,
      pm.next_token_seconds,
      pm.last_sync_at::timestamptz as last_sync_at,
      pm.api_key_is_valid,
      pm.tacticus_api_key_encrypted,
      pm.last_sync_bombs,
      pm.next_bomb_seconds
    from public.player_mapping pm
    where pm.guild_code = p_guild_code
      and pm.is_current = true
      and (p_player_id is null or pm.player_id = p_player_id)
  ),
  recent_spend as (
    select
      m2.player_id,
      count(distinct d."startedOn") filter (where d."damageType" = 'Battle')::int as battles_after_sync,
      count(distinct d."startedOn") filter (where d."damageType" = 'Bomb')::int as bombs_after_sync,
      array_agg(distinct d."startedOn"::timestamptz)
        filter (where d."damageType" = 'Battle') as battle_spends,
      array_agg(distinct d."startedOn"::timestamptz)
        filter (where d."damageType" = 'Bomb') as bomb_spends
    from members m2
    join public."EOT_GR_data" d
      on d."userId" = m2.player_id
      and d."Guild" = p_guild_code
      and (
        d."Season" = v_season
        or (v_season ~ '^\d+$' and d."Season" = (v_season::int - 1)::text)
      )
      and d."damageType" in ('Battle', 'Bomb')
      and (p_cluster_code is null or d.cluster_code = p_cluster_code)
    where m2.last_sync_at is not null
      and d."startedOn"::timestamptz > m2.last_sync_at
    group by m2.player_id
  ),
  battle_rows as (
    select
      d."userId" as player_id,
      d."damageType" as damage_type,
      d."damageDealt" as damage_dealt,
      d."startedOn"::timestamptz as started_on
    from public."EOT_GR_data" d
    where d."Guild" = p_guild_code
      and d."Season" = v_season
      and d."damageType" in ('Battle', 'Bomb')
      and d."userId" is not null
      and (p_cluster_code is null or d.cluster_code = p_cluster_code)
  ),
  current_season_totals as (
    select
      b.player_id,
      count(*) filter (
        where b.damage_type = 'Battle'
      )::int as tokens_used,
      max(b.started_on) filter (where b.damage_type = 'Battle') as last_battle_time
    from battle_rows b
    group by b.player_id
  ),
  max_tokens as (
    select coalesce(max(c.tokens_used), 0)::int as max_possible
    from current_season_totals c
  ),
  calculated as (
    select
      m.player_id,
      calc.tokens_available as calc_tokens_available,
      calc.is_capped as calc_is_capped,
      calc.time_until_next_token as calc_time_until_next_token,
      calc.last_battle_time as calc_last_battle_time
    from members m
    left join lateral (
      select *
      from public.calculate_player_tokens_by_user(m.player_id, p_guild_code, v_season)
      limit 1
    ) calc on true
  ),
  burn_state as (
    select
      m.player_id,
      cb.burned_tokens,
      cb.time_over_cap_seconds
    from members m
    cross join lateral public.compute_player_token_burn(
      p_guild_code := p_guild_code,
      p_season := v_season,
      p_player_id := m.player_id
    ) cb
  ),
  bomb_calc as (
    select
      b.player_id,
      max(b.started_on) as last_bomb_time,
      case
        when max(b.started_on) is not null
          and extract(epoch from (now() - max(b.started_on))) < 64800
        then 0
        else 1
      end as calc_bombs_available,
      case
        when max(b.started_on) is not null
          and extract(epoch from (now() - max(b.started_on))) < 64800
        then floor(64800 - extract(epoch from (now() - max(b.started_on))))::int
        else null
      end as calc_bomb_next_seconds
    from battle_rows b
    where b.damage_type = 'Bomb'
    group by b.player_id
  )
  select
    m.player_id,
    m.display_name,
    m.discord_user_id,
    case
      when live_source.token_spent then tok_spend_proj.spent_tokens
      when live_source.token_pure then tok_proj.proj_tokens
      else coalesce(c.calc_tokens_available, 3)
    end as tokens_available,
    case
      when live_source.token_spent then tok_spend_proj.spent_tokens >= 3
      when live_source.token_pure then tok_proj.proj_tokens >= 3
      else coalesce(c.calc_is_capped, coalesce(c.calc_tokens_available, 3) >= 3)
    end as is_capped,
    case
      when live_source.token_spent then
        case
          when tok_spend_proj.spent_next_seconds is null then null::interval
          else make_interval(secs => tok_spend_proj.spent_next_seconds)
        end
      when live_source.token_pure then
        case
          when tok_proj.proj_next_seconds is null then null::interval
          else make_interval(secs => tok_proj.proj_next_seconds)
        end
      else
        case
          when coalesce(c.calc_tokens_available, 3) >= 3 then null::interval
          else c.calc_time_until_next_token
        end
    end as time_to_next_token,
    case
      when live_source.token_live then 'live'::text
      else 'calculated'::text
    end as data_source,
    case
      when live_source.token_spent then tok_spend_proj.spent_next_seconds
      when live_source.token_pure then tok_proj.proj_next_seconds
      else floor(extract(epoch from c.calc_time_until_next_token))::int
    end as token_next_in_seconds,
    m.last_sync_at,
    coalesce(t.tokens_used, 0) as tokens_used,
    coalesce(mt.max_possible, 0) as max_possible,
    coalesce(bs.burned_tokens, 0) as burned_tokens,
    coalesce(bs.time_over_cap_seconds, 0) as time_over_cap_seconds,
    coalesce(t.last_battle_time, c.calc_last_battle_time) as last_battle_time,
    case
      when live_source.bomb_spent and bomb_spend_proj.spent_bombs is not null
        then bomb_spend_proj.spent_bombs
      when live_source.bomb_pure and bomb_proj.proj_bombs is not null
        then bomb_proj.proj_bombs
      else coalesce(bc.calc_bombs_available, 1)
    end as bombs_available,
    case
      when live_source.bomb_spent and bomb_spend_proj.spent_bombs is not null
        then bomb_spend_proj.spent_bomb_next
      when live_source.bomb_pure and bomb_proj.proj_bombs is not null
        then bomb_proj.proj_bomb_next
      else bc.calc_bomb_next_seconds
    end as bomb_next_in_seconds,
    case
      when live_source.token_live then coalesce(rs.battles_after_sync, 0)
      else null::int
    end as post_snapshot_spends
  from members m
  left join calculated c
    on c.player_id = m.player_id
  left join current_season_totals t
    on t.player_id = m.player_id
  cross join max_tokens mt
  left join burn_state bs
    on bs.player_id = m.player_id
  left join bomb_calc bc
    on bc.player_id = m.player_id
  left join recent_spend rs
    on rs.player_id = m.player_id
  cross join lateral (
    select
      base_live.ok as base_live,
      base_live.ok as token_live,
      (base_live.ok and coalesce(rs.battles_after_sync, 0) = 0) as token_pure,
      (base_live.ok and coalesce(rs.battles_after_sync, 0) > 0) as token_spent,
      (base_live.ok and coalesce(rs.bombs_after_sync, 0) = 0) as bomb_pure,
      (base_live.ok and coalesce(rs.bombs_after_sync, 0) > 0) as bomb_spent
    from (
      select (
        m.tacticus_api_key_encrypted is not null
        and coalesce(m.api_key_is_valid, false)
        and m.last_sync_tokens is not null
        and m.last_sync_at is not null
      ) as ok
    ) base_live
  ) live_source
  cross join lateral (
    select
      case
        when live_source.base_live
          then greatest(0::numeric, floor(extract(epoch from (now() - m.last_sync_at))))
        else null::numeric
      end as elapsed_secs,
      greatest(0, least(3, coalesce(m.last_sync_tokens, 3))) as synced_tokens
  ) sync_snap
  cross join lateral (
    select
      case
        when not live_source.token_pure then null::int
        when sync_snap.synced_tokens >= 3 then 3
        when coalesce(m.next_token_seconds, 0) <= 0 then sync_snap.synced_tokens
        when sync_snap.elapsed_secs < m.next_token_seconds then sync_snap.synced_tokens
        else least(
          3,
          sync_snap.synced_tokens + 1 + floor(
            (sync_snap.elapsed_secs - m.next_token_seconds) / 43200.0
          )::int
        )
      end as proj_tokens,
      case
        when not live_source.token_pure then null::int
        when sync_snap.synced_tokens >= 3 then null::int
        when coalesce(m.next_token_seconds, 0) <= 0 then null::int
        when sync_snap.elapsed_secs < m.next_token_seconds
          then (m.next_token_seconds - sync_snap.elapsed_secs)::int
        else (43200 - ((sync_snap.elapsed_secs - m.next_token_seconds)::bigint % 43200))::int
      end as proj_next_raw
  ) tok_proj0
  cross join lateral (
    select
      tok_proj0.proj_tokens,
      case
        when tok_proj0.proj_tokens is null then null::int
        when tok_proj0.proj_tokens >= 3 then null::int
        else tok_proj0.proj_next_raw
      end as proj_next_seconds
  ) tok_proj
  cross join lateral (
    select
      tsp.available as spent_tokens,
      tsp.next_in_seconds as spent_next_seconds
    from public.project_token_snapshot(
      case when live_source.token_spent then m.last_sync_tokens else null::int end,
      m.next_token_seconds,
      m.last_sync_at,
      coalesce(rs.battle_spends, array[]::timestamptz[]),
      now(),
      3,
      43200
    ) tsp
  ) tok_spend_proj
  cross join lateral (
    select
      case
        when not live_source.bomb_pure or m.next_bomb_seconds is null then null::int
        when sync_snap.elapsed_secs >= m.next_bomb_seconds
          then greatest(1, coalesce(m.last_sync_bombs, 0))
        else greatest(0, coalesce(m.last_sync_bombs, 0))
      end as proj_bombs,
      case
        when not live_source.bomb_pure or m.next_bomb_seconds is null then null::int
        when sync_snap.elapsed_secs >= m.next_bomb_seconds then null::int
        else (m.next_bomb_seconds - sync_snap.elapsed_secs)::int
      end as proj_bomb_next
  ) bomb_proj
  cross join lateral (
    select
      bsp.available as spent_bombs,
      bsp.next_in_seconds as spent_bomb_next
    from public.project_token_snapshot(
      case when live_source.bomb_spent then m.last_sync_bombs else null::int end,
      m.next_bomb_seconds,
      m.last_sync_at,
      coalesce(rs.bomb_spends, array[]::timestamptz[]),
      now(),
      1,
      64800
    ) bsp
  ) bomb_spend_proj
  order by m.display_name;
end;
$_$;

CREATE TABLE public.boss_target_tokens (
    guild_code text NOT NULL,
    boss_name text NOT NULL,
    rarity text NOT NULL,
    set integer NOT NULL,
    target_tokens numeric NOT NULL,
    source text NOT NULL,
    seeded_from_seasons text,
    notes text,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    encounter_id integer DEFAULT 0 NOT NULL,
    skip boolean DEFAULT false NOT NULL,
    season_number text DEFAULT ''::text NOT NULL,
    board_id text,
    CONSTRAINT boss_target_tokens_encounter_id_check CHECK ((encounter_id = ANY (ARRAY[0, 1, 2]))),
    CONSTRAINT boss_target_tokens_rarity_check CHECK ((rarity = ANY (ARRAY['Legendary'::text, 'Mythic'::text]))),
    CONSTRAINT boss_target_tokens_set_check CHECK (((set >= 1) AND (set <= 5))),
    CONSTRAINT boss_target_tokens_source_check CHECK ((source = ANY (ARRAY['historical_seed'::text, 'officer_manual'::text]))),
    CONSTRAINT boss_target_tokens_target_tokens_check CHECK ((target_tokens > (0)::numeric))
);

CREATE TABLE public.herald_boss_config (
    id bigint NOT NULL,
    guild_code text NOT NULL,
    boss_id text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    webhook_config_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    discord_role_ids text[] DEFAULT '{}'::text[] NOT NULL,
    extra_links jsonb DEFAULT '[]'::jsonb NOT NULL,
    extra_videos jsonb DEFAULT '[]'::jsonb NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    rarity_set text,
    custom_message_url text,
    notes text,
    side1_notes text,
    side2_notes text,
    side1_behaviour text DEFAULT 'kill'::text NOT NULL,
    side2_behaviour text DEFAULT 'kill'::text NOT NULL,
    side1_threshold_hp_pct smallint,
    side2_threshold_hp_pct smallint,
    ping_mode text DEFAULT 'per_side'::text NOT NULL,
    ping_mode_explicit boolean DEFAULT false NOT NULL,
    discord_role_labels jsonb DEFAULT '{}'::jsonb NOT NULL,
    pinned_replay_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    replay_auto_count integer DEFAULT 0 NOT NULL,
    replay_link_mode text DEFAULT 'inherit'::text NOT NULL,
    CONSTRAINT herald_boss_config_boss_id_format CHECK ((boss_id ~ '^[A-Za-z][A-Za-z0-9]*_E[0-9]{1,3}$'::text)),
    CONSTRAINT herald_boss_config_extra_links_is_array CHECK ((jsonb_typeof(extra_links) = 'array'::text)),
    CONSTRAINT herald_boss_config_extra_videos_is_array CHECK ((jsonb_typeof(extra_videos) = 'array'::text)),
    CONSTRAINT herald_boss_config_ping_mode_check CHECK ((ping_mode = ANY (ARRAY['combined'::text, 'per_side'::text, 'skip_all'::text]))),
    CONSTRAINT herald_boss_config_replay_link_mode_check CHECK ((replay_link_mode = ANY (ARRAY['inherit'::text, 'off'::text, 'pinned'::text, 'featured'::text, 'all'::text]))),
    CONSTRAINT herald_boss_config_rarity_set_format CHECK (((rarity_set IS NULL) OR (rarity_set ~ '^[LM][1-5]$'::text))),
    CONSTRAINT herald_boss_config_side1_behaviour_check CHECK ((side1_behaviour = ANY (ARRAY['skip'::text, 'kill'::text, 'threshold'::text]))),
    CONSTRAINT herald_boss_config_side1_threshold_hp_pct_check CHECK (((side1_threshold_hp_pct IS NULL) OR ((side1_threshold_hp_pct >= 1) AND (side1_threshold_hp_pct <= 100)))),
    CONSTRAINT herald_boss_config_side2_behaviour_check CHECK ((side2_behaviour = ANY (ARRAY['skip'::text, 'kill'::text, 'threshold'::text]))),
    CONSTRAINT herald_boss_config_side2_threshold_hp_pct_check CHECK (((side2_threshold_hp_pct IS NULL) OR ((side2_threshold_hp_pct >= 1) AND (side2_threshold_hp_pct <= 100))))
);

CREATE TABLE public.upcoming_season_bosses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    guild_code text NOT NULL,
    season_number text NOT NULL,
    level text NOT NULL,
    boss_name text NOT NULL,
    selected_by uuid,
    selected_at timestamp with time zone DEFAULT now(),
    sub_bosses jsonb DEFAULT '{}'::jsonb,
    CONSTRAINT upcoming_season_bosses_boss_name_nonempty CHECK ((boss_name <> ''::text)),
    CONSTRAINT upcoming_season_bosses_level_check CHECK ((level = ANY (ARRAY['L1'::text, 'L2'::text, 'L3'::text, 'L4'::text, 'L5'::text, 'M1'::text, 'M2'::text, 'M3'::text, 'M4'::text, 'M5'::text])))
);

CREATE FUNCTION public.boss_target_tokens_touch_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

CREATE FUNCTION public.get_cluster_latest_season() RETURNS text
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_guild_code   TEXT;
  v_cluster_code TEXT;
  v_latest_season TEXT;
BEGIN
  SELECT pm.guild_code, gc.cluster_code
  INTO v_guild_code, v_cluster_code
  FROM player_mapping pm
  LEFT JOIN guild_config gc ON gc.guild_code = pm.guild_code
  WHERE pm.user_id = auth.uid()
    AND pm.is_current = true
  LIMIT 1;

  IF v_cluster_code IS NOT NULL THEN
    SELECT max(per_guild.season_num)::text
    INTO v_latest_season
    FROM guild_config gc
    CROSS JOIN LATERAL (
      SELECT max(e.season_num) AS season_num
      FROM "EOT_GR_data" e
      WHERE e."Guild" = gc.guild_code
    ) AS per_guild
    WHERE gc.cluster_code = v_cluster_code;
  ELSIF v_guild_code IS NOT NULL THEN
    SELECT max(e.season_num)::text
    INTO v_latest_season
    FROM "EOT_GR_data" e
    WHERE e."Guild" = v_guild_code;
  END IF;

  RETURN v_latest_season;
END;
$$;

-- Cached token reads keep the signed-in caller and canonical membership checks.
-- Present durable snapshots remain useful after API access has been removed.
-- The adapter preserves the canonical calculation body, replaces the snapshot
-- credential predicate with snapshot presence, and labels that source cached.
CREATE FUNCTION public.desktop_get_player_token_state(p_guild_code text, p_season text DEFAULT NULL::text, p_cluster_code text DEFAULT NULL::text, p_player_id text DEFAULT NULL::text) RETURNS TABLE(player_id text, display_name text, discord_user_id text, tokens_available integer, is_capped boolean, time_to_next_token interval, data_source text, token_next_in_seconds integer, last_sync_at timestamp with time zone, tokens_used integer, max_possible integer, burned_tokens integer, time_over_cap_seconds integer, last_battle_time timestamp with time zone, bombs_available integer, bomb_next_in_seconds integer, post_snapshot_spends integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'auth'
    AS $_$
declare
  v_season text;
  v_is_service boolean := COALESCE(
    NULLIF(NULLIF(current_setting('role', true), ''), 'none'),
    NULLIF(session_user, '')
  ) = 'service_role';
  v_requester_id uuid := auth.uid();
  v_requester_role text := null;
  v_requester_guild text := null;
  v_requester_cluster text := null;
  v_target_cluster text := null;
begin
  if not v_is_service then
    if v_requester_id is null then
      return;
    end if;

    select pm.guild_code, pm.cluster_code, pm.role
      into v_requester_guild, v_requester_cluster, v_requester_role
    from public.player_with_cluster pm
    where pm.user_id = v_requester_id
      and pm.is_current = true
    limit 1;

    select gc.cluster_code::text
      into v_target_cluster
    from public.guild_config gc
    where gc.guild_code = p_guild_code
    limit 1;

    if v_requester_guild is distinct from p_guild_code then
      if lower(v_requester_role) not in ('officer', 'leader') then
        return;
      end if;
      if v_target_cluster is null or v_requester_cluster is distinct from v_target_cluster then
        return;
      end if;
    end if;
  end if;

  if p_season is null or trim(p_season) = '' then
    select max(d.season_num)::text into v_season
    from "EOT_GR_data" d
    where d."Guild" = p_guild_code
      and (p_cluster_code is null or d.cluster_code = p_cluster_code);
  else
    v_season := trim(p_season);
  end if;

  if v_season is null then
    return;
  end if;

  return query
  with members as (
    select
      pm.player_id,
      pm.display_name,
      pm.discord_user_id::text as discord_user_id,
      pm.last_sync_tokens,
      pm.next_token_seconds,
      pm.last_sync_at::timestamptz as last_sync_at,
      pm.api_key_is_valid,
      pm.tacticus_api_key_encrypted,
      pm.last_sync_bombs,
      pm.next_bomb_seconds
    from public.player_mapping pm
    where pm.guild_code = p_guild_code
      and pm.is_current = true
      and (p_player_id is null or pm.player_id = p_player_id)
  ),
  recent_spend as (
    select
      m2.player_id,
      count(distinct d."startedOn") filter (where d."damageType" = 'Battle')::int as battles_after_sync,
      count(distinct d."startedOn") filter (where d."damageType" = 'Bomb')::int as bombs_after_sync,
      array_agg(distinct d."startedOn"::timestamptz)
        filter (where d."damageType" = 'Battle') as battle_spends,
      array_agg(distinct d."startedOn"::timestamptz)
        filter (where d."damageType" = 'Bomb') as bomb_spends
    from members m2
    join public."EOT_GR_data" d
      on d."userId" = m2.player_id
      and d."Guild" = p_guild_code
      and (
        d."Season" = v_season
        or (v_season ~ '^\d+$' and d."Season" = (v_season::int - 1)::text)
      )
      and d."damageType" in ('Battle', 'Bomb')
      and (p_cluster_code is null or d.cluster_code = p_cluster_code)
    where m2.last_sync_at is not null
      and d."startedOn"::timestamptz > m2.last_sync_at
    group by m2.player_id
  ),
  battle_rows as (
    select
      d."userId" as player_id,
      d."damageType" as damage_type,
      d."damageDealt" as damage_dealt,
      d."startedOn"::timestamptz as started_on
    from public."EOT_GR_data" d
    where d."Guild" = p_guild_code
      and d."Season" = v_season
      and d."damageType" in ('Battle', 'Bomb')
      and d."userId" is not null
      and (p_cluster_code is null or d.cluster_code = p_cluster_code)
  ),
  current_season_totals as (
    select
      b.player_id,
      count(*) filter (
        where b.damage_type = 'Battle'
      )::int as tokens_used,
      max(b.started_on) filter (where b.damage_type = 'Battle') as last_battle_time
    from battle_rows b
    group by b.player_id
  ),
  max_tokens as (
    select coalesce(max(c.tokens_used), 0)::int as max_possible
    from current_season_totals c
  ),
  calculated as (
    select
      m.player_id,
      calc.tokens_available as calc_tokens_available,
      calc.is_capped as calc_is_capped,
      calc.time_until_next_token as calc_time_until_next_token,
      calc.last_battle_time as calc_last_battle_time
    from members m
    left join lateral (
      select *
      from public.calculate_player_tokens_by_user(m.player_id, p_guild_code, v_season)
      limit 1
    ) calc on true
  ),
  burn_state as (
    select
      m.player_id,
      cb.burned_tokens,
      cb.time_over_cap_seconds
    from members m
    cross join lateral public.compute_player_token_burn(
      p_guild_code := p_guild_code,
      p_season := v_season,
      p_player_id := m.player_id
    ) cb
  ),
  bomb_calc as (
    select
      b.player_id,
      max(b.started_on) as last_bomb_time,
      case
        when max(b.started_on) is not null
          and extract(epoch from (now() - max(b.started_on))) < 64800
        then 0
        else 1
      end as calc_bombs_available,
      case
        when max(b.started_on) is not null
          and extract(epoch from (now() - max(b.started_on))) < 64800
        then floor(64800 - extract(epoch from (now() - max(b.started_on))))::int
        else null
      end as calc_bomb_next_seconds
    from battle_rows b
    where b.damage_type = 'Bomb'
    group by b.player_id
  )
  select
    m.player_id,
    m.display_name,
    m.discord_user_id,
    case
      when live_source.token_spent then tok_spend_proj.spent_tokens
      when live_source.token_pure then tok_proj.proj_tokens
      else coalesce(c.calc_tokens_available, 3)
    end as tokens_available,
    case
      when live_source.token_spent then tok_spend_proj.spent_tokens >= 3
      when live_source.token_pure then tok_proj.proj_tokens >= 3
      else coalesce(c.calc_is_capped, coalesce(c.calc_tokens_available, 3) >= 3)
    end as is_capped,
    case
      when live_source.token_spent then
        case
          when tok_spend_proj.spent_next_seconds is null then null::interval
          else make_interval(secs => tok_spend_proj.spent_next_seconds)
        end
      when live_source.token_pure then
        case
          when tok_proj.proj_next_seconds is null then null::interval
          else make_interval(secs => tok_proj.proj_next_seconds)
        end
      else
        case
          when coalesce(c.calc_tokens_available, 3) >= 3 then null::interval
          else c.calc_time_until_next_token
        end
    end as time_to_next_token,
    case
      when live_source.token_live then 'cached'::text
      else 'calculated'::text
    end as data_source,
    case
      when live_source.token_spent then tok_spend_proj.spent_next_seconds
      when live_source.token_pure then tok_proj.proj_next_seconds
      else floor(extract(epoch from c.calc_time_until_next_token))::int
    end as token_next_in_seconds,
    m.last_sync_at,
    coalesce(t.tokens_used, 0) as tokens_used,
    coalesce(mt.max_possible, 0) as max_possible,
    coalesce(bs.burned_tokens, 0) as burned_tokens,
    coalesce(bs.time_over_cap_seconds, 0) as time_over_cap_seconds,
    coalesce(t.last_battle_time, c.calc_last_battle_time) as last_battle_time,
    case
      when live_source.bomb_spent and bomb_spend_proj.spent_bombs is not null
        then bomb_spend_proj.spent_bombs
      when live_source.bomb_pure and bomb_proj.proj_bombs is not null
        then bomb_proj.proj_bombs
      else coalesce(bc.calc_bombs_available, 1)
    end as bombs_available,
    case
      when live_source.bomb_spent and bomb_spend_proj.spent_bombs is not null
        then bomb_spend_proj.spent_bomb_next
      when live_source.bomb_pure and bomb_proj.proj_bombs is not null
        then bomb_proj.proj_bomb_next
      else bc.calc_bomb_next_seconds
    end as bomb_next_in_seconds,
    case
      when live_source.token_live then coalesce(rs.battles_after_sync, 0)
      else null::int
    end as post_snapshot_spends
  from members m
  left join calculated c
    on c.player_id = m.player_id
  left join current_season_totals t
    on t.player_id = m.player_id
  cross join max_tokens mt
  left join burn_state bs
    on bs.player_id = m.player_id
  left join bomb_calc bc
    on bc.player_id = m.player_id
  left join recent_spend rs
    on rs.player_id = m.player_id
  cross join lateral (
    select
      base_live.ok as base_live,
      base_live.ok as token_live,
      (base_live.ok and coalesce(rs.battles_after_sync, 0) = 0) as token_pure,
      (base_live.ok and coalesce(rs.battles_after_sync, 0) > 0) as token_spent,
      (base_live.ok and coalesce(rs.bombs_after_sync, 0) = 0) as bomb_pure,
      (base_live.ok and coalesce(rs.bombs_after_sync, 0) > 0) as bomb_spent
    from (
      select (
        m.last_sync_tokens is not null
        and m.last_sync_at is not null
      ) as ok
    ) base_live
  ) live_source
  cross join lateral (
    select
      case
        when live_source.base_live
          then greatest(0::numeric, floor(extract(epoch from (now() - m.last_sync_at))))
        else null::numeric
      end as elapsed_secs,
      greatest(0, least(3, coalesce(m.last_sync_tokens, 3))) as synced_tokens
  ) sync_snap
  cross join lateral (
    select
      case
        when not live_source.token_pure then null::int
        when sync_snap.synced_tokens >= 3 then 3
        when coalesce(m.next_token_seconds, 0) <= 0 then sync_snap.synced_tokens
        when sync_snap.elapsed_secs < m.next_token_seconds then sync_snap.synced_tokens
        else least(
          3,
          sync_snap.synced_tokens + 1 + floor(
            (sync_snap.elapsed_secs - m.next_token_seconds) / 43200.0
          )::int
        )
      end as proj_tokens,
      case
        when not live_source.token_pure then null::int
        when sync_snap.synced_tokens >= 3 then null::int
        when coalesce(m.next_token_seconds, 0) <= 0 then null::int
        when sync_snap.elapsed_secs < m.next_token_seconds
          then (m.next_token_seconds - sync_snap.elapsed_secs)::int
        else (43200 - ((sync_snap.elapsed_secs - m.next_token_seconds)::bigint % 43200))::int
      end as proj_next_raw
  ) tok_proj0
  cross join lateral (
    select
      tok_proj0.proj_tokens,
      case
        when tok_proj0.proj_tokens is null then null::int
        when tok_proj0.proj_tokens >= 3 then null::int
        else tok_proj0.proj_next_raw
      end as proj_next_seconds
  ) tok_proj
  cross join lateral (
    select
      tsp.available as spent_tokens,
      tsp.next_in_seconds as spent_next_seconds
    from public.project_token_snapshot(
      case when live_source.token_spent then m.last_sync_tokens else null::int end,
      m.next_token_seconds,
      m.last_sync_at,
      coalesce(rs.battle_spends, array[]::timestamptz[]),
      now(),
      3,
      43200
    ) tsp
  ) tok_spend_proj
  cross join lateral (
    select
      case
        when not live_source.bomb_pure or m.next_bomb_seconds is null then null::int
        when sync_snap.elapsed_secs >= m.next_bomb_seconds
          then greatest(1, coalesce(m.last_sync_bombs, 0))
        else greatest(0, coalesce(m.last_sync_bombs, 0))
      end as proj_bombs,
      case
        when not live_source.bomb_pure or m.next_bomb_seconds is null then null::int
        when sync_snap.elapsed_secs >= m.next_bomb_seconds then null::int
        else (m.next_bomb_seconds - sync_snap.elapsed_secs)::int
      end as proj_bomb_next
  ) bomb_proj
  cross join lateral (
    select
      bsp.available as spent_bombs,
      bsp.next_in_seconds as spent_bomb_next
    from public.project_token_snapshot(
      case when live_source.bomb_spent then m.last_sync_bombs else null::int end,
      m.next_bomb_seconds,
      m.last_sync_at,
      coalesce(rs.bomb_spends, array[]::timestamptz[]),
      now(),
      1,
      64800
    ) bsp
  ) bomb_spend_proj
  order by m.display_name;
end;
$_$;

ALTER TABLE public.season_calendar ADD PRIMARY KEY(season_id);
ALTER TABLE public.season_calendar ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.season_calendar FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.season_calendar FROM PUBLIC,anon,authenticated,service_role,desktop_rpc_reader;
GRANT SELECT ON public.season_calendar TO authenticated,service_role,desktop_rpc_reader;
CREATE POLICY desktop_season_calendar_read ON public.season_calendar FOR SELECT TO authenticated,desktop_rpc_reader USING(true);
GRANT SELECT ON public.player_with_cluster TO desktop_rpc_reader;
REVOKE ALL ON FUNCTION public.calculate_player_tokens_by_user(text,text,text),public.project_token_snapshot(integer,integer,timestamptz,timestamptz[],timestamptz,integer,bigint),public.get_player_token_state(text,text,text,text),public.desktop_get_player_token_state(text,text,text,text),public.get_cluster_latest_season() FROM PUBLIC,anon,authenticated,service_role,desktop_rpc_reader;
ALTER FUNCTION public.get_player_token_state(text,text,text,text) OWNER TO desktop_rpc_reader;
ALTER FUNCTION public.desktop_get_player_token_state(text,text,text,text) OWNER TO desktop_rpc_reader;
ALTER FUNCTION public.get_cluster_latest_season() OWNER TO desktop_rpc_reader;
GRANT EXECUTE ON FUNCTION public.calculate_player_tokens_by_user(text,text,text),public.project_token_snapshot(integer,integer,timestamptz,timestamptz[],timestamptz,integer,bigint) TO desktop_rpc_reader;
GRANT EXECUTE ON FUNCTION public.get_player_token_state(text,text,text,text),public.desktop_get_player_token_state(text,text,text,text),public.get_cluster_latest_season() TO authenticated;

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

ALTER TABLE ONLY public.boss_target_tokens
    ADD CONSTRAINT boss_target_tokens_pkey PRIMARY KEY (guild_code, boss_name, rarity, set, encounter_id, season_number);

ALTER TABLE ONLY public.boss_target_tokens
    ADD CONSTRAINT boss_target_tokens_guild_code_fkey FOREIGN KEY (guild_code) REFERENCES public.guild_config(guild_code) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.boss_target_tokens
    ADD CONSTRAINT boss_target_tokens_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX boss_target_tokens_guild_idx ON public.boss_target_tokens USING btree (guild_code);

CREATE INDEX boss_target_tokens_skip_idx ON public.boss_target_tokens USING btree (guild_code, skip);

CREATE INDEX idx_boss_target_tokens_guild_rarity_set ON public.boss_target_tokens USING btree (guild_code, rarity, set);

CREATE TRIGGER boss_target_tokens_touch BEFORE UPDATE ON public.boss_target_tokens FOR EACH ROW EXECUTE FUNCTION public.boss_target_tokens_touch_updated_at();

ALTER TABLE public.boss_target_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY boss_target_tokens_read ON public.boss_target_tokens FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.player_mapping pm
  WHERE ((pm.user_id = ( SELECT auth.uid() AS uid)) AND (pm.guild_code = boss_target_tokens.guild_code) AND (pm.is_current = true)))));

CREATE POLICY herald_boss_config_guild_read ON public.herald_boss_config FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.player_mapping pm
  WHERE ((pm.user_id = ( SELECT auth.uid() AS uid)) AND (pm.is_current = true) AND (pm.guild_code = herald_boss_config.guild_code)))));

CREATE POLICY upcoming_season_bosses_member_read ON public.upcoming_season_bosses FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.player_mapping pm
  WHERE ((pm.user_id = ( SELECT auth.uid() AS uid)) AND (pm.guild_code = upcoming_season_bosses.guild_code) AND (pm.is_current = true)))));

ALTER TABLE ONLY public.herald_boss_config
    ADD CONSTRAINT herald_boss_config_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.herald_boss_config
    ADD CONSTRAINT herald_boss_config_guild_code_fkey FOREIGN KEY (guild_code) REFERENCES public.guild_config(guild_code) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.upcoming_season_bosses
    ADD CONSTRAINT upcoming_season_bosses_guild_code_season_number_level_key UNIQUE (guild_code, season_number, level);

ALTER TABLE ONLY public.upcoming_season_bosses
    ADD CONSTRAINT upcoming_season_bosses_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.upcoming_season_bosses
    ADD CONSTRAINT upcoming_season_bosses_guild_code_fkey FOREIGN KEY (guild_code) REFERENCES public.guild_config(guild_code) ON UPDATE CASCADE;

ALTER TABLE ONLY public.upcoming_season_bosses
    ADD CONSTRAINT upcoming_season_bosses_selected_by_fkey FOREIGN KEY (selected_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.boss_target_tokens FORCE ROW LEVEL SECURITY;
ALTER TABLE public.herald_boss_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.herald_boss_config FORCE ROW LEVEL SECURITY;
ALTER TABLE public.upcoming_season_bosses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.upcoming_season_bosses FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.boss_target_tokens,public.herald_boss_config,public.upcoming_season_bosses FROM PUBLIC,anon,authenticated,service_role,desktop_rpc_reader;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.boss_target_tokens TO authenticated;
GRANT SELECT ON public.herald_boss_config,public.upcoming_season_bosses TO authenticated;
REVOKE ALL ON FUNCTION public.boss_target_tokens_touch_updated_at() FROM PUBLIC,anon,authenticated,service_role,desktop_rpc_reader;

-- Add saved season planning.
CREATE TABLE public.guild_raid_season_plans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    guild_code text NOT NULL,
    season_id text NOT NULL,
    start_at timestamp with time zone NOT NULL,
    end_at timestamp with time zone NOT NULL,
    snapshot_at timestamp with time zone,
    kind text NOT NULL,
    baseline_key text,
    baseline_plan_id uuid,
    trigger text DEFAULT 'manual'::text NOT NULL,
    resolved_options jsonb DEFAULT '{}'::jsonb NOT NULL,
    seed integer,
    plan_hash text,
    input_snapshots jsonb DEFAULT '{}'::jsonb NOT NULL,
    plan_metrics jsonb DEFAULT '{}'::jsonb NOT NULL,
    plan jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT guild_raid_season_plans_kind_check CHECK ((kind = ANY (ARRAY['baseline'::text, 'replan'::text])))
);

CREATE TABLE public.raid_progression_config (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    scope text DEFAULT 'global'::text NOT NULL,
    game_version text,
    first_pass_sequence text[] NOT NULL,
    loop_sequence text[] NOT NULL,
    loop_start_stage text DEFAULT 'L1'::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

ALTER TABLE ONLY public.guild_raid_season_plans
    ADD CONSTRAINT guild_raid_season_plans_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.raid_progression_config
    ADD CONSTRAINT raid_progression_config_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.guild_raid_season_plans
    ADD CONSTRAINT guild_raid_season_plans_baseline_plan_id_fkey FOREIGN KEY (baseline_plan_id) REFERENCES public.guild_raid_season_plans(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.guild_raid_season_plans
    ADD CONSTRAINT guild_raid_season_plans_guild_code_fkey FOREIGN KEY (guild_code) REFERENCES public.guild_config(guild_code) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.feature_releases
    ADD CONSTRAINT feature_releases_feature_key_key UNIQUE (feature_key);

ALTER TABLE public.guild_raid_season_plans
  DROP CONSTRAINT IF EXISTS guild_raid_season_plans_created_by_fkey,
  ADD CONSTRAINT guild_raid_season_plans_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX idx_gr_season_plans_guild_season_created ON public.guild_raid_season_plans USING btree (guild_code, season_id, created_at DESC);

CREATE UNIQUE INDEX idx_raid_progression_config_active_scope ON public.raid_progression_config USING btree (scope) WHERE (is_active = true);

CREATE UNIQUE INDEX ux_gr_season_plans_baseline_key ON public.guild_raid_season_plans USING btree (guild_code, season_id, baseline_key) WHERE ((kind = 'baseline'::text) AND (baseline_key IS NOT NULL));

CREATE TRIGGER update_gr_season_plans_updated_at BEFORE UPDATE ON public.guild_raid_season_plans FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE POLICY gr_season_plans_delete_officers ON public.guild_raid_season_plans FOR DELETE USING ((EXISTS ( SELECT 1
   FROM public.player_mapping pm
  WHERE ((pm.guild_code = guild_raid_season_plans.guild_code) AND (pm.user_id = ( SELECT auth.uid() AS uid)) AND (pm.is_current = true) AND (pm.role = ANY (ARRAY['officer'::public.app_role, 'leader'::public.app_role, 'Officer'::public.app_role, 'Leader'::public.app_role]))))));

CREATE POLICY gr_season_plans_insert_officers ON public.guild_raid_season_plans FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.player_mapping pm
  WHERE ((pm.guild_code = guild_raid_season_plans.guild_code) AND (pm.user_id = ( SELECT auth.uid() AS uid)) AND (pm.is_current = true) AND (pm.role = ANY (ARRAY['officer'::public.app_role, 'leader'::public.app_role, 'Officer'::public.app_role, 'Leader'::public.app_role]))))));

CREATE POLICY gr_season_plans_select_own_guild ON public.guild_raid_season_plans FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public._pm_caller_mapping_rows() pm(user_id, guild_code, cluster_code, role, is_current, is_app_admin)
  WHERE ((pm.guild_code = guild_raid_season_plans.guild_code) AND (pm.user_id = ( SELECT auth.uid() AS uid)) AND (pm.is_current = true)))));

CREATE POLICY gr_season_plans_update_officers ON public.guild_raid_season_plans FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.player_mapping pm
  WHERE ((pm.guild_code = guild_raid_season_plans.guild_code) AND (pm.user_id = ( SELECT auth.uid() AS uid)) AND (pm.is_current = true) AND (pm.role = ANY (ARRAY['officer'::public.app_role, 'leader'::public.app_role, 'Officer'::public.app_role, 'Leader'::public.app_role]))))));

CREATE POLICY "Anyone authenticated can read progression config" ON public.raid_progression_config FOR SELECT USING ((( SELECT auth.role() AS role) = 'authenticated'::text));

CREATE POLICY "Service role can manage progression config" ON public.raid_progression_config USING ((( SELECT auth.role() AS role) = 'service_role'::text));

ALTER TABLE public.guild_raid_season_plans ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.raid_progression_config ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.guild_raid_season_plans,public.raid_progression_config FROM PUBLIC,anon,authenticated,service_role,desktop_rpc_reader;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.guild_raid_season_plans TO authenticated;
GRANT SELECT ON public.raid_progression_config TO authenticated;
GRANT SELECT(timezone) ON public.guild_config TO authenticated;
REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM PUBLIC,anon,authenticated,service_role,desktop_rpc_reader;

-- Local saved capabilities describe preview availability, not upstream entitlements.
INSERT INTO public.feature_releases(feature_key,display_name,release_stage,route)
VALUES ('boss_assignments','Saved boss assignments','public','/boss-assignments/targets'),
       ('boss_assignment_season_planner','Saved season planning','public','/boss-assignments/season')
ON CONFLICT (feature_key) DO UPDATE
SET release_stage = EXCLUDED.release_stage, route = EXCLUDED.route;

-- Local direct-write guard supplements the preserved canonical role policies.
-- Fixture and Auth owners are trusted by explicit role, never by a missing uid.
CREATE FUNCTION public.desktop_guard_season_plan_write() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF current_user IN ('desktop_owner', 'supabase_auth_admin') THEN
    RETURN NEW;
  END IF;
  IF current_user <> 'authenticated' OR auth.uid() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Signed plan writer required';
  END IF;
  IF TG_OP = 'INSERT' AND NEW.created_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Plan creator must be the signed caller';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Plan creator is immutable';
  END IF;
  IF NEW.baseline_plan_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.guild_raid_season_plans AS baseline
    WHERE baseline.id = NEW.baseline_plan_id
      AND baseline.guild_code = NEW.guild_code
      AND baseline.season_id = NEW.season_id
      AND (baseline.plan->>'season') IS NOT DISTINCT FROM (NEW.plan->>'season')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Baseline must be a visible plan in the same guild and season';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.desktop_guard_season_plan_write() FROM PUBLIC,anon,authenticated,service_role,desktop_rpc_reader;
CREATE TRIGGER desktop_guard_season_plan_write
    BEFORE INSERT OR UPDATE ON public.guild_raid_season_plans
    FOR EACH ROW EXECUTE FUNCTION public.desktop_guard_season_plan_write();

-- Add selected-season assignment storage and scoped writer.

CREATE TABLE public.upcoming_season_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    guild_code text NOT NULL,
    season_number text NOT NULL,
    player_id text NOT NULL,
    display_name text NOT NULL,
    primary_boss text,
    secondary_boss text,
    assigned_by uuid,
    assigned_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    token_allocations jsonb DEFAULT '{}'::jsonb,
    uses_flexible_tokens boolean DEFAULT false,
    total_tokens_allocated integer DEFAULT 0
);

CREATE FUNCTION public.manage_season_assignments(p_guild_code text, p_season_number text, p_mode text DEFAULT 'upcoming'::text, p_bosses jsonb DEFAULT '[]'::jsonb, p_assignments jsonb DEFAULT '[]'::jsonb, p_primary_secondary jsonb DEFAULT NULL::jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user_role TEXT;
  v_user_guild_code TEXT;
  v_user_cluster TEXT;
  v_target_cluster TEXT;
  v_assigned_count INTEGER := 0;
  v_total_players INTEGER := 0;
  v_total_tokens INTEGER := 0;
  v_mode TEXT := lower(COALESCE(p_mode, 'upcoming'));
  v_bosses JSONB := COALESCE(p_bosses, '[]'::jsonb);
  v_assignments JSONB := COALESCE(p_assignments, '[]'::jsonb);
  v_primary_secondary JSONB := COALESCE(p_primary_secondary, '[]'::jsonb);
BEGIN
  IF p_guild_code IS NULL OR btrim(p_guild_code) = '' THEN
    RAISE EXCEPTION 'Invalid guild code';
  END IF;

  IF p_season_number IS NULL OR btrim(p_season_number) = '' THEN
    RAISE EXCEPTION 'Invalid season number';
  END IF;

  IF v_mode NOT IN ('current', 'upcoming') THEN
    RAISE EXCEPTION 'Invalid mode';
  END IF;

  IF jsonb_typeof(v_bosses) <> 'array' THEN
    v_bosses := '[]'::jsonb;
  END IF;

  IF jsonb_typeof(v_assignments) <> 'array' THEN
    v_assignments := '[]'::jsonb;
  END IF;

  IF jsonb_typeof(v_primary_secondary) <> 'array' THEN
    v_primary_secondary := '[]'::jsonb;
  END IF;

  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF auth.uid() IS NULL THEN
      RAISE EXCEPTION 'Auth required';
    END IF;

    SELECT role, guild_code
      INTO v_user_role, v_user_guild_code
    FROM player_mapping
    WHERE user_id = auth.uid()
      AND is_current = true
    LIMIT 1;

    IF v_user_role IS NULL THEN
      RAISE EXCEPTION 'User profile not found';
    END IF;

    IF v_user_role NOT IN ('officer', 'leader') THEN
      RAISE EXCEPTION 'Insufficient permissions';
    END IF;

    IF v_user_role = 'officer' THEN
      IF v_user_guild_code IS DISTINCT FROM p_guild_code THEN
        RAISE EXCEPTION 'Access denied for guild';
      END IF;
    ELSE
      SELECT gc.cluster_code INTO v_user_cluster
      FROM guild_config gc
      WHERE gc.guild_code = v_user_guild_code;

      SELECT gc.cluster_code INTO v_target_cluster
      FROM guild_config gc
      WHERE gc.guild_code = p_guild_code;

      IF v_user_guild_code IS DISTINCT FROM p_guild_code AND
         (v_user_cluster IS NULL OR v_target_cluster IS NULL OR v_user_cluster != v_target_cluster) THEN
        RAISE EXCEPTION 'Access denied for cluster';
      END IF;
    END IF;
  END IF;

  IF jsonb_array_length(v_bosses) > 0 THEN
    INSERT INTO upcoming_season_bosses (
      guild_code,
      season_number,
      level,
      boss_name,
      sub_bosses,
      selected_by,
      selected_at
    )
    SELECT
      p_guild_code,
      p_season_number,
      b.level,
      b.boss_name,
      b.sub_bosses,
      auth.uid(),
      NOW()
    FROM jsonb_to_recordset(v_bosses) AS b(
      level TEXT,
      boss_name TEXT,
      sub_bosses JSONB
    )
    WHERE b.boss_name IS NOT NULL AND btrim(b.boss_name) <> ''
    ON CONFLICT (guild_code, season_number, level)
    DO UPDATE SET
      boss_name = EXCLUDED.boss_name,
      sub_bosses = coalesce(upcoming_season_bosses.sub_bosses, '{}'::jsonb) || coalesce(excluded.sub_bosses, '{}'::jsonb),
      selected_by = EXCLUDED.selected_by,
      selected_at = NOW();
  END IF;

  IF jsonb_array_length(v_assignments) > 0 THEN
    INSERT INTO upcoming_season_assignments (
      guild_code,
      season_number,
      player_id,
      display_name,
      primary_boss,
      secondary_boss,
      token_allocations,
      uses_flexible_tokens,
      total_tokens_allocated,
      assigned_by,
      assigned_at
    )
    SELECT
      p_guild_code,
      p_season_number,
      a.player_id,
      a.display_name,
      a.primary_boss,
      a.secondary_boss,
      a.token_allocations,
      a.uses_flexible_tokens,
      a.total_tokens_allocated,
      auth.uid(),
      NOW()
    FROM jsonb_to_recordset(v_assignments) AS a(
      player_id TEXT,
      display_name TEXT,
      primary_boss TEXT,
      secondary_boss TEXT,
      token_allocations JSONB,
      uses_flexible_tokens BOOLEAN,
      total_tokens_allocated INTEGER
    )
    ON CONFLICT (guild_code, season_number, player_id)
    DO UPDATE SET
      display_name = EXCLUDED.display_name,
      primary_boss = EXCLUDED.primary_boss,
      secondary_boss = EXCLUDED.secondary_boss,
      token_allocations = EXCLUDED.token_allocations,
      uses_flexible_tokens = EXCLUDED.uses_flexible_tokens,
      total_tokens_allocated = EXCLUDED.total_tokens_allocated,
      assigned_by = EXCLUDED.assigned_by,
      assigned_at = NOW(),
      updated_at = NOW();
  END IF;

  IF v_mode = 'current' AND jsonb_array_length(v_primary_secondary) > 0 THEN
    UPDATE player_mapping pm
    SET
      primary_boss = u.primary_boss,
      secondary_boss = u.secondary_boss,
      assigned_at = NOW(),
      updated_at = NOW()
    FROM jsonb_to_recordset(v_primary_secondary) AS u(
      player_id TEXT,
      primary_boss TEXT,
      secondary_boss TEXT
    )
    WHERE pm.player_id = u.player_id
      AND pm.guild_code = p_guild_code
      AND pm.is_current = true;
  END IF;

  SELECT
    COUNT(*),
    COALESCE(SUM(COALESCE(a.total_tokens_allocated, 0)), 0),
    COALESCE(SUM(CASE WHEN COALESCE(a.total_tokens_allocated, 0) > 0 THEN 1 ELSE 0 END), 0)
  INTO v_total_players, v_total_tokens, v_assigned_count
  FROM jsonb_to_recordset(v_assignments) AS a(total_tokens_allocated INTEGER);

  BEGIN
    INSERT INTO audit_logs (action, user_id, details)
    VALUES (
      'assignment_save',
      auth.uid(),
      jsonb_build_object(
        'guild_code', p_guild_code,
        'season', p_season_number,
        'mode', v_mode,
        'assigned_count', v_assigned_count,
        'total_players', v_total_players,
        'total_tokens', v_total_tokens,
        'bosses', COALESCE(
          (
            SELECT jsonb_agg(b.boss_name)
            FROM jsonb_to_recordset(v_bosses) AS b(boss_name TEXT)
            WHERE b.boss_name IS NOT NULL AND btrim(b.boss_name) <> ''
          ),
          '[]'::jsonb
        )
      )
    );
  EXCEPTION WHEN OTHERS THEN
  END;

  RETURN jsonb_build_object(
    'assignedCount', v_assigned_count,
    'totalPlayers', v_total_players,
    'totalTokens', v_total_tokens
  );
END;
$$;

CREATE FUNCTION public.clear_season_assignments(p_guild_code text, p_season_number text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user_role TEXT;
  v_user_guild_code TEXT;
  v_user_cluster TEXT;
  v_target_cluster TEXT;
  v_assignments_deleted INTEGER := 0;
  v_bosses_deleted INTEGER := 0;
BEGIN
  IF p_guild_code IS NULL OR btrim(p_guild_code) = '' THEN
    RAISE EXCEPTION 'Invalid guild code';
  END IF;

  IF p_season_number IS NULL OR btrim(p_season_number) = '' THEN
    RAISE EXCEPTION 'Invalid season number';
  END IF;

  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF auth.uid() IS NULL THEN
      RAISE EXCEPTION 'Auth required';
    END IF;

    SELECT role, guild_code
      INTO v_user_role, v_user_guild_code
    FROM player_mapping
    WHERE user_id = auth.uid()
      AND is_current = true
    LIMIT 1;

    IF v_user_role IS NULL THEN
      RAISE EXCEPTION 'User profile not found';
    END IF;

    IF v_user_role NOT IN ('officer', 'leader') THEN
      RAISE EXCEPTION 'Insufficient permissions';
    END IF;

    IF v_user_role = 'officer' THEN
      IF v_user_guild_code IS DISTINCT FROM p_guild_code THEN
        RAISE EXCEPTION 'Access denied for guild';
      END IF;
    ELSE
      SELECT gc.cluster_code INTO v_user_cluster
      FROM guild_config gc
      WHERE gc.guild_code = v_user_guild_code;

      SELECT gc.cluster_code INTO v_target_cluster
      FROM guild_config gc
      WHERE gc.guild_code = p_guild_code;

      IF v_user_guild_code IS DISTINCT FROM p_guild_code AND
         (v_user_cluster IS NULL OR v_target_cluster IS NULL OR v_user_cluster != v_target_cluster) THEN
        RAISE EXCEPTION 'Access denied for cluster';
      END IF;
    END IF;
  END IF;

  DELETE FROM upcoming_season_assignments
  WHERE guild_code = p_guild_code
    AND season_number = p_season_number;
  GET DIAGNOSTICS v_assignments_deleted = ROW_COUNT;

  DELETE FROM upcoming_season_bosses
  WHERE guild_code = p_guild_code
    AND season_number = p_season_number;
  GET DIAGNOSTICS v_bosses_deleted = ROW_COUNT;

  BEGIN
    INSERT INTO audit_logs (action, user_id, details)
    VALUES (
      'assignment_clear',
      auth.uid(),
      jsonb_build_object(
        'guild_code', p_guild_code,
        'season', p_season_number,
        'assignments_deleted', v_assignments_deleted,
        'bosses_deleted', v_bosses_deleted
      )
    );
  EXCEPTION WHEN OTHERS THEN
  END;

  RETURN jsonb_build_object(
    'assignmentsDeleted', v_assignments_deleted,
    'bossesDeleted', v_bosses_deleted
  );
END;
$$;

ALTER TABLE ONLY public.upcoming_season_assignments FORCE ROW LEVEL SECURITY;

ALTER TABLE ONLY public.upcoming_season_assignments
    ADD CONSTRAINT upcoming_season_assignments_guild_code_season_number_player_key UNIQUE (guild_code, season_number, player_id);

ALTER TABLE ONLY public.upcoming_season_assignments
    ADD CONSTRAINT upcoming_season_assignments_pkey PRIMARY KEY (id);

CREATE INDEX idx_fk_upcoming_season_assignments_assigned_by ON public.upcoming_season_assignments USING btree (assigned_by);

CREATE INDEX idx_upcoming_assignments_guild_season ON public.upcoming_season_assignments USING btree (guild_code, season_number);

CREATE INDEX idx_upcoming_assignments_player ON public.upcoming_season_assignments USING btree (player_id);

CREATE INDEX idx_upcoming_assignments_token_allocations ON public.upcoming_season_assignments USING gin (token_allocations);

CREATE INDEX idx_upcoming_season_assignments_guild ON public.upcoming_season_assignments USING btree (guild_code);

CREATE TRIGGER update_upcoming_season_assignments_updated_at BEFORE UPDATE ON public.upcoming_season_assignments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE ONLY public.upcoming_season_assignments
    ADD CONSTRAINT upcoming_season_assignments_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.upcoming_season_assignments
    ADD CONSTRAINT upcoming_season_assignments_guild_code_fkey FOREIGN KEY (guild_code) REFERENCES public.guild_config(guild_code) ON UPDATE CASCADE;

CREATE POLICY "Guild members can view their guild assignments" ON public.upcoming_season_assignments FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.player_mapping pm
  WHERE ((pm.user_id = ( SELECT auth.uid() AS uid)) AND (pm.guild_code = upcoming_season_assignments.guild_code) AND (pm.is_current = true)))));

CREATE POLICY "Officers can manage their guild assignments" ON public.upcoming_season_assignments TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.player_mapping pm
  WHERE ((pm.user_id = ( SELECT auth.uid() AS uid)) AND (pm.guild_code = upcoming_season_assignments.guild_code) AND (pm.is_current = true) AND (pm.role = ANY (ARRAY['officer'::public.app_role, 'leader'::public.app_role])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.player_mapping pm
  WHERE ((pm.user_id = ( SELECT auth.uid() AS uid)) AND (pm.guild_code = upcoming_season_assignments.guild_code) AND (pm.is_current = true) AND (pm.role = ANY (ARRAY['officer'::public.app_role, 'leader'::public.app_role]))))));

CREATE POLICY "Officers can view their guild assignments" ON public.upcoming_season_assignments FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.player_mapping pm
  WHERE ((pm.user_id = ( SELECT auth.uid() AS uid)) AND (pm.guild_code = upcoming_season_assignments.guild_code) AND (pm.is_current = true) AND (pm.role = ANY (ARRAY['officer'::public.app_role, 'leader'::public.app_role]))))));

ALTER TABLE public.upcoming_season_assignments ENABLE ROW LEVEL SECURITY;
-- Selected-season storage intent only. Captured lineup, as-of and modeled
-- token-budget validation belong to the signed application interface.
CREATE ROLE desktop_assignment_writer NOLOGIN NOSUPERUSER NOBYPASSRLS;
GRANT USAGE ON SCHEMA public,auth TO desktop_assignment_writer;
GRANT EXECUTE ON FUNCTION auth.uid(),auth.jwt(),auth.role() TO desktop_assignment_writer;
GRANT SELECT ON public.current_user_player_mapping TO desktop_assignment_writer;
GRANT SELECT(id,user_id,guild_code,player_id,display_name,role,is_current,is_active,discord_user_id) ON public.player_mapping TO desktop_assignment_writer;
-- UPDATE(id) permits FOR SHARE, while the policy's false WITH CHECK prohibits
-- all mapping changes. Authenticated callers receive no new mapping privilege.
GRANT UPDATE(id) ON public.player_mapping TO desktop_assignment_writer;
CREATE POLICY desktop_assignment_mapping_read ON public.player_mapping FOR SELECT TO desktop_assignment_writer USING (
 user_id=auth.uid() OR guild_code IN (SELECT p.guild_code FROM public.current_user_player_mapping p WHERE p.user_id=auth.uid() AND p.is_current AND p.is_active)
);
CREATE POLICY desktop_assignment_mapping_lock ON public.player_mapping FOR UPDATE TO desktop_assignment_writer USING (
 guild_code IN (SELECT p.guild_code FROM public.current_user_player_mapping p WHERE p.user_id=auth.uid() AND p.is_current AND p.is_active)
) WITH CHECK (false);
GRANT SELECT(id,email) ON auth.users TO desktop_assignment_writer;
GRANT SELECT(user_id,provider,identity_data) ON auth.identities TO desktop_assignment_writer;
CREATE POLICY desktop_assignment_auth_subject ON auth.users FOR SELECT TO desktop_assignment_writer USING (id=auth.uid());
CREATE POLICY desktop_assignment_auth_identity ON auth.identities FOR SELECT TO desktop_assignment_writer USING (user_id=auth.uid());

-- The helper accepts no subject selector, and is not executable by clients.
-- Discord's first nonempty string claim and snowflake validation mirror the
-- canonical Auth identity adapter; current mapping handles are also checked.
CREATE FUNCTION public.desktop_saved_assignment_subjects() RETURNS TABLE(subject_type text,subject_value text)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT 'user_id'::text,lower(auth.uid()::text) WHERE auth.uid() IS NOT NULL
 UNION
 SELECT 'email',lower(btrim(u.email)) FROM auth.users u WHERE u.id=auth.uid() AND nullif(btrim(u.email),'') IS NOT NULL
 UNION
 SELECT 'discord_user_id',d.value FROM auth.identities i CROSS JOIN LATERAL (
  SELECT coalesce(
   CASE WHEN jsonb_typeof(i.identity_data->'provider_id')='string' THEN nullif(i.identity_data->>'provider_id','') END,
   CASE WHEN jsonb_typeof(i.identity_data->'sub')='string' THEN nullif(i.identity_data->>'sub','') END,
   CASE WHEN jsonb_typeof(i.identity_data->'id')='string' THEN nullif(i.identity_data->>'id','') END
  ) AS value
 ) d WHERE i.user_id=auth.uid() AND i.provider='discord' AND d.value ~ '^[0-9]{17,20}$'
 UNION
 SELECT s.kind,lower(btrim(s.value)) FROM public.player_mapping p CROSS JOIN LATERAL (
  VALUES ('player_id'::text,p.player_id),('discord_user_id',p.discord_user_id::text)
 ) s(kind,value) WHERE p.user_id=auth.uid() AND p.is_current AND nullif(btrim(s.value),'') IS NOT NULL;
$$;
ALTER FUNCTION public.desktop_saved_assignment_subjects() OWNER TO desktop_assignment_writer;
REVOKE ALL ON FUNCTION public.desktop_saved_assignment_subjects() FROM PUBLIC,anon,authenticated,service_role,desktop_rpc_reader;
GRANT SELECT(auth_user_id,subject_type,subject_value,lifted_at,expires_at) ON public.user_bans TO desktop_assignment_writer;
CREATE POLICY desktop_assignment_subject_ban ON public.user_bans FOR SELECT TO desktop_assignment_writer USING (
 auth_user_id=auth.uid() OR (subject_type,subject_value) IN (SELECT s.subject_type,s.subject_value FROM public.desktop_saved_assignment_subjects() s)
);
CREATE FUNCTION public.desktop_saved_assignment_is_banned() RETURNS boolean
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=auth.uid()) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Signed account required';
 END IF;
 RETURN EXISTS(SELECT 1 FROM public.user_bans b WHERE b.lifted_at IS NULL AND (b.expires_at IS NULL OR b.expires_at>statement_timestamp()));
END;
$$;
ALTER FUNCTION public.desktop_saved_assignment_is_banned() OWNER TO desktop_assignment_writer;
REVOKE ALL ON FUNCTION public.desktop_saved_assignment_is_banned() FROM PUBLIC,anon,authenticated,service_role,desktop_rpc_reader;
GRANT EXECUTE ON FUNCTION public.desktop_saved_assignment_is_banned() TO authenticated;

CREATE FUNCTION public.desktop_saved_assignment_guild(p_write boolean) RETURNS text
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE g text; r text;
BEGIN
 IF auth.uid() IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' OR public.desktop_saved_assignment_is_banned() THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Signed active account required';
 END IF;
 SELECT p.guild_code,p.role::text INTO STRICT g,r FROM public.player_mapping p
  WHERE p.user_id=auth.uid() AND p.is_current AND p.is_active FOR SHARE;
 IF g IS NULL OR r IS NULL OR (p_write AND r NOT IN ('officer','leader')) OR (NOT p_write AND lower(r) NOT IN ('member','officer','leader')) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current own-guild writer required';
 END IF;
 RETURN g;
EXCEPTION WHEN no_data_found OR too_many_rows THEN
 RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current guild membership required';
END;
$$;
ALTER FUNCTION public.desktop_saved_assignment_guild(boolean) OWNER TO desktop_assignment_writer;
REVOKE ALL ON FUNCTION public.desktop_saved_assignment_guild(boolean) FROM PUBLIC,anon,authenticated,service_role,desktop_rpc_reader;

REVOKE ALL ON public.upcoming_season_assignments FROM PUBLIC,anon,authenticated,service_role,desktop_rpc_reader;
GRANT SELECT ON public.upcoming_season_assignments TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.upcoming_season_assignments,public.upcoming_season_bosses TO desktop_assignment_writer;
CREATE POLICY desktop_assignment_intent_read ON public.upcoming_season_assignments AS RESTRICTIVE FOR SELECT TO authenticated USING (
 NOT public.desktop_saved_assignment_is_banned() AND EXISTS(SELECT 1 FROM public.current_user_player_mapping p WHERE p.user_id=auth.uid() AND p.guild_code=upcoming_season_assignments.guild_code AND p.is_current AND p.is_active)
);
CREATE POLICY desktop_assignment_boss_read ON public.upcoming_season_bosses AS RESTRICTIVE FOR SELECT TO authenticated USING (
 NOT public.desktop_saved_assignment_is_banned() AND EXISTS(SELECT 1 FROM public.current_user_player_mapping p WHERE p.user_id=auth.uid() AND p.guild_code=upcoming_season_bosses.guild_code AND p.is_current AND p.is_active)
);
CREATE POLICY desktop_assignment_intent_write ON public.upcoming_season_assignments TO desktop_assignment_writer USING (
 guild_code IN (SELECT p.guild_code FROM public.current_user_player_mapping p WHERE p.user_id=auth.uid() AND p.is_current AND p.is_active AND p.role::text IN ('officer','leader'))
) WITH CHECK (
 guild_code IN (SELECT p.guild_code FROM public.current_user_player_mapping p WHERE p.user_id=auth.uid() AND p.is_current AND p.is_active AND p.role::text IN ('officer','leader')) AND assigned_by=auth.uid()
);
CREATE POLICY desktop_assignment_boss_write ON public.upcoming_season_bosses TO desktop_assignment_writer USING (
 guild_code IN (SELECT p.guild_code FROM public.current_user_player_mapping p WHERE p.user_id=auth.uid() AND p.is_current AND p.is_active AND p.role::text IN ('officer','leader'))
) WITH CHECK (
 guild_code IN (SELECT p.guild_code FROM public.current_user_player_mapping p WHERE p.user_id=auth.uid() AND p.is_current AND p.is_active AND p.role::text IN ('officer','leader')) AND selected_by=auth.uid()
);
GRANT SELECT("Guild","Season") ON public."EOT_GR_data" TO desktop_assignment_writer;
CREATE POLICY desktop_assignment_imported_season ON public."EOT_GR_data" FOR SELECT TO desktop_assignment_writer USING (
 "Guild" IN (SELECT p.guild_code FROM public.current_user_player_mapping p WHERE p.user_id=auth.uid() AND p.is_current AND p.is_active)
);
GRANT SELECT(guild_code,cluster_code) ON public.guild_config TO desktop_assignment_writer;
CREATE POLICY desktop_assignment_guild_read ON public.guild_config FOR SELECT TO desktop_assignment_writer USING (
 guild_code IN (SELECT p.guild_code FROM public.current_user_player_mapping p WHERE p.user_id=auth.uid() AND p.is_current AND p.is_active)
);
ALTER FUNCTION public.manage_season_assignments(text,text,text,jsonb,jsonb,jsonb) OWNER TO desktop_assignment_writer;
ALTER FUNCTION public.clear_season_assignments(text,text) OWNER TO desktop_assignment_writer;
REVOKE ALL ON FUNCTION public.manage_season_assignments(text,text,text,jsonb,jsonb,jsonb),public.clear_season_assignments(text,text) FROM PUBLIC,anon,authenticated,service_role,desktop_rpc_reader;

CREATE FUNCTION public.desktop_validate_saved_assignment_season(p_season text,p_guild text) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 IF p_season IS NULL OR p_season !~ '^[1-9][0-9]{0,5}$' OR NOT EXISTS(
  SELECT 1 FROM public."EOT_GR_data" e WHERE e."Guild"=p_guild AND e."Season"=p_season
 ) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Imported saved season required'; END IF;
END;
$$;
ALTER FUNCTION public.desktop_validate_saved_assignment_season(text,text) OWNER TO desktop_assignment_writer;
REVOKE ALL ON FUNCTION public.desktop_validate_saved_assignment_season(text,text) FROM PUBLIC,anon,authenticated,service_role,desktop_rpc_reader;

CREATE FUNCTION public.desktop_replace_saved_assignments(p_season_number text,p_bosses jsonb,p_assignments jsonb) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' SET lock_timeout TO '5s' AS $$
DECLARE g text; b jsonb; a jsonb; k text; v jsonb; n numeric; total numeric:=0; row_total numeric; player_name text; canonical_rows jsonb:='[]';
BEGIN
 g:=public.desktop_saved_assignment_guild(true);
 PERFORM public.desktop_validate_saved_assignment_season(p_season_number,g);
 IF p_bosses IS NULL OR p_assignments IS NULL OR jsonb_typeof(p_bosses)<>'array' OR jsonb_typeof(p_assignments)<>'array'
  OR octet_length(p_bosses::text)+octet_length(p_assignments::text)>65536 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Bounded assignment arrays required';
 END IF;
 IF jsonb_array_length(p_bosses)>10 OR jsonb_array_length(p_assignments)>30
  OR (SELECT count(DISTINCT x->>'level') FROM jsonb_array_elements(p_bosses) x)<>jsonb_array_length(p_bosses)
  OR (SELECT count(DISTINCT x->>'player_id') FROM jsonb_array_elements(p_assignments) x)<>jsonb_array_length(p_assignments) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Unique bounded stages and players required';
 END IF;
 FOR b IN SELECT value FROM jsonb_array_elements(p_bosses) LOOP
  IF jsonb_typeof(b)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(b))<>3 OR NOT(b ?& ARRAY['level','boss_name','sub_bosses'])
   OR jsonb_typeof(b->'level')<>'string' OR b->>'level' !~ '^[ML][1-5]$'
   OR jsonb_typeof(b->'boss_name')<>'string' OR length(b->>'boss_name') NOT BETWEEN 1 AND 128 OR b->>'boss_name'<>btrim(b->>'boss_name') OR b->>'boss_name' ~ '[[:cntrl:]]'
   OR jsonb_typeof(b->'sub_bosses')<>'object' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid saved boss choice'; END IF;
  FOR k,v IN SELECT * FROM jsonb_each(b->'sub_bosses') LOOP
   IF k NOT IN ('sub1','sub2','sub1_skip','sub2_skip')
    OR (k IN ('sub1_skip','sub2_skip') AND jsonb_typeof(v)<>'boolean')
    OR (k IN ('sub1','sub2') AND (jsonb_typeof(v) NOT IN ('string','null') OR (jsonb_typeof(v)='string' AND (length(v#>>'{}') NOT BETWEEN 0 AND 128 OR v#>>'{}'<>btrim(v#>>'{}') OR v#>>'{}' ~ '[[:cntrl:]]')))) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid saved prime choice';
   END IF;
  END LOOP;
 END LOOP;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('desktop-saved-assignments:'||g||':'||p_season_number,0));
 FOR a IN SELECT value FROM jsonb_array_elements(p_assignments) LOOP
  IF jsonb_typeof(a)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(a))<>2 OR NOT(a ?& ARRAY['player_id','token_allocations'])
   OR jsonb_typeof(a->'player_id')<>'string' OR length(a->>'player_id') NOT BETWEEN 1 AND 256 OR a->>'player_id'<>btrim(a->>'player_id') OR a->>'player_id' ~ '[[:cntrl:]]'
   OR jsonb_typeof(a->'token_allocations')<>'object' OR (SELECT count(*) FROM jsonb_object_keys(a->'token_allocations'))>30 THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid saved player assignment';
  END IF;
  SELECT p.display_name INTO STRICT player_name FROM public.player_mapping p WHERE p.guild_code=g AND p.player_id=a->>'player_id' AND p.is_current AND p.is_active FOR SHARE;
  row_total:=0;
  FOR k,v IN SELECT * FROM jsonb_each(a->'token_allocations') LOOP
   IF k !~ '^[ML][1-5](_Sub[12])?$' OR jsonb_typeof(v)<>'number' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid saved token allocation'; END IF;
   n:=(v#>>'{}')::numeric;
   IF n<0 OR n>2147483647 OR n<>trunc(n) OR NOT EXISTS(
    SELECT 1 FROM jsonb_array_elements(p_bosses) choice WHERE choice->>'level'=split_part(k,'_',1)
     AND (position('_' IN k)=0 OR (nullif(choice->'sub_bosses'->>lower(right(k,4)),'') IS NOT NULL AND coalesce((choice->'sub_bosses'->>(lower(right(k,4))||'_skip'))::boolean,false)=false))
   ) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid saved token allocation'; END IF;
   row_total:=row_total+n;
  END LOOP;
  total:=total+row_total;
  IF total>2147483647 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Saved token total exceeds storage bound'; END IF;
  canonical_rows:=canonical_rows||jsonb_build_array(jsonb_build_object('player_id',a->>'player_id','display_name',player_name,'primary_boss',NULL,'secondary_boss',NULL,'token_allocations',a->'token_allocations','uses_flexible_tokens',true,'total_tokens_allocated',row_total::integer));
 END LOOP;
 IF public.desktop_saved_assignment_guild(true) IS DISTINCT FROM g THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current guild authority changed'; END IF;
 DELETE FROM public.upcoming_season_assignments WHERE guild_code=g AND season_number=p_season_number;
 DELETE FROM public.upcoming_season_bosses WHERE guild_code=g AND season_number=p_season_number;
 RETURN public.manage_season_assignments(g,p_season_number,'upcoming',p_bosses,canonical_rows,'[]'::jsonb);
EXCEPTION WHEN no_data_found OR too_many_rows THEN
 RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Current own-guild roster player required';
END;
$$;
ALTER FUNCTION public.desktop_replace_saved_assignments(text,jsonb,jsonb) OWNER TO desktop_assignment_writer;
REVOKE ALL ON FUNCTION public.desktop_replace_saved_assignments(text,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role,desktop_rpc_reader;
GRANT EXECUTE ON FUNCTION public.desktop_replace_saved_assignments(text,jsonb,jsonb) TO authenticated;

CREATE FUNCTION public.desktop_clear_saved_assignments(p_season_number text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' SET lock_timeout TO '5s' AS $$
DECLARE g text;
BEGIN
 g:=public.desktop_saved_assignment_guild(true);
 PERFORM public.desktop_validate_saved_assignment_season(p_season_number,g);
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('desktop-saved-assignments:'||g||':'||p_season_number,0));
 IF public.desktop_saved_assignment_guild(true) IS DISTINCT FROM g THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current guild authority changed'; END IF;
 RETURN public.clear_season_assignments(g,p_season_number);
END;
$$;
ALTER FUNCTION public.desktop_clear_saved_assignments(text) OWNER TO desktop_assignment_writer;
REVOKE ALL ON FUNCTION public.desktop_clear_saved_assignments(text) FROM PUBLIC,anon,authenticated,service_role,desktop_rpc_reader;
GRANT EXECUTE ON FUNCTION public.desktop_clear_saved_assignments(text) TO authenticated;

-- Read-only policies let active own-guild members use the paired projection.
-- They grant no mutation; write checks still require lowercase officer/leader.
CREATE POLICY desktop_assignment_paired_intent_read ON public.upcoming_season_assignments FOR SELECT TO desktop_assignment_writer USING (
 guild_code IN (SELECT p.guild_code FROM public.current_user_player_mapping p WHERE p.user_id=auth.uid() AND p.is_current AND p.is_active)
);
CREATE POLICY desktop_assignment_paired_boss_read ON public.upcoming_season_bosses FOR SELECT TO desktop_assignment_writer USING (
 guild_code IN (SELECT p.guild_code FROM public.current_user_player_mapping p WHERE p.user_id=auth.uid() AND p.is_current AND p.is_active)
);
CREATE FUNCTION public.desktop_get_saved_assignments(p_season_number text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' SET lock_timeout TO '5s' AS $$
DECLARE g text;
BEGIN
 g:=public.desktop_saved_assignment_guild(false);
 PERFORM public.desktop_validate_saved_assignment_season(p_season_number,g);
 -- Both arrays share this single SQL statement snapshot. One excess row is
 -- explicit overflow for the application decoder, never a successful truncation.
 RETURN (SELECT jsonb_build_object(
  'assignments',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.player_id),'[]'::jsonb) FROM (
   SELECT player_id,display_name,primary_boss,secondary_boss,token_allocations,uses_flexible_tokens,total_tokens_allocated,assigned_at,updated_at
   FROM public.upcoming_season_assignments WHERE guild_code=g AND season_number=p_season_number ORDER BY player_id LIMIT 31
  ) a),
  'bosses',(SELECT coalesce(jsonb_agg(to_jsonb(b) ORDER BY b.level),'[]'::jsonb) FROM (
   SELECT level,boss_name,sub_bosses,selected_at FROM public.upcoming_season_bosses WHERE guild_code=g AND season_number=p_season_number ORDER BY level LIMIT 11
  ) b)
 ));
END;
$$;
ALTER FUNCTION public.desktop_get_saved_assignments(text) OWNER TO desktop_assignment_writer;
REVOKE ALL ON FUNCTION public.desktop_get_saved_assignments(text) FROM PUBLIC,anon,authenticated,service_role,desktop_rpc_reader;
GRANT EXECUTE ON FUNCTION public.desktop_get_saved_assignments(text) TO authenticated;
