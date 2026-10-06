GRANT SELECT ON public.feature_releases TO authenticated,desktop_rpc_reader;
CREATE TABLE public.work_queue (
    id bigint NOT NULL,
    job_type text NOT NULL,
    job_class text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    dedupe_key text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    priority smallint DEFAULT 5 NOT NULL,
    attempts smallint DEFAULT 0 NOT NULL,
    max_attempts smallint DEFAULT 3 NOT NULL,
    claimed_by text,
    claimed_at timestamp with time zone,
    scheduled_for timestamp with time zone DEFAULT now() NOT NULL,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT work_queue_class_check CHECK ((job_class = ANY (ARRAY['batch'::text, 'sync'::text, 'webhook'::text, 'alert'::text, 'notification'::text, 'hook'::text, 'heavy'::text, 'verify'::text, 'volunteer'::text]))),
    CONSTRAINT work_queue_priority_check CHECK (((priority >= 1) AND (priority <= 9))),
    CONSTRAINT work_queue_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'completed'::text, 'failed'::text, 'dead'::text])))
);
CREATE TABLE public.public_guild_snapshots (
    guild_code text NOT NULL,
    season integer NOT NULL,
    rank integer,
    total_damage bigint,
    average_damage bigint,
    member_count integer,
    veteran_count integer,
    votlw_count integer,
    cluster_code text,
    last_updated timestamp with time zone DEFAULT now(),
    guild_name text,
    cluster_name text,
    total_battles bigint DEFAULT 0,
    active_players integer DEFAULT 0,
    avg_damage_per_battle bigint DEFAULT 0,
    top_boss_hits json DEFAULT '[]'::json,
    votlw_champions json DEFAULT '[]'::json,
    war_rank integer,
    explore_privacy_mode jsonb DEFAULT '["public"]'::jsonb,
    explore_obfuscation_percent integer DEFAULT 10 NOT NULL,
    guild_tag text,
    CONSTRAINT public_guild_snapshots_explore_obfuscation_percent_check CHECK (((explore_obfuscation_percent >= 1) AND (explore_obfuscation_percent <= 30)))
);
CREATE TABLE public.votlw_winners (
    guild_code text NOT NULL,
    season text NOT NULL,
    winner_name text NOT NULL,
    total_points numeric(10,2) NOT NULL,
    gold_medals integer DEFAULT 0,
    silver_medals integer DEFAULT 0,
    bronze_medals integer DEFAULT 0,
    kill_bonus_points numeric(10,2) DEFAULT 0,
    bomb_bonus_points numeric(10,2) DEFAULT 0,
    calculated_at timestamp with time zone DEFAULT now()
);
CREATE FUNCTION public.claim_next_work_job(p_worker_id text, p_classes text[]) RETURNS SETOF public.work_queue
    LANGUAGE plpgsql
    AS $$
BEGIN
  RETURN QUERY
  UPDATE public.work_queue q
  SET status      = 'processing',
      claimed_by  = p_worker_id,
      claimed_at  = now(),
      started_at  = now(),
      attempts    = q.attempts + 1,
      updated_at  = now()
  WHERE q.id = (
    SELECT id
    FROM public.work_queue
    WHERE status = 'pending'
      AND job_class = ANY(p_classes)
      AND scheduled_for <= now()
      AND attempts < max_attempts
    ORDER BY priority ASC, scheduled_for ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  RETURNING q.*;
END;
$$;
CREATE FUNCTION public.complete_work_job(p_job_id bigint, p_worker_id text, p_result jsonb DEFAULT '{}'::jsonb) RETURNS boolean
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_updated int;
BEGIN
  UPDATE public.work_queue
  SET status       = 'completed',
      completed_at = now(),
      payload      = payload || jsonb_build_object('result', p_result),
      updated_at   = now()
  WHERE id = p_job_id
    AND claimed_by = p_worker_id
    AND status = 'processing';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;
CREATE FUNCTION public.fail_work_job(p_job_id bigint, p_worker_id text, p_error text, p_backoff_seconds integer DEFAULT 60) RETURNS boolean
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_job public.work_queue;
BEGIN
  SELECT * INTO v_job
  FROM public.work_queue
  WHERE id = p_job_id
    AND claimed_by = p_worker_id
    AND status = 'processing'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_job.attempts >= v_job.max_attempts THEN
    UPDATE public.work_queue
    SET status       = 'dead',
        completed_at = now(),
        error        = p_error,
        updated_at   = now()
    WHERE id = p_job_id;
  ELSE
    UPDATE public.work_queue
    SET status        = 'pending',
        claimed_by    = NULL,
        claimed_at    = NULL,
        started_at    = NULL,
        scheduled_for = now() + make_interval(secs => p_backoff_seconds),
        error         = p_error,
        updated_at    = now()
    WHERE id = p_job_id;
  END IF;
  RETURN true;
END;
$$;
CREATE FUNCTION public.reap_stuck_work_jobs(p_timeout_seconds integer DEFAULT 600) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_count int;
BEGIN
  WITH reaped AS (
    UPDATE public.work_queue
    SET status      = CASE
                        WHEN attempts >= max_attempts THEN 'dead'
                        ELSE 'pending'
                      END,
        claimed_by  = CASE
                        WHEN attempts >= max_attempts THEN claimed_by
                        ELSE NULL
                      END,
        claimed_at  = CASE
                        WHEN attempts >= max_attempts THEN claimed_at
                        ELSE NULL
                      END,
        started_at  = NULL,
        completed_at = CASE
                        WHEN attempts >= max_attempts THEN now()
                        ELSE NULL
                      END,
        error       = COALESCE(error, '') || ' [reaped at ' || now()::text || ']',
        updated_at  = now()
    WHERE status = 'processing'
      AND claimed_at < now() - make_interval(secs => p_timeout_seconds)
    RETURNING id
  )
  SELECT COUNT(*)::int INTO v_count FROM reaped;
  RETURN v_count;
END;
$$;
CREATE FUNCTION public.manual_refresh_guild_snapshots() RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
  v_start timestamp;
  v_end timestamp;
  v_count integer;
  v_season integer;
BEGIN
  v_start := clock_timestamp();

  -- Call the comprehensive refresh function (not the simplified one)
  PERFORM public.refresh_public_guild_snapshots();

  -- Get the season from the refreshed data
  SELECT season INTO v_season FROM public_guild_snapshots LIMIT 1;

  -- Get count of refreshed snapshots
  SELECT COUNT(*) INTO v_count FROM public_guild_snapshots;

  v_end := clock_timestamp();

  RETURN jsonb_build_object(
    'success', true,
    'count', v_count,
    'season', v_season,
    'duration_ms', EXTRACT(EPOCH FROM (v_end - v_start)) * 1000,
    'message', 'Guild snapshots refreshed with comprehensive data'
  );
END;
$$;
CREATE FUNCTION public.refresh_public_guild_snapshots() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
DECLARE
  v_season integer;
  v_start_time timestamp;
  v_processed_guilds integer := 0;
BEGIN
  v_start_time := clock_timestamp();

  SELECT COALESCE(MAX(season_num), 84)
    INTO v_season
    FROM public."EOT_GR_data";

  TRUNCATE public.public_guild_snapshots;

  INSERT INTO public.public_guild_snapshots (
    guild_code, guild_tag, guild_name, cluster_code, cluster_name, season,
    rank, total_damage, average_damage, total_battles, active_players,
    avg_damage_per_battle, member_count, veteran_count, votlw_count,
    top_boss_hits, votlw_champions, last_updated, war_rank,
    explore_privacy_mode, explore_obfuscation_percent
  )
  WITH guild_base AS (
    SELECT gc.guild_code,
           gc.guild_tag,
           COALESCE(gc.display_name, gc.guild_code) AS guild_name,
           gc.cluster_code,
           COALESCE(c.display_name, gc.cluster_code) AS cluster_name,
           COALESCE(gc."GR_Ranking", 9999) AS rank,
           gc."GW_Ranking" AS war_rank,
           COALESCE(gc.explore_privacy_mode, '["public"]'::jsonb) AS privacy_mode,
           COALESCE(gc.explore_obfuscation_percent, 10) AS obfuscation_percent
      FROM public.guild_config gc
      LEFT JOIN public.clusters c ON c.cluster_code = gc.cluster_code
     WHERE gc.enabled = true
  ),
  guild_stats AS (
    SELECT d."Guild" AS guild_code,
           SUM(d."damageDealt") AS total_damage,
           AVG(d."damageDealt") AS average_damage,
           COUNT(*) AS total_battles,
           COUNT(DISTINCT d."displayName") AS active_players
      FROM public."EOT_GR_data" d
     WHERE d.season_num = v_season
       AND d."damageType" = 'Battle'
     GROUP BY d."Guild"
  ),
  boss_hits AS (
    SELECT d."Guild" AS guild_code,
           jsonb_agg(
             jsonb_build_object(
               'boss', d."Name",
               'damage', d."damageDealt",
               'player', d."displayName",
               'rarity', CASE
                 WHEN d.rarity IS NOT NULL
                   AND d.rarity NOT IN ('Unknown', '', 'null') THEN d.rarity
                 WHEN d.tier = 5 THEN 'Mythic'
                 WHEN d.tier = 4 THEN 'Legendary'
                 WHEN d.tier = 3 THEN 'Epic'
                 WHEN d.tier = 2 THEN 'Rare'
                 WHEN d.tier = 1 THEN 'Uncommon'
                 ELSE 'Common'
               END,
               'set', COALESCE(d.set, 0),
               'encounterId', COALESCE(d."encounterId", 0),
               'heroDetails', d."heroDetails",
               'tier', d.tier,
               'metaTeam', 'Other'
             ) ORDER BY
               CASE WHEN d.tier >= 4 THEN d.tier ELSE 0 END DESC,
               COALESCE(d.set, 0) DESC,
               COALESCE(d."encounterId", 0) ASC
           ) AS top_hits
      FROM (
        SELECT DISTINCT ON ("Guild", "Name", "encounterId", tier, set)
               "Guild", "Name", "damageDealt", "displayName", rarity,
               tier, set, "encounterId", "heroDetails"
          FROM public."EOT_GR_data"
         WHERE season_num = v_season
           AND "damageType" = 'Battle'
           AND "damageDealt" > 0
           AND "Name" IS NOT NULL
           AND tier IS NOT NULL
           AND "encounterId" IS NOT NULL
         ORDER BY "Guild", "Name", "encounterId", tier, set, "damageDealt" DESC
      ) d
     GROUP BY d."Guild"
  ),
  veteran_stats AS (
    SELECT history."Guild" AS guild_code,
           COUNT(*) AS veteran_count
      FROM (
        SELECT d."Guild", d."displayName"
          FROM public."EOT_GR_data" d
         WHERE d.season_num BETWEEN v_season - 4 AND v_season
           AND d."damageType" = 'Battle'
           AND d."damageDealt" > 0
         GROUP BY d."Guild", d."displayName"
        HAVING COUNT(DISTINCT d.season_num) >= 5
      ) history
     GROUP BY history."Guild"
  ),
  votlw_stats AS (
    SELECT v.guild_code,
           COUNT(*) AS votlw_count,
           jsonb_agg(
             jsonb_build_object(
               'season', v.season,
               'player', v.winner_name,
               'points', 0
             ) ORDER BY v.season::integer DESC
           ) FILTER (WHERE rn <= 5) AS recent_champions
      FROM (
        SELECT guild_code,
               season,
               winner_name,
               ROW_NUMBER() OVER (
                 PARTITION BY guild_code ORDER BY season::integer DESC
               ) AS rn
          FROM public.votlw_winners
         WHERE season ~ '^\d+$'
      ) v
     GROUP BY v.guild_code
  )
  SELECT gb.guild_code,
         gb.guild_tag,
         gb.guild_name,
         gb.cluster_code,
         gb.cluster_name,
         v_season,
         gb.rank,
         COALESCE(gs.total_damage, 0),
         COALESCE(gs.average_damage, 0),
         COALESCE(gs.total_battles, 0),
         COALESCE(gs.active_players, 0),
         CASE WHEN COALESCE(gs.total_battles, 0) > 0
           THEN COALESCE(gs.total_damage, 0) / gs.total_battles
           ELSE 0
         END,
         COALESCE(gs.active_players, 0),
         COALESCE(vs.veteran_count, 0),
         COALESCE(vws.votlw_count, 0),
         COALESCE(bh.top_hits, '[]'::jsonb),
         COALESCE(vws.recent_champions, '[]'::jsonb),
         now(),
         gb.war_rank,
         gb.privacy_mode,
         gb.obfuscation_percent
    FROM guild_base gb
    LEFT JOIN guild_stats gs ON gs.guild_code = gb.guild_code
    LEFT JOIN boss_hits bh ON bh.guild_code = gb.guild_code
    LEFT JOIN veteran_stats vs ON vs.guild_code = gb.guild_code
    LEFT JOIN votlw_stats vws ON vws.guild_code = gb.guild_code;

  GET DIAGNOSTICS v_processed_guilds = ROW_COUNT;
  RAISE NOTICE 'Refreshed % guild snapshots for season % in % seconds',
    v_processed_guilds,
    v_season,
    EXTRACT(EPOCH FROM (clock_timestamp() - v_start_time));
END;
$_$;
CREATE SEQUENCE public.work_queue_id_seq;
ALTER SEQUENCE public.work_queue_id_seq OWNED BY public.work_queue.id;
ALTER TABLE public.work_queue ALTER COLUMN id SET DEFAULT nextval('public.work_queue_id_seq');
ALTER TABLE public.work_queue ADD PRIMARY KEY(id);
CREATE UNIQUE INDEX work_queue_dedupe_active_idx ON public.work_queue(dedupe_key) WHERE status IN ('pending','processing');
CREATE INDEX work_queue_claim_idx ON public.work_queue(job_class,priority,scheduled_for) WHERE status='pending';
ALTER TABLE public.public_guild_snapshots ADD PRIMARY KEY(guild_code);

ALTER TABLE public.work_queue ADD CONSTRAINT desktop_local_job_type CHECK(job_type='refresh-explore-snapshots');
ALTER TABLE public.work_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.public_guild_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.votlw_winners ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.work_queue TO service_role;
GRANT USAGE,SELECT ON SEQUENCE public.work_queue_id_seq TO service_role;
GRANT SELECT ON public.public_guild_snapshots TO authenticated,service_role;
CREATE POLICY desktop_snapshot_read ON public.public_guild_snapshots FOR SELECT TO authenticated USING (guild_code IN (SELECT public._pm_caller_guild_codes()));
REVOKE ALL ON FUNCTION public.claim_next_work_job(text,text[]),public.complete_work_job(bigint,text,jsonb),public.fail_work_job(bigint,text,text,integer),public.reap_stuck_work_jobs(integer),public.manual_refresh_guild_snapshots(),public.refresh_public_guild_snapshots() FROM PUBLIC,anon,authenticated,desktop_rpc_reader;
GRANT EXECUTE ON FUNCTION public.claim_next_work_job(text,text[]),public.complete_work_job(bigint,text,jsonb),public.fail_work_job(bigint,text,text,integer),public.reap_stuck_work_jobs(integer),public.manual_refresh_guild_snapshots() TO service_role;

CREATE ROLE desktop_snapshot_owner NOLOGIN NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO desktop_snapshot_owner;
GRANT SELECT ON public."EOT_GR_data",public.guild_config,public.clusters,public.votlw_winners,public.public_guild_snapshots TO desktop_snapshot_owner;
GRANT INSERT,TRUNCATE ON public.public_guild_snapshots TO desktop_snapshot_owner;
CREATE POLICY desktop_snapshot_raid_read ON public."EOT_GR_data" FOR SELECT TO desktop_snapshot_owner USING(true);
CREATE POLICY desktop_snapshot_guild_read ON public.guild_config FOR SELECT TO desktop_snapshot_owner USING(true);
CREATE POLICY desktop_snapshot_cluster_read ON public.clusters FOR SELECT TO desktop_snapshot_owner USING(true);
CREATE POLICY desktop_snapshot_winner_read ON public.votlw_winners FOR SELECT TO desktop_snapshot_owner USING(true);
CREATE POLICY desktop_snapshot_owner_read ON public.public_guild_snapshots FOR SELECT TO desktop_snapshot_owner USING(true);
CREATE POLICY desktop_snapshot_owner_write ON public.public_guild_snapshots FOR INSERT TO desktop_snapshot_owner WITH CHECK(true);
GRANT EXECUTE ON FUNCTION public.refresh_public_guild_snapshots() TO service_role;
ALTER FUNCTION public.refresh_public_guild_snapshots() OWNER TO desktop_snapshot_owner;

CREATE TABLE public.boss_mapping (
    id integer NOT NULL,
    boss_type text NOT NULL,
    encounter_index integer NOT NULL,
    boss_name text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    auto_generated boolean DEFAULT false,
    asset_slug text,
    portrait_path text,
    icon_path text,
    thumbnail_path text,
    asset_source text DEFAULT 'datamine'::text,
    map_slug text,
    map_display_name text,
    map_variant text,
    map_source text,
    map_metadata jsonb,
    last_synced_at timestamp with time zone,
    unit_id text,
    faction text,
    faction_ban text,
    damage_type text,
    traits text[] DEFAULT '{}'::text[],
    key_abilities text[] DEFAULT '{}'::text[],
    weaknesses text[] DEFAULT '{}'::text[],
    preferred_traits text[] DEFAULT '{}'::text[],
    avoid_traits text[] DEFAULT '{}'::text[],
    hex_width integer DEFAULT 2,
    hex_height integer DEFAULT 2,
    movement integer DEFAULT 0,
    can_fly boolean DEFAULT false,
    base_health integer,
    base_damage integer,
    base_armor integer
);

CREATE OR REPLACE FUNCTION public._pm_caller_mapping_rows()
RETURNS TABLE(user_id uuid, guild_code text, cluster_code character varying,
              role public.app_role, is_current boolean, is_app_admin boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  RETURN QUERY
  SELECT pm.user_id, pm.guild_code, pm.cluster_code, pm.role,
         pm.is_current, pm.is_app_admin
  FROM public.player_mapping pm
  WHERE pm.user_id = (SELECT auth.uid());
END;
$fn$;
CREATE TABLE public.meta_teams (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    team_name text NOT NULL,
    description text,
    is_meta boolean DEFAULT true,
    sort_order integer DEFAULT 0,
    trigger_heroes jsonb DEFAULT '[]'::jsonb,
    match_type text DEFAULT 'any'::text,
    CONSTRAINT meta_teams_match_type_check CHECK ((match_type = ANY (ARRAY['any'::text, 'all'::text, 'exact'::text])))
);

CREATE TABLE public.player_avatar_frames (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    avatar_id character varying(100) NOT NULL,
    hero_unit_id character varying(100),
    display_name character varying(255),
    icon_url text,
    is_premium boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.hero_mappings (
    id integer NOT NULL,
    unit_id text NOT NULL,
    display_name text,
    discord_emoji text,
    discord_emoji_id text,
    icon_url text GENERATED ALWAYS AS (
CASE
    WHEN (discord_emoji_id IS NOT NULL) THEN (('https://cdn.discordapp.com/emojis/'::text || discord_emoji_id) || '.png'::text)
    ELSE NULL::text
END) STORED,
    category text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    web_icon_url text,
    avatar_id character varying(100),
    game_id text,
    long_name text,
    description text,
    faction_id text,
    alliance_id text,
    base_rarity text,
    movement integer DEFAULT 3,
    sorting integer,
    active_ability text,
    passive_ability text,
    mow_active_abilities text[],
    mythic_abilities text[],
    traits text[] DEFAULT '{}'::text[],
    damage_profiles text[] DEFAULT '{}'::text[],
    item_slots text[] DEFAULT '{}'::text[],
    base_health integer,
    base_damage integer,
    base_armor integer,
    CONSTRAINT hero_mappings_category_check CHECK ((category = ANY (ARRAY['Hero'::text, 'MOW'::text])))
);

CREATE FUNCTION public.get_boss_difficulty_analysis(p_guild_code text, p_season text, p_rarities text[] DEFAULT ARRAY['Legendary'::text, 'Mythic'::text]) RETURNS TABLE(boss_name text, display_name text, rarity text, set_num integer, encounter_id integer, avg_attempts numeric, avg_time_minutes numeric, hit_count integer, total_damage bigint, completed_loops integer, total_loops integer, completion_rate numeric, avg_damage_per_attempt numeric)
    LANGUAGE plpgsql
    AS $$
BEGIN
  RETURN QUERY
  WITH battle_records AS (
    SELECT
      d."Name",
      d.rarity,
      d.set,
      d."encounterId",
      d."damageDealt",
      d."remainingHp",
      d."maxHp",
      d."loopIndex",
      d.timestamp,
      d."startedOn",
      d."completedOn",
      CASE
        WHEN d.rarity = 'Mythic' THEN 'M' || (COALESCE(d.set, 0) + 1)::TEXT
        ELSE 'L' || (COALESCE(d.set, 0) + 1)::TEXT
      END || ' ' || d."Name" AS boss_display_name
    FROM "EOT_GR_data" d
    WHERE d."Guild" = p_guild_code
      AND d."Season" = p_season
      AND d."damageType" = 'Battle'
      AND d."damageDealt" > 0
      AND d.rarity = ANY(p_rarities)
  ),
  boss_loop_stats AS (
    SELECT
      br."Name",
      br.rarity,
      br.set,
      br."encounterId",
      br.boss_display_name,
      br."loopIndex",
      COUNT(*)::INTEGER AS loop_attempts,
      SUM(br."damageDealt")::BIGINT AS loop_damage,
      MIN(COALESCE(br."startedOn", br.timestamp)) AS first_hit,
      MAX(COALESCE(br."completedOn", br.timestamp)) AS last_hit,
      MAX(br."maxHp") AS max_hp,
      (SELECT br2."remainingHp"
       FROM battle_records br2
       WHERE br2."Name" = br."Name"
         AND br2.rarity = br.rarity
         AND br2.set = br.set
         AND br2."encounterId" = br."encounterId"
         AND br2."loopIndex" = br."loopIndex"
       ORDER BY br2."completedOn" DESC NULLS LAST, br2.timestamp DESC NULLS LAST
       LIMIT 1) AS final_remaining_hp
    FROM battle_records br
    WHERE br."loopIndex" IS NOT NULL
    GROUP BY br."Name", br.rarity, br.set, br."encounterId", br.boss_display_name, br."loopIndex"
  ),
  boss_aggregates AS (
    SELECT
      bls."Name",
      bls.rarity,
      bls.set,
      bls."encounterId",
      bls.boss_display_name,
      COUNT(DISTINCT bls."loopIndex")::INTEGER AS total_loop_count,
      COUNT(DISTINCT bls."loopIndex") FILTER (
        WHERE bls.final_remaining_hp IS NOT NULL AND bls.final_remaining_hp <= 0
           OR (bls.max_hp > 0 AND bls.loop_damage >= bls.max_hp)
      )::INTEGER AS completed_loop_count,
      SUM(bls.loop_attempts) FILTER (
        WHERE bls.final_remaining_hp IS NOT NULL AND bls.final_remaining_hp <= 0
           OR (bls.max_hp > 0 AND bls.loop_damage >= bls.max_hp)
      )::INTEGER AS attempts_in_completed_loops,
      SUM(bls.loop_attempts)::INTEGER AS total_hits,
      SUM(bls.loop_damage)::BIGINT AS total_dmg,
      SUM(
        CASE
          WHEN (bls.final_remaining_hp IS NOT NULL AND bls.final_remaining_hp <= 0
                OR (bls.max_hp > 0 AND bls.loop_damage >= bls.max_hp))
               AND bls.first_hit IS NOT NULL AND bls.last_hit IS NOT NULL
               AND bls.last_hit > bls.first_hit
          THEN EXTRACT(EPOCH FROM (bls.last_hit - bls.first_hit)) / 60.0
          ELSE 0
        END
      ) AS total_completion_time_minutes
    FROM boss_loop_stats bls
    GROUP BY bls."Name", bls.rarity, bls.set, bls."encounterId", bls.boss_display_name
  )
  SELECT
    ba."Name" AS boss_name,
    ba.boss_display_name AS display_name,
    ba.rarity,
    ba.set AS set_num,
    ba."encounterId" AS encounter_id,
    CASE
      WHEN ba.completed_loop_count > 0
      THEN ROUND(ba.attempts_in_completed_loops::NUMERIC / ba.completed_loop_count, 2)
      ELSE 0
    END AS avg_attempts,
    CASE
      WHEN ba.completed_loop_count > 0
      THEN ROUND(ba.total_completion_time_minutes / ba.completed_loop_count, 2)
      ELSE 0
    END AS avg_time_minutes,
    ba.total_hits AS hit_count,
    ba.total_dmg AS total_damage,
    ba.completed_loop_count AS completed_loops,
    ba.total_loop_count AS total_loops,
    CASE
      WHEN ba.total_loop_count > 0
      THEN ROUND(ba.completed_loop_count::NUMERIC / ba.total_loop_count, 3)
      ELSE 0
    END AS completion_rate,
    CASE
      WHEN ba.total_hits > 0
      THEN ROUND(ba.total_dmg::NUMERIC / ba.total_hits, 0)
      ELSE 0
    END AS avg_damage_per_attempt
  FROM boss_aggregates ba
  ORDER BY
    CASE WHEN ba.rarity = 'Mythic' THEN 0 ELSE 1 END,
    ba.set DESC,
    avg_attempts DESC;
END;
$$;

CREATE FUNCTION public.get_damage_by_boss_loop(p_guild_code text, p_season text) RETURNS TABLE(loop_index integer, boss_display_name text, avg_damage numeric, max_damage numeric, total_damage bigint, hit_count integer, start_time timestamp with time zone, end_time timestamp with time zone, is_prime boolean)
    LANGUAGE plpgsql
    AS $$
BEGIN
  RETURN QUERY
  WITH boss_data AS (
    SELECT
      d."loopIndex",
      d."Name",
      d."damageDealt",
      d."timestamp",
      d."startedOn",
      d."completedOn",
      d.rarity,
      d.set,
      d."encounterId",
      CASE
        WHEN d.rarity = 'Mythic' THEN 'M' || (COALESCE(d.set, 0) + 1)::TEXT
        ELSE 'L' || (COALESCE(d.set, 0) + 1)::TEXT
      END || ' ' || d."Name" AS display_name,
      (d."encounterId" != 0) AS is_prime_enemy
    FROM "EOT_GR_data" d
    WHERE d."Guild" = p_guild_code
      AND d."Season" = p_season
      AND d."damageType" = 'Battle'
      AND d.rarity IN ('Legendary', 'Mythic')
      AND d."loopIndex" IS NOT NULL
  )
  SELECT
    bd."loopIndex"::INTEGER AS loop_index,
    bd.display_name AS boss_display_name,
    ROUND(AVG(bd."damageDealt") FILTER (WHERE bd."damageDealt" > 0), 0) AS avg_damage,
    MAX(bd."damageDealt") FILTER (WHERE bd."damageDealt" > 0)::NUMERIC AS max_damage,
    SUM(bd."damageDealt") FILTER (WHERE bd."damageDealt" > 0)::BIGINT AS total_damage,
    COUNT(*)::INTEGER AS hit_count,
    MIN(COALESCE(bd."startedOn", bd."timestamp")) AS start_time,
    MAX(COALESCE(bd."completedOn", bd."timestamp")) AS end_time,
    bd.is_prime_enemy AS is_prime
  FROM boss_data bd
  GROUP BY bd."loopIndex", bd.display_name, bd.is_prime_enemy
  ORDER BY bd."loopIndex", bd.display_name;
END;
$$;

CREATE FUNCTION public.get_token_usage_by_loop(p_guild_code text, p_season text, p_rarities text[] DEFAULT ARRAY['Legendary'::text, 'Mythic'::text]) RETURNS TABLE(loop_index integer, bosses integer, primes integer, rarities text[])
    LANGUAGE plpgsql
    AS $$
BEGIN
  RETURN QUERY
  WITH battle_data AS (
    SELECT
      d."loopIndex",
      d."encounterId",
      d.rarity
    FROM "EOT_GR_data" d
    WHERE d."Guild" = p_guild_code
      AND d."Season" = p_season
      AND d."damageType" = 'Battle'
      AND d.rarity = ANY(p_rarities)
  ),
  loop_aggregates AS (
    SELECT
      bd."loopIndex"::INTEGER AS loop_idx,
      COUNT(*) FILTER (WHERE bd."encounterId" = 0)::INTEGER AS boss_count,
      COUNT(*) FILTER (WHERE bd."encounterId" != 0)::INTEGER AS prime_count,
      ARRAY_AGG(DISTINCT bd.rarity) AS rarity_list
    FROM battle_data bd
    WHERE bd."loopIndex" IS NOT NULL
    GROUP BY bd."loopIndex"
  )
  SELECT
    la.loop_idx,
    la.boss_count,
    la.prime_count,
    la.rarity_list
  FROM loop_aggregates la
  ORDER BY la.loop_idx;
END;
$$;

CREATE FUNCTION public.get_guild_vs_cluster_prime_performance(p_guild_code text, p_season text) RETURNS TABLE(prime_name text, guild_avg_damage numeric, cluster_avg_damage numeric, vs_cluster_percent numeric, set integer, rarity text)
    LANGUAGE sql
    AS $$
with cluster_ctx as (
  select cluster_code
  from guild_config
  where guild_code = p_guild_code
  limit 1
),
cluster_guilds as (
  select guild_code
  from guild_config
  where cluster_code in (select cluster_code from cluster_ctx)
),
guild_agg as (
  select
    "Name" as prime_name,
    "set",
    rarity,
    sum("damageDealt") as total_damage,
    count(*) as battle_count
  from "EOT_GR_data"
  where "Season" = p_season
    and "Guild" = p_guild_code
    and "damageType" = 'Battle'
    and rarity in ('Legendary','Mythic')
    and "damageDealt" > 0
    and not ("remainingHp" = 0 and "maxHp" > 0 and "damageDealt" < "maxHp" and "damageType" = 'Battle')
    and "encounterId" in (1, 2) -- primes only
  group by "Name", "set", rarity
),
cluster_agg as (
  select
    "Name" as prime_name,
    "set",
    rarity,
    avg("damageDealt") as cluster_avg
  from "EOT_GR_data"
  where "Season" = p_season
    and "damageType" = 'Battle'
    and rarity in ('Legendary','Mythic')
    and "damageDealt" > 0
    and not ("remainingHp" = 0 and "maxHp" > 0 and "damageDealt" < "maxHp" and "damageType" = 'Battle')
    and "encounterId" in (1, 2) -- primes only
    and (
      coalesce(cluster_code, '') = coalesce((select cluster_code from cluster_ctx limit 1), '')
      or "Guild" in (select guild_code from cluster_guilds)
    )
  group by "Name", "set", rarity
)
select
  g.prime_name,
  (g.total_damage / nullif(g.battle_count,0)) as guild_avg_damage,
  c.cluster_avg as cluster_avg_damage,
  case
    when c.cluster_avg > 0 then ((g.total_damage / nullif(g.battle_count,0)) / c.cluster_avg - 1) * 100
    else 0
  end as vs_cluster_percent,
  g."set",
  g.rarity
from guild_agg g
left join cluster_agg c on
  g.prime_name = c.prime_name
  and g."set" = c."set"
  and g.rarity = c.rarity
order by vs_cluster_percent desc nulls last;
$$;

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

CREATE OR REPLACE FUNCTION public.get_guild_trends_batch(p_guild_code text, p_seasons text[])
 RETURNS TABLE(season text, total_damage numeric, total_battles integer, max_hit bigint, boss_kills integer, active_players integer, guild_member_count integer, participation_rate numeric, avg_damage_per_token numeric, vs_cluster_percent numeric, guild_rank_in_cluster integer, total_guilds_in_cluster integer, reliability_score numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH guild_cluster AS (
    SELECT cluster_code
    FROM guild_config
    WHERE guild_code = p_guild_code
    LIMIT 1
  ),
  cluster_guilds AS (
    SELECT guild_code
    FROM guild_config
    WHERE cluster_code = (SELECT cluster_code FROM guild_cluster)
      AND (SELECT cluster_code FROM guild_cluster) IS NOT NULL
  ),
  all_token_counts AS (
    SELECT
      e."Season",
      COUNT(*)::integer AS token_count,
      COUNT(DISTINCT e."userId")::integer AS active_players
    FROM "EOT_GR_data" e
    WHERE e."Guild" = p_guild_code
      AND e."Season" = ANY(p_seasons)
      AND e."damageType" = 'Battle'
    GROUP BY e."Season"
  ),
  battle_data AS (
    SELECT
      e."Season",
      e."userId",
      e."damageDealt",
      e."remainingHp",
      e."Name" AS boss_name,
      e."encounterId"
    FROM "EOT_GR_data" e
    WHERE e."Guild" = p_guild_code
      AND e."Season" = ANY(p_seasons)
      AND e."damageType" = 'Battle'
      AND e.rarity IN ('Legendary', 'Mythic')
      AND e."damageDealt" > 0
      AND NOT (e."remainingHp" = 0 AND e."maxHp" > 0 AND e."damageDealt" < e."maxHp")
      AND e."encounterId" = 0
  ),
  season_agg AS (
    SELECT
      bd."Season",
      SUM(bd."damageDealt")::numeric AS total_damage,
      COUNT(*)::integer AS filtered_battles,
      MAX(bd."damageDealt") AS max_hit,
      COUNT(*) FILTER (WHERE bd."remainingHp" = 0)::integer AS boss_kills
    FROM battle_data bd
    GROUP BY bd."Season"
  ),
  member_count AS (
    SELECT COUNT(*)::integer AS cnt
    FROM player_mapping
    WHERE guild_code = p_guild_code
      AND is_current = true
  ),
  guild_boss_avgs AS (
    SELECT
      bd."Season",
      bd.boss_name,
      AVG(bd."damageDealt")::numeric AS guild_avg,
      COUNT(*)::integer AS battle_count
    FROM battle_data bd
    GROUP BY bd."Season", bd.boss_name
  ),
  cluster_boss_avgs AS (
    SELECT
      e."Season",
      e."Name" AS boss_name,
      AVG(e."damageDealt")::numeric AS cluster_avg
    FROM "EOT_GR_data" e
    WHERE e."Season" = ANY(p_seasons)
      AND e."damageType" = 'Battle'
      AND e.rarity IN ('Legendary', 'Mythic')
      AND e."damageDealt" > 0
      AND NOT (e."remainingHp" = 0 AND e."maxHp" > 0 AND e."damageDealt" < e."maxHp")
      AND e."encounterId" = 0
      AND (
        e."Guild" IN (SELECT guild_code FROM cluster_guilds)
        OR e.cluster_code = (SELECT cluster_code FROM guild_cluster)
      )
      AND (SELECT cluster_code FROM guild_cluster) IS NOT NULL
    GROUP BY e."Season", e."Name"
  ),
  guild_vs_cluster AS (
    SELECT
      g."Season",
      CASE
        WHEN SUM(g.battle_count) > 0 THEN
          ROUND(
            SUM(
              CASE WHEN c.cluster_avg > 0
                THEN ((g.guild_avg / c.cluster_avg) - 1) * 100 * g.battle_count
                ELSE 0
              END
            ) / SUM(g.battle_count),
          1)
        ELSE NULL
      END AS vs_cluster_pct
    FROM guild_boss_avgs g
    LEFT JOIN cluster_boss_avgs c
      ON g."Season" = c."Season" AND g.boss_name = c.boss_name
    GROUP BY g."Season"
  ),
  guild_reliability AS (
    SELECT
      g."Season",
      CASE
        WHEN COUNT(g.guild_avg) >= 2 AND AVG(g.guild_avg) > 0 THEN
          ROUND(GREATEST(0, 100 - (STDDEV_POP(g.guild_avg) / AVG(g.guild_avg)) * 100), 1)
        ELSE NULL
      END AS reliability
    FROM guild_boss_avgs g
    GROUP BY g."Season"
  ),
  cluster_guild_totals AS (
    SELECT
      e."Season",
      e."Guild" AS guild_code,
      SUM(e."damageDealt")::numeric AS total_damage
    FROM "EOT_GR_data" e
    WHERE e."Season" = ANY(p_seasons)
      AND (
        e."Guild" IN (SELECT guild_code FROM cluster_guilds)
        OR e.cluster_code = (SELECT cluster_code FROM guild_cluster)
      )
      AND (SELECT cluster_code FROM guild_cluster) IS NOT NULL
    GROUP BY e."Season", e."Guild"
  ),
  guild_rankings AS (
    SELECT
      cgt."Season",
      cgt.guild_code,
      RANK() OVER (PARTITION BY cgt."Season" ORDER BY cgt.total_damage DESC)::integer AS rank_in_cluster,
      COUNT(*) OVER (PARTITION BY cgt."Season")::integer AS total_guilds
    FROM cluster_guild_totals cgt
    WHERE cgt.total_damage IS NOT NULL
  )
  SELECT
    sa."Season"::text AS season,
    sa.total_damage,
    atc.token_count AS total_battles,
    sa.max_hit,
    sa.boss_kills,
    atc.active_players,
    mc.cnt AS guild_member_count,
    CASE WHEN mc.cnt > 0
      THEN LEAST(100.0, ROUND((atc.active_players::numeric / mc.cnt) * 100, 1))
      ELSE NULL
    END AS participation_rate,
    CASE WHEN sa.filtered_battles > 0
      THEN ROUND(sa.total_damage / sa.filtered_battles, 2)
      ELSE NULL
    END AS avg_damage_per_token,
    gvc.vs_cluster_pct AS vs_cluster_percent,
    gr.rank_in_cluster AS guild_rank_in_cluster,
    gr.total_guilds AS total_guilds_in_cluster,
    grel.reliability AS reliability_score
  FROM season_agg sa
  JOIN all_token_counts atc ON sa."Season" = atc."Season"
  CROSS JOIN member_count mc
  LEFT JOIN guild_vs_cluster gvc ON sa."Season" = gvc."Season"
  LEFT JOIN guild_rankings gr ON sa."Season" = gr."Season" AND gr.guild_code = p_guild_code
  LEFT JOIN guild_reliability grel ON sa."Season" = grel."Season"
  ORDER BY (sa."Season")::numeric DESC;
$function$;

CREATE FUNCTION public.get_boss_performance_overview(p_guild_code text, p_season text, p_level text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
DECLARE
  v_rarity text;
  v_level_number integer;
  v_set integer;
  v_cluster text;
  v_result jsonb;
  v_is_service boolean := COALESCE(
    NULLIF(NULLIF(current_setting('role', true), ''), 'none'),
    NULLIF(session_user, '')
  ) = 'service_role';
BEGIN
  IF NOT v_is_service AND NOT COALESCE(
    p_guild_code IN (SELECT public._pm_caller_guild_codes())
    OR p_guild_code IN (SELECT public._pm_caller_cluster_guild_codes())
    OR public._pm_caller_is_app_admin(),
    FALSE
  ) THEN
    RETURN NULL;
  END IF;
  IF p_level IS NULL OR length(p_level) = 0 THEN
    RAISE EXCEPTION 'Level is required';
  END IF;

  v_rarity := CASE upper(left(p_level, 1))
    WHEN 'M' THEN 'Mythic'
    WHEN 'E' THEN 'Epic'
    WHEN 'R' THEN 'Rare'
    WHEN 'U' THEN 'Uncommon'
    WHEN 'C' THEN 'Common'
    ELSE 'Legendary'
  END;

  v_level_number := NULLIF(regexp_replace(p_level, '[^0-9]', '', 'g'), '')::integer;
  v_set := GREATEST(0, COALESCE(v_level_number, 1) - 1);

  SELECT cluster_code INTO v_cluster
  FROM guild_config
  WHERE guild_code = p_guild_code
  LIMIT 1;

  WITH filtered AS (
    SELECT *
    FROM "EOT_GR_data"
    WHERE "Guild" = p_guild_code
      AND "Season" = p_season
      AND "set" = v_set
      AND "rarity" = v_rarity
      AND "damageType" = 'Battle'
      AND (
        v_cluster IS NULL
        OR v_cluster = ''
        OR "cluster_code" = v_cluster
      )
  ),
  boss_meta AS (
    SELECT
      COALESCE(
        (
          SELECT bm.boss_name
          FROM boss_mapping bm
          WHERE bm.boss_type = base_type
            AND bm.encounter_index = 0
          ORDER BY bm.auto_generated ASC NULLS LAST
          LIMIT 1
        ),
        base_type,
        'Boss ' || p_level
      ) AS boss_name,
      COALESCE(base_type, 'Unknown') AS boss_type
    FROM (
      SELECT
        COALESCE(
          MAX(NULLIF("type", '')),
          MAX(NULLIF("Name", ''))
        ) AS base_type
      FROM filtered
      WHERE COALESCE("encounterId", 0) = 0
    ) bt
  ),
  non_sweep AS (
    SELECT *
    FROM filtered
    WHERE COALESCE("encounterId", 0) = 0
      AND COALESCE("damageDealt", 0) > 0
      AND NOT (
        COALESCE("remainingHp", 0) = 0
        AND COALESCE("maxHp", 0) > 0
        AND COALESCE("damageDealt", 0) < "maxHp"
      )
  ),
  boss_all_token_counts AS (
    SELECT "displayName", COUNT(*) AS all_tokens
    FROM filtered
    WHERE COALESCE("encounterId", 0) = 0
    GROUP BY "displayName"
  ),
  boss_all_lap_counts AS (
    SELECT COALESCE("loopIndex", 0) AS lap, COUNT(*) AS all_tokens
    FROM filtered
    WHERE COALESCE("encounterId", 0) = 0
    GROUP BY COALESCE("loopIndex", 0)
  ),
  prime_all_token_counts AS (
    SELECT "displayName", COUNT(*) AS all_tokens
    FROM filtered
    WHERE COALESCE("encounterId", 0) > 0
    GROUP BY "displayName"
  ),
  main_hits AS (
    SELECT COALESCE("damageDealt", 0)::numeric AS dmg
    FROM non_sweep
  ),
  prime_rows AS (
    SELECT *
    FROM filtered
    WHERE COALESCE("encounterId", 0) > 0
      AND COALESCE("damageDealt", 0) > 0
  ),
  prime_named_rows AS (
    SELECT
      pr.*,
      COALESCE(
        (
          SELECT bm.boss_name
          FROM boss_mapping bm
          WHERE bm.boss_type = COALESCE(NULLIF(pr."type", ''), bm_base.boss_type)
            AND bm.encounter_index = COALESCE(pr."encounterId", 0)
          ORDER BY bm.auto_generated ASC NULLS LAST
          LIMIT 1
        ),
        COALESCE(NULLIF(pr."type", ''), pr."Name", 'Prime Boss')
      ) AS resolved_boss_name
    FROM prime_rows pr
    CROSS JOIN boss_meta bm_base
  ),
  player_stats AS (
    SELECT
      ns."displayName" AS display_name,
      AVG(ns."damageDealt") AS avg_damage,
      MAX(ns."damageDealt") AS max_hit,
      SUM(ns."damageDealt") AS total_damage,
      COALESCE(bat.all_tokens, COUNT(*))::bigint AS token_count,
      SUM(ns."damageDealt") / NULLIF(COUNT(*), 0) AS efficiency
    FROM non_sweep ns
    LEFT JOIN boss_all_token_counts bat ON bat."displayName" = ns."displayName"
    GROUP BY ns."displayName", bat.all_tokens
  ),
  prime_stats AS (
    SELECT
      pr."displayName" AS display_name,
      AVG(pr."damageDealt") AS avg_damage,
      MAX(pr."damageDealt") AS max_hit,
      COALESCE(pat.all_tokens, COUNT(*))::bigint AS token_count
    FROM prime_rows pr
    LEFT JOIN prime_all_token_counts pat ON pat."displayName" = pr."displayName"
    GROUP BY pr."displayName", pat.all_tokens
  ),
  prime_ranked AS (
    SELECT *,
      ROW_NUMBER() OVER (ORDER BY token_count DESC, avg_damage DESC) AS rnk
    FROM prime_stats
  ),
  prime_boss_players AS (
    SELECT
      resolved_boss_name AS boss_name,
      "displayName" AS display_name,
      AVG("damageDealt") AS avg_damage,
      MAX("damageDealt") AS max_hit,
      COUNT(*) AS token_count
    FROM prime_named_rows
    GROUP BY resolved_boss_name, "displayName"
  ),
  prime_boss_ranked AS (
    SELECT *,
      ROW_NUMBER() OVER (PARTITION BY boss_name ORDER BY avg_damage DESC, token_count DESC) AS boss_rank
    FROM prime_boss_players
  ),
  lap_trends AS (
    SELECT
      COALESCE(ns."loopIndex", 0) AS lap,
      AVG(ns."damageDealt") AS avg_damage,
      COALESCE(blc.all_tokens, COUNT(*))::bigint AS token_count
    FROM non_sweep ns
    LEFT JOIN boss_all_lap_counts blc ON blc.lap = COALESCE(ns."loopIndex", 0)
    GROUP BY COALESCE(ns."loopIndex", 0), blc.all_tokens
  ),
  top_stats AS (
    SELECT jsonb_build_object(
      'topTotalDamagePlayer',
      (SELECT display_name FROM player_stats ORDER BY total_damage DESC LIMIT 1),
      'topTotalDamage',
      COALESCE((SELECT total_damage FROM player_stats ORDER BY total_damage DESC LIMIT 1), 0),
      'biggestHitPlayer',
      (SELECT "displayName" FROM non_sweep ORDER BY COALESCE("damageDealt", 0) DESC LIMIT 1),
      'biggestHit',
      COALESCE((SELECT MAX("damageDealt") FROM non_sweep), 0),
      'totalBossTokens',
      (SELECT COUNT(*) FROM filtered WHERE COALESCE("encounterId", 0) = 0),
      'totalPrimeTokens',
      (SELECT COUNT(*) FROM filtered WHERE COALESCE("encounterId", 0) > 0),
      'overallAvgDamage',
      COALESCE((SELECT AVG("damageDealt") FROM non_sweep), 0)
    ) AS payload
  ),
  main_distribution AS (
    SELECT CASE
      WHEN EXISTS (SELECT 1 FROM main_hits)
        THEN jsonb_build_object(
          'name', (SELECT boss_name FROM boss_meta),
          'min', MIN(dmg),
          'q1', percentile_cont(0.25) WITHIN GROUP (ORDER BY dmg),
          'median', percentile_cont(0.5) WITHIN GROUP (ORDER BY dmg),
          'q3', percentile_cont(0.75) WITHIN GROUP (ORDER BY dmg),
          'max', MAX(dmg),
          'sampleSize', COUNT(*)
        )
      ELSE NULL
    END AS payload
    FROM main_hits
  ),
  prime_distribution_stats AS (
    SELECT jsonb_build_object(
      'name', resolved_boss_name,
      'min', MIN(dmg),
      'q1', percentile_cont(0.25) WITHIN GROUP (ORDER BY dmg),
      'median', percentile_cont(0.5) WITHIN GROUP (ORDER BY dmg),
      'q3', percentile_cont(0.75) WITHIN GROUP (ORDER BY dmg),
      'max', MAX(dmg),
      'sampleSize', COUNT(*)
    ) AS payload
    FROM (
      SELECT
        resolved_boss_name,
        COALESCE("damageDealt", 0)::numeric AS dmg
      FROM prime_named_rows
    ) p
    GROUP BY resolved_boss_name
  ),
  prime_distributions AS (
    SELECT COALESCE(
      jsonb_agg(payload ORDER BY payload->>'name'),
      '[]'::jsonb
    ) AS payload
    FROM prime_distribution_stats
  ),
  assigned_players AS (
    SELECT jsonb_build_object(
      'primary', COALESCE(
        (
          SELECT jsonb_agg(display_name ORDER BY display_name)
          FROM player_with_cluster pwc
          WHERE pwc.guild_code = p_guild_code
            AND (v_cluster IS NULL OR v_cluster = '' OR pwc.cluster_code = v_cluster)
            AND pwc.primary_boss = (SELECT boss_name FROM boss_meta)
        ),
        '[]'::jsonb
      ),
      'secondary', COALESCE(
        (
          SELECT jsonb_agg(display_name ORDER BY display_name)
          FROM player_with_cluster pwc
          WHERE pwc.guild_code = p_guild_code
            AND (v_cluster IS NULL OR v_cluster = '' OR pwc.cluster_code = v_cluster)
            AND pwc.secondary_boss = (SELECT boss_name FROM boss_meta)
        ),
        '[]'::jsonb
      )
    ) AS payload
  ),
  prime_boss_json AS (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'bossName', boss_name,
          'playerStats', players
        )
        ORDER BY boss_name
      ),
      '[]'::jsonb
    ) AS payload
    FROM (
      SELECT
        boss_name,
        jsonb_agg(
          jsonb_build_object(
            'displayName', display_name,
            'avgDamage', avg_damage,
            'maxHit', max_hit,
            'tokenCount', token_count
          )
          ORDER BY avg_damage DESC, token_count DESC
        ) AS players
      FROM prime_boss_ranked
      WHERE boss_rank <= 20
      GROUP BY boss_name
    ) s
  )
  SELECT jsonb_build_object(
    'bossName', (SELECT boss_name FROM boss_meta), 'bossType', (SELECT boss_type FROM boss_meta),
    'playerStats', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'displayName', display_name,
            'avgDamage', avg_damage,
            'maxHit', max_hit,
            'totalDamage', total_damage,
            'tokenCount', token_count,
            'efficiency', efficiency
          )
          ORDER BY avg_damage DESC
        )
        FROM player_stats
      ),
      '[]'::jsonb
    ),
    'primeStats', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'displayName', display_name,
            'avgDamage', avg_damage,
            'maxHit', max_hit,
            'tokenCount', token_count
          )
          ORDER BY token_count DESC, avg_damage DESC
        )
        FROM prime_ranked
        WHERE rnk <= 30
      ),
      '[]'::jsonb
    ),
    'primeBossStats', (SELECT payload FROM prime_boss_json),
    'primeDistributions', (SELECT payload FROM prime_distributions),
    'lapTrends', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'lap', lap + 1,
            'avgDamage', avg_damage,
            'tokenCount', token_count
          )
          ORDER BY lap
        )
        FROM lap_trends
      ),
      '[]'::jsonb
    ),
    'topStats', (SELECT payload FROM top_stats),
    'mainDistribution', (SELECT payload FROM main_distribution),
    'assignedPlayers', (SELECT payload FROM assigned_players),
    'hasPrimeData', EXISTS(SELECT 1 FROM prime_rows),
    'hasCluster', (v_cluster IS NOT NULL AND v_cluster <> '')
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

ALTER TABLE public.meta_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_teams FORCE ROW LEVEL SECURITY;
ALTER TABLE public.hero_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hero_mappings FORCE ROW LEVEL SECURITY;
ALTER TABLE public.player_avatar_frames ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_avatar_frames FORCE ROW LEVEL SECURITY;
ALTER TABLE public.boss_mapping ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.boss_mapping FORCE ROW LEVEL SECURITY;
CREATE POLICY desktop_meta_catalog_read ON public.meta_teams FOR SELECT TO authenticated,desktop_rpc_reader USING(true);
CREATE POLICY desktop_hero_catalog_read ON public.hero_mappings FOR SELECT TO authenticated,desktop_rpc_reader USING(true);
CREATE POLICY desktop_avatar_catalog_read ON public.player_avatar_frames FOR SELECT TO authenticated,desktop_rpc_reader USING(true);
CREATE POLICY desktop_boss_catalog_read ON public.boss_mapping FOR SELECT TO authenticated,desktop_rpc_reader USING(true);
GRANT SELECT ON public.meta_teams,public.hero_mappings,public.player_avatar_frames,public.boss_mapping TO authenticated,desktop_rpc_reader,service_role;
GRANT SELECT(avatar_unit_id) ON public.player_mapping TO authenticated;
DO $core_rpc$
DECLARE fn regprocedure;
BEGIN
 FOR fn IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN ('_pm_caller_mapping_rows','get_boss_difficulty_analysis','get_damage_by_boss_loop','get_token_usage_by_loop','get_guild_vs_cluster_prime_performance','get_token_usage_by_loop_and_set','get_guild_trends_batch','get_boss_performance_overview') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',fn);
  EXECUTE format('ALTER FUNCTION %s OWNER TO desktop_rpc_reader',fn);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated,service_role,desktop_rpc_reader',fn);
 END LOOP;
END;
$core_rpc$;

CREATE FUNCTION public.get_player_stats_comprehensive(p_guild_code text, p_season text, p_display_name text) RETURNS jsonb
    LANGUAGE sql
    AS $$
WITH cluster_info AS (
  SELECT cluster_code
  FROM guild_config
  WHERE guild_code = p_guild_code
  LIMIT 1
),
battle AS (
  SELECT
    "Name" AS name,
    tier,
    set,
    "encounterId" AS encounter_id,
    "damageDealt" AS damage_dealt,
    "damageType" AS damage_type,
    "maxHp" AS max_hp,
    "remainingHp" AS remaining_hp,
    rarity,
    "loopIndex" AS loop_index,
    ( "remainingHp" = 0 AND "maxHp" > 0 AND "damageDealt" < "maxHp" AND "damageType" = 'Battle' ) AS is_sweep,
    ( "remainingHp" = 0 AND "damageDealt" >= "maxHp" AND "damageType" = 'Battle' ) AS is_one_shot,
    ( "damageType" = 'Battle' AND "damageDealt" = 0 ) AS is_crash
  FROM "EOT_GR_data"
  WHERE "Guild" = p_guild_code
    AND "Season" = p_season
    AND "displayName" = p_display_name
),
agg AS (
  SELECT
    coalesce(sum(CASE WHEN damage_type IN ('Battle','Bomb') THEN damage_dealt END), 0) AS total_damage,
    avg(nullif(CASE
      WHEN damage_type = 'Battle'
        AND NOT is_sweep
        AND damage_dealt > 0
      THEN damage_dealt
    END, 0)) AS avg_damage_per_hit,
    count(*) FILTER (WHERE damage_type = 'Battle') AS tokens_used,
    count(*) FILTER (WHERE damage_type = 'Bomb') AS bombs_used,
    count(*) FILTER (WHERE damage_type = 'Battle' AND rarity IN ('Legendary','Mythic')) AS legendary_tokens_used,
    count(*) FILTER (WHERE damage_type = 'Bomb' AND rarity IN ('Legendary','Mythic')) AS legendary_bombs_used,
    count(*) FILTER (WHERE remaining_hp = 0 AND damage_dealt > 0) AS kills,
    count(*) FILTER (WHERE is_sweep) AS sweeps,
    count(*) FILTER (WHERE is_one_shot) AS one_shots,
    count(*) FILTER (WHERE is_crash) AS crashes
  FROM battle
),
guild_avg AS (
  SELECT
    "Name" AS name,
    rarity,
    set AS set_val,
    CASE WHEN "encounterId" = 0 THEN 'boss' ELSE 'prime' END AS kind,
    avg("damageDealt")::numeric AS avg_damage
  FROM "EOT_GR_data"
  WHERE "Guild" = p_guild_code
    AND "Season" = p_season
    AND "damageType" = 'Battle'
    AND rarity IN ('Legendary', 'Mythic')
    AND "damageDealt" > 0
    AND NOT ("remainingHp" = 0 AND "maxHp" > 0 AND "damageDealt" < "maxHp")
  GROUP BY "Name", rarity, set, CASE WHEN "encounterId" = 0 THEN 'boss' ELSE 'prime' END
),
cluster_avg AS (
  SELECT
    e."Name" AS name,
    e.rarity,
    e.set AS set_val,
    CASE WHEN e."encounterId" = 0 THEN 'boss' ELSE 'prime' END AS kind,
    avg(e."damageDealt")::numeric AS avg_damage
  FROM "EOT_GR_data" e
  JOIN guild_config gc ON gc.guild_code = e."Guild"
  CROSS JOIN cluster_info ci
  WHERE e."Season" = p_season
    AND gc.cluster_code = ci.cluster_code
    AND e."damageType" = 'Battle'
    AND e.rarity IN ('Legendary', 'Mythic')
    AND e."damageDealt" > 0
    AND NOT (e."remainingHp" = 0 AND e."maxHp" > 0 AND e."damageDealt" < e."maxHp")
    AND ci.cluster_code IS NOT NULL
  GROUP BY e."Name", e.rarity, e.set, CASE WHEN e."encounterId" = 0 THEN 'boss' ELSE 'prime' END
),
bosses AS (
  SELECT
    CASE WHEN min(encounter_id) = 0 THEN 'boss' ELSE 'prime' END AS kind,
    concat(name, '_', rarity, '_', set) AS boss_key,
    name,
    set AS set_val,
    max(tier) AS tier_max,
    rarity,
    min(encounter_id) AS encounter_id,
    sum(damage_dealt) FILTER ( WHERE NOT is_sweep ) AS damage,
    count(*) FILTER ( WHERE damage_type = 'Battle' AND NOT is_sweep ) AS tokens,
    max(damage_dealt) AS biggest_hit,
    count(*) FILTER (WHERE is_sweep) AS sweeps,
    count(*) FILTER (WHERE is_one_shot) AS one_shots,
    count(*) FILTER (WHERE is_crash) AS crashes,
    count(*) FILTER (WHERE damage_type = 'Battle') AS total_tokens,
    sum(damage_dealt) FILTER (WHERE damage_type = 'Battle') AS total_damage_with_sweeps,
    avg(damage_dealt) FILTER (WHERE damage_type = 'Battle' AND NOT is_sweep AND damage_dealt > 0)::numeric AS player_avg,
    array_agg(damage_dealt::numeric) FILTER (WHERE is_sweep AND damage_dealt > 0) AS sweep_damages
  FROM battle
  WHERE rarity IN ('Legendary','Mythic') AND damage_type = 'Battle'
  GROUP BY name, rarity, set
),
boss_with_vs AS (
  SELECT
    b.*,
    coalesce(qualifying_sweep_count(b.sweep_damages, GREATEST(b.player_avg, ga.avg_damage)), 0) AS qualifying_sweeps_guild,
    coalesce(qualifying_sweep_count(b.sweep_damages, GREATEST(b.player_avg, ca.avg_damage)), 0) AS qualifying_sweeps_cluster,
    coalesce(b.damage, 0) + coalesce(qualifying_sweep_sum(b.sweep_damages, GREATEST(b.player_avg, ga.avg_damage)), 0) AS adj_damage_guild,
    (coalesce(b.tokens, 0) + coalesce(qualifying_sweep_count(b.sweep_damages, GREATEST(b.player_avg, ga.avg_damage)), 0)) AS adj_count_guild,
    ROUND(COALESCE(calc_boss_performance_pct(b.damage, b.tokens, b.sweep_damages, ga.avg_damage, b.player_avg), 0)::numeric, 1) AS vs_guild,
    ROUND(COALESCE(calc_boss_performance_pct(b.damage, b.tokens, b.sweep_damages, ca.avg_damage, b.player_avg), 0)::numeric, 1) AS vs_cluster
  FROM bosses b
  LEFT JOIN guild_avg ga ON ga.name = b.name AND ga.rarity = b.rarity AND ga.set_val = b.set_val AND ga.kind = b.kind
  LEFT JOIN cluster_avg ca ON ca.name = b.name AND ca.rarity = b.rarity AND ca.set_val = b.set_val AND ca.kind = b.kind
),
overall_weighted AS (
  SELECT
    CASE WHEN sum(coalesce(tokens, 0) + qualifying_sweeps_guild) > 0
      THEN sum(vs_guild * (coalesce(tokens, 0) + qualifying_sweeps_guild)) / sum(coalesce(tokens, 0) + qualifying_sweeps_guild)
      ELSE 0 END AS weighted_vs_guild,
    CASE WHEN sum(coalesce(tokens, 0) + qualifying_sweeps_cluster) > 0
      THEN sum(vs_cluster * (coalesce(tokens, 0) + qualifying_sweeps_cluster)) / sum(coalesce(tokens, 0) + qualifying_sweeps_cluster)
      ELSE 0 END AS weighted_vs_cluster
  FROM boss_with_vs
  WHERE (coalesce(tokens, 0) + qualifying_sweeps_guild) > 0
     OR (coalesce(tokens, 0) + qualifying_sweeps_cluster) > 0
),
boss_map AS (
  SELECT coalesce(
    jsonb_object_agg(
      b.boss_key,
      jsonb_build_object(
        'damage', coalesce(b.damage,0),
        'tokens', coalesce(b.tokens,0),
        'avgDamage', CASE WHEN b.adj_count_guild > 0 THEN b.adj_damage_guild::float / b.adj_count_guild ELSE 0 END,
        'biggestHit', coalesce(b.biggest_hit,0),
        'sweeps', coalesce(b.sweeps,0),
        'oneShots', coalesce(b.one_shots,0),
        'crashes', coalesce(b.crashes,0),
        'totalTokens', coalesce(b.total_tokens,0),
        'totalDamageWithSweeps', coalesce(b.total_damage_with_sweeps,0),
        'avgDamageWithSweeps', CASE WHEN b.total_tokens > 0 THEN b.total_damage_with_sweeps::float / b.total_tokens ELSE 0 END,
        'set', b.set_val,
        'tier', b.tier_max,
        'rarity', b.rarity,
        'encounterId', b.encounter_id,
        'vsGuildAvg', b.vs_guild,
        'vsClusterAvg', b.vs_cluster,
        'qualifyingSweepsGuild', coalesce(b.qualifying_sweeps_guild, 0),
        'qualifyingSweepsCluster', coalesce(b.qualifying_sweeps_cluster, 0)
      )
    ) FILTER (WHERE b.kind = 'boss'),
    '{}'::jsonb
  ) AS boss_stats,
  coalesce(
    jsonb_object_agg(
      b.boss_key,
      jsonb_build_object(
        'damage', coalesce(b.damage,0),
        'tokens', coalesce(b.tokens,0),
        'avgDamage', CASE WHEN b.adj_count_guild > 0 THEN b.adj_damage_guild::float / b.adj_count_guild ELSE 0 END,
        'biggestHit', coalesce(b.biggest_hit,0),
        'sweeps', coalesce(b.sweeps,0),
        'oneShots', coalesce(b.one_shots,0),
        'crashes', coalesce(b.crashes,0),
        'totalTokens', coalesce(b.total_tokens,0),
        'totalDamageWithSweeps', coalesce(b.total_damage_with_sweeps,0),
        'avgDamageWithSweeps', CASE WHEN b.total_tokens > 0 THEN b.total_damage_with_sweeps::float / b.total_tokens ELSE 0 END,
        'set', b.set_val,
        'tier', b.tier_max,
        'rarity', b.rarity,
        'encounterId', b.encounter_id,
        'vsGuildAvg', b.vs_guild,
        'vsClusterAvg', b.vs_cluster,
        'qualifyingSweepsGuild', coalesce(b.qualifying_sweeps_guild, 0),
        'qualifyingSweepsCluster', coalesce(b.qualifying_sweeps_cluster, 0)
      )
    ) FILTER (WHERE b.kind = 'prime'),
    '{}'::jsonb
  ) AS prime_stats
  FROM boss_with_vs b
),
historical_tokens AS (
  SELECT coalesce(
    jsonb_object_agg(season, token_count),
    '{}'::jsonb
  ) AS season_tokens
  FROM (
    SELECT "Season" AS season, count(*) AS token_count
    FROM "EOT_GR_data"
    WHERE "Guild" = p_guild_code
      AND "displayName" = p_display_name
      AND "damageType" = 'Battle'
      AND "damageDealt" > 0
    GROUP BY "Season"
  ) t
)
SELECT jsonb_build_object(
  'totalDamage', agg.total_damage,
  'avgDamagePerHit', coalesce(agg.avg_damage_per_hit, 0),
  'tokensUsed', agg.tokens_used,
  'bombsUsed', agg.bombs_used,
  'legendaryTokensUsed', agg.legendary_tokens_used,
  'legendaryBombsUsed', agg.legendary_bombs_used,
  'maxPossibleTokens', 0,
  'maxPossibleBombs', 0,
  'isTokenOffender', false,
  'isTokenAbuser', false,
  'kills', agg.kills,
  'sweeps', agg.sweeps,
  'oneShots', agg.one_shots,
  'crashes', agg.crashes,
  'vsClusterAvg', coalesce(round(ow.weighted_vs_cluster::numeric, 1), 0),
  'vsGuildAvg', coalesce(round(ow.weighted_vs_guild::numeric, 1), 0),
  'weightedContribution', 0,
  'bossStats', coalesce(boss_map.boss_stats, '{}'::jsonb),
  'primeStats', coalesce(boss_map.prime_stats, '{}'::jsonb),
  'historicalTokens', coalesce(historical_tokens.season_tokens, '{}'::jsonb)
) AS result
FROM agg
CROSS JOIN boss_map
CROSS JOIN historical_tokens
CROSS JOIN overall_weighted ow;
$$;
REVOKE ALL ON FUNCTION public.get_player_stats_comprehensive(text,text,text) FROM PUBLIC,anon,authenticated,desktop_rpc_reader;
GRANT EXECUTE ON FUNCTION public.get_player_stats_comprehensive(text,text,text) TO service_role;

CREATE FUNCTION public.get_player_boss_rankings(p_player_name text, p_guild_code text, p_cluster_code text, p_season text) RETURNS TABLE(boss_name text, encounter_id integer, player_rank integer, total_players integer)
    LANGUAGE plpgsql
    AS $$
BEGIN
  RETURN QUERY
  WITH boss_performances AS (
    SELECT
      CONCAT(COALESCE(resolve_boss_name(e."Name"), e."Name"), '_', e.rarity, '_', e.set) as boss_name,
      e."encounterId" as encounter_id,
      e."displayName" as player_name,
      e."Guild" as guild,
      AVG(e."damageDealt") as avg_damage
    FROM "EOT_GR_data" e
    LEFT JOIN guild_config gc ON gc.guild_code = e."Guild"
    WHERE e."Season" = p_season
      AND e."damageType" = 'Battle'
      AND e.rarity IN ('Legendary', 'Mythic')
      AND e."damageDealt" > 0
      AND gc.cluster_code = p_cluster_code
      AND NOT (e."remainingHp" = 0 AND e."maxHp" > 0 AND e."damageDealt" < e."maxHp")
    GROUP BY COALESCE(resolve_boss_name(e."Name"), e."Name"), e.rarity, e.set, e."encounterId", e."displayName", e."Guild"
  ),
  ranked_performances AS (
    SELECT
      bp.boss_name,
      bp.encounter_id,
      bp.player_name,
      bp.guild,
      bp.avg_damage,
      RANK() OVER (PARTITION BY bp.boss_name, bp.encounter_id ORDER BY bp.avg_damage DESC) as rank,
      COUNT(*) OVER (PARTITION BY bp.boss_name, bp.encounter_id) as total_players
    FROM boss_performances bp
  )
  SELECT
    rp.boss_name,
    rp.encounter_id,
    rp.rank::INTEGER as player_rank,
    rp.total_players::INTEGER
  FROM ranked_performances rp
  WHERE rp.player_name = p_player_name
    AND rp.guild = p_guild_code;
END;
$$;

CREATE FUNCTION public.get_player_damage_by_boss_loop(p_guild_code text, p_season text, p_display_name text) RETURNS TABLE(loop_index integer, boss_display_name text, avg_damage numeric, max_damage numeric, total_damage bigint, hit_count integer, start_time timestamp with time zone, end_time timestamp with time zone, is_prime boolean, sweep_count integer, one_shot_count integer, crash_count integer, eff_avg_damage numeric)
    LANGUAGE plpgsql
    AS $$
BEGIN
  RETURN QUERY
  WITH boss_data AS (
    SELECT
      d."loopIndex",
      d."Name",
      d."damageDealt",
      d."remainingHp",
      d."maxHp",
      d."timestamp",
      d."startedOn",
      d."completedOn",
      d.rarity,
      d.set,
      d."encounterId",
      CASE
        WHEN d.rarity = 'Mythic' THEN 'M' || (COALESCE(d.set, 0) + 1)::TEXT
        ELSE 'L' || (COALESCE(d.set, 0) + 1)::TEXT
      END || ' ' || d."Name" AS display_name,
      (d."encounterId" != 0) AS is_prime_enemy
    FROM "EOT_GR_data" d
    WHERE d."Guild" = p_guild_code
      AND d."Season" = p_season
      AND d."displayName" = p_display_name
      AND d."damageType" = 'Battle'
      AND d.rarity IN ('Legendary', 'Mythic')
      AND d."loopIndex" IS NOT NULL
  )
  SELECT
    bd."loopIndex"::INTEGER AS loop_index,
    bd.display_name AS boss_display_name,
    ROUND(AVG(bd."damageDealt") FILTER (WHERE bd."damageDealt" > 0), 0) AS avg_damage,
    MAX(bd."damageDealt") FILTER (WHERE bd."damageDealt" > 0)::NUMERIC AS max_damage,
    SUM(bd."damageDealt")::BIGINT AS total_damage,
    COUNT(*) FILTER (WHERE bd."damageDealt" > 0)::INTEGER AS hit_count,
    MIN(COALESCE(bd."startedOn", bd."timestamp")) AS start_time,
    MAX(COALESCE(bd."completedOn", bd."timestamp")) AS end_time,
    bd.is_prime_enemy AS is_prime,
    COUNT(*) FILTER (
      WHERE bd."damageDealt" > 0
        AND bd."remainingHp" = 0
        AND bd."maxHp" > 0
        AND bd."damageDealt" < bd."maxHp"
    )::INTEGER AS sweep_count,
    COUNT(*) FILTER (
      WHERE bd."maxHp" > 0
        AND bd."damageDealt" >= bd."maxHp"
    )::INTEGER AS one_shot_count,
    COUNT(*) FILTER (WHERE bd."damageDealt" = 0)::INTEGER AS crash_count,
    ROUND(AVG(bd."damageDealt") FILTER (
      WHERE bd."damageDealt" > 0
        AND NOT (bd."remainingHp" = 0 AND bd."maxHp" > 0 AND bd."damageDealt" < bd."maxHp")
    ), 0) AS eff_avg_damage
  FROM boss_data bd
  GROUP BY bd."loopIndex", bd.display_name, bd.is_prime_enemy
  ORDER BY bd."loopIndex", bd.display_name;
END;
$$;
REVOKE ALL ON FUNCTION public.get_player_damage_by_boss_loop(text,text,text),public.get_player_boss_rankings(text,text,text,text) FROM PUBLIC,anon,authenticated;
ALTER FUNCTION public.get_player_damage_by_boss_loop(text,text,text) OWNER TO desktop_rpc_reader;
ALTER FUNCTION public.get_player_boss_rankings(text,text,text,text) OWNER TO desktop_rpc_reader;
GRANT EXECUTE ON FUNCTION public.get_player_damage_by_boss_loop(text,text,text),public.get_player_boss_rankings(text,text,text,text) TO authenticated,desktop_rpc_reader,service_role;

CREATE TABLE public.boss_name_aliases (
    id integer NOT NULL,
    canonical_name text NOT NULL,
    alias_name text NOT NULL,
    unit_id text,
    created_at timestamp with time zone DEFAULT now(),
    notes text
);

CREATE FUNCTION public.resolve_boss_name(p_name text) RETURNS text
    LANGUAGE sql STABLE
    AS $$
  SELECT COALESCE(
    (SELECT canonical_name FROM boss_name_aliases WHERE alias_name = p_name LIMIT 1),
    p_name
  );
$$;
ALTER TABLE public.boss_name_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.boss_name_aliases FORCE ROW LEVEL SECURITY;
CREATE POLICY desktop_boss_alias_read ON public.boss_name_aliases FOR SELECT TO authenticated,desktop_rpc_reader USING(true);
GRANT SELECT ON public.boss_name_aliases TO authenticated,desktop_rpc_reader,service_role;
REVOKE ALL ON FUNCTION public.resolve_boss_name(text) FROM PUBLIC,anon,authenticated;
ALTER FUNCTION public.resolve_boss_name(text) OWNER TO desktop_rpc_reader;
GRANT EXECUTE ON FUNCTION public.resolve_boss_name(text) TO authenticated,desktop_rpc_reader,service_role;

ALTER TABLE public.desktop_preview_setup ADD COLUMN recovery_code_hash text CHECK (recovery_code_hash ~ '^[a-f0-9]{64}$');
REVOKE ALL ON public.desktop_preview_setup FROM PUBLIC,anon,authenticated,service_role,desktop_rpc_reader;

-- Local identity claims describe this workspace only; never upstream ownership.
ALTER TABLE public.desktop_preview_setup ADD COLUMN identity_mode text NOT NULL DEFAULT 'sample' CHECK (identity_mode IN ('sample','local-file'));
ALTER TABLE public.desktop_preview_setup ADD COLUMN guild_code text;
UPDATE public.desktop_preview_setup s SET guild_code=(SELECT min(p.guild_code) FROM public.player_mapping p WHERE p.user_id=s.subject_user_id AND p.is_current);
ALTER TABLE public.player_identity_attestations DROP CONSTRAINT player_identity_attestations_source_check;
ALTER TABLE public.player_identity_attestations ADD CONSTRAINT player_identity_attestations_source_check CHECK (source IN ('invite_consumption','historical_exact_invite','operator_quarantine_restore','self_player_id_change','desktop_local_claim'));
ALTER TABLE public.player_identity_attestations DROP CONSTRAINT player_identity_attestations_invite_presence;
ALTER TABLE public.player_identity_attestations ADD CONSTRAINT player_identity_attestations_invite_presence CHECK (source IN ('operator_quarantine_restore','desktop_local_claim') OR source_invite_id IS NOT NULL);

ALTER TABLE public."EOT_GR_data" ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY;
SELECT setval(pg_get_serial_sequence('public."EOT_GR_data"','id'),coalesce((SELECT max(id)+1 FROM public."EOT_GR_data"),1),false);
CREATE UNIQUE INDEX desktop_raid_conflict_key ON public."EOT_GR_data" ("Guild","Season","userId","encounterId","startedOn","completedOn","damageDealt","damageType");
CREATE ROLE desktop_importer NOLOGIN NOSUPERUSER NOBYPASSRLS;
GRANT USAGE ON SCHEMA public,auth TO desktop_importer;
GRANT EXECUTE ON FUNCTION auth.uid() TO desktop_importer;
GRANT SELECT ON public.desktop_preview_setup TO desktop_importer;
CREATE POLICY desktop_import_setup ON public.desktop_preview_setup FOR SELECT TO desktop_importer USING (subject_user_id=auth.uid());
GRANT SELECT (guild_code,cluster_code,cluster_id) ON public.guild_config TO desktop_importer;
CREATE POLICY desktop_import_guild ON public.guild_config FOR SELECT TO desktop_importer USING (guild_code IN (SELECT s.guild_code FROM public.desktop_preview_setup s));
GRANT INSERT ON public."EOT_GR_data" TO desktop_importer;
GRANT SELECT ("Guild","Season","userId","encounterId","startedOn","completedOn","damageDealt","damageType") ON public."EOT_GR_data" TO desktop_importer;
CREATE POLICY desktop_import_conflict_read ON public."EOT_GR_data" FOR SELECT TO desktop_importer USING ("Guild" IN (SELECT s.guild_code FROM public.desktop_preview_setup s));
GRANT USAGE ON SEQUENCE public."EOT_GR_data_id_seq" TO desktop_importer;
CREATE POLICY desktop_import_write ON public."EOT_GR_data" FOR INSERT TO desktop_importer WITH CHECK ("Guild" IN (SELECT s.guild_code FROM public.desktop_preview_setup s));

CREATE TABLE public.desktop_raid_imports (
 subject_user_id uuid NOT NULL REFERENCES auth.users(id),
 fingerprint text NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
 guild_code text NOT NULL,
 entry_count integer NOT NULL CHECK (entry_count BETWEEN 1 AND 10000),
 inserted_count integer NOT NULL CHECK (inserted_count BETWEEN 0 AND entry_count),
 imported_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (subject_user_id,fingerprint)
);
ALTER TABLE public.desktop_raid_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.desktop_raid_imports FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.desktop_raid_imports FROM PUBLIC,anon,authenticated,service_role,desktop_rpc_reader;
GRANT SELECT,INSERT ON public.desktop_raid_imports TO desktop_importer;
CREATE POLICY desktop_import_receipt ON public.desktop_raid_imports TO desktop_importer USING (subject_user_id=auth.uid()) WITH CHECK (subject_user_id=auth.uid());

CREATE FUNCTION public.desktop_import_raid(p_fingerprint text,p_rows jsonb) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $import$
DECLARE target text; target_cluster text; target_cluster_id uuid; count_rows integer; count_inserted integer; previous integer;
BEGIN
 SELECT s.guild_code INTO STRICT target FROM public.desktop_preview_setup s WHERE s.subject_user_id=auth.uid() AND s.singleton;
 SELECT g.cluster_code,g.cluster_id INTO STRICT target_cluster,target_cluster_id FROM public.guild_config g WHERE g.guild_code=target;
 IF target IS NULL OR p_fingerprint IS NULL OR p_fingerprint !~ '^[a-f0-9]{64}$' OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid local import'; END IF;
 count_rows:=jsonb_array_length(p_rows);
 IF count_rows NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'Invalid local import'; END IF;
 IF EXISTS (SELECT 1 FROM jsonb_populate_recordset(NULL::public."EOT_GR_data",p_rows) r WHERE
   r."Guild" IS DISTINCT FROM target OR r.cluster_code IS DISTINCT FROM target_cluster OR r.cluster_id IS DISTINCT FROM target_cluster_id OR
   r."Season" IS NULL OR r."Season" !~ '^[0-9]{1,6}$' OR r."Season"::integer<1 OR
   r."userId" IS NULL OR length(r."userId") NOT BETWEEN 1 AND 128 OR
   r."startedOn" IS NULL OR r."completedOn" IS NULL OR r."completedOn"<r."startedOn" OR
   r."damageDealt" IS NULL OR r."damageDealt" NOT BETWEEN 0 AND 1000000000000 OR r."damageType" IS NULL OR r."damageType" NOT IN ('Battle','Bomb') OR
   r."startedOn"<'2000-01-01T00:00:00Z'::timestamptz OR r."completedOn">'2100-01-01T00:00:00Z'::timestamptz OR
   r."displayName" IS NULL OR length(r."displayName") NOT BETWEEN 1 AND 128 OR r."Name" IS NULL OR length(r."Name") NOT BETWEEN 1 AND 256 OR
   r.rarity IS NULL OR r.rarity NOT IN ('Common','Uncommon','Rare','Epic','Legendary','Mythic') OR r.set IS NULL OR r.set NOT BETWEEN 0 AND 4 OR r.tier IS NULL OR r.tier NOT BETWEEN 0 AND 10000 OR
   r."maxHp" IS NULL OR r."maxHp" NOT BETWEEN 0 AND 1000000000000 OR r."remainingHp" IS NULL OR r."remainingHp" NOT BETWEEN 0 AND r."maxHp" OR
   r."encounterIndex" IS NULL OR r."encounterIndex" NOT BETWEEN 0 AND 1000 OR r."encounterId" IS DISTINCT FROM r."encounterIndex") THEN RAISE EXCEPTION 'Invalid local import'; END IF;
 PERFORM pg_advisory_xact_lock(74832019);
 SELECT i.inserted_count INTO previous FROM public.desktop_raid_imports i WHERE i.subject_user_id=auth.uid() AND i.fingerprint=p_fingerprint;
 IF FOUND THEN RETURN jsonb_build_object('entries',count_rows,'inserted',0,'repeated',true); END IF;
 WITH inserted AS (
   INSERT INTO public."EOT_GR_data" ("Guild","Season","userId","displayName","Name",type,"encounterType","encounterId","encounterIndex","damageType","damageDealt","remainingHp","maxHp","startedOn","completedOn",rarity,tier,set,"loopIndex","heroDetails","machineOfWarDetails","unitId","globalConfigHash",cluster_code,cluster_id)
   SELECT r."Guild",r."Season",r."userId",r."displayName",r."Name",r.type,r."encounterType",r."encounterId",r."encounterIndex",r."damageType",r."damageDealt",r."remainingHp",r."maxHp",r."startedOn",r."completedOn",r.rarity,r.tier,r.set,r."loopIndex",r."heroDetails",r."machineOfWarDetails",r."unitId",r."globalConfigHash",r.cluster_code,r.cluster_id
   FROM jsonb_populate_recordset(NULL::public."EOT_GR_data",p_rows) r
   ON CONFLICT ("Guild","Season","userId","encounterId","startedOn","completedOn","damageDealt","damageType") DO NOTHING RETURNING 1
 ) SELECT count(*) INTO count_inserted FROM inserted;
 INSERT INTO public.desktop_raid_imports(subject_user_id,fingerprint,guild_code,entry_count,inserted_count) VALUES(auth.uid(),p_fingerprint,target,count_rows,count_inserted);
 RETURN jsonb_build_object('entries',count_rows,'inserted',count_inserted,'repeated',false);
END $import$;
ALTER FUNCTION public.desktop_import_raid(text,jsonb) OWNER TO desktop_importer;
REVOKE ALL ON FUNCTION public.desktop_import_raid(text,jsonb) FROM PUBLIC,anon,authenticated,service_role,desktop_rpc_reader;
GRANT EXECUTE ON FUNCTION public.desktop_import_raid(text,jsonb) TO desktop_owner;

-- Add canonical meta-team membership to the local profile.
CREATE TABLE public.player_meta_roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    meta_team_id uuid NOT NULL,
    source text NOT NULL,
    set_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT player_meta_roles_source_check CHECK ((source = ANY (ARRAY['auto'::text, 'self'::text, 'manual'::text, 'leader_override'::text])))
);

CREATE FUNCTION public.player_meta_roles_set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Local membership retains canonical rows and allows scoped human changes.
ALTER TABLE public.meta_teams ADD PRIMARY KEY (id);
ALTER TABLE public.player_meta_roles ADD PRIMARY KEY (id);
ALTER TABLE public.player_meta_roles ADD UNIQUE (user_id,meta_team_id);
ALTER TABLE public.player_meta_roles ADD FOREIGN KEY (meta_team_id) REFERENCES public.meta_teams(id) ON DELETE CASCADE;
ALTER TABLE public.player_meta_roles ADD FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.player_meta_roles ADD FOREIGN KEY (set_by) REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE TRIGGER trg_player_meta_roles_updated_at BEFORE UPDATE ON public.player_meta_roles FOR EACH ROW EXECUTE FUNCTION public.player_meta_roles_set_updated_at();
ALTER TABLE public.player_meta_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_meta_roles FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.player_meta_roles FROM PUBLIC,anon,authenticated,service_role,desktop_rpc_reader;
REVOKE ALL ON FUNCTION public.player_meta_roles_set_updated_at() FROM PUBLIC,anon,authenticated,service_role,desktop_rpc_reader;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.player_meta_roles TO authenticated;
GRANT SELECT ON public.player_meta_roles TO service_role;
CREATE POLICY desktop_meta_role_read ON public.player_meta_roles FOR SELECT TO authenticated USING (
 user_id=auth.uid() OR EXISTS (SELECT 1 FROM public.player_mapping p WHERE p.user_id=player_meta_roles.user_id AND p.is_current AND p.guild_code IN (SELECT public._pm_caller_guild_codes()))
);
CREATE POLICY desktop_meta_role_self ON public.player_meta_roles TO authenticated USING (user_id=auth.uid() AND source='self') WITH CHECK (user_id=auth.uid() AND source='self' AND set_by=auth.uid());
CREATE POLICY desktop_meta_role_leader_insert ON public.player_meta_roles FOR INSERT TO authenticated WITH CHECK (source='leader_override' AND set_by=auth.uid() AND EXISTS (SELECT 1 FROM public.player_mapping caller JOIN public.player_mapping target ON target.guild_code=caller.guild_code WHERE caller.user_id=auth.uid() AND caller.is_current AND caller.role::text IN ('officer','leader') AND target.user_id=player_meta_roles.user_id AND target.is_current));
CREATE POLICY desktop_meta_role_leader_update ON public.player_meta_roles FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM public.player_mapping caller JOIN public.player_mapping target ON target.guild_code=caller.guild_code WHERE caller.user_id=auth.uid() AND caller.is_current AND caller.role::text IN ('officer','leader') AND target.user_id=player_meta_roles.user_id AND target.is_current)) WITH CHECK (source='leader_override' AND set_by=auth.uid() AND EXISTS (SELECT 1 FROM public.player_mapping caller JOIN public.player_mapping target ON target.guild_code=caller.guild_code WHERE caller.user_id=auth.uid() AND caller.is_current AND caller.role::text IN ('officer','leader') AND target.user_id=player_meta_roles.user_id AND target.is_current));
CREATE POLICY desktop_meta_role_leader_delete ON public.player_meta_roles FOR DELETE TO authenticated USING (source='leader_override' AND EXISTS (SELECT 1 FROM public.player_mapping caller JOIN public.player_mapping target ON target.guild_code=caller.guild_code WHERE caller.user_id=auth.uid() AND caller.is_current AND caller.role::text IN ('officer','leader') AND target.user_id=player_meta_roles.user_id AND target.is_current));

-- Canonical roster read model and an explicit, unverified local own-key cache.
CREATE TABLE public.player_roster (
    id bigint NOT NULL,
    user_id uuid,
    hero_mapping_id integer,
    rank_name text NOT NULL,
    stars integer DEFAULT 0,
    crit_item_id text,
    crit_item_level integer,
    booster_item_id text,
    booster_item_level integer,
    defensive_item_id text,
    defensive_item_level integer,
    synced_at timestamp with time zone DEFAULT now(),
    rarity text,
    xp integer,
    xp_level integer,
    progression_index integer,
    shards integer,
    mythic_shards integer,
    active_ability_level integer,
    passive_ability_level integer,
    upgrades integer[],
    player_mapping_id integer
);

CREATE SEQUENCE public.player_roster_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER TABLE public.hero_mappings ADD PRIMARY KEY (id);
ALTER TABLE public.hero_mappings ADD UNIQUE (unit_id);
ALTER SEQUENCE public.player_roster_id_seq OWNED BY public.player_roster.id;
ALTER TABLE public.player_roster ALTER COLUMN id SET DEFAULT nextval('public.player_roster_id_seq'::regclass);
ALTER TABLE public.player_roster ADD PRIMARY KEY (id);
ALTER TABLE public.player_roster ADD UNIQUE (user_id,hero_mapping_id);
CREATE UNIQUE INDEX player_roster_mapping_hero_key ON public.player_roster(player_mapping_id,hero_mapping_id);
ALTER TABLE public.player_roster ADD FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.player_roster ADD FOREIGN KEY (hero_mapping_id) REFERENCES public.hero_mappings(id) ON DELETE CASCADE;
ALTER TABLE public.player_roster ADD FOREIGN KEY (player_mapping_id) REFERENCES public.player_mapping(id) ON DELETE CASCADE;
ALTER TABLE public.player_roster ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_roster FORCE ROW LEVEL SECURITY;
CREATE ROLE desktop_roster_writer NOLOGIN NOSUPERUSER NOBYPASSRLS;
GRANT USAGE ON SCHEMA public,auth TO desktop_roster_writer;
GRANT EXECUTE ON FUNCTION auth.uid() TO desktop_roster_writer;
REVOKE ALL ON public.player_roster FROM PUBLIC,anon,authenticated,service_role,desktop_rpc_reader;
GRANT SELECT ON public.player_roster TO authenticated,service_role;
GRANT SELECT ON public.player_roster TO desktop_roster_writer;
GRANT INSERT,UPDATE,DELETE ON public.player_roster TO desktop_roster_writer;
REVOKE ALL ON SEQUENCE public.player_roster_id_seq FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SEQUENCE public.player_roster_id_seq TO desktop_roster_writer;
GRANT SELECT (id,unit_id) ON public.hero_mappings TO desktop_roster_writer;
CREATE POLICY desktop_roster_catalog ON public.hero_mappings FOR SELECT TO desktop_roster_writer USING (true);
GRANT SELECT (subject_user_id,guild_code,identity_mode,singleton) ON public.desktop_preview_setup TO desktop_roster_writer;
CREATE POLICY desktop_roster_setup ON public.desktop_preview_setup FOR SELECT TO desktop_roster_writer USING (subject_user_id=auth.uid());
GRANT SELECT (id,user_id,guild_code,is_current) ON public.player_mapping TO desktop_roster_writer;
GRANT UPDATE (player_power,updated_at) ON public.player_mapping TO desktop_roster_writer;
CREATE POLICY desktop_roster_mapping ON public.player_mapping TO desktop_roster_writer USING (user_id=auth.uid() AND is_current) WITH CHECK (user_id=auth.uid() AND is_current);
CREATE POLICY desktop_roster_read ON public.player_roster FOR SELECT TO authenticated USING (user_id=auth.uid());
CREATE POLICY desktop_roster_write ON public.player_roster TO desktop_roster_writer USING (user_id=auth.uid()) WITH CHECK (user_id=auth.uid() AND player_mapping_id IS NULL);

CREATE TABLE public.desktop_roster_snapshots (
  subject_user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  guild_code text NOT NULL,
  payload jsonb NOT NULL CHECK (octet_length(payload::text)<=8388608),
  source text NOT NULL DEFAULT 'official-own-key-local-claim' CHECK (source='official-own-key-local-claim'),
  cached_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.desktop_roster_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.desktop_roster_snapshots FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.desktop_roster_snapshots FROM PUBLIC,anon,authenticated,service_role,desktop_rpc_reader;
GRANT SELECT ON public.desktop_roster_snapshots TO authenticated;
GRANT SELECT,INSERT,UPDATE ON public.desktop_roster_snapshots TO desktop_roster_writer;
CREATE POLICY desktop_roster_snapshot_read ON public.desktop_roster_snapshots FOR SELECT TO authenticated USING (subject_user_id=auth.uid());
CREATE POLICY desktop_roster_snapshot_write ON public.desktop_roster_snapshots TO desktop_roster_writer USING (subject_user_id=auth.uid()) WITH CHECK (subject_user_id=auth.uid());

CREATE FUNCTION public.desktop_save_roster(p_snapshot jsonb,p_rows jsonb) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $roster$
DECLARE target text; count_units integer; count_rows integer;
BEGIN
 SELECT s.guild_code INTO STRICT target FROM public.desktop_preview_setup s WHERE s.singleton AND s.subject_user_id=auth.uid() AND s.identity_mode='local-file';
 IF target IS NULL OR jsonb_typeof(p_snapshot) IS DISTINCT FROM 'object' OR
    p_snapshot->>'format' IS DISTINCT FROM 'ta-official-roster-v1' OR p_snapshot->>'guildCode' IS DISTINCT FROM target OR
    EXISTS(SELECT 1 FROM jsonb_object_keys(p_snapshot) AS keys(name) WHERE name NOT IN ('format','guildCode','playerName','powerLevel','units','machinesOfWar')) OR
    jsonb_typeof(p_snapshot->'playerName') IS DISTINCT FROM 'string' OR length(p_snapshot->>'playerName') NOT BETWEEN 1 AND 128 OR
    jsonb_typeof(p_snapshot->'powerLevel') IS DISTINCT FROM 'number' OR
    jsonb_typeof(p_snapshot->'units') IS DISTINCT FROM 'array' OR jsonb_typeof(p_snapshot->'machinesOfWar') IS DISTINCT FROM 'array' OR
    jsonb_array_length(p_snapshot->'units')>1024 OR jsonb_array_length(p_snapshot->'machinesOfWar')>128 OR
    octet_length(p_snapshot::text)>8388608 OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid local roster'; END IF;
 IF (p_snapshot->>'powerLevel')::bigint NOT BETWEEN 0 AND 2147483647 OR EXISTS (
   SELECT 1 FROM jsonb_array_elements((p_snapshot->'units')||(p_snapshot->'machinesOfWar')) u WHERE
     jsonb_typeof(u) IS DISTINCT FROM 'object' OR u->>'id' IS NULL OR u->>'id' !~ '^[A-Za-z0-9_-]{1,100}$' OR
     u->>'progressionIndex' IS NULL OR (u->>'progressionIndex')::integer NOT BETWEEN 0 AND 15 OR
     u->>'rank' IS NULL OR (u->>'rank')::integer NOT BETWEEN 0 AND 17 OR
     u->>'xpLevel' IS NULL OR (u->>'xpLevel')::integer NOT BETWEEN 1 AND 50 OR
     u->>'xp' IS NULL OR (u->>'xp')::integer<0 OR u->>'shards' IS NULL OR (u->>'shards')::integer<0 OR u->>'mythicShards' IS NULL OR (u->>'mythicShards')::integer<0 OR
     jsonb_typeof(u->'abilities') IS DISTINCT FROM 'array' OR jsonb_array_length(u->'abilities')>2 OR
     jsonb_typeof(u->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(u->'items')>3 OR
     jsonb_typeof(u->'upgrades') IS DISTINCT FROM 'array' OR jsonb_array_length(u->'upgrades')>6
 ) THEN RAISE EXCEPTION 'Invalid local roster'; END IF;
 count_rows:=jsonb_array_length(p_rows);
 SELECT count(DISTINCT value->>'id') INTO count_units FROM jsonb_array_elements((p_snapshot->'units')||(p_snapshot->'machinesOfWar'));
 IF count_rows>count_units OR count_rows>1152 OR EXISTS (
   SELECT 1 FROM jsonb_array_elements(p_rows) r LEFT JOIN public.hero_mappings h ON h.id=(r->>'hero_mapping_id')::integer
   WHERE h.id IS NULL OR h.unit_id IS DISTINCT FROM r->>'source_unit_id' OR
     NOT EXISTS (SELECT 1 FROM jsonb_array_elements((p_snapshot->'units')||(p_snapshot->'machinesOfWar')) u WHERE u->>'id'=h.unit_id)
 ) OR EXISTS (
   SELECT 1 FROM jsonb_populate_recordset(NULL::public.player_roster,p_rows) r WHERE
     r.user_id IS DISTINCT FROM auth.uid() OR r.player_mapping_id IS NOT NULL OR r.hero_mapping_id IS NULL OR
     r.rank_name IS NULL OR length(r.rank_name) NOT BETWEEN 1 AND 32 OR
     r.stars IS NULL OR r.stars NOT BETWEEN 0 AND 15 OR r.progression_index IS NULL OR r.progression_index NOT BETWEEN 0 AND 15 OR
     r.rarity IS NULL OR r.rarity NOT IN ('Common','Uncommon','Rare','Epic','Legendary','Mythic') OR
     r.xp IS NULL OR r.xp<0 OR r.xp_level IS NULL OR r.xp_level NOT BETWEEN 1 AND 50 OR
     r.shards IS NULL OR r.shards<0 OR r.mythic_shards IS NULL OR r.mythic_shards<0 OR
     (r.active_ability_level IS NOT NULL AND r.active_ability_level NOT BETWEEN 0 AND 50) OR
     (r.passive_ability_level IS NOT NULL AND r.passive_ability_level NOT BETWEEN 0 AND 50) OR
     (r.crit_item_level IS NOT NULL AND r.crit_item_level NOT BETWEEN 1 AND 11) OR
     (r.defensive_item_level IS NOT NULL AND r.defensive_item_level NOT BETWEEN 1 AND 11) OR
     (r.booster_item_level IS NOT NULL AND r.booster_item_level NOT BETWEEN 1 AND 11) OR
     r.upgrades IS NULL OR cardinality(r.upgrades)>6 OR EXISTS (SELECT 1 FROM unnest(r.upgrades) value WHERE value IS NULL OR value NOT BETWEEN 0 AND 5)
 ) THEN RAISE EXCEPTION 'Invalid local roster'; END IF;
 PERFORM pg_advisory_xact_lock(74832020);
 DELETE FROM public.player_roster r WHERE r.user_id=auth.uid() AND NOT EXISTS (SELECT 1 FROM jsonb_populate_recordset(NULL::public.player_roster,p_rows) n WHERE n.hero_mapping_id=r.hero_mapping_id);
 INSERT INTO public.player_roster(user_id,hero_mapping_id,rank_name,stars,crit_item_id,crit_item_level,booster_item_id,booster_item_level,defensive_item_id,defensive_item_level,synced_at,rarity,xp,xp_level,progression_index,shards,mythic_shards,active_ability_level,passive_ability_level,upgrades)
 SELECT r.user_id,r.hero_mapping_id,r.rank_name,r.stars,r.crit_item_id,r.crit_item_level,r.booster_item_id,r.booster_item_level,r.defensive_item_id,r.defensive_item_level,now(),r.rarity,r.xp,r.xp_level,r.progression_index,r.shards,r.mythic_shards,r.active_ability_level,r.passive_ability_level,r.upgrades FROM jsonb_populate_recordset(NULL::public.player_roster,p_rows) r
 ON CONFLICT (user_id,hero_mapping_id) DO UPDATE SET rank_name=EXCLUDED.rank_name,stars=EXCLUDED.stars,crit_item_id=EXCLUDED.crit_item_id,crit_item_level=EXCLUDED.crit_item_level,booster_item_id=EXCLUDED.booster_item_id,booster_item_level=EXCLUDED.booster_item_level,defensive_item_id=EXCLUDED.defensive_item_id,defensive_item_level=EXCLUDED.defensive_item_level,synced_at=EXCLUDED.synced_at,rarity=EXCLUDED.rarity,xp=EXCLUDED.xp,xp_level=EXCLUDED.xp_level,progression_index=EXCLUDED.progression_index,shards=EXCLUDED.shards,mythic_shards=EXCLUDED.mythic_shards,active_ability_level=EXCLUDED.active_ability_level,passive_ability_level=EXCLUDED.passive_ability_level,upgrades=EXCLUDED.upgrades;
 UPDATE public.player_mapping SET player_power=(p_snapshot->>'powerLevel')::integer,updated_at=now() WHERE user_id=auth.uid() AND is_current AND guild_code=target;
 IF NOT FOUND THEN RAISE EXCEPTION 'Local roster subject changed'; END IF;
 INSERT INTO public.desktop_roster_snapshots(subject_user_id,guild_code,payload) VALUES(auth.uid(),target,p_snapshot)
 ON CONFLICT(subject_user_id) DO UPDATE SET guild_code=EXCLUDED.guild_code,payload=EXCLUDED.payload,cached_at=now();
 RETURN jsonb_build_object('units',count_units,'mapped',count_rows,'unmapped',count_units-count_rows);
END $roster$;
ALTER FUNCTION public.desktop_save_roster(jsonb,jsonb) OWNER TO desktop_roster_writer;
REVOKE ALL ON FUNCTION public.desktop_save_roster(jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role,desktop_rpc_reader;
GRANT EXECUTE ON FUNCTION public.desktop_save_roster(jsonb,jsonb) TO desktop_owner;

-- Local planner links are editable only through the canonical owner projection.
-- Validate this column's writes without rejecting unrelated updates to legacy rows.
CREATE FUNCTION public.desktop_validate_planner_link() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $planner$
BEGIN
 IF NEW.tacticus_share_url IS NOT NULL AND (
   length(NEW.tacticus_share_url) NOT BETWEEN 1 AND 2048 OR
   NEW.tacticus_share_url !~ '^https?://[^/?#[:space:]@]+([/?#][^[:cntrl:]]*)?$'
 ) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invalid local planner link'; END IF;
 RETURN NEW;
END $planner$;
REVOKE ALL ON FUNCTION public.desktop_validate_planner_link() FROM PUBLIC,anon,authenticated,service_role,desktop_rpc_reader;
CREATE TRIGGER desktop_planner_link_write BEFORE UPDATE OF tacticus_share_url ON public.player_mapping
 FOR EACH ROW EXECUTE FUNCTION public.desktop_validate_planner_link();
GRANT UPDATE (tacticus_share_url) ON public.current_user_player_mapping TO authenticated;

-- Canonical achievement inputs with local job and read authority.
CREATE FUNCTION public.get_votlw_set_winners(p_guild_code text, p_season text, p_cluster_code text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'auth'
    AS $$
DECLARE
  v_results JSONB := '[]'::jsonb;
BEGIN
  IF p_guild_code IS NULL OR length(trim(p_guild_code)) = 0 THEN
    RAISE EXCEPTION 'p_guild_code is required';
  END IF;

  IF p_season IS NULL OR length(trim(p_season)) = 0 THEN
    RAISE EXCEPTION 'p_season is required';
  END IF;

  WITH filtered_all AS (
    SELECT
      d."Guild" AS guild_code,
      d."Season" AS season,
      d.cluster_code,
      COALESCE(NULLIF(trim(d."displayName"), ''), 'Unknown') AS display_name,
      d."Name" AS boss_name,
      d.rarity,
      d.tier,
      d."set" AS set_num,
      d."encounterId" AS encounter_id,
      d."encounterIndex" AS encounter_index,
      d."loopIndex" AS loop_index,
      d."damageDealt" AS damage_dealt,
      d."remainingHp" AS remaining_hp,
      d."maxHp" AS max_hp,
      d."startedOn" AS started_on,
      d."completedOn" AS completed_on,
      CASE
        WHEN COALESCE(d."remainingHp", 0) = 0
          AND COALESCE(d."maxHp", 0) > 0
          AND COALESCE(d."damageDealt", 0) < d."maxHp"
          THEN TRUE
        ELSE FALSE
      END AS is_sweep,
      CASE
        WHEN COALESCE(d."remainingHp", 0) = 0
          AND COALESCE(d."maxHp", 0) > 0
          AND COALESCE(d."damageDealt", 0) >= d."maxHp"
          THEN TRUE
        ELSE FALSE
      END AS is_one_shot
    FROM public."EOT_GR_data" d
    WHERE d."Guild" = p_guild_code
      AND d."Season" = p_season
      AND d."damageType" = 'Battle'
      AND d."damageDealt" IS NOT NULL
      AND d."damageDealt" > 0
      AND d.rarity IN ('Legendary', 'Mythic')
      AND (p_cluster_code IS NULL OR d.cluster_code = p_cluster_code)
  ),
  loop_start AS (
    SELECT rarity_rank, set_num
    FROM (
      SELECT
        CASE rarity WHEN 'Legendary' THEN 4 WHEN 'Mythic' THEN 5 ELSE 99 END AS rarity_rank,
        COALESCE(set_num, 0) AS set_num
      FROM filtered_all
      WHERE COALESCE(loop_index, 0) >= 1
    ) s
    ORDER BY rarity_rank, set_num
    LIMIT 1
  ),
  filtered AS (
    SELECT f.*
    FROM filtered_all f
    LEFT JOIN loop_start ls ON TRUE
    WHERE ls.rarity_rank IS NULL
       OR (
            CASE f.rarity WHEN 'Legendary' THEN 4 WHEN 'Mythic' THEN 5 ELSE 99 END,
            COALESCE(f.set_num, 0)
          ) >= (ls.rarity_rank, ls.set_num)
  ),
  guild_baseline AS (
    SELECT
      rarity,
      set_num,
      AVG(damage_dealt) AS avg_damage
    FROM filtered
    WHERE (encounter_id = 0 OR encounter_id IS NULL)
      AND (NOT is_sweep OR is_one_shot)
    GROUP BY rarity, set_num
  ),
  side_boss_baseline AS (
    SELECT
      rarity,
      set_num,
      encounter_index,
      AVG(damage_dealt) AS avg_damage
    FROM filtered
    WHERE encounter_index IN (1, 2)
      AND (NOT is_sweep OR is_one_shot)
    GROUP BY rarity, set_num, encounter_index
  ),
  base_stats AS (
    SELECT
      rarity,
      set_num,
      display_name,
      SUM(damage_dealt) FILTER (WHERE NOT is_sweep OR is_one_shot) AS non_sweep_damage,
      COUNT(*) FILTER (WHERE NOT is_sweep OR is_one_shot) AS meaningful_tokens,
      SUM(damage_dealt) AS total_damage,
      COUNT(*) AS token_count,
      MIN(started_on) AS first_token_time,
      array_agg(damage_dealt::numeric) FILTER (WHERE is_sweep AND NOT is_one_shot) AS sweep_damages
    FROM filtered
    WHERE encounter_id = 0 OR encounter_id IS NULL
    GROUP BY rarity, set_num, display_name
  ),
  adjusted_stats AS (
    SELECT
      bs.*,
      COALESCE(bs.non_sweep_damage, 0)
        + COALESCE(qualifying_sweep_sum(bs.sweep_damages, GREATEST(bs.non_sweep_damage / NULLIF(bs.meaningful_tokens, 0), gb.avg_damage)::numeric), 0) AS adj_damage,
      COALESCE(bs.meaningful_tokens, 0)
        + COALESCE(qualifying_sweep_count(bs.sweep_damages, GREATEST(bs.non_sweep_damage / NULLIF(bs.meaningful_tokens, 0), gb.avg_damage)::numeric), 0) AS adj_count,
      CASE
        WHEN (COALESCE(bs.meaningful_tokens, 0)
              + COALESCE(qualifying_sweep_count(bs.sweep_damages, GREATEST(bs.non_sweep_damage / NULLIF(bs.meaningful_tokens, 0), gb.avg_damage)::numeric), 0)) > 0
        THEN (COALESCE(bs.non_sweep_damage, 0)
              + COALESCE(qualifying_sweep_sum(bs.sweep_damages, GREATEST(bs.non_sweep_damage / NULLIF(bs.meaningful_tokens, 0), gb.avg_damage)::numeric), 0))::numeric
             / (COALESCE(bs.meaningful_tokens, 0)
                + COALESCE(qualifying_sweep_count(bs.sweep_damages, GREATEST(bs.non_sweep_damage / NULLIF(bs.meaningful_tokens, 0), gb.avg_damage)::numeric), 0))
        ELSE NULL
      END AS adj_avg
    FROM base_stats bs
    LEFT JOIN guild_baseline gb ON gb.rarity = bs.rarity AND gb.set_num = bs.set_num
  ),
  qualified_avg AS (
    SELECT
      *,
      ROW_NUMBER() OVER (
        PARTITION BY rarity, set_num
        ORDER BY adj_avg DESC NULLS LAST, adj_count DESC, first_token_time ASC
      ) AS avg_rank
    FROM adjusted_stats
    WHERE adj_count > 1 AND adj_avg IS NOT NULL
  ),
  total_damage_ranked AS (
    SELECT
      *,
      ROW_NUMBER() OVER (
        PARTITION BY rarity, set_num
        ORDER BY total_damage DESC, token_count DESC, first_token_time ASC
      ) AS total_rank
    FROM adjusted_stats
  ),
  side_boss_raw AS (
    SELECT
      rarity,
      set_num,
      CASE WHEN encounter_index = 1 THEN 'SideBoss1' ELSE 'SideBoss2' END AS encounter_label,
      display_name,
      SUM(damage_dealt) FILTER (WHERE NOT is_sweep OR is_one_shot) AS non_sweep_damage,
      COUNT(*) FILTER (WHERE NOT is_sweep OR is_one_shot) AS meaningful_tokens,
      MIN(started_on) AS first_token_time,
      array_agg(damage_dealt::numeric) FILTER (WHERE is_sweep AND NOT is_one_shot) AS sweep_damages,
      encounter_index
    FROM filtered
    WHERE encounter_index IN (1, 2)
    GROUP BY rarity, set_num, encounter_label, display_name, encounter_index
  ),
  side_boss_adjusted AS (
    SELECT
      sbr.rarity,
      sbr.set_num,
      sbr.encounter_label,
      sbr.display_name,
      CASE
        WHEN (COALESCE(sbr.meaningful_tokens, 0)
              + COALESCE(qualifying_sweep_count(sbr.sweep_damages, GREATEST(sbr.non_sweep_damage / NULLIF(sbr.meaningful_tokens, 0), sbb.avg_damage)::numeric), 0)) > 0
        THEN (COALESCE(sbr.non_sweep_damage, 0)
              + COALESCE(qualifying_sweep_sum(sbr.sweep_damages, GREATEST(sbr.non_sweep_damage / NULLIF(sbr.meaningful_tokens, 0), sbb.avg_damage)::numeric), 0))::numeric
             / (COALESCE(sbr.meaningful_tokens, 0)
                + COALESCE(qualifying_sweep_count(sbr.sweep_damages, GREATEST(sbr.non_sweep_damage / NULLIF(sbr.meaningful_tokens, 0), sbb.avg_damage)::numeric), 0))
        ELSE NULL
      END AS avg_damage,
      COALESCE(sbr.meaningful_tokens, 0)
        + COALESCE(qualifying_sweep_count(sbr.sweep_damages, GREATEST(sbr.non_sweep_damage / NULLIF(sbr.meaningful_tokens, 0), sbb.avg_damage)::numeric), 0) AS adj_count,
      sbr.first_token_time
    FROM side_boss_raw sbr
    LEFT JOIN side_boss_baseline sbb
      ON sbb.rarity = sbr.rarity AND sbb.set_num = sbr.set_num AND sbb.encounter_index = sbr.encounter_index
  ),
  side_boss_ranked AS (
    SELECT
      *,
      ROW_NUMBER() OVER (
        PARTITION BY rarity, set_num, encounter_label
        ORDER BY avg_damage DESC NULLS LAST, adj_count DESC, first_token_time ASC
      ) AS side_rank
    FROM side_boss_adjusted
    WHERE avg_damage IS NOT NULL AND adj_count > 1
  ),
  boss_identity AS (
    SELECT
      rarity,
      set_num,
      MAX(
        CASE
          WHEN encounter_index IS NULL OR encounter_index = 0 THEN boss_name
          ELSE NULL
        END
      ) AS boss_name
    FROM filtered
    GROUP BY rarity, set_num
  ),
  biggest_hits AS (
    SELECT
      rarity,
      set_num,
      display_name,
      damage_dealt,
      ROW_NUMBER() OVER (
        PARTITION BY rarity, set_num
        ORDER BY damage_dealt DESC, started_on ASC
      ) AS hit_rank
    FROM filtered
    WHERE encounter_id = 0 OR encounter_id IS NULL
  ),
  aggregated AS (
    SELECT
      q.rarity,
      q.set_num,
      COALESCE(bi.boss_name, 'Unknown Boss') AS boss_name,
      MAX(CASE WHEN q.avg_rank = 1 THEN jsonb_build_object('player', q.display_name, 'value', ROUND(q.adj_avg))::text END)::jsonb AS gold,
      MAX(CASE WHEN q.avg_rank = 2 THEN jsonb_build_object('player', q.display_name, 'value', ROUND(q.adj_avg))::text END)::jsonb AS silver,
      MAX(CASE WHEN q.avg_rank = 3 THEN jsonb_build_object('player', q.display_name, 'value', ROUND(q.adj_avg))::text END)::jsonb AS bronze,
      MAX(CASE WHEN t.total_rank = 1 THEN jsonb_build_object('player', t.display_name, 'value', t.total_damage)::text END)::jsonb AS most_damage,
      MAX(CASE WHEN sb.encounter_label = 'SideBoss1' AND sb.side_rank = 1 THEN jsonb_build_object('player', sb.display_name, 'value', ROUND(sb.avg_damage))::text END)::jsonb AS side_boss1,
      MAX(CASE WHEN sb.encounter_label = 'SideBoss2' AND sb.side_rank = 1 THEN jsonb_build_object('player', sb.display_name, 'value', ROUND(sb.avg_damage))::text END)::jsonb AS side_boss2,
      MAX(CASE WHEN bh.hit_rank = 1 THEN jsonb_build_object('player', bh.display_name, 'value', bh.damage_dealt)::text END)::jsonb AS biggest_hit
    FROM qualified_avg q
    LEFT JOIN boss_identity bi
      ON bi.rarity = q.rarity AND bi.set_num = q.set_num
    LEFT JOIN total_damage_ranked t
      ON t.rarity = q.rarity AND t.set_num = q.set_num AND t.display_name = q.display_name
    LEFT JOIN side_boss_ranked sb
      ON sb.rarity = q.rarity AND sb.set_num = q.set_num
    LEFT JOIN biggest_hits bh
      ON bh.rarity = q.rarity AND bh.set_num = q.set_num
    GROUP BY q.rarity, q.set_num, bi.boss_name
  )
  SELECT
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'rarity', ag.rarity,
        'set', ag.set_num,
        'levelString',
          CASE WHEN ag.rarity = 'Legendary' THEN CONCAT('L', ag.set_num + 1)
               WHEN ag.rarity = 'Mythic' THEN CONCAT('M', ag.set_num + 1)
               ELSE CONCAT('S', ag.set_num + 1) END,
        'bossName', ag.boss_name,
        'gold', COALESCE(ag.gold, '{}'::jsonb),
        'silver', COALESCE(ag.silver, '{}'::jsonb),
        'bronze', COALESCE(ag.bronze, '{}'::jsonb),
        'mostDamage', COALESCE(ag.most_damage, '{}'::jsonb),
        'sideBoss1', COALESCE(ag.side_boss1, '{}'::jsonb),
        'sideBoss2', COALESCE(ag.side_boss2, '{}'::jsonb),
        'biggestHit', COALESCE(ag.biggest_hit, '{}'::jsonb)
      )
      ORDER BY ag.rarity, ag.set_num
    ), '[]'::jsonb)
  INTO v_results
  FROM aggregated ag;

  RETURN v_results;
END;
$$;

CREATE TABLE public.guild_war_player_attempts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    war_id character varying(255) NOT NULL,
    zone_id uuid NOT NULL,
    guild_code text NOT NULL,
    player_id character varying(255) NOT NULL,
    player_name character varying(255) NOT NULL,
    attempt_number integer NOT NULL,
    attempt_status character varying(20) NOT NULL,
    attempt_result character varying(10),
    damage_dealt bigint DEFAULT 0,
    score_earned integer DEFAULT 0,
    units_used jsonb,
    attempt_start_time timestamp with time zone,
    attempt_end_time timestamp with time zone,
    battle_duration integer,
    raw_loki_data jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    is_guild_member boolean DEFAULT true NOT NULL,
    attacker_team_index integer,
    attacker_guild_name text,
    defender_player_id text,
    defender_player_name text,
    defender_guild_name text,
    attacker_units_json jsonb,
    defender_units_json jsonb,
    attempt_debuff integer,
    CONSTRAINT guild_war_player_attempts_attempt_result_check CHECK (((attempt_result)::text = ANY (ARRAY[('win'::character varying)::text, ('loss'::character varying)::text]))),
    CONSTRAINT guild_war_player_attempts_attempt_status_check CHECK (((attempt_status)::text = ANY (ARRAY[('in_progress'::character varying)::text, ('completed'::character varying)::text, ('failed'::character varying)::text, ('abandoned'::character varying)::text])))
);

CREATE TABLE public.guild_war_zones (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    war_id character varying(255) NOT NULL,
    guild_code text NOT NULL,
    zone_number integer NOT NULL,
    zone_name character varying(255),
    zone_type character varying(50) NOT NULL,
    zone_status character varying(20) NOT NULL,
    assigned_players text[],
    zone_score integer DEFAULT 0,
    opponent_zone_score integer DEFAULT 0,
    zone_result character varying(10),
    attempts_remaining integer DEFAULT 0,
    max_attempts integer DEFAULT 0,
    zone_start_time timestamp with time zone,
    zone_end_time timestamp with time zone,
    raw_loki_data jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    board_id text,
    CONSTRAINT guild_war_zones_zone_result_check CHECK (((zone_result)::text = ANY (ARRAY[('win'::character varying)::text, ('loss'::character varying)::text, ('draw'::character varying)::text]))),
    CONSTRAINT guild_war_zones_zone_status_check CHECK (((zone_status)::text = ANY (ARRAY[('available'::character varying)::text, ('assigned'::character varying)::text, ('in_progress'::character varying)::text, ('completed'::character varying)::text, ('failed'::character varying)::text])))
);

CREATE TABLE public.player_achievements (
    id bigint NOT NULL,
    user_id uuid NOT NULL,
    achievement_key text NOT NULL,
    unlocked_at timestamp with time zone DEFAULT now() NOT NULL,
    value jsonb,
    CONSTRAINT player_achievements_key_format CHECK ((achievement_key ~ '^[a-z][a-z0-9_]{1,80}$'::text))
);

CREATE SEQUENCE public.player_achievements_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.player_achievements_id_seq OWNED BY public.player_achievements.id;
ALTER TABLE public.player_achievements ALTER COLUMN id SET DEFAULT nextval('public.player_achievements_id_seq'::regclass);
ALTER TABLE public.player_achievements ADD PRIMARY KEY (id);
ALTER TABLE public.player_achievements ADD UNIQUE(user_id,achievement_key);
ALTER TABLE public.player_achievements ADD FOREIGN KEY(user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.guild_war_zones ADD PRIMARY KEY(id);
ALTER TABLE public.guild_war_player_attempts ADD PRIMARY KEY(id);
ALTER TABLE public.guild_war_player_attempts ADD FOREIGN KEY(zone_id) REFERENCES public.guild_war_zones(id) ON DELETE CASCADE;
ALTER TABLE public.guild_war_zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guild_war_zones FORCE ROW LEVEL SECURITY;
ALTER TABLE public.guild_war_player_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guild_war_player_attempts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.player_achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_achievements FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.guild_war_zones,public.guild_war_player_attempts,public.player_achievements FROM PUBLIC,anon,authenticated,service_role,desktop_rpc_reader;
REVOKE ALL ON SEQUENCE public.player_achievements_id_seq FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.guild_war_zones,public.guild_war_player_attempts,public.player_achievements TO authenticated,service_role;
GRANT INSERT ON public.player_achievements TO service_role;
GRANT USAGE ON SEQUENCE public.player_achievements_id_seq TO service_role;
CREATE POLICY desktop_achievement_self_read ON public.player_achievements FOR SELECT TO authenticated USING(user_id=auth.uid());
CREATE POLICY desktop_war_zone_read ON public.guild_war_zones FOR SELECT TO authenticated USING(guild_code IN(SELECT public._pm_caller_guild_codes()));
CREATE POLICY desktop_war_attempt_read ON public.guild_war_player_attempts FOR SELECT TO authenticated USING(guild_code IN(SELECT public._pm_caller_guild_codes()));
GRANT SELECT(subject_user_id,guild_code,singleton) ON public.desktop_preview_setup TO service_role;
CREATE ROLE desktop_achievement_reader NOLOGIN NOSUPERUSER NOBYPASSRLS;
GRANT USAGE ON SCHEMA public,auth TO desktop_achievement_reader;
GRANT EXECUTE ON FUNCTION auth.uid(),auth.jwt() TO desktop_achievement_reader;
GRANT SELECT(subject_user_id,guild_code,singleton) ON public.desktop_preview_setup TO desktop_achievement_reader;
CREATE POLICY desktop_achievement_context ON public.desktop_preview_setup FOR SELECT TO desktop_achievement_reader USING(singleton AND (subject_user_id=auth.uid() OR auth.jwt()->>'role'='service_role'));
GRANT SELECT ON public."EOT_GR_data" TO desktop_achievement_reader;
CREATE POLICY desktop_achievement_raid_read ON public."EOT_GR_data" FOR SELECT TO desktop_achievement_reader USING("Guild" IN(SELECT guild_code FROM public.desktop_preview_setup WHERE singleton));
ALTER FUNCTION public.get_votlw_set_winners(text,text,text) OWNER TO desktop_achievement_reader;
REVOKE ALL ON FUNCTION public.get_votlw_set_winners(text,text,text) FROM PUBLIC,anon,authenticated,service_role,desktop_rpc_reader;
GRANT EXECUTE ON FUNCTION public.get_votlw_set_winners(text,text,text) TO authenticated,service_role;
ALTER TABLE public.work_queue DROP CONSTRAINT desktop_local_job_type;
ALTER TABLE public.work_queue ADD CONSTRAINT desktop_local_job_type CHECK(job_type IN ('refresh-explore-snapshots','refresh-local-achievements'));

GRANT EXECUTE ON FUNCTION public.qualifying_sweep_sum(numeric[],numeric),public.qualifying_sweep_count(numeric[],numeric) TO desktop_achievement_reader;

-- Local display preferences never grant account or guild authority.
WITH bundled(team_name,sort_order) AS (VALUES
 ('Admech',0),('Battlesuits',1),('Custodes',2),('Double Howl',3),
 ('Forcasmo',4),('Lavstodes',5),('Neuro / Z''Kar',6),('Orkz',7))
INSERT INTO public.meta_teams(team_name,sort_order,is_meta)
SELECT b.team_name,b.sort_order,true FROM bundled b
WHERE NOT EXISTS(SELECT 1 FROM public.meta_teams m WHERE m.team_name=b.team_name);

CREATE FUNCTION public.desktop_validate_profile_preferences() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $preferences$
BEGIN
 IF NEW.timezone IS DISTINCT FROM OLD.timezone AND NEW.timezone IS NOT NULL AND
   NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=NEW.timezone)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invalid local timezone'; END IF;
 IF NEW.discord_username IS DISTINCT FROM OLD.discord_username AND NEW.discord_username IS NOT NULL AND (
   length(NEW.discord_username) NOT BETWEEN 1 AND 128 OR NEW.discord_username ~ '[[:cntrl:]]')
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invalid local display alias'; END IF;
 IF NEW.theme_preference IS DISTINCT FROM OLD.theme_preference AND NEW.theme_preference IS NOT NULL AND
   NEW.theme_preference !~ '^[A-Za-z0-9_-]{1,20}$'
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invalid local theme preference'; END IF;
 IF (NEW.primary_team IS DISTINCT FROM OLD.primary_team AND NEW.primary_team IS NOT NULL AND
       NOT EXISTS(SELECT 1 FROM public.meta_teams WHERE team_name=NEW.primary_team)) OR
    (NEW.secondary_team IS DISTINCT FROM OLD.secondary_team AND NEW.secondary_team IS NOT NULL AND
       NOT EXISTS(SELECT 1 FROM public.meta_teams WHERE team_name=NEW.secondary_team)) OR
    (NEW.tertiary_team IS DISTINCT FROM OLD.tertiary_team AND NEW.tertiary_team IS NOT NULL AND
       NOT EXISTS(SELECT 1 FROM public.meta_teams WHERE team_name=NEW.tertiary_team))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invalid local preferred team'; END IF;
 RETURN NEW;
END $preferences$;
REVOKE ALL ON FUNCTION public.desktop_validate_profile_preferences() FROM PUBLIC,anon,authenticated,service_role,desktop_rpc_reader;
CREATE TRIGGER desktop_profile_preferences_write BEFORE UPDATE OF timezone,discord_username,theme_preference,primary_team,secondary_team,tertiary_team ON public.player_mapping
 FOR EACH ROW EXECUTE FUNCTION public.desktop_validate_profile_preferences();
GRANT UPDATE(timezone,discord_username,theme_preference,primary_team,secondary_team,tertiary_team) ON public.current_user_player_mapping TO authenticated;

-- Owner boss choices are local preferences, not verified game-account claims.
CREATE FUNCTION public.desktop_validate_boss_preferences() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $preferences$
DECLARE choice record;
BEGIN
 IF NEW.boss_preferences IS NOT DISTINCT FROM OLD.boss_preferences THEN RETURN NEW; END IF;
 IF NEW.boss_preferences IS NULL OR jsonb_typeof(NEW.boss_preferences) <> 'object' OR
    octet_length(NEW.boss_preferences::text) > 16384
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invalid local boss preferences'; END IF;
 FOR choice IN SELECT key,value FROM jsonb_each(NEW.boss_preferences) LOOP
  IF choice.value NOT IN ('"preferred"'::jsonb,'"avoid"'::jsonb) OR
    NOT EXISTS(SELECT 1 FROM public.boss_mapping b WHERE
      choice.key='main_'||b.boss_type OR
      choice.key=CASE WHEN b.encounter_index>0 THEN 'side_' ELSE 'main_' END||b.boss_name)
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invalid local boss preference choice'; END IF;
 END LOOP;
 NEW.preferences_updated_at=statement_timestamp();
 RETURN NEW;
END $preferences$;
REVOKE ALL ON FUNCTION public.desktop_validate_boss_preferences() FROM PUBLIC,anon,authenticated,service_role,desktop_rpc_reader;
CREATE TRIGGER desktop_boss_preferences_write BEFORE UPDATE OF boss_preferences ON public.player_mapping
 FOR EACH ROW EXECUTE FUNCTION public.desktop_validate_boss_preferences();
GRANT UPDATE(boss_preferences) ON public.current_user_player_mapping TO authenticated;

CREATE TABLE public.gdpr_data_exports (
    request_id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    requested_at timestamp with time zone DEFAULT now(),
    completed_at timestamp with time zone,
    status text DEFAULT 'pending'::text NOT NULL,
    data_package jsonb,
    download_url text,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT gdpr_data_exports_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'completed'::text, 'failed'::text])))
);

CREATE TABLE public.gdpr_processing_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    data_type text NOT NULL,
    processing_purpose text NOT NULL,
    legal_basis text NOT NULL,
    "timestamp" timestamp with time zone DEFAULT now(),
    retention_until timestamp with time zone,
    consent_given boolean,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT gdpr_processing_log_legal_basis_check CHECK ((legal_basis = ANY (ARRAY['consent'::text, 'contract'::text, 'legal_obligation'::text, 'vital_interests'::text, 'public_task'::text, 'legitimate_interest'::text])))
);

CREATE TABLE public.user_token_alert_prefs (
    user_id uuid NOT NULL,
    alert_on_full boolean DEFAULT false NOT NULL,
    alert_before_full boolean DEFAULT false NOT NULL,
    alert_before_full_minutes integer DEFAULT 120 NOT NULL,
    alert_on_token_gained boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    alert_on_bomb_ready boolean DEFAULT false NOT NULL,
    alert_before_bomb_ready boolean DEFAULT false NOT NULL,
    alert_before_bomb_ready_minutes integer DEFAULT 120 NOT NULL,
    quiet_hours_start smallint,
    quiet_hours_end smallint,
    quiet_hours_timezone text,
    alert_on_full_repeat_hours integer,
    alert_before_quiet_hours boolean DEFAULT false NOT NULL,
    alert_before_quiet_hours_minutes integer DEFAULT 30 NOT NULL,
    alert_before_burn boolean DEFAULT false NOT NULL,
    alert_before_burn_minutes integer DEFAULT 30 NOT NULL,
    CONSTRAINT user_token_alert_prefs_bomb_minutes_range CHECK (((alert_before_bomb_ready_minutes >= 15) AND (alert_before_bomb_ready_minutes <= 960))),
    CONSTRAINT user_token_alert_prefs_burn_minutes_range CHECK (((alert_before_burn_minutes >= 15) AND (alert_before_burn_minutes <= 360))),
    CONSTRAINT user_token_alert_prefs_full_repeat_hours_range CHECK (((alert_on_full_repeat_hours IS NULL) OR ((alert_on_full_repeat_hours >= 11) AND (alert_on_full_repeat_hours <= 168)))),
    CONSTRAINT user_token_alert_prefs_full_repeat_requires_full CHECK ((alert_on_full OR (alert_on_full_repeat_hours IS NULL))),
    CONSTRAINT user_token_alert_prefs_minutes_range CHECK (((alert_before_full_minutes >= 15) AND (alert_before_full_minutes <= 720))),
    CONSTRAINT user_token_alert_prefs_pre_quiet_minutes_range CHECK (((alert_before_quiet_hours_minutes >= 15) AND (alert_before_quiet_hours_minutes <= 180))),
    CONSTRAINT user_token_alert_prefs_pre_quiet_requires_quiet_hours CHECK (((NOT alert_before_quiet_hours) OR (quiet_hours_start IS NOT NULL))),
    CONSTRAINT user_token_alert_prefs_quiet_end_range CHECK (((quiet_hours_end >= 0) AND (quiet_hours_end <= 23))),
    CONSTRAINT user_token_alert_prefs_quiet_hours_complete CHECK ((num_nonnulls(quiet_hours_start, quiet_hours_end, quiet_hours_timezone) = ANY (ARRAY[0, 3]))),
    CONSTRAINT user_token_alert_prefs_quiet_start_range CHECK (((quiet_hours_start >= 0) AND (quiet_hours_start <= 23))),
    CONSTRAINT user_token_alert_prefs_quiet_tz_length CHECK (((quiet_hours_timezone IS NULL) OR ((length(quiet_hours_timezone) >= 1) AND (length(quiet_hours_timezone) <= 64))))
);

CREATE TABLE public.user_token_alert_state (
    user_id uuid NOT NULL,
    last_tokens integer,
    last_time_to_full_seconds integer,
    last_scan_at timestamp with time zone,
    last_full_alert_at timestamp with time zone,
    last_prewarn_alert_at timestamp with time zone,
    last_gain_alert_at timestamp with time zone,
    consecutive_dm_failures integer DEFAULT 0 NOT NULL,
    dm_blocked_at timestamp with time zone,
    dm_channel_id text,
    dm_channel_recipient_id text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_bombs integer,
    last_time_to_bomb_seconds integer,
    last_bomb_ready_alert_at timestamp with time zone,
    last_bomb_prewarn_alert_at timestamp with time zone,
    quiet_hours_deferred_since timestamp with time zone,
    capped_since timestamp with time zone,
    last_pre_quiet_alert_at timestamp with time zone,
    last_burn_prewarn_alert_at timestamp with time zone
);

CREATE FUNCTION public.get_user_data_for_export(p_user_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'auth', 'pg_temp'
    AS $$
DECLARE
    result JSONB;
    user_data JSONB;
    player_data JSONB;
    battle_data JSONB;
    processing_data JSONB;
    alert_prefs_data JSONB;
    alert_state_data JSONB;
    caller_uid UUID;
BEGIN
    caller_uid := auth.uid();

    IF caller_uid IS NULL AND current_setting('role', true) <> 'service_role' THEN
        RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
    END IF;

    IF caller_uid IS NOT NULL AND caller_uid <> p_user_id THEN
        RAISE EXCEPTION 'Forbidden: can only export your own data'
            USING ERRCODE = '42501';
    END IF;

    SELECT to_jsonb(auth.users.*) INTO user_data
    FROM auth.users
    WHERE id = p_user_id;

    SELECT jsonb_agg(to_jsonb(pm.*)) INTO player_data
    FROM player_mapping pm
    WHERE pm.user_id = p_user_id;

    SELECT jsonb_agg(battle_subset.*)
    INTO battle_data
    FROM (
        SELECT gr.*
        FROM "EOT_GR_data" gr
        JOIN player_mapping pm ON gr."displayName" = pm.display_name
        WHERE pm.user_id = p_user_id
        ORDER BY COALESCE(gr."completedOn", gr."timestamp") DESC
        LIMIT 1000
    ) battle_subset;

    SELECT jsonb_agg(processing_subset.*)
    INTO processing_data
    FROM (
        SELECT gpl.*
        FROM gdpr_processing_log gpl
        WHERE gpl.user_id = p_user_id
        ORDER BY gpl.timestamp DESC
        LIMIT 100
    ) processing_subset;

    SELECT to_jsonb(utap.*) INTO alert_prefs_data
    FROM user_token_alert_prefs utap
    WHERE utap.user_id = p_user_id;

    SELECT to_jsonb(utas.*) INTO alert_state_data
    FROM user_token_alert_state utas
    WHERE utas.user_id = p_user_id;

    result := jsonb_build_object(
        'export_generated_at', NOW(),
        'user_id', p_user_id,
        'data', jsonb_build_object(
            'profile', COALESCE(user_data, '{}'),
            'player_mappings', COALESCE(player_data, '[]'),
            'battle_data', COALESCE(battle_data, '[]'),
            'processing_history', COALESCE(processing_data, '[]'),
            'token_alert_preferences', COALESCE(alert_prefs_data, '{}'),
            'token_alert_state', COALESCE(alert_state_data, '{}')
        ),
        'data_summary', jsonb_build_object(
            'total_battles', COALESCE(jsonb_array_length(battle_data), 0),
            'total_players', COALESCE(jsonb_array_length(player_data), 0),
            'data_retention_info', 'Battle data: indefinite, Processing logs: 7 years'
        )
    );

    RETURN result;
END;
$$;

-- Local exports use canonical request shapes and a restricted local reader.
ALTER TABLE public.gdpr_data_exports ADD PRIMARY KEY(request_id);
ALTER TABLE public.gdpr_data_exports ADD FOREIGN KEY(user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.gdpr_data_exports ADD COLUMN processing_started_at timestamptz;
ALTER TABLE public.gdpr_data_exports ADD CONSTRAINT desktop_export_package_bound CHECK(data_package IS NULL OR (jsonb_typeof(data_package)='object' AND octet_length(data_package::text)<=16777216));
ALTER TABLE public.gdpr_data_exports ADD CONSTRAINT desktop_export_download_path CHECK(download_url IS NULL OR download_url='/api/gdpr/my-data/'||request_id::text||'/download');
ALTER TABLE public.gdpr_processing_log ADD PRIMARY KEY(id);
ALTER TABLE public.gdpr_processing_log ADD FOREIGN KEY(user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.user_token_alert_prefs ADD PRIMARY KEY(user_id);
ALTER TABLE public.user_token_alert_prefs ADD FOREIGN KEY(user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.user_token_alert_state ADD PRIMARY KEY(user_id);
ALTER TABLE public.user_token_alert_state ADD FOREIGN KEY(user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.gdpr_data_exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gdpr_data_exports FORCE ROW LEVEL SECURITY;
ALTER TABLE public.gdpr_processing_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gdpr_processing_log FORCE ROW LEVEL SECURITY;
ALTER TABLE public.user_token_alert_prefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_token_alert_prefs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.user_token_alert_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_token_alert_state FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.gdpr_data_exports,public.gdpr_processing_log,public.user_token_alert_prefs,public.user_token_alert_state FROM PUBLIC,anon,authenticated,service_role,desktop_rpc_reader;
CREATE ROLE desktop_export_reader NOLOGIN NOSUPERUSER NOBYPASSRLS;
GRANT USAGE ON SCHEMA public,auth TO desktop_export_reader;
GRANT EXECUTE ON FUNCTION auth.uid(),auth.jwt() TO desktop_export_reader;
GRANT SELECT(subject_user_id,guild_code,singleton) ON public.desktop_preview_setup TO desktop_export_reader;
CREATE POLICY desktop_export_context ON public.desktop_preview_setup FOR SELECT TO desktop_export_reader USING(singleton AND (subject_user_id=auth.uid() OR auth.jwt()->>'role'='service_role'));
CREATE FUNCTION public.desktop_personal_export_subject() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $subject$
 SELECT subject_user_id FROM public.desktop_preview_setup WHERE singleton;
$subject$;
ALTER FUNCTION public.desktop_personal_export_subject() OWNER TO desktop_export_reader;
REVOKE ALL ON FUNCTION public.desktop_personal_export_subject() FROM PUBLIC,anon,authenticated,service_role,desktop_rpc_reader;
GRANT EXECUTE ON FUNCTION public.desktop_personal_export_subject() TO authenticated,service_role,desktop_export_reader;
GRANT SELECT(id,email,created_at,last_sign_in_at) ON auth.users TO desktop_export_reader;
CREATE POLICY desktop_export_auth_profile ON auth.users FOR SELECT TO desktop_export_reader USING(id=public.desktop_personal_export_subject());
GRANT SELECT ON public.player_mapping,public."EOT_GR_data",public.gdpr_processing_log,public.user_token_alert_prefs,public.user_token_alert_state,public.player_roster,public.player_achievements,public.player_meta_roles,public.desktop_roster_snapshots TO desktop_export_reader;
CREATE POLICY desktop_export_mapping ON public.player_mapping FOR SELECT TO desktop_export_reader USING(user_id=public.desktop_personal_export_subject());
CREATE POLICY desktop_export_battle ON public."EOT_GR_data" FOR SELECT TO desktop_export_reader USING(EXISTS(SELECT 1 FROM public.player_mapping p WHERE p.user_id=public.desktop_personal_export_subject() AND p.player_id="EOT_GR_data"."userId" AND p.guild_code="EOT_GR_data"."Guild"));
CREATE POLICY desktop_export_roster ON public.player_roster FOR SELECT TO desktop_export_reader USING(user_id=public.desktop_personal_export_subject());
CREATE POLICY desktop_export_achievements ON public.player_achievements FOR SELECT TO desktop_export_reader USING(user_id=public.desktop_personal_export_subject());
CREATE POLICY desktop_export_meta ON public.player_meta_roles FOR SELECT TO desktop_export_reader USING(user_id=public.desktop_personal_export_subject());
CREATE POLICY desktop_export_roster_snapshot ON public.desktop_roster_snapshots FOR SELECT TO desktop_export_reader USING(subject_user_id=public.desktop_personal_export_subject());
CREATE POLICY desktop_export_processing ON public.gdpr_processing_log FOR SELECT TO desktop_export_reader,service_role USING(user_id=public.desktop_personal_export_subject());
CREATE POLICY desktop_export_processing_write ON public.gdpr_processing_log FOR INSERT TO service_role WITH CHECK(user_id=public.desktop_personal_export_subject());
CREATE POLICY desktop_export_alert_preferences ON public.user_token_alert_prefs FOR SELECT TO desktop_export_reader USING(user_id=public.desktop_personal_export_subject());
CREATE POLICY desktop_export_alert_state ON public.user_token_alert_state FOR SELECT TO desktop_export_reader USING(user_id=public.desktop_personal_export_subject());
GRANT SELECT ON public.gdpr_data_exports TO authenticated,service_role;
GRANT INSERT(user_id) ON public.gdpr_data_exports TO authenticated;
GRANT UPDATE(status,processing_started_at,completed_at,data_package,download_url,expires_at) ON public.gdpr_data_exports TO service_role;
GRANT SELECT,INSERT ON public.gdpr_processing_log TO service_role;
CREATE POLICY desktop_export_request_read ON public.gdpr_data_exports FOR SELECT TO authenticated USING(user_id=public.desktop_personal_export_subject() AND user_id=auth.uid() AND (expires_at IS NULL OR expires_at>statement_timestamp()));
CREATE POLICY desktop_export_request_create ON public.gdpr_data_exports FOR INSERT TO authenticated WITH CHECK(user_id=auth.uid() AND user_id=public.desktop_personal_export_subject());
CREATE POLICY desktop_export_request_worker ON public.gdpr_data_exports TO service_role USING(user_id=public.desktop_personal_export_subject()) WITH CHECK(user_id=public.desktop_personal_export_subject());
CREATE OR REPLACE FUNCTION public.get_user_data_for_export(p_user_id uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $export$
DECLARE profile jsonb; mappings jsonb; battles jsonb; processing jsonb; prefs jsonb; state jsonb; roster jsonb; achievements jsonb; memberships jsonb;
BEGIN
 IF p_user_id IS NULL OR p_user_id IS DISTINCT FROM public.desktop_personal_export_subject() THEN
  RAISE EXCEPTION 'Local export subject refused' USING ERRCODE='42501';
 END IF;
 SELECT jsonb_build_object('id',id,'email',email,'created_at',created_at,'last_sign_in_at',last_sign_in_at) INTO profile FROM auth.users WHERE id=p_user_id;
 SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY id),'[]'::jsonb) INTO mappings FROM (
  SELECT id,user_id,player_id,display_name,guild_code,is_current,role,timezone,discord_username,theme_preference,tacticus_share_url,primary_team,secondary_team,tertiary_team,boss_preferences,preferences_updated_at,avatar_unit_id FROM public.player_mapping WHERE user_id=p_user_id
 ) p;
 SELECT coalesce(jsonb_agg(to_jsonb(b)),'[]'::jsonb) INTO battles FROM (
  SELECT r.* FROM public."EOT_GR_data" r WHERE EXISTS(SELECT 1 FROM public.player_mapping p WHERE p.user_id=p_user_id AND p.player_id=r."userId" AND p.guild_code=r."Guild") ORDER BY coalesce(r."completedOn",r."timestamp") DESC,r.id DESC LIMIT 1000
 ) b;
 SELECT coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) INTO processing FROM (SELECT l.* FROM public.gdpr_processing_log l WHERE user_id=p_user_id ORDER BY "timestamp" DESC,id DESC LIMIT 100) p;
 SELECT to_jsonb(p) INTO prefs FROM public.user_token_alert_prefs p WHERE user_id=p_user_id;
 SELECT to_jsonb(s) INTO state FROM public.user_token_alert_state s WHERE user_id=p_user_id;
 SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY id),'[]'::jsonb) INTO roster FROM public.player_roster r WHERE user_id=p_user_id;
 SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY achievement_key),'[]'::jsonb) INTO achievements FROM public.player_achievements a WHERE user_id=p_user_id;
 SELECT coalesce(jsonb_agg(to_jsonb(m)),'[]'::jsonb) INTO memberships FROM public.player_meta_roles m WHERE user_id=p_user_id;
 RETURN jsonb_build_object('export_generated_at',statement_timestamp(),'user_id',p_user_id,'data',jsonb_build_object(
  'profile',coalesce(profile,'{}'::jsonb),'player_mappings',mappings,'battle_data',battles,'processing_history',processing,
  'token_alert_preferences',coalesce(prefs,'{}'::jsonb),'token_alert_state',coalesce(state,'{}'::jsonb),
  'local_roster',roster,'local_achievements',achievements,'local_meta_memberships',memberships,
  'local_roster_snapshot',(SELECT payload FROM public.desktop_roster_snapshots WHERE subject_user_id=p_user_id),
  'identity_verification',jsonb_build_object('scope','local-workspace','game_account_verified',false)),
  'data_summary',jsonb_build_object('total_battles',jsonb_array_length(battles),'total_players',jsonb_array_length(mappings),'battle_limit',1000,'processing_history_limit',100));
END $export$;
ALTER FUNCTION public.get_user_data_for_export(uuid) OWNER TO desktop_export_reader;
REVOKE ALL ON FUNCTION public.get_user_data_for_export(uuid) FROM PUBLIC,anon,authenticated,service_role,desktop_rpc_reader;
GRANT EXECUTE ON FUNCTION public.get_user_data_for_export(uuid) TO authenticated,service_role;
ALTER TABLE public.work_queue DROP CONSTRAINT desktop_local_job_type;
ALTER TABLE public.work_queue ADD CONSTRAINT desktop_local_job_type CHECK(job_type IN ('refresh-explore-snapshots','refresh-local-achievements','export-local-profile-data'));

-- Update the local roster projection for Mythic units and third machine abilities.
CREATE OR REPLACE FUNCTION public.desktop_save_roster(p_snapshot jsonb,p_rows jsonb) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $roster$
DECLARE target text; count_units integer; count_rows integer;
BEGIN
 SELECT s.guild_code INTO STRICT target FROM public.desktop_preview_setup s WHERE s.singleton AND s.subject_user_id=auth.uid() AND s.identity_mode='local-file';
 IF target IS NULL OR jsonb_typeof(p_snapshot) IS DISTINCT FROM 'object' OR
    p_snapshot->>'format' IS DISTINCT FROM 'ta-official-roster-v1' OR p_snapshot->>'guildCode' IS DISTINCT FROM target OR
    EXISTS(SELECT 1 FROM jsonb_object_keys(p_snapshot) AS keys(name) WHERE name NOT IN ('format','guildCode','playerName','powerLevel','units','machinesOfWar')) OR
    jsonb_typeof(p_snapshot->'playerName') IS DISTINCT FROM 'string' OR length(p_snapshot->>'playerName') NOT BETWEEN 1 AND 128 OR
    jsonb_typeof(p_snapshot->'powerLevel') IS DISTINCT FROM 'number' OR
    jsonb_typeof(p_snapshot->'units') IS DISTINCT FROM 'array' OR jsonb_typeof(p_snapshot->'machinesOfWar') IS DISTINCT FROM 'array' OR
    jsonb_array_length(p_snapshot->'units')>1024 OR jsonb_array_length(p_snapshot->'machinesOfWar')>128 OR
    octet_length(p_snapshot::text)>8388608 OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid local roster'; END IF;
 IF (p_snapshot->>'powerLevel')::bigint NOT BETWEEN 0 AND 2147483647 OR EXISTS (
   SELECT 1 FROM jsonb_array_elements((p_snapshot->'units')||(p_snapshot->'machinesOfWar')) u WHERE
     jsonb_typeof(u) IS DISTINCT FROM 'object' OR u->>'id' IS NULL OR u->>'id' !~ '^[A-Za-z0-9_-]{1,100}$' OR
     u->>'progressionIndex' IS NULL OR (u->>'progressionIndex')::integer NOT BETWEEN 0 AND 19 OR
     u->>'rank' IS NULL OR (u->>'rank')::integer NOT BETWEEN 0 AND 23 OR
     u->>'xpLevel' IS NULL OR (u->>'xpLevel')::integer NOT BETWEEN 1 AND 32767 OR
     u->>'xp' IS NULL OR (u->>'xp')::integer<0 OR u->>'shards' IS NULL OR (u->>'shards')::integer<0 OR u->>'mythicShards' IS NULL OR (u->>'mythicShards')::integer<0 OR
     jsonb_typeof(u->'abilities') IS DISTINCT FROM 'array' OR jsonb_array_length(u->'abilities')>3 OR
     jsonb_typeof(u->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(u->'items')>3 OR
     jsonb_typeof(u->'upgrades') IS DISTINCT FROM 'array' OR jsonb_array_length(u->'upgrades')>6
 ) THEN RAISE EXCEPTION 'Invalid local roster'; END IF;
 count_rows:=jsonb_array_length(p_rows);
 SELECT count(DISTINCT value->>'id') INTO count_units FROM jsonb_array_elements((p_snapshot->'units')||(p_snapshot->'machinesOfWar'));
 IF count_rows>count_units OR count_rows>1152 OR EXISTS (
   SELECT 1 FROM jsonb_array_elements(p_rows) r LEFT JOIN public.hero_mappings h ON h.id=(r->>'hero_mapping_id')::integer
   WHERE h.id IS NULL OR h.unit_id IS DISTINCT FROM r->>'source_unit_id' OR
     NOT EXISTS (SELECT 1 FROM jsonb_array_elements((p_snapshot->'units')||(p_snapshot->'machinesOfWar')) u WHERE u->>'id'=h.unit_id)
 ) OR EXISTS (
   SELECT 1 FROM jsonb_populate_recordset(NULL::public.player_roster,p_rows) r WHERE
     r.user_id IS DISTINCT FROM auth.uid() OR r.player_mapping_id IS NOT NULL OR r.hero_mapping_id IS NULL OR
     r.rank_name IS NULL OR length(r.rank_name) NOT BETWEEN 1 AND 32 OR
     r.stars IS NULL OR r.stars NOT BETWEEN 0 AND 19 OR r.progression_index IS NULL OR r.progression_index NOT BETWEEN 0 AND 19 OR
     r.rarity IS NULL OR r.rarity NOT IN ('Common','Uncommon','Rare','Epic','Legendary','Mythic') OR
     r.xp IS NULL OR r.xp<0 OR r.xp_level IS NULL OR r.xp_level NOT BETWEEN 1 AND 32767 OR
     r.shards IS NULL OR r.shards<0 OR r.mythic_shards IS NULL OR r.mythic_shards<0 OR
     (r.active_ability_level IS NOT NULL AND r.active_ability_level NOT BETWEEN 0 AND 32767) OR
     (r.passive_ability_level IS NOT NULL AND r.passive_ability_level NOT BETWEEN 0 AND 32767) OR
     (r.crit_item_level IS NOT NULL AND r.crit_item_level NOT BETWEEN 1 AND 32767) OR
     (r.defensive_item_level IS NOT NULL AND r.defensive_item_level NOT BETWEEN 1 AND 32767) OR
     (r.booster_item_level IS NOT NULL AND r.booster_item_level NOT BETWEEN 1 AND 32767) OR
     r.upgrades IS NULL OR cardinality(r.upgrades)>6 OR EXISTS (SELECT 1 FROM unnest(r.upgrades) value WHERE value IS NULL OR value NOT BETWEEN 0 AND 5)
 ) THEN RAISE EXCEPTION 'Invalid local roster'; END IF;
 PERFORM pg_advisory_xact_lock(74832020);
 DELETE FROM public.player_roster r WHERE r.user_id=auth.uid() AND NOT EXISTS (SELECT 1 FROM jsonb_populate_recordset(NULL::public.player_roster,p_rows) n WHERE n.hero_mapping_id=r.hero_mapping_id);
 INSERT INTO public.player_roster(user_id,hero_mapping_id,rank_name,stars,crit_item_id,crit_item_level,booster_item_id,booster_item_level,defensive_item_id,defensive_item_level,synced_at,rarity,xp,xp_level,progression_index,shards,mythic_shards,active_ability_level,passive_ability_level,upgrades)
 SELECT r.user_id,r.hero_mapping_id,r.rank_name,r.stars,r.crit_item_id,r.crit_item_level,r.booster_item_id,r.booster_item_level,r.defensive_item_id,r.defensive_item_level,now(),r.rarity,r.xp,r.xp_level,r.progression_index,r.shards,r.mythic_shards,r.active_ability_level,r.passive_ability_level,r.upgrades FROM jsonb_populate_recordset(NULL::public.player_roster,p_rows) r
 ON CONFLICT (user_id,hero_mapping_id) DO UPDATE SET rank_name=EXCLUDED.rank_name,stars=EXCLUDED.stars,crit_item_id=EXCLUDED.crit_item_id,crit_item_level=EXCLUDED.crit_item_level,booster_item_id=EXCLUDED.booster_item_id,booster_item_level=EXCLUDED.booster_item_level,defensive_item_id=EXCLUDED.defensive_item_id,defensive_item_level=EXCLUDED.defensive_item_level,synced_at=EXCLUDED.synced_at,rarity=EXCLUDED.rarity,xp=EXCLUDED.xp,xp_level=EXCLUDED.xp_level,progression_index=EXCLUDED.progression_index,shards=EXCLUDED.shards,mythic_shards=EXCLUDED.mythic_shards,active_ability_level=EXCLUDED.active_ability_level,passive_ability_level=EXCLUDED.passive_ability_level,upgrades=EXCLUDED.upgrades;
 UPDATE public.player_mapping SET player_power=(p_snapshot->>'powerLevel')::integer,updated_at=now() WHERE user_id=auth.uid() AND is_current AND guild_code=target;
 IF NOT FOUND THEN RAISE EXCEPTION 'Local roster subject changed'; END IF;
 INSERT INTO public.desktop_roster_snapshots(subject_user_id,guild_code,payload) VALUES(auth.uid(),target,p_snapshot)
 ON CONFLICT(subject_user_id) DO UPDATE SET guild_code=EXCLUDED.guild_code,payload=EXCLUDED.payload,cached_at=now();
 RETURN jsonb_build_object('units',count_units,'mapped',count_rows,'unmapped',count_units-count_rows);
END $roster$;
ALTER FUNCTION public.desktop_save_roster(jsonb,jsonb) OWNER TO desktop_roster_writer;
REVOKE ALL ON FUNCTION public.desktop_save_roster(jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role,desktop_rpc_reader;
GRANT EXECUTE ON FUNCTION public.desktop_save_roster(jsonb,jsonb) TO desktop_owner;

