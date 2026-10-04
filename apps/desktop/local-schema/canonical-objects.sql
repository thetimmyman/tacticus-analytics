-- Selected canonical read-journey objects. Not a hosted migration replay.
CREATE TYPE public.app_role AS ENUM (
    'leader',
    'officer',
    'member',
    'Leader',
    'Member',
    'Officer',
    'demo'
);

CREATE TABLE public.clusters (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cluster_code character varying(20) NOT NULL,
    display_name character varying(100),
    tagline character varying(255),
    description text,
    logo_url text,
    banner_url text,
    primary_color character varying(7),
    secondary_color character varying(7),
    accent_color character varying(7),
    discord_server_id character varying(50),
    discord_invite_url text,
    website_url text,
    time_zone character varying(50) DEFAULT 'UTC'::character varying,
    primary_language character varying(10) DEFAULT 'en'::character varying,
    founded_date date,
    founder_name character varying(100),
    public_notes text,
    is_active boolean DEFAULT true,
    is_public boolean DEFAULT false,
    max_guilds integer DEFAULT 10,
    cluster_stats jsonb DEFAULT '{}'::jsonb,
    feature_flags jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    invite_code character varying(20),
    invite_expires_at timestamp with time zone,
    created_by uuid,
    short_name character varying(50),
    onboarding_completed boolean DEFAULT false,
    onboarding_started_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.guild_themes (
    id integer NOT NULL,
    guild_code text NOT NULL,
    primary_color character varying(7) DEFAULT '#C0C0C0'::character varying NOT NULL,
    secondary_color character varying(7) DEFAULT '#696969'::character varying NOT NULL,
    accent_color character varying(7) DEFAULT '#FFD700'::character varying NOT NULL,
    bg_from character varying(7) DEFAULT '#232526'::character varying NOT NULL,
    bg_via character varying(7) DEFAULT '#414345'::character varying NOT NULL,
    bg_to character varying(7) DEFAULT '#232526'::character varying NOT NULL,
    card_bg character varying(30) DEFAULT 'rgba(105, 105, 105, 0.2)'::character varying NOT NULL,
    card_border character varying(30) DEFAULT 'rgba(192, 192, 192, 0.3)'::character varying NOT NULL,
    text_primary character varying(7) DEFAULT '#C0C0C0'::character varying NOT NULL,
    text_secondary character varying(7) DEFAULT '#A9A9A9'::character varying NOT NULL,
    text_accent character varying(7) DEFAULT '#FFD700'::character varying NOT NULL,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE public.feature_releases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    feature_key text NOT NULL,
    display_name text NOT NULL,
    description text,
    release_stage text DEFAULT 'coming_soon'::text NOT NULL,
    icon text,
    route text,
    value_proposition text,
    sort_order integer DEFAULT 0,
    released_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT feature_releases_release_stage_check CHECK ((release_stage = ANY (ARRAY['alpha'::text, 'beta'::text, 'coming_soon'::text, 'public'::text])))
);

CREATE TABLE public.feature_access_grants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    access_level text NOT NULL,
    granted_by uuid,
    granted_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone,
    notes text,
    CONSTRAINT feature_access_grants_access_level_check CHECK ((access_level = ANY (ARRAY['alpha_tester'::text, 'beta_tester'::text])))
);

CREATE TABLE public."EOT_GR_data" (
    id bigint NOT NULL,
    "Guild" text NOT NULL,
    "Season" text,
    "displayName" text,
    "Name" text,
    "damageType" text DEFAULT 'N/A'::text,
    "damageDealt" bigint,
    "loopIndex" bigint,
    tier bigint,
    set integer,
    "startedOn" timestamp with time zone,
    "completedOn" timestamp with time zone,
    "timestamp" timestamp with time zone DEFAULT now(),
    "encounterId" integer NOT NULL,
    rarity text DEFAULT 'Unknown'::text,
    "userId" text,
    "encounterIndex" integer DEFAULT 0 NOT NULL,
    "encounterType" text DEFAULT 'Unknown'::text,
    "globalConfigHash" text,
    "heroDetails" text,
    "machineOfWarDetails" text,
    "unitId" text,
    type text,
    cluster_code character varying(20),
    cluster_id uuid,
    "maxHp" bigint,
    "remainingHp" bigint,
    season_num integer GENERATED ALWAYS AS (
CASE
    WHEN ("Season" ~ '^\d+$'::text) THEN ("Season")::integer
    ELSE NULL::integer
END) STORED,
    CONSTRAINT check_damage_positive CHECK (("damageDealt" >= 0)),
    CONSTRAINT check_damage_type CHECK (("damageType" = ANY (ARRAY['Battle'::text, 'Bomb'::text, 'N/A'::text]))),
    CONSTRAINT check_set_range CHECK (((set >= 0) AND (set <= 4))),
    CONSTRAINT no_independent_cluster_code CHECK (((cluster_code)::text <> 'INDEPENDENT'::text))
)
WITH (autovacuum_enabled='true', autovacuum_vacuum_scale_factor='0.05', autovacuum_analyze_scale_factor='0.02', autovacuum_vacuum_cost_delay='5', autovacuum_vacuum_cost_limit='2000', fillfactor='85');

CREATE TABLE public.guild_config (
    id integer NOT NULL,
    guild_code text NOT NULL,
    display_name text NOT NULL,
    enabled boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    guild_id text,
    user_id text,
    session_id text,
    "GR_Ranking" bigint,
    "GW_Ranking" bigint,
    discord_webhook_url text,
    "API_Owner" text,
    token_offender_threshold integer DEFAULT 4,
    token_abuser_threshold integer DEFAULT 5,
    is_cluster boolean DEFAULT false,
    cluster_id uuid,
    joined_cluster_at timestamp with time zone,
    cluster_role character varying(20) DEFAULT 'member'::character varying,
    cluster_code character varying(20),
    discord_webhook_enabled boolean DEFAULT false,
    tagline text,
    description text,
    logo_url text,
    timezone text DEFAULT 'UTC'::text,
    theme_preset text DEFAULT 'default'::text,
    social_links jsonb DEFAULT '{}'::jsonb,
    onboarding_completed boolean DEFAULT false,
    onboarding_started_at timestamp with time zone DEFAULT now(),
    api_key_encrypted text,
    api_key_migration_status text DEFAULT 'pending'::text,
    primary_assignment_tokens integer DEFAULT 3,
    secondary_assignment_tokens integer DEFAULT 2,
    api_key_is_valid boolean,
    api_key_last_validated timestamp with time zone,
    onboarding_completed_at timestamp with time zone,
    registration_status text DEFAULT 'incomplete'::text,
    registration_started_at timestamp with time zone DEFAULT now(),
    registration_completed_at timestamp with time zone,
    last_resume_attempt_at timestamp with time zone,
    last_sync_attempt timestamp with time zone,
    last_successful_sync timestamp with time zone,
    consecutive_sync_failures integer DEFAULT 0,
    auto_sync_enabled boolean DEFAULT true,
    guild_tag text,
    onboarding_source text DEFAULT 'legacy'::text,
    explore_privacy_mode jsonb DEFAULT '["public"]'::jsonb NOT NULL,
    explore_obfuscation_percent integer DEFAULT 10 NOT NULL,
    use_modular_sync boolean DEFAULT false NOT NULL,
    banner_url text,
    requirements_text text,
    min_power_level integer,
    min_account_level integer,
    preferred_timezone text,
    preferred_languages text[] DEFAULT ARRAY['English'::text],
    contact_discord text,
    restrict_playbooks_to_assignments boolean DEFAULT false,
    last_successful_gw_season integer,
    session_refreshed_at timestamp with time zone,
    sync_tier text DEFAULT 'active'::text NOT NULL,
    notifications_enabled boolean DEFAULT true NOT NULL,
    mention_roles_as_text boolean DEFAULT false NOT NULL,
    combine_prime_deaths boolean DEFAULT false NOT NULL,
    bomb_alert_enabled boolean DEFAULT false NOT NULL,
    bomb_alert_overkill_threshold numeric(3,2) DEFAULT 0.80 NOT NULL,
    bomb_alert_role_id text,
    bomb_alert_webhook_url text,
    defeat_alerts_enabled boolean DEFAULT true NOT NULL,
    apply_token_offender_filtering boolean DEFAULT false NOT NULL,
    beta_tester boolean DEFAULT false NOT NULL,
    guild_level smallint,
    guild_level_overridden_at timestamp with time zone,
    bomb_alert_calculation_mode text DEFAULT 'worst_case'::text NOT NULL,
    bomb_alert_ping_holders boolean DEFAULT false NOT NULL,
    compact_availability_posts boolean DEFAULT false NOT NULL,
    short_code text,
    herald_default_role_id text,
    consecutive_loki_failures integer DEFAULT 0 NOT NULL,
    realtime_sync boolean DEFAULT false NOT NULL,
    war_visibility text DEFAULT 'guild'::text NOT NULL,
    herald_replay_link_mode text DEFAULT 'off'::text NOT NULL,
    CONSTRAINT check_primary_assignment_tokens CHECK (((primary_assignment_tokens >= 1) AND (primary_assignment_tokens <= 10))),
    CONSTRAINT check_rankings_positive CHECK (((("GR_Ranking" IS NULL) OR ("GR_Ranking" > 0)) AND (("GW_Ranking" IS NULL) OR ("GW_Ranking" > 0)))),
    CONSTRAINT check_secondary_assignment_tokens CHECK (((secondary_assignment_tokens >= 1) AND (secondary_assignment_tokens <= 10))),
    CONSTRAINT check_token_thresholds CHECK ((((token_offender_threshold IS NULL) OR ((token_offender_threshold >= 1) AND (token_offender_threshold <= 100))) AND ((token_abuser_threshold IS NULL) OR ((token_abuser_threshold >= 1) AND (token_abuser_threshold <= 100))) AND ((token_offender_threshold IS NULL) OR (token_abuser_threshold IS NULL) OR (token_offender_threshold <= token_abuser_threshold)))),
    CONSTRAINT guild_config_bomb_alert_calculation_mode_check CHECK ((bomb_alert_calculation_mode = ANY (ARRAY['worst_case'::text, 'average'::text, 'best_case'::text]))),
    CONSTRAINT guild_config_bomb_alert_overkill_threshold_check CHECK (((bomb_alert_overkill_threshold > (0)::numeric) AND (bomb_alert_overkill_threshold <= (1)::numeric))),
    CONSTRAINT guild_config_explore_obfuscation_percent_check CHECK (((explore_obfuscation_percent >= 1) AND (explore_obfuscation_percent <= 30))),
    CONSTRAINT guild_config_explore_privacy_mode_check CHECK (((explore_privacy_mode IS NOT NULL) AND (jsonb_typeof(explore_privacy_mode) = 'array'::text) AND (jsonb_array_length(explore_privacy_mode) > 0))),
    CONSTRAINT guild_config_guild_code_not_empty CHECK (((guild_code IS NOT NULL) AND (guild_code <> ''::text) AND (length(TRIM(BOTH FROM guild_code)) > 0))),
    CONSTRAINT guild_config_guild_level_check CHECK (((guild_level IS NULL) OR ((guild_level >= 1) AND (guild_level <= 100)))),
    CONSTRAINT guild_config_guild_tag_check CHECK ((length(guild_tag) <= 6)),
    CONSTRAINT guild_config_herald_replay_link_mode_check CHECK ((herald_replay_link_mode = ANY (ARRAY['off'::text, 'pinned'::text, 'featured'::text, 'all'::text]))),
    CONSTRAINT guild_config_registration_status_check CHECK ((registration_status = ANY (ARRAY['incomplete'::text, 'pending_api_key'::text, 'completed'::text, 'abandoned'::text]))),
    CONSTRAINT guild_config_sync_tier_check CHECK ((sync_tier = ANY (ARRAY['active'::text, 'warm'::text, 'dormant'::text]))),
    CONSTRAINT guild_config_war_visibility_check CHECK ((war_visibility = ANY (ARRAY['guild'::text, 'cluster'::text, 'public'::text]))),
    CONSTRAINT no_independent_cluster_code CHECK (((cluster_code)::text <> 'INDEPENDENT'::text)),
    CONSTRAINT prevent_system_guild_deletion CHECK ((NOT (((cluster_code)::text = 'TEST'::text) AND (enabled = false))))
);

CREATE TABLE public.player_mapping (
    id integer NOT NULL,
    player_id text NOT NULL,
    display_name text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    guild_code text DEFAULT 'GLOBAL'::text,
    auto_generated boolean DEFAULT false,
    user_id uuid,
    username text,
    role public.app_role DEFAULT 'member'::public.app_role,
    discord_username text,
    avatar_url text,
    is_active boolean DEFAULT true,
    is_current boolean DEFAULT false,
    timezone text DEFAULT 'UTC'::text,
    tacticus_share_url text,
    player_notes text,
    officer_notes text,
    has_duplicate_name boolean DEFAULT false,
    original_display_name text,
    theme_preference character varying(20) DEFAULT NULL::character varying,
    boss_preferences jsonb DEFAULT '{}'::jsonb,
    preferences_updated_at timestamp with time zone DEFAULT now(),
    primary_boss text,
    secondary_boss text,
    assignment_notes text,
    assigned_by uuid,
    assigned_at timestamp with time zone,
    last_battle_time timestamp with time zone,
    api_key_added_at timestamp with time zone,
    api_key_last_verified timestamp with time zone,
    api_key_is_valid boolean DEFAULT true,
    notify_boss_kills boolean DEFAULT false,
    notify_prime_kills boolean DEFAULT false,
    notify_when_capped boolean DEFAULT false,
    primary_team text,
    secondary_team text,
    tertiary_team text,
    last_sync_tokens integer,
    last_sync_bombs integer,
    last_sync_at timestamp without time zone,
    next_token_seconds integer,
    next_bomb_seconds integer,
    protected boolean DEFAULT false,
    cluster_code character varying(20),
    cluster_id uuid,
    tacticus_api_key_encrypted text,
    discord_user_id character varying(32),
    is_app_admin boolean DEFAULT false,
    patreon_user_id text,
    player_level integer,
    avatar_unit_id character varying(100),
    player_power bigint,
    last_active_at timestamp with time zone,
    ownership_attestation_id uuid,
    CONSTRAINT no_independent_cluster_code CHECK (((cluster_code)::text <> 'INDEPENDENT'::text))
);

CREATE TABLE public.player_identity_attestations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    mapping_id integer NOT NULL,
    player_id text NOT NULL,
    subject_user_id uuid NOT NULL,
    source_invite_id uuid,
    consumed_at timestamp with time zone NOT NULL,
    attested_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    source text NOT NULL,
    guild_code_snapshot text,
    CONSTRAINT player_identity_attestation_consumption_order CHECK ((attested_at >= consumed_at)),
    CONSTRAINT player_identity_attestations_invite_presence CHECK (((source = 'operator_quarantine_restore'::text) OR (source_invite_id IS NOT NULL))),
    CONSTRAINT player_identity_attestations_source_check CHECK ((source = ANY (ARRAY['invite_consumption'::text, 'historical_exact_invite'::text, 'operator_quarantine_restore'::text, 'self_player_id_change'::text])))
);

CREATE TABLE public.player_identity_attestation_revocations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    attestation_id uuid NOT NULL,
    revoked_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    reason text NOT NULL,
    actor_user_id uuid,
    actor_role text NOT NULL,
    source text NOT NULL,
    CONSTRAINT player_identity_attestation_revocations_reason_check CHECK ((reason = ANY (ARRAY['account_delete'::text, 'gdpr_erasure'::text, 'admin_unlink'::text, 'player_id_correction'::text, 'mapping_delete'::text, 'guild_delete'::text, 'support_reverify'::text, 'authority_recovery'::text, 'roster_deactivation'::text])))
);

CREATE TABLE public.player_identity_subject_authority_blocks (
    subject_user_id uuid NOT NULL,
    blocked_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    reason text NOT NULL,
    source text NOT NULL,
    CONSTRAINT player_identity_subject_authority_blocks_reason_check CHECK ((reason = ANY (ARRAY['account_delete'::text, 'gdpr_erasure'::text, 'auth_delete'::text]))),
    CONSTRAINT player_identity_subject_authority_blocks_source_check CHECK (((length(source) >= 3) AND (length(source) <= 120)))
);

CREATE TABLE IF NOT EXISTS public.user_bans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ban_group_id uuid NOT NULL,
  auth_user_id uuid NOT NULL,
  subject_type text NOT NULL,
  subject_value text NOT NULL,
  reason text,
  banned_by uuid,
  banned_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  lifted_at timestamptz,
  lifted_by uuid,
  lift_reason text,
  CONSTRAINT user_bans_subject_type_check
    CHECK (subject_type = ANY (ARRAY[
      'user_id'::text,
      'email'::text,
      'discord_user_id'::text,
      'player_id'::text
    ])),
  CONSTRAINT user_bans_subject_value_normalized
    CHECK (btrim(subject_value) <> '' AND subject_value = lower(subject_value)),
  CONSTRAINT user_bans_expires_after_banned
    CHECK (expires_at IS NULL OR expires_at > banned_at),
  CONSTRAINT user_bans_lift_is_complete
    CHECK ((lifted_at IS NULL) = (lifted_by IS NULL))
);

CREATE FUNCTION public.qualifying_sweep_count(sweep_damages numeric[], threshold numeric) RETURNS integer
    LANGUAGE sql IMMUTABLE STRICT
    AS $$
  SELECT coalesce(count(*)::integer, 0) FROM unnest(sweep_damages) s WHERE s >= threshold;
$$;

CREATE FUNCTION public.qualifying_sweep_sum(sweep_damages numeric[], threshold numeric) RETURNS numeric
    LANGUAGE sql IMMUTABLE STRICT
    AS $$
  SELECT coalesce(sum(s), 0) FROM unnest(sweep_damages) s WHERE s >= threshold;
$$;

CREATE FUNCTION public.calc_boss_performance_pct(p_non_sweep_damage numeric, p_non_sweep_count numeric, p_sweep_damages numeric[], p_reference_avg numeric, p_gate_avg numeric DEFAULT NULL::numeric) RETURNS numeric
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT CASE WHEN p_reference_avg > 0 THEN
    ((
      (COALESCE(p_non_sweep_damage, 0)
        + COALESCE(qualifying_sweep_sum(p_sweep_damages, GREATEST(p_gate_avg, p_reference_avg)), 0))
      / NULLIF(
          COALESCE(p_non_sweep_count, 0)
          + COALESCE(qualifying_sweep_count(p_sweep_damages, GREATEST(p_gate_avg, p_reference_avg)), 0),
        0)
      / p_reference_avg
    ) - 1) * 100
  ELSE NULL END
$$;

CREATE FUNCTION public.calc_effective_battle_count(p_non_sweep_count numeric, p_sweep_damages numeric[], p_reference_avg numeric, p_gate_avg numeric DEFAULT NULL::numeric) RETURNS numeric
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT CASE WHEN p_reference_avg > 0 THEN
    COALESCE(p_non_sweep_count, 0)
      + COALESCE(qualifying_sweep_count(p_sweep_damages, GREATEST(p_gate_avg, p_reference_avg)), 0)
  ELSE 0 END
$$;

CREATE OR REPLACE FUNCTION public._pm_caller_cluster_guild_codes()
RETURNS SETOF text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  RETURN QUERY
  SELECT gc2.guild_code
  FROM public.guild_config gc2
  WHERE gc2.cluster_id IS NOT NULL
    AND gc2.cluster_id IN (
      SELECT gc.cluster_id
      FROM public.guild_config gc
      JOIN public.player_mapping pm ON pm.guild_code = gc.guild_code
      WHERE pm.user_id = (SELECT auth.uid())
        AND pm.is_current = true
        AND gc.cluster_id IS NOT NULL
    );
END;
$fn$;

CREATE OR REPLACE FUNCTION public._pm_caller_guild_codes()
RETURNS SETOF text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  RETURN QUERY
  SELECT guild_code
  FROM public.player_mapping
  WHERE user_id = (SELECT auth.uid())
    AND is_current = true
    AND guild_code IS NOT NULL;
END;
$fn$;

CREATE OR REPLACE FUNCTION public._pm_caller_is_app_admin()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  RETURN EXISTS(
    SELECT 1 FROM public.player_mapping
    WHERE user_id = (SELECT auth.uid())
      AND is_app_admin = true
      AND is_current = true
  );
END;
$fn$;

CREATE FUNCTION public.resolve_verified_players(p_user_ids uuid[]) RETURNS TABLE(mapping_id bigint, player_id text, user_id uuid, guild_code text, role public.app_role, is_app_admin boolean, ownership_attestation_id uuid)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF p_user_ids IS NULL OR cardinality(p_user_ids) IS NULL
    OR cardinality(p_user_ids) < 1 OR cardinality(p_user_ids) > 1000
    OR array_position(p_user_ids, NULL) IS NOT NULL
  THEN
    RAISE EXCEPTION 'p_user_ids must contain 1..1000 non-null UUIDs'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT
      mapping.id,
      mapping.player_id,
      mapping.user_id,
      mapping.guild_code,
      mapping.role,
      mapping.is_app_admin,
      mapping.ownership_attestation_id
    FROM public.player_mapping AS mapping
    CROSS JOIN LATERAL (
      SELECT
        count(*) AS match_count,
        (array_agg(attestation.id ORDER BY attestation.id))[1]
          AS exact_attestation_id
      FROM public.player_identity_attestations AS attestation
      WHERE attestation.mapping_id = mapping.id
        AND attestation.player_id = mapping.player_id
        AND attestation.subject_user_id = mapping.user_id
        AND NOT EXISTS (
          SELECT 1
          FROM public.player_identity_attestation_revocations AS revoked
          WHERE revoked.attestation_id = attestation.id
        )
    ) AS proof
    WHERE mapping.is_current IS TRUE
      AND mapping.user_id = ANY(p_user_ids)
      AND NOT EXISTS (
        SELECT 1
        FROM public.player_identity_subject_authority_blocks AS block
        WHERE block.subject_user_id = mapping.user_id
      )
      AND proof.match_count = 1
      AND proof.exact_attestation_id = mapping.ownership_attestation_id
  ), unambiguous_users AS (
    SELECT candidate.user_id
    FROM candidates AS candidate
    GROUP BY candidate.user_id
    HAVING count(*) = 1
  )
  SELECT
    candidate.id::bigint,
    candidate.player_id,
    candidate.user_id,
    candidate.guild_code,
    candidate.role,
    coalesce(candidate.is_app_admin, false),
    candidate.ownership_attestation_id
  FROM candidates AS candidate
  JOIN unambiguous_users AS exact_user USING (user_id)
  ORDER BY candidate.id;
END
$$;

CREATE OR REPLACE FUNCTION public.get_guild_boss_averages_batch(p_guild_code text, p_seasons text[])
 RETURNS TABLE(season text, boss_key text, avg_damage numeric, total_damage numeric, battle_count integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    e."Season"::text AS season,
    e."Name" || '_' || e.rarity || '_' || e.set AS boss_key,
    ROUND(AVG(e."damageDealt")::numeric, 2) AS avg_damage,
    ROUND(SUM(e."damageDealt")::numeric, 2) AS total_damage,
    COUNT(*)::integer AS battle_count
  FROM "EOT_GR_data" e
  WHERE e."Guild" = p_guild_code
    AND e."Season" = ANY(p_seasons)
    AND e."damageType" = 'Battle'
    AND e.rarity IN ('Legendary', 'Mythic')
    AND e."damageDealt" > 0
    AND NOT (e."remainingHp" = 0 AND e."maxHp" > 0 AND e."damageDealt" < e."maxHp")
  GROUP BY e."Season", e."Name", e.rarity, e.set
  ORDER BY (e."Season")::numeric DESC, total_damage DESC;
$function$;

CREATE OR REPLACE FUNCTION public.get_guild_player_scores_batch(p_guild_code text, p_seasons text[])
 RETURNS TABLE(season text, user_id text, weighted_vs_guild numeric, battle_count integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH guild_averages AS (
    SELECT
      e."Season",
      e."Name" || '_' || e.rarity || '_' || e.set AS boss_key,
      AVG(e."damageDealt") AS avg_damage
    FROM "EOT_GR_data" e
    WHERE e."Guild" = p_guild_code
      AND e."Season" = ANY(p_seasons)
      AND e."damageType" = 'Battle'
      AND e.rarity IN ('Legendary', 'Mythic')
      AND e."damageDealt" > 0
      AND NOT (e."remainingHp" = 0 AND e."maxHp" > 0 AND e."damageDealt" < e."maxHp")
    GROUP BY e."Season", e."Name", e.rarity, e.set
  ),
  player_boss_stats AS (
    SELECT
      e."Season",
      e."userId",
      e."Name" || '_' || e.rarity || '_' || e.set AS boss_key,
      AVG(e."damageDealt") FILTER (
        WHERE NOT (e."remainingHp" = 0 AND e."maxHp" > 0 AND e."damageDealt" < e."maxHp")
      ) AS player_avg,
      COUNT(*) FILTER (
        WHERE NOT (e."remainingHp" = 0 AND e."maxHp" > 0 AND e."damageDealt" < e."maxHp")
      ) AS battle_count,
      SUM(e."damageDealt") FILTER (
        WHERE NOT (e."remainingHp" = 0 AND e."maxHp" > 0 AND e."damageDealt" < e."maxHp")
      ) AS non_sweep_damage,
      array_agg(e."damageDealt"::numeric) FILTER (
        WHERE e."remainingHp" = 0 AND e."maxHp" > 0 AND e."damageDealt" < e."maxHp"
      ) AS sweep_damages
    FROM "EOT_GR_data" e
    WHERE e."Guild" = p_guild_code
      AND e."Season" = ANY(p_seasons)
      AND e."damageType" = 'Battle'
      AND e.rarity IN ('Legendary', 'Mythic')
      AND e."damageDealt" > 0
    GROUP BY e."Season", e."userId", e."Name", e.rarity, e.set
  ),
  player_weighted AS (
    SELECT
      pbs."Season",
      pbs."userId",
      SUM(
        calc_boss_performance_pct(pbs.non_sweep_damage, pbs.battle_count, pbs.sweep_damages, ga.avg_damage::numeric, pbs.player_avg::numeric)
        * calc_effective_battle_count(pbs.battle_count, pbs.sweep_damages, ga.avg_damage::numeric, pbs.player_avg::numeric)
      ) / NULLIF(SUM(
        calc_effective_battle_count(pbs.battle_count, pbs.sweep_damages, ga.avg_damage::numeric, pbs.player_avg::numeric)
      ), 0) AS weighted_vs_guild,
      SUM(COALESCE(pbs.battle_count, 0) + COALESCE(qualifying_sweep_count(pbs.sweep_damages, GREATEST(pbs.player_avg::numeric, ga.avg_damage::numeric)), 0))::integer AS total_battles
    FROM player_boss_stats pbs
    LEFT JOIN guild_averages ga ON ga."Season" = pbs."Season" AND ga.boss_key = pbs.boss_key
    GROUP BY pbs."Season", pbs."userId"
  )
  SELECT
    pw."Season"::text AS season,
    pw."userId" AS user_id,
    pw.weighted_vs_guild,
    pw.total_battles AS battle_count
  FROM player_weighted pw
  WHERE pw.weighted_vs_guild IS NOT NULL
  ORDER BY (pw."Season")::numeric DESC, pw.weighted_vs_guild DESC;
$function$;

CREATE FUNCTION public.calculate_player_reliability(p_user_id text, p_guild_code text, p_season text, p_cluster_code text DEFAULT NULL::text) RETURNS TABLE(reliability_score numeric, consistency_rating text, avg_performance numeric, performance_stddev numeric, coefficient_of_variation numeric, battles_analyzed integer, performance_range_min numeric, performance_range_max numeric)
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_performance_data NUMERIC[];
  v_avg_performance NUMERIC;
  v_stddev NUMERIC;
  v_cv NUMERIC;
  v_reliability NUMERIC;
  v_battles_count INTEGER;
  v_min_perf NUMERIC;
  v_max_perf NUMERIC;
  v_consistency_text TEXT;
BEGIN
  WITH battle_performance AS (
    SELECT
      d."userId",
      d."Name" as boss_name,
      d."damageDealt",
      d."remainingHp",
      d."maxHp",
      d."damageType",
      d."damageDealt"::NUMERIC / NULLIF(
        AVG(d."damageDealt") OVER (
          PARTITION BY d."Name", d."Guild"
        ), 0
      ) as performance_ratio,
      COUNT(*) OVER (PARTITION BY d."Name", d."Guild") as boss_hit_count
    FROM "EOT_GR_data" d
    WHERE d."userId" = p_user_id
      AND d."Guild" = p_guild_code
      AND d."Season" = p_season
      AND (p_cluster_code IS NULL OR d."cluster_code" = p_cluster_code)
      AND (d."damageType" IS NULL OR d."damageType" NOT IN ('Bomb', 'Bombardment'))
      AND NOT (d."remainingHp" = 0 AND d."maxHp" > 0 AND d."damageDealt" < d."maxHp")
      AND d."damageDealt" > 0
      AND (d."damageType" IS NULL OR d."damageType" IN ('Battle', 'Normal', 'Standard'))
  ),
  filtered_performance AS (
    SELECT
      performance_ratio
    FROM battle_performance
    WHERE performance_ratio IS NOT NULL
      AND boss_hit_count > 1
  ),
  performance_array AS (
    SELECT
      array_agg(performance_ratio ORDER BY performance_ratio) as perf_array,
      COUNT(*)::INTEGER as battle_count,
      AVG(performance_ratio) as avg_ratio,
      STDDEV_POP(performance_ratio) as stddev_ratio,
      MIN(performance_ratio) as min_ratio,
      MAX(performance_ratio) as max_ratio
    FROM filtered_performance
  )
  SELECT
    perf_array,
    battle_count,
    avg_ratio,
    stddev_ratio,
    min_ratio,
    max_ratio
  INTO
    v_performance_data,
    v_battles_count,
    v_avg_performance,
    v_stddev,
    v_min_perf,
    v_max_perf
  FROM performance_array;
  IF v_battles_count IS NULL OR v_battles_count < 2 THEN
    SELECT
      COUNT(*)::INTEGER,
      AVG("damageDealt")::NUMERIC
    INTO
      v_battles_count,
      v_avg_performance
    FROM "EOT_GR_data"
    WHERE "userId" = p_user_id
      AND "Guild" = p_guild_code
      AND "Season" = p_season
      AND (p_cluster_code IS NULL OR "cluster_code" = p_cluster_code)
      AND ("damageType" IS NULL OR "damageType" NOT IN ('Bomb', 'Bombardment'))
      AND NOT ("remainingHp" = 0 AND "maxHp" > 0 AND "damageDealt" < "maxHp")
      AND "damageDealt" > 0;

    RETURN QUERY
    SELECT
      NULL::NUMERIC as reliability_score,
      'Insufficient Data (needs 2+ attacks on one boss)'::TEXT as consistency_rating,
      v_avg_performance,
      NULL::NUMERIC as performance_stddev,
      NULL::NUMERIC as coefficient_of_variation,
      v_battles_count,
      NULL::NUMERIC as performance_range_min,
      NULL::NUMERIC as performance_range_max;
    RETURN;
  END IF;
  IF v_avg_performance > 0 THEN
    v_cv := (v_stddev / v_avg_performance) * 100;
  ELSE
    v_cv := 100; -- Max CV if average is 0
  END IF;
  v_reliability := GREATEST(0, 100 - v_cv);
  v_consistency_text := CASE
    WHEN v_reliability >= 90 THEN 'Elite Consistency'
    WHEN v_reliability >= 80 THEN 'Very Consistent'
    WHEN v_reliability >= 70 THEN 'Consistent'
    WHEN v_reliability >= 60 THEN 'Moderately Consistent'
    WHEN v_reliability >= 50 THEN 'Average Consistency'
    WHEN v_reliability >= 40 THEN 'Variable'
    WHEN v_reliability >= 30 THEN 'Highly Variable'
    WHEN v_reliability >= 20 THEN 'Very Inconsistent'
    ELSE 'Extremely Variable'
  END;
  RETURN QUERY
  SELECT
    v_reliability,
    v_consistency_text,
    v_avg_performance,
    v_stddev,
    v_cv,
    v_battles_count,
    v_min_perf,
    v_max_perf;
END;
$$;

CREATE FUNCTION public.get_player_performance_in_cluster(p_user_id text, p_guild_code text, p_cluster_code text, p_season text) RETURNS TABLE(player_name text, guild_code text, total_damage bigint, battle_count integer, vs_guild_pct numeric, vs_cluster_pct numeric, guild_rank integer, total_players_in_guild integer, cluster_rank integer, total_players_in_cluster integer)
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_target_cluster_code TEXT;
  v_target_cluster_id UUID;
  v_is_service BOOLEAN := COALESCE(
    NULLIF(
      NULLIF(current_setting('role', true), ''),
      'none'
    ),
    NULLIF(session_user, '')
  ) = 'service_role';
BEGIN
  IF NOT v_is_service
    AND NOT COALESCE(
      p_guild_code IN (
        SELECT public._pm_caller_guild_codes()
      )
      OR p_guild_code IN (
        SELECT public._pm_caller_cluster_guild_codes()
      )
      OR public._pm_caller_is_app_admin(),
      FALSE
    )
  THEN
    RETURN;
  END IF;

  SELECT gc.cluster_code, gc.cluster_id
  INTO v_target_cluster_code, v_target_cluster_id
  FROM public.guild_config AS gc
  WHERE gc.guild_code = p_guild_code
  LIMIT 1;

  RETURN QUERY
  WITH cluster_guilds AS (
    SELECT gc.guild_code
    FROM guild_config gc
    WHERE v_target_cluster_code IS NOT NULL
      AND v_target_cluster_id IS NOT NULL
      AND gc.cluster_code = v_target_cluster_code
      AND gc.cluster_id = v_target_cluster_id
  ),
  guild_averages AS (
    SELECT
      e."Name" || '_' || e.rarity AS boss_key,
      AVG(e."damageDealt") AS avg_damage
    FROM "EOT_GR_data" e
    WHERE e."Guild" = p_guild_code
      AND e."Season" = p_season
      AND e."damageType" = 'Battle'
      AND e.rarity IN ('Legendary', 'Mythic')
      AND e."damageDealt" > 0
      AND NOT (e."remainingHp" = 0 AND e."maxHp" > 0 AND e."damageDealt" < e."maxHp")
    GROUP BY e."Name", e.rarity
  ),
  cluster_averages AS (
    SELECT
      e."Name" || '_' || e.rarity AS boss_key,
      AVG(e."damageDealt") AS avg_damage
    FROM "EOT_GR_data" e
    INNER JOIN cluster_guilds cg ON cg.guild_code = e."Guild"
    WHERE e."Season" = p_season
      AND e."damageType" = 'Battle'
      AND e.rarity IN ('Legendary', 'Mythic')
      AND e."damageDealt" > 0
      AND NOT (e."remainingHp" = 0 AND e."maxHp" > 0 AND e."damageDealt" < e."maxHp")
    GROUP BY e."Name", e.rarity
  ),
  player_boss_stats AS (
    SELECT
      e."Name" || '_' || e.rarity AS boss_key,
      AVG(e."damageDealt") FILTER (
        WHERE NOT (e."remainingHp" = 0 AND e."maxHp" > 0 AND e."damageDealt" < e."maxHp")
      ) AS player_avg,
      COUNT(*) FILTER (
        WHERE NOT (e."remainingHp" = 0 AND e."maxHp" > 0 AND e."damageDealt" < e."maxHp")
      ) AS battle_count,
      SUM(e."damageDealt") FILTER (
        WHERE NOT (e."remainingHp" = 0 AND e."maxHp" > 0 AND e."damageDealt" < e."maxHp")
      ) AS non_sweep_damage,
      array_agg(e."damageDealt"::numeric) FILTER (
        WHERE e."remainingHp" = 0 AND e."maxHp" > 0 AND e."damageDealt" < e."maxHp"
      ) AS sweep_damages
    FROM "EOT_GR_data" e
    WHERE e."userId" = p_user_id
      AND e."Guild" = p_guild_code
      AND e."Season" = p_season
      AND e."damageType" = 'Battle'
      AND e.rarity IN ('Legendary', 'Mythic')
      AND e."damageDealt" > 0
    GROUP BY e."Name", e.rarity
  ),
  player_performance AS (
    SELECT
      SUM(
        CASE WHEN ga.avg_damage > 0 THEN
          ((
            (coalesce(pbs.non_sweep_damage, 0) + coalesce(qualifying_sweep_sum(pbs.sweep_damages, GREATEST(pbs.player_avg, ga.avg_damage)::numeric), 0))
            / nullif(coalesce(pbs.battle_count, 0) + coalesce(qualifying_sweep_count(pbs.sweep_damages, GREATEST(pbs.player_avg, ga.avg_damage)::numeric), 0), 0)
            / ga.avg_damage
          ) - 1) * 100
          * (coalesce(pbs.battle_count, 0) + coalesce(qualifying_sweep_count(pbs.sweep_damages, GREATEST(pbs.player_avg, ga.avg_damage)::numeric), 0))
        ELSE 0 END
      ) / NULLIF(SUM(
        CASE WHEN ga.avg_damage > 0
          THEN coalesce(pbs.battle_count, 0) + coalesce(qualifying_sweep_count(pbs.sweep_damages, GREATEST(pbs.player_avg, ga.avg_damage)::numeric), 0)
          ELSE 0 END
      ), 0) AS vs_guild,
      SUM(
        CASE WHEN ca.avg_damage > 0 THEN
          ((
            (coalesce(pbs.non_sweep_damage, 0) + coalesce(qualifying_sweep_sum(pbs.sweep_damages, GREATEST(pbs.player_avg, ca.avg_damage)::numeric), 0))
            / nullif(coalesce(pbs.battle_count, 0) + coalesce(qualifying_sweep_count(pbs.sweep_damages, GREATEST(pbs.player_avg, ca.avg_damage)::numeric), 0), 0)
            / ca.avg_damage
          ) - 1) * 100
          * (coalesce(pbs.battle_count, 0) + coalesce(qualifying_sweep_count(pbs.sweep_damages, GREATEST(pbs.player_avg, ca.avg_damage)::numeric), 0))
        ELSE 0 END
      ) / NULLIF(SUM(
        CASE WHEN ca.avg_damage > 0
          THEN coalesce(pbs.battle_count, 0) + coalesce(qualifying_sweep_count(pbs.sweep_damages, GREATEST(pbs.player_avg, ca.avg_damage)::numeric), 0)
          ELSE 0 END
      ), 0) AS vs_cluster
    FROM player_boss_stats pbs
    LEFT JOIN guild_averages ga ON ga.boss_key = pbs.boss_key
    LEFT JOIN cluster_averages ca ON ca.boss_key = pbs.boss_key
  ),
  all_guild_players_stats AS (
    SELECT
      e."userId",
      e."Name" || '_' || e.rarity AS boss_key,
      AVG(e."damageDealt") FILTER (
        WHERE NOT (e."remainingHp" = 0 AND e."maxHp" > 0 AND e."damageDealt" < e."maxHp")
      ) AS player_avg,
      COUNT(*) FILTER (
        WHERE NOT (e."remainingHp" = 0 AND e."maxHp" > 0 AND e."damageDealt" < e."maxHp")
      ) AS battle_count,
      SUM(e."damageDealt") FILTER (
        WHERE NOT (e."remainingHp" = 0 AND e."maxHp" > 0 AND e."damageDealt" < e."maxHp")
      ) AS non_sweep_damage,
      array_agg(e."damageDealt"::numeric) FILTER (
        WHERE e."remainingHp" = 0 AND e."maxHp" > 0 AND e."damageDealt" < e."maxHp"
      ) AS sweep_damages
    FROM "EOT_GR_data" e
    WHERE e."Guild" = p_guild_code
      AND e."Season" = p_season
      AND e."damageType" = 'Battle'
      AND e.rarity IN ('Legendary', 'Mythic')
      AND e."damageDealt" > 0
    GROUP BY e."userId", e."Name", e.rarity
  ),
  all_guild_players_weighted AS (
    SELECT
      agps."userId",
      SUM(
        CASE WHEN ga.avg_damage > 0 THEN
          ((
            (coalesce(agps.non_sweep_damage, 0) + coalesce(qualifying_sweep_sum(agps.sweep_damages, GREATEST(agps.player_avg, ga.avg_damage)::numeric), 0))
            / nullif(coalesce(agps.battle_count, 0) + coalesce(qualifying_sweep_count(agps.sweep_damages, GREATEST(agps.player_avg, ga.avg_damage)::numeric), 0), 0)
            / ga.avg_damage
          ) - 1) * 100
          * (coalesce(agps.battle_count, 0) + coalesce(qualifying_sweep_count(agps.sweep_damages, GREATEST(agps.player_avg, ga.avg_damage)::numeric), 0))
        ELSE 0 END
      ) / NULLIF(SUM(
        CASE WHEN ga.avg_damage > 0
          THEN coalesce(agps.battle_count, 0) + coalesce(qualifying_sweep_count(agps.sweep_damages, GREATEST(agps.player_avg, ga.avg_damage)::numeric), 0)
          ELSE 0 END
      ), 0) AS weighted_vs_guild
    FROM all_guild_players_stats agps
    LEFT JOIN guild_averages ga ON ga.boss_key = agps.boss_key
    GROUP BY agps."userId"
  ),
  guild_rankings AS (
    SELECT
      "userId",
      weighted_vs_guild,
      RANK() OVER (ORDER BY weighted_vs_guild DESC NULLS LAST) AS rank,
      COUNT(*) OVER () AS total_players
    FROM all_guild_players_weighted
    WHERE weighted_vs_guild IS NOT NULL
  ),
  player_guild_rank AS (
    SELECT
      rank,
      total_players
    FROM guild_rankings
    WHERE "userId" = p_user_id
  ),
  all_cluster_players_stats AS (
    SELECT
      e."userId",
      e."Guild",
      e."Name" || '_' || e.rarity AS boss_key,
      AVG(e."damageDealt") FILTER (
        WHERE NOT (e."remainingHp" = 0 AND e."maxHp" > 0 AND e."damageDealt" < e."maxHp")
      ) AS player_avg,
      COUNT(*) FILTER (
        WHERE NOT (e."remainingHp" = 0 AND e."maxHp" > 0 AND e."damageDealt" < e."maxHp")
      ) AS battle_count,
      SUM(e."damageDealt") FILTER (
        WHERE NOT (e."remainingHp" = 0 AND e."maxHp" > 0 AND e."damageDealt" < e."maxHp")
      ) AS non_sweep_damage,
      array_agg(e."damageDealt"::numeric) FILTER (
        WHERE e."remainingHp" = 0 AND e."maxHp" > 0 AND e."damageDealt" < e."maxHp"
      ) AS sweep_damages
    FROM "EOT_GR_data" e
    INNER JOIN cluster_guilds cg ON cg.guild_code = e."Guild"
    WHERE e."Season" = p_season
      AND e."damageType" = 'Battle'
      AND e.rarity IN ('Legendary', 'Mythic')
      AND e."damageDealt" > 0
    GROUP BY e."userId", e."Guild", e."Name", e.rarity
  ),
  all_cluster_players_weighted AS (
    SELECT
      acps."userId",
      acps."Guild",
      SUM(
        CASE WHEN ca.avg_damage > 0 THEN
          ((
            (coalesce(acps.non_sweep_damage, 0) + coalesce(qualifying_sweep_sum(acps.sweep_damages, GREATEST(acps.player_avg, ca.avg_damage)::numeric), 0))
            / nullif(coalesce(acps.battle_count, 0) + coalesce(qualifying_sweep_count(acps.sweep_damages, GREATEST(acps.player_avg, ca.avg_damage)::numeric), 0), 0)
            / ca.avg_damage
          ) - 1) * 100
          * (coalesce(acps.battle_count, 0) + coalesce(qualifying_sweep_count(acps.sweep_damages, GREATEST(acps.player_avg, ca.avg_damage)::numeric), 0))
        ELSE 0 END
      ) / NULLIF(SUM(
        CASE WHEN ca.avg_damage > 0
          THEN coalesce(acps.battle_count, 0) + coalesce(qualifying_sweep_count(acps.sweep_damages, GREATEST(acps.player_avg, ca.avg_damage)::numeric), 0)
          ELSE 0 END
      ), 0) AS weighted_vs_cluster
    FROM all_cluster_players_stats acps
    LEFT JOIN cluster_averages ca ON ca.boss_key = acps.boss_key
    GROUP BY acps."userId", acps."Guild"
  ),
  cluster_rankings AS (
    SELECT
      "userId",
      "Guild",
      weighted_vs_cluster,
      RANK() OVER (ORDER BY weighted_vs_cluster DESC NULLS LAST) AS rank,
      COUNT(*) OVER () AS total_players
    FROM all_cluster_players_weighted
    WHERE weighted_vs_cluster IS NOT NULL
  ),
  player_cluster_rank AS (
    SELECT
      rank,
      total_players
    FROM cluster_rankings
    WHERE "userId" = p_user_id AND "Guild" = p_guild_code
  )
  SELECT
    p_user_id,
    p_guild_code,
    (SELECT COALESCE(SUM("damageDealt"), 0) FROM "EOT_GR_data"
     WHERE "userId" = p_user_id
       AND "Guild" = p_guild_code
       AND "Season" = p_season
       AND "damageType" = 'Battle')::BIGINT AS total_damage,
    (SELECT COUNT(*) FROM "EOT_GR_data"
     WHERE "userId" = p_user_id
       AND "Guild" = p_guild_code
       AND "Season" = p_season
       AND "damageType" = 'Battle')::INTEGER AS battle_count,
    COALESCE((SELECT vs_guild FROM player_performance), 0)::NUMERIC AS vs_guild_pct,
    COALESCE((SELECT vs_cluster FROM player_performance), 0)::NUMERIC AS vs_cluster_pct,
    COALESCE((SELECT rank FROM player_guild_rank), 0)::INTEGER AS guild_rank,
    COALESCE((SELECT total_players FROM player_guild_rank), 0)::INTEGER AS total_players_in_guild,
    COALESCE((SELECT rank FROM player_cluster_rank), 0)::INTEGER AS cluster_rank,
    COALESCE((SELECT total_players FROM player_cluster_rank), 0)::INTEGER AS total_players_in_cluster;
END;
$$;

CREATE FUNCTION public.get_latest_season() RETURNS text
    LANGUAGE sql STABLE PARALLEL SAFE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT MAX(season_num)::text
  FROM public."EOT_GR_data";
$$;

CREATE FUNCTION public.compute_player_token_burn(p_guild_code text, p_season text, p_player_id text, p_now timestamp with time zone DEFAULT now()) RETURNS TABLE(burned_tokens integer, time_over_cap_seconds integer)
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $_$
declare
  v_max_tokens integer := 3;
  v_starting_tokens integer := 2;
  v_regen_seconds bigint := 12 * 60 * 60;
  v_season_start_at timestamptz;
  v_season_end_at timestamptz;
  v_effective_now timestamptz;
  v_effective_now_secs bigint;
  v_tokens integer;
  v_refresh_time bigint;
  v_burned_total bigint := 0;
  v_over_cap_secs bigint := 0;
  v_battle record;
  v_battle_ts bigint;
  v_n_recharged integer;
  v_excess integer;
  v_prev_tokens integer;
  v_cap_start bigint;
begin
  if p_guild_code is null or p_season is null or p_player_id is null then
    return query select 0::integer, 0::integer;
    return;
  end if;
  if to_regclass('public.season_calendar') is not null
     and p_season ~ '^\d+$' then
    select sc.starts_at, sc.ends_at
    into v_season_start_at, v_season_end_at
    from public.season_calendar sc
    where sc.season_id = p_season::integer
    limit 1;
  end if;

  if v_season_start_at is null then
    select min(d."startedOn")
    into v_season_start_at
    from public."EOT_GR_data" d
    where d."Guild" = p_guild_code
      and d."Season" = p_season
      and d."startedOn" is not null;
  end if;

  if v_season_end_at is null and p_season ~ '^\d+$' then
    select min(d."startedOn")
    into v_season_end_at
    from public."EOT_GR_data" d
    where d."Guild" = p_guild_code
      and d."Season" = (p_season::integer + 1)::text
      and d."startedOn" is not null;
  end if;

  v_effective_now := coalesce(p_now, now());
  if v_season_end_at is not null and v_effective_now > v_season_end_at then
    v_effective_now := v_season_end_at;
  end if;
  v_effective_now_secs := extract(epoch from v_effective_now)::bigint;
  v_tokens := v_starting_tokens;
  if v_season_start_at is not null then
    v_refresh_time := extract(epoch from v_season_start_at)::bigint;
  else
    v_refresh_time := null;
  end if;

  for v_battle in
    select distinct d."startedOn"::timestamptz as battle_time
    from public."EOT_GR_data" d
    where d."userId" = p_player_id
      and d."Guild" = p_guild_code
      and d."Season" = p_season
      and d."damageType" = 'Battle'
      and d."startedOn" is not null
    order by d."startedOn"::timestamptz asc
  loop
    v_battle_ts := extract(epoch from v_battle.battle_time)::bigint;
    if v_refresh_time is null then
      v_refresh_time := v_battle_ts;
    end if;

    if v_battle_ts > v_effective_now_secs then
      exit;
    end if;
    v_n_recharged := floor((v_battle_ts - v_refresh_time)::numeric / v_regen_seconds)::integer;
    if v_n_recharged > 0 then
      if v_n_recharged + v_tokens >= v_max_tokens then
        v_cap_start := v_refresh_time + (v_max_tokens - v_tokens)::bigint * v_regen_seconds;
        v_excess := v_n_recharged + v_tokens - v_max_tokens;
        if v_excess > 0 then
          v_burned_total := v_burned_total + v_excess;
        end if;
        v_over_cap_secs := v_over_cap_secs + greatest(0, v_battle_ts - v_cap_start);
        v_tokens := v_max_tokens;
        v_refresh_time := v_battle_ts;
      else
        v_tokens := v_tokens + v_n_recharged;
        v_refresh_time := v_refresh_time + v_n_recharged::bigint * v_regen_seconds;
      end if;
    end if;

    v_prev_tokens := v_tokens;
    v_tokens := v_tokens - 1;

    if v_prev_tokens = v_max_tokens then
      v_refresh_time := v_battle_ts;
    end if;

    if v_tokens < 0 then v_tokens := 0; end if;
  end loop;
  if v_refresh_time is not null and v_tokens < v_max_tokens then
    v_n_recharged := floor((v_effective_now_secs - v_refresh_time)::numeric / v_regen_seconds)::integer;
    if v_n_recharged > 0 then
      if v_n_recharged + v_tokens >= v_max_tokens then
        v_cap_start := v_refresh_time + (v_max_tokens - v_tokens)::bigint * v_regen_seconds;
        v_excess := v_n_recharged + v_tokens - v_max_tokens;
        if v_excess > 0 then
          v_burned_total := v_burned_total + v_excess;
        end if;
        v_over_cap_secs := v_over_cap_secs + greatest(0, v_effective_now_secs - v_cap_start);
      else
        v_tokens := v_tokens + v_n_recharged;
        v_refresh_time := v_refresh_time + v_n_recharged::bigint * v_regen_seconds;
      end if;
    end if;
  end if;

  return query select greatest(0, v_burned_total)::integer,
                      greatest(0, v_over_cap_secs)::integer;
end;
$_$;

CREATE FUNCTION public.compute_player_tokens_available(p_guild_code text, p_season text, p_player_id text, p_now timestamp with time zone DEFAULT now()) RETURNS TABLE(tokens_available integer, token_next_in_seconds integer)
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $_$
declare
  v_max_tokens integer := 3;
  v_initial_tokens integer := 2;
  v_regen_seconds bigint := 12 * 60 * 60;
  v_season_start_at timestamptz;
  v_now_secs bigint;
  v_count integer;
  v_refresh_time bigint;
  v_battle record;
  v_battle_ts bigint;
  v_n_recharged integer;
  v_prev_count integer;
  v_first_battle_ts bigint := null;
  v_time_since_refresh bigint;
  v_time_until_next bigint;
begin
  if p_guild_code is null or p_season is null or p_player_id is null then
    return query select v_max_tokens::integer, 0::integer;
    return;
  end if;

  v_now_secs := extract(epoch from coalesce(p_now, now()))::bigint;
  if to_regclass('public.season_calendar') is not null
     and p_season ~ '^\d+$' then
    select sc.starts_at into v_season_start_at
    from public.season_calendar sc
    where sc.season_id = p_season::integer
    limit 1;
  end if;
  select extract(epoch from min(d."startedOn"::timestamptz))::bigint
    into v_first_battle_ts
  from public."EOT_GR_data" d
  where d."userId" = p_player_id
    and d."Guild" = p_guild_code
    and d."Season" = p_season
    and d."damageType" = 'Battle'
    and d."startedOn" is not null;

  if v_first_battle_ts is null then
    if v_season_start_at is not null then
      v_count := v_initial_tokens;
      v_refresh_time := extract(epoch from v_season_start_at)::bigint;
      v_n_recharged := floor((v_now_secs - v_refresh_time)::numeric / v_regen_seconds)::integer;
      if v_n_recharged + v_count >= v_max_tokens then
        v_count := v_max_tokens;
        v_refresh_time := v_now_secs;
      else
        v_count := v_count + v_n_recharged;
        v_refresh_time := v_refresh_time + v_n_recharged::bigint * v_regen_seconds;
      end if;
    else
      v_count := v_max_tokens;
      v_refresh_time := v_now_secs;
    end if;
  else
    v_count := v_initial_tokens;
    v_refresh_time := v_first_battle_ts;
    for v_battle in
      select distinct d."startedOn"::timestamptz as battle_time
      from public."EOT_GR_data" d
      where d."userId" = p_player_id
        and d."Guild" = p_guild_code
        and d."Season" = p_season
        and d."damageType" = 'Battle'
        and d."startedOn" is not null
      order by d."startedOn"::timestamptz asc
    loop
      v_battle_ts := extract(epoch from v_battle.battle_time)::bigint;
      if v_count < v_max_tokens then
        v_n_recharged := floor((v_battle_ts - v_refresh_time)::numeric / v_regen_seconds)::integer;
        if v_n_recharged + v_count >= v_max_tokens then
          v_count := v_max_tokens;
          v_refresh_time := v_battle_ts;
        else
          v_count := v_count + v_n_recharged;
          v_refresh_time := v_refresh_time + v_n_recharged::bigint * v_regen_seconds;
        end if;
      end if;

      v_prev_count := v_count;
      v_count := v_count - 1;
      if v_count <= 0 then
        v_count := 0;
        if v_prev_count > 0 then
          v_refresh_time := v_battle_ts;
        end if;
      end if;
    end loop;
    if v_count < v_max_tokens then
      v_n_recharged := floor((v_now_secs - v_refresh_time)::numeric / v_regen_seconds)::integer;
      if v_n_recharged + v_count >= v_max_tokens then
        v_count := v_max_tokens;
        v_refresh_time := v_now_secs;
      else
        v_count := v_count + v_n_recharged;
        v_refresh_time := v_refresh_time + v_n_recharged::bigint * v_regen_seconds;
      end if;
    end if;
  end if;
  v_time_until_next := null;
  if v_count < v_max_tokens then
    v_time_since_refresh := v_now_secs - v_refresh_time;
    v_time_until_next := v_regen_seconds - (v_time_since_refresh % v_regen_seconds);
    if v_time_until_next <= 0 or v_time_until_next >= v_regen_seconds then
      v_time_until_next := null;
    end if;
  end if;

  return query select
    least(v_max_tokens, greatest(0, v_count))::integer,
    case
      when v_time_until_next is null then null::integer
      else v_time_until_next::integer
    end;
end;
$_$;

CREATE FUNCTION public.get_distinct_seasons_for_guild(p_guild text, p_cluster_code text DEFAULT NULL::text) RETURNS text[]
    LANGUAGE sql STABLE PARALLEL SAFE
    SET search_path TO 'public', 'pg_temp'
    AS $_$
  SELECT COALESCE(array_agg(s ORDER BY s::int DESC), ARRAY[]::text[])
  FROM (
    SELECT DISTINCT "Season" AS s
    FROM public."EOT_GR_data"
    WHERE "Season" ~ '^\d+$'
      AND "Guild" = p_guild
      AND (p_cluster_code IS NULL OR cluster_code = p_cluster_code)
  ) AS sub;
$_$;

CREATE FUNCTION public.get_guild_vs_cluster_boss_performance(p_guild_code text, p_season text, p_rarities text[] DEFAULT ARRAY['Legendary'::text, 'Mythic'::text]) RETURNS TABLE(boss_name text, encounter_type text, guild_avg_damage numeric, cluster_avg_damage numeric, vs_cluster_percent numeric, set integer, rarity text)
    LANGUAGE sql
    AS $$
WITH cluster_ctx AS (
  SELECT cluster_code
  FROM guild_config
  WHERE guild_code = p_guild_code
  LIMIT 1
),
cluster_guilds AS (
  SELECT guild_code
  FROM guild_config
  WHERE cluster_code IN (SELECT cluster_code FROM cluster_ctx)
),
guild_agg AS (
  SELECT
    "Name" as boss_name,
    "encounterId" as encounter_id,
    "set",
    rarity,
    sum("damageDealt") as total_damage,
    count(*) as battle_count
  FROM "EOT_GR_data"
  WHERE "Season" = p_season
    AND "Guild" = p_guild_code
    AND "damageType" = 'Battle'
    AND rarity = ANY(p_rarities)
    AND "damageDealt" > 0
    AND NOT ("remainingHp" = 0 AND "maxHp" > 0 AND "damageDealt" < "maxHp" AND "damageType" = 'Battle')
    AND "encounterId" IN (0, 1, 2)
  GROUP BY "Name", "encounterId", "set", rarity
),
cluster_agg AS (
  SELECT
    "Name" as boss_name,
    "encounterId" as encounter_id,
    "set",
    rarity,
    avg("damageDealt") as cluster_avg
  FROM "EOT_GR_data"
  WHERE "Season" = p_season
    AND "damageType" = 'Battle'
    AND rarity = ANY(p_rarities)
    AND "damageDealt" > 0
    AND NOT ("remainingHp" = 0 AND "maxHp" > 0 AND "damageDealt" < "maxHp" AND "damageType" = 'Battle')
    AND "encounterId" IN (0, 1, 2)
    AND (
      coalesce(cluster_code, '') = coalesce((SELECT cluster_code FROM cluster_ctx LIMIT 1), '')
      OR "Guild" IN (SELECT guild_code FROM cluster_guilds)
    )
  GROUP BY "Name", "encounterId", "set", rarity
)
SELECT
  g.boss_name,
  CASE WHEN g.encounter_id IN (1,2) THEN 'Prime' ELSE 'Boss' END as encounter_type,
  (g.total_damage / nullif(g.battle_count,0)) as guild_avg_damage,
  c.cluster_avg as cluster_avg_damage,
  CASE
    WHEN c.cluster_avg > 0 THEN ((g.total_damage / nullif(g.battle_count,0)) / c.cluster_avg - 1) * 100
    ELSE 0
  END as vs_cluster_percent,
  g."set",
  g.rarity
FROM guild_agg g
LEFT JOIN cluster_agg c ON
  g.boss_name = c.boss_name
  AND coalesce(g.encounter_id, -1) = coalesce(c.encounter_id, -1)
  AND g."set" = c."set"
  AND g.rarity = c.rarity
ORDER BY vs_cluster_percent DESC NULLS LAST;
$$;

CREATE FUNCTION public.check_feature_access(p_user_id uuid, p_feature_key text) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_role text;
  v_release_stage text;
  v_mapping_count integer;
  v_is_app_admin boolean;
  v_is_alpha boolean;
  v_is_beta boolean;
  v_cluster text;
BEGIN
  v_role := lower(trim(COALESCE(NULLIF(NULLIF(current_setting('role', true), ''), 'none'), NULLIF(session_user, ''))));
  IF v_role NOT IN ('authenticated', 'service_role') THEN
    RAISE EXCEPTION USING ERRCODE = '42501';
  END IF;

  IF v_role = 'authenticated'
    AND (
      auth.uid() IS NULL
      OR p_user_id IS NULL
      OR p_user_id IS DISTINCT FROM auth.uid()
    )
  THEN
    RAISE EXCEPTION USING ERRCODE = '42501';
  END IF;

  SELECT fr.release_stage
  INTO v_release_stage
  FROM public.feature_releases AS fr
  WHERE fr.feature_key = p_feature_key;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'has_access', false,
      'reason', 'feature_not_found',
      'stage', NULL
    );
  END IF;

  SELECT
    count(pm.id)::integer,
    coalesce(max(pm.is_app_admin::integer), 0) = 1,
    max(pm.cluster_code)
  INTO v_mapping_count, v_is_app_admin, v_cluster
  FROM public.player_mapping AS pm
  WHERE pm.user_id = p_user_id
    AND pm.is_active IS TRUE
    AND pm.is_current IS TRUE;

  SELECT
    count(fag.user_id) FILTER (
      WHERE fag.access_level = 'alpha_tester'
        AND (fag.expires_at IS NULL OR fag.expires_at > now())
    ) > 0,
    count(fag.user_id) FILTER (
      WHERE fag.access_level = 'beta_tester'
        AND (fag.expires_at IS NULL OR fag.expires_at > now())
    ) > 0
  INTO v_is_alpha, v_is_beta
  FROM public.feature_access_grants AS fag
  WHERE fag.user_id = p_user_id;

  RETURN jsonb_build_object(
    'has_access',
      CASE v_release_stage
        WHEN 'public' THEN true
        WHEN 'alpha' THEN coalesce(v_is_app_admin OR v_is_alpha, false)
        WHEN 'beta' THEN coalesce(
          v_is_app_admin OR v_is_alpha OR v_is_beta,
          false
        )
        ELSE false
      END,
    'reason',
      CASE
        WHEN v_release_stage = 'public' THEN 'public_feature'
        WHEN v_is_app_admin THEN 'admin'
        WHEN v_is_alpha THEN 'alpha_tester'
        WHEN v_is_beta THEN 'beta_tester'
        ELSE v_release_stage || '_only'
      END,
    'stage',
      v_release_stage
  );
END;
$$;

CREATE FUNCTION public.get_duplicate_display_labels(p_guild_code text DEFAULT NULL::text) RETURNS TABLE(player_id text, display_name text, original_display_name text, previous_name text, friendly_label text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'auth'
    AS $_$
  WITH request_context AS MATERIALIZED (
    SELECT
      COALESCE(
        NULLIF(NULLIF(current_setting('role', true), ''), 'none'),
        NULLIF(session_user, '')
      ) AS request_role,
      (SELECT auth.uid()) AS caller_uid
  ),
  caller_guilds AS MATERIALIZED (
    SELECT pm.guild_code
    FROM public.player_mapping pm
    CROSS JOIN request_context rc
    WHERE rc.request_role = 'authenticated'
      AND rc.caller_uid IS NOT NULL
      AND pm.user_id = rc.caller_uid
      AND pm.is_current
      AND pm.guild_code IS NOT NULL
  ),
  dup AS (
    SELECT
      pm.player_id,
      pm.guild_code,
      pm.display_name,
      pm.original_display_name AS base
    FROM public.player_mapping pm
    CROSS JOIN request_context rc
    WHERE pm.is_current
      AND pm.has_duplicate_name
      AND pm.original_display_name IS NOT NULL
      AND btrim(pm.original_display_name) <> ''
      AND (p_guild_code IS NULL OR pm.guild_code = p_guild_code)
      AND (
        rc.request_role = 'service_role'
        OR (
          rc.request_role = 'authenticated'
          AND pm.guild_code IN (SELECT cg.guild_code FROM caller_guilds cg)
        )
      )
  ),
  resolved AS (
    SELECT
      d.player_id,
      d.guild_code,
      d.display_name,
      d.base,
      (
        SELECT e."displayName"
        FROM public."EOT_GR_data" e
        WHERE e."userId" = d.player_id
          AND e."displayName" IS NOT NULL
          AND btrim(e."displayName") <> ''
          AND e."displayName" <> d.base
          AND NOT starts_with(e."displayName", d.base || ' (')
          AND NOT starts_with(e."displayName", 'Player#')
          AND e."displayName" !~ ' \([^()]*_[0-9]+\)$'
        ORDER BY COALESCE(e."completedOn", e."startedOn", e."timestamp") DESC NULLS LAST
        LIMIT 1
      ) AS previous_name
    FROM dup d
  ),
  counted AS (
    SELECT
      r.*,
      count(*) FILTER (WHERE r.previous_name IS NOT NULL)
        OVER (PARTITION BY r.guild_code, r.base, r.previous_name) AS same_prev_count
    FROM resolved r
  )
  SELECT
    c.player_id,
    c.display_name,
    c.base AS original_display_name,
    c.previous_name,
    c.base || ' (' ||
      CASE
        WHEN c.previous_name IS NOT NULL AND c.same_prev_count = 1
          THEN c.previous_name
        ELSE upper(substr(c.player_id, 1, 6))
      END
    || ')' AS friendly_label
  FROM counted c;
$_$;

CREATE FUNCTION public.get_player_performance_summary(p_guild_code text, p_season text, p_rarities text[] DEFAULT ARRAY['Legendary'::text, 'Mythic'::text]) RETURNS TABLE(user_id text, display_name text, avg_vs_cluster numeric, avg_vs_guild numeric, avg_vs_cluster_boss_only numeric, avg_vs_guild_boss_only numeric, bosses_played integer, boss_hits integer, prime_hits integer, primes_played integer, total_battles integer)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
WITH caller_authorization AS MATERIALIZED (
  SELECT
    COALESCE(
      NULLIF(
        NULLIF(current_setting('role', true), ''),
        'none'
      ),
      NULLIF(session_user, '')
    ) = 'service_role'
    OR (
      p_guild_code IS NOT NULL
      AND (
        p_guild_code IN (
          SELECT public._pm_caller_guild_codes()
        )
        OR p_guild_code IN (
          SELECT public._pm_caller_cluster_guild_codes()
        )
        OR public._pm_caller_is_app_admin()
      )
    ) AS allowed
),
guild_cluster AS (
  SELECT cluster_code
  FROM guild_config
  WHERE guild_code = p_guild_code
  LIMIT 1
),
latest_display_names AS (
  SELECT DISTINCT ON ("userId")
    "userId",
    "displayName"
  FROM "EOT_GR_data"
  WHERE "Season" = p_season
    AND "Guild" = p_guild_code
    AND "userId" IS NOT NULL
    AND "displayName" IS NOT NULL
  ORDER BY "userId", "completedOn" DESC NULLS LAST
),
player_boss_raw AS (
  SELECT
    e."userId" as uid,
    e."Name" as boss_name,
    e."encounterId",
    e.rarity as rarity_val,
    e.set as set_val,
    SUM(e."damageDealt") FILTER (
      WHERE NOT (e."remainingHp" = 0 AND e."maxHp" > 0 AND e."damageDealt" < e."maxHp")
    ) as non_sweep_damage,
    COUNT(*) FILTER (
      WHERE NOT (e."remainingHp" = 0 AND e."maxHp" > 0 AND e."damageDealt" < e."maxHp")
    ) as non_sweep_count,
    array_agg(e."damageDealt"::numeric) FILTER (
      WHERE e."remainingHp" = 0 AND e."maxHp" > 0 AND e."damageDealt" < e."maxHp"
    ) as sweep_damages,
    AVG(e."damageDealt") FILTER (
      WHERE NOT (e."remainingHp" = 0 AND e."maxHp" > 0 AND e."damageDealt" < e."maxHp")
    ) as player_avg
  FROM "EOT_GR_data" e
  WHERE e."Season" = p_season
    AND e."Guild" = p_guild_code
    AND e."damageType" = 'Battle'
    AND e.rarity = ANY(p_rarities)
    AND e."damageDealt" > 0
    AND e."userId" IS NOT NULL
  GROUP BY e."userId", e."Name", e."encounterId", e.rarity, e.set
),
guild_stats AS (
  SELECT
    "Name" as boss_name,
    "encounterId",
    rarity as rarity_val,
    set as set_val,
    avg("damageDealt") as guild_avg
  FROM "EOT_GR_data"
  WHERE "Season" = p_season
    AND "Guild" = p_guild_code
    AND "damageType" = 'Battle'
    AND rarity = ANY(p_rarities)
    AND "damageDealt" > 0
    AND NOT ("remainingHp" = 0 AND "maxHp" > 0 AND "damageDealt" < "maxHp")
  GROUP BY "Name", "encounterId", rarity, set
),
cluster_stats AS (
  SELECT
    e."Name" as boss_name,
    e."encounterId",
    e.rarity as rarity_val,
    e.set as set_val,
    avg(e."damageDealt") as cluster_avg
  FROM "EOT_GR_data" e
  INNER JOIN guild_config gc ON gc.guild_code = e."Guild"
  WHERE e."Season" = p_season
    AND gc.cluster_code = (SELECT cluster_code FROM guild_cluster)
    AND e."damageType" = 'Battle'
    AND e.rarity = ANY(p_rarities)
    AND e."damageDealt" > 0
    AND NOT (e."remainingHp" = 0 AND e."maxHp" > 0 AND e."damageDealt" < e."maxHp")
  GROUP BY e."Name", e."encounterId", e.rarity, e.set
),
player_comparisons AS (
  SELECT
    p.uid as user_id,
    p.boss_name,
    p."encounterId",
    (COALESCE(p.non_sweep_count, 0)
      + COALESCE(qualifying_sweep_count(p.sweep_damages, GREATEST(p.player_avg, g.guild_avg::numeric)), 0)
    ) as guild_battle_count,
    (COALESCE(p.non_sweep_count, 0)
      + COALESCE(qualifying_sweep_count(p.sweep_damages, GREATEST(p.player_avg, c.cluster_avg::numeric)), 0)
    ) as cluster_battle_count,
    COALESCE(calc_boss_performance_pct(p.non_sweep_damage, p.non_sweep_count, p.sweep_damages, c.cluster_avg::numeric, GREATEST(p.player_avg, c.cluster_avg::numeric)), 0) as vs_cluster_pct,
    COALESCE(calc_boss_performance_pct(p.non_sweep_damage, p.non_sweep_count, p.sweep_damages, g.guild_avg::numeric, GREATEST(p.player_avg, g.guild_avg::numeric)), 0) as vs_guild_pct,
    CASE WHEN p."encounterId" = 0 THEN 1 ELSE 0 END as is_boss
  FROM player_boss_raw p
  LEFT JOIN guild_stats g ON p.boss_name = g.boss_name AND p."encounterId" = g."encounterId" AND p.rarity_val = g.rarity_val AND p.set_val = g.set_val
  LEFT JOIN cluster_stats c ON p.boss_name = c.boss_name AND p."encounterId" = c."encounterId" AND p.rarity_val = c.rarity_val AND p.set_val = c.set_val
)
SELECT
  pc.user_id,
  ldn."displayName" as display_name,
  ROUND(sum(pc.vs_cluster_pct * pc.cluster_battle_count) / NULLIF(sum(pc.cluster_battle_count), 0), 2) as avg_vs_cluster,
  ROUND(sum(pc.vs_guild_pct * pc.guild_battle_count) / NULLIF(sum(pc.guild_battle_count), 0), 2) as avg_vs_guild,
  ROUND(sum(CASE WHEN pc.is_boss = 1 THEN pc.vs_cluster_pct * pc.cluster_battle_count ELSE 0 END) /
    NULLIF(sum(CASE WHEN pc.is_boss = 1 THEN pc.cluster_battle_count ELSE 0 END), 0), 2) as avg_vs_cluster_boss_only,
  ROUND(sum(CASE WHEN pc.is_boss = 1 THEN pc.vs_guild_pct * pc.guild_battle_count ELSE 0 END) /
    NULLIF(sum(CASE WHEN pc.is_boss = 1 THEN pc.guild_battle_count ELSE 0 END), 0), 2) as avg_vs_guild_boss_only,
  count(DISTINCT pc.boss_name)::integer as bosses_played,
  sum(CASE WHEN pc.is_boss = 1 THEN pc.guild_battle_count ELSE 0 END)::integer as boss_hits,
  sum(CASE WHEN pc.is_boss = 0 THEN pc.guild_battle_count ELSE 0 END)::integer as prime_hits,
  count(DISTINCT CASE WHEN pc.is_boss = 0 THEN pc.boss_name END)::integer as primes_played,
  sum(pc.guild_battle_count)::integer as total_battles
FROM player_comparisons pc
JOIN latest_display_names ldn ON pc.user_id = ldn."userId"
CROSS JOIN caller_authorization AS caller_scope
WHERE caller_scope.allowed
GROUP BY pc.user_id, ldn."displayName"
ORDER BY avg_vs_guild DESC;
$$;

CREATE FUNCTION public.get_player_prime_performance(guild_code_param text, season_param text) RETURNS TABLE(display_name text, prime_name text, encounter_id integer, player_avg numeric, battle_count integer, biggest_hit bigint, player_vs_guild_avg numeric, player_vs_cluster_avg numeric, set_num integer, tier integer, rarity text, boss_preference text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'auth'
    AS $$
  WITH player_prime_stats AS (
    SELECT
      e."displayName",
      CONCAT(e."Name", '_', e.rarity) AS prime_key,
      COALESCE(e."encounterId", 0)::integer AS enc_id,
      e.tier AS tier_val,
      e.set AS set_val,
      e.rarity AS rarity_val,
      SUM(e."damageDealt") FILTER (
        WHERE NOT (e."remainingHp" = 0 AND e."maxHp" > 0 AND e."damageDealt" < e."maxHp")
      )::numeric AS non_sweep_damage,
      COUNT(*) FILTER (
        WHERE NOT (e."remainingHp" = 0 AND e."maxHp" > 0 AND e."damageDealt" < e."maxHp")
      )::integer AS non_sweep_count,
      array_agg(e."damageDealt"::numeric) FILTER (
        WHERE e."remainingHp" = 0 AND e."maxHp" > 0 AND e."damageDealt" < e."maxHp"
      ) AS sweep_damages,
      MAX(e."damageDealt") FILTER (
        WHERE NOT (e."remainingHp" = 0 AND e."maxHp" > 0 AND e."damageDealt" < e."maxHp")
      ) AS b_hit
    FROM "EOT_GR_data" e
    WHERE e."Season" = season_param
      AND e."Guild" = guild_code_param
      AND e."damageType" = 'Battle'
      AND e.rarity IN ('Legendary','Mythic')
      AND e."damageDealt" > 0
      AND COALESCE(e."encounterId", 0) IN (1,2)
    GROUP BY e."displayName", prime_key, enc_id, e.tier, e.set, e.rarity
  ),
  guild_avg AS (
    SELECT
      CONCAT("Name", '_', rarity) AS prime_key,
      COALESCE("encounterId", 0)::integer AS enc_id,
      rarity AS rarity_val,
      AVG("damageDealt")::numeric AS g_avg
    FROM "EOT_GR_data"
    WHERE "Season" = season_param
      AND "Guild" = guild_code_param
      AND "damageType" = 'Battle'
      AND rarity IN ('Legendary','Mythic')
      AND "damageDealt" > 0
      AND NOT ("remainingHp" = 0 AND "maxHp" > 0 AND "damageDealt" < "maxHp")
      AND COALESCE("encounterId", 0) IN (1,2)
    GROUP BY prime_key, enc_id, rarity
  ),
  cluster_avg AS (
    SELECT
      CONCAT(e."Name", '_', e.rarity) AS prime_key,
      COALESCE(e."encounterId", 0)::integer AS enc_id,
      e.rarity AS rarity_val,
      AVG(e."damageDealt")::numeric AS c_avg
    FROM "EOT_GR_data" e
    LEFT JOIN guild_config gc ON gc.guild_code = e."Guild"
    WHERE e."Season" = season_param
      AND e."damageType" = 'Battle'
      AND e.rarity IN ('Legendary','Mythic')
      AND e."damageDealt" > 0
      AND NOT (e."remainingHp" = 0 AND e."maxHp" > 0 AND e."damageDealt" < e."maxHp")
      AND gc.cluster_code = (SELECT cluster_code FROM guild_config WHERE guild_code = guild_code_param LIMIT 1)
      AND COALESCE(e."encounterId", 0) IN (1,2)
    GROUP BY prime_key, enc_id, e.rarity
  )
  SELECT
    p."displayName" AS display_name,
    p.prime_key AS prime_name,
    p.enc_id AS encounter_id,
    CASE
      WHEN COALESCE(p.non_sweep_count, 0)
           + COALESCE(qualifying_sweep_count(p.sweep_damages, GREATEST(p.non_sweep_damage / NULLIF(p.non_sweep_count, 0), g.g_avg)), 0) > 0
      THEN (
        (COALESCE(p.non_sweep_damage, 0) + COALESCE(qualifying_sweep_sum(p.sweep_damages, GREATEST(p.non_sweep_damage / NULLIF(p.non_sweep_count, 0), g.g_avg)), 0))
        / (COALESCE(p.non_sweep_count, 0) + COALESCE(qualifying_sweep_count(p.sweep_damages, GREATEST(p.non_sweep_damage / NULLIF(p.non_sweep_count, 0), g.g_avg)), 0))
      )
      ELSE 0
    END AS player_avg,
    (COALESCE(p.non_sweep_count, 0) + COALESCE(qualifying_sweep_count(p.sweep_damages, GREATEST(p.non_sweep_damage / NULLIF(p.non_sweep_count, 0), g.g_avg)), 0))::integer AS battle_count,
    p.b_hit AS biggest_hit,
    CASE
      WHEN g.g_avg > 0 THEN ROUND((
        (
          (COALESCE(p.non_sweep_damage, 0) + COALESCE(qualifying_sweep_sum(p.sweep_damages, GREATEST(p.non_sweep_damage / NULLIF(p.non_sweep_count, 0), g.g_avg)), 0))
          / NULLIF(COALESCE(p.non_sweep_count, 0) + COALESCE(qualifying_sweep_count(p.sweep_damages, GREATEST(p.non_sweep_damage / NULLIF(p.non_sweep_count, 0), g.g_avg)), 0), 0)
          / g.g_avg
        ) - 1) * 100, 1)
      ELSE 0
    END AS player_vs_guild_avg,
    CASE
      WHEN c.c_avg > 0 THEN ROUND((
        (
          (COALESCE(p.non_sweep_damage, 0) + COALESCE(qualifying_sweep_sum(p.sweep_damages, GREATEST(p.non_sweep_damage / NULLIF(p.non_sweep_count, 0), c.c_avg)), 0))
          / NULLIF(COALESCE(p.non_sweep_count, 0) + COALESCE(qualifying_sweep_count(p.sweep_damages, GREATEST(p.non_sweep_damage / NULLIF(p.non_sweep_count, 0), c.c_avg)), 0), 0)
          / c.c_avg
        ) - 1) * 100, 1)
      ELSE 0
    END AS player_vs_cluster_avg,
    p.set_val AS set_num,
    p.tier_val AS tier,
    p.rarity_val AS rarity,
    'neutral' AS boss_preference
  FROM player_prime_stats p
  LEFT JOIN guild_avg g ON p.prime_key = g.prime_key AND p.enc_id = g.enc_id AND p.rarity_val = g.rarity_val
  LEFT JOIN cluster_avg c ON p.prime_key = c.prime_key AND p.enc_id = c.enc_id AND p.rarity_val = c.rarity_val
  ORDER BY p."displayName", p.rarity_val DESC, p.set_val, p.enc_id;
$$;

CREATE FUNCTION public.get_season_token_stats(p_guild_code text, p_season integer, p_include_cluster boolean DEFAULT false) RETURNS TABLE(context text, guild_code text, cluster_code text, season integer, tokens_possible bigint, tokens_spent bigint, tokens_remaining bigint, tokens_per_player_cap integer, ratio_spent numeric, updated_at timestamp with time zone, players jsonb)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'auth'
    AS $$
DECLARE
  v_cluster_code TEXT;
  v_default_cap INTEGER := 28; -- fallback when nobody spent tokens this season
  v_now TIMESTAMPTZ := timezone('UTC', now());
  v_is_service BOOLEAN := COALESCE(
    NULLIF(
      NULLIF(current_setting('role', true), ''),
      'none'
    ),
    NULLIF(session_user, '')
  ) = 'service_role';
BEGIN
  IF NOT v_is_service
    AND NOT COALESCE(
      p_guild_code IN (
        SELECT public._pm_caller_guild_codes()
      )
      OR p_guild_code IN (
        SELECT public._pm_caller_cluster_guild_codes()
      )
      OR public._pm_caller_is_app_admin(),
      FALSE
    )
  THEN
    RETURN;
  END IF;

  IF p_guild_code IS NULL OR length(trim(p_guild_code)) = 0 THEN
    RAISE EXCEPTION 'p_guild_code is required';
  END IF;

  IF p_season IS NULL THEN
    RAISE EXCEPTION 'p_season is required';
  END IF;
  SELECT gc.cluster_code
  INTO v_cluster_code
  FROM public.guild_config gc
  WHERE gc.guild_code = p_guild_code
  LIMIT 1;

  IF v_cluster_code IS NULL THEN
    SELECT d.cluster_code
    INTO v_cluster_code
    FROM public."EOT_GR_data" d
    WHERE d."Guild" = p_guild_code
      AND d."Season" = p_season::text
      AND d.cluster_code IS NOT NULL
    LIMIT 1;
  END IF;
  RETURN QUERY
  WITH guild_candidates AS (
    SELECT DISTINCT
      NULLIF(trim(pm.player_id), '') AS player_id,
      trim(pm.display_name) AS display_name
    FROM public.player_with_cluster pm
    WHERE pm.guild_code = p_guild_code
    UNION
    SELECT DISTINCT
      NULLIF(trim(d."userId"), '') AS player_id,
      COALESCE(NULLIF(trim(d."displayName"), ''), 'Unknown') AS display_name
    FROM public."EOT_GR_data" d
    WHERE d."Guild" = p_guild_code
      AND d."Season" = p_season::text
      AND d."damageType" = 'Battle'
      AND d."damageDealt" > 0
  ),
  guild_tokens AS (
    SELECT
      NULLIF(trim(d."userId"), '') AS player_id,
      LOWER(COALESCE(NULLIF(trim(d."displayName"), ''), '')) AS name_key,
      COUNT(*)::BIGINT AS tokens_spent
    FROM public."EOT_GR_data" d
    WHERE d."Guild" = p_guild_code
      AND d."Season" = p_season::text
      AND d."damageType" = 'Battle'
      AND d."damageDealt" > 0
    GROUP BY NULLIF(trim(d."userId"), ''), LOWER(COALESCE(NULLIF(trim(d."displayName"), ''), ''))
  ),
  guild_players AS (
    SELECT
      gc.player_id,
      COALESCE(gc.display_name, 'Unknown') AS display_name,
      LOWER(COALESCE(gc.display_name, '')) AS name_key
    FROM guild_candidates gc
  ),
  guild_player_tokens AS (
    SELECT
      gp.player_id,
      gp.display_name,
      COALESCE(gt.tokens_spent, 0) AS tokens_spent,
      COALESCE(gt.tokens_spent, 0) AS tokens_spent_raw
    FROM guild_players gp
    LEFT JOIN guild_tokens gt
      ON (
        gp.player_id IS NOT NULL
        AND gt.player_id = gp.player_id
      )
      OR (
        gp.player_id IS NULL
        AND gt.player_id IS NULL
        AND gp.name_key = gt.name_key
      )
  ),
  guild_caps AS (
    SELECT
      COALESCE(NULLIF(MAX(gpt.tokens_spent), 0), v_default_cap)::NUMERIC AS max_tokens
    FROM guild_player_tokens gpt
  ),
  guild_player_adjusted AS (
    SELECT
      gpt.player_id,
      gpt.display_name,
      gpt.tokens_spent,
      gc.max_tokens::INTEGER AS tokens_possible_per_player,
      CASE
        WHEN gc.max_tokens > 0
          THEN LEAST(gpt.tokens_spent::NUMERIC / gc.max_tokens, 1)
        ELSE 0
      END AS ratio_spent
    FROM guild_player_tokens gpt
    CROSS JOIN guild_caps gc
  ),
  guild_totals AS (
    SELECT
      COALESCE(SUM(gpa.tokens_possible_per_player), 0)::BIGINT AS tokens_possible,
      COALESCE(SUM(gpa.tokens_spent), 0)::BIGINT AS tokens_spent,
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'player_id', gpa.player_id,
            'display_name', gpa.display_name,
            'tokens_possible', gpa.tokens_possible_per_player,
            'tokens_spent', gpa.tokens_spent,
            'ratio_spent', LEAST(gpa.ratio_spent, 1)
          )
          ORDER BY gpa.tokens_spent DESC, gpa.display_name
        ),
        '[]'::jsonb
      ) AS players
    FROM guild_player_adjusted gpa
    CROSS JOIN guild_caps gc
  )
  SELECT
    'guild'::TEXT AS context,
    p_guild_code AS guild_code,
    v_cluster_code,
    p_season,
    gt.tokens_possible,
    gt.tokens_spent,
    GREATEST(gt.tokens_possible - gt.tokens_spent, 0)::BIGINT AS tokens_remaining,
    (SELECT max_tokens::INTEGER FROM guild_caps) AS tokens_per_player_cap,
    CASE
      WHEN gt.tokens_possible > 0
        THEN LEAST(gt.tokens_spent::NUMERIC / gt.tokens_possible::NUMERIC, 1)
      ELSE 0
    END AS ratio_spent,
    v_now AS updated_at,
    gt.players
  FROM guild_totals gt;
  IF COALESCE(p_include_cluster, FALSE) AND v_cluster_code IS NOT NULL THEN
    RETURN QUERY
    WITH cluster_candidates AS (
      SELECT DISTINCT
        NULLIF(trim(pm.player_id), '') AS player_id,
        trim(pm.display_name) AS display_name
      FROM public.player_with_cluster pm
      WHERE pm.cluster_code = v_cluster_code
      UNION
      SELECT DISTINCT
        NULLIF(trim(d."userId"), '') AS player_id,
        COALESCE(NULLIF(trim(d."displayName"), ''), 'Unknown') AS display_name
      FROM public."EOT_GR_data" d
      WHERE d.cluster_code = v_cluster_code
        AND d."Season" = p_season::text
        AND d."damageType" = 'Battle'
        AND d."damageDealt" > 0
    ),
    cluster_tokens AS (
      SELECT
        NULLIF(trim(d."userId"), '') AS player_id,
        LOWER(COALESCE(NULLIF(trim(d."displayName"), ''), '')) AS name_key,
        COUNT(*)::BIGINT AS tokens_spent
      FROM public."EOT_GR_data" d
      WHERE d.cluster_code = v_cluster_code
        AND d."Season" = p_season::text
        AND d."damageType" = 'Battle'
        AND d."damageDealt" > 0
      GROUP BY NULLIF(trim(d."userId"), ''), LOWER(COALESCE(NULLIF(trim(d."displayName"), ''), ''))
    ),
    cluster_players AS (
      SELECT
        cc.player_id,
        COALESCE(cc.display_name, 'Unknown') AS display_name,
        LOWER(COALESCE(cc.display_name, '')) AS name_key
      FROM cluster_candidates cc
    ),
    cluster_player_tokens AS (
      SELECT
        cp.player_id,
        cp.display_name,
        COALESCE(ct.tokens_spent, 0) AS tokens_spent,
        COALESCE(ct.tokens_spent, 0) AS tokens_spent_raw
      FROM cluster_players cp
      LEFT JOIN cluster_tokens ct
        ON (
          cp.player_id IS NOT NULL
          AND ct.player_id = cp.player_id
        )
        OR (
          cp.player_id IS NULL
          AND ct.player_id IS NULL
          AND cp.name_key = ct.name_key
        )
    ),
    cluster_caps AS (
      SELECT
        COALESCE(NULLIF(MAX(cpt.tokens_spent), 0), v_default_cap)::NUMERIC AS max_tokens
      FROM cluster_player_tokens cpt
    ),
    cluster_player_adjusted AS (
      SELECT
        cpt.player_id,
        cpt.display_name,
        cpt.tokens_spent,
        cc.max_tokens::INTEGER AS tokens_possible_per_player,
        CASE
          WHEN cc.max_tokens > 0
            THEN LEAST(cpt.tokens_spent::NUMERIC / cc.max_tokens, 1)
          ELSE 0
        END AS ratio_spent
      FROM cluster_player_tokens cpt
      CROSS JOIN cluster_caps cc
    ),
    cluster_totals AS (
      SELECT
        COALESCE(SUM(cpa.tokens_possible_per_player), 0)::BIGINT AS tokens_possible,
        COALESCE(SUM(cpa.tokens_spent), 0)::BIGINT AS tokens_spent,
        COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'player_id', cpa.player_id,
              'display_name', cpa.display_name,
              'tokens_possible', cpa.tokens_possible_per_player,
              'tokens_spent', cpa.tokens_spent,
              'ratio_spent', LEAST(cpa.ratio_spent, 1)
            )
            ORDER BY cpa.tokens_spent DESC, cpa.display_name
          ),
          '[]'::jsonb
        ) AS players
      FROM cluster_player_adjusted cpa
      CROSS JOIN cluster_caps cc
    )
    SELECT
      'cluster'::TEXT AS context,
      p_guild_code AS guild_code,
      v_cluster_code,
      p_season,
      ct.tokens_possible,
      ct.tokens_spent,
      GREATEST(ct.tokens_possible - ct.tokens_spent, 0)::BIGINT AS tokens_remaining,
      (SELECT max_tokens::INTEGER FROM cluster_caps) AS tokens_per_player_cap,
      CASE
        WHEN ct.tokens_possible > 0
          THEN LEAST(ct.tokens_spent::NUMERIC / ct.tokens_possible::NUMERIC, 1)
        ELSE 0
      END AS ratio_spent,
      v_now AS updated_at,
      ct.players
    FROM cluster_totals ct;
  END IF;
END;
$$;

CREATE FUNCTION public.get_token_usage_for_guild(p_guild_code text, p_season text) RETURNS TABLE(player_id text, display_name text, tokens_used integer, max_possible integer, tokens_below_offender boolean, tokens_below_abuser boolean, boss_tokens integer, prime_tokens integer, bombs_used integer, bombs_available integer, burned_tokens integer, time_over_cap_seconds integer, tokens_available integer, token_next_in_seconds integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_max_possible_hard_cap integer := 28;
  v_regen_seconds numeric := 43200;
  v_is_service boolean := COALESCE(NULLIF(NULLIF(current_setting('role', true), ''), 'none'), NULLIF(session_user, '')) = 'service_role';
  v_uid uuid;
  v_mapping_count integer := 0;
  v_caller_guild text;
  v_caller_role text;
  v_is_admin boolean := false;
  v_caller_cluster uuid;
  v_target_cluster uuid;
  v_allowed boolean := false;
BEGIN
  IF NOT v_is_service THEN
    v_uid := auth.uid();
    IF v_uid IS NULL THEN
      RETURN;
    END IF;

    SELECT count(*)::integer,
           max(NULLIF(trim(pm.guild_code), '')),
           max(lower(trim(pm.role::text))),
           bool_or(pm.is_app_admin IS TRUE)
    INTO v_mapping_count, v_caller_guild, v_caller_role, v_is_admin
    FROM public.player_mapping pm
    WHERE pm.user_id = v_uid
      AND pm.is_current IS TRUE;

    IF v_mapping_count <> 1
      OR v_caller_guild IS NULL
      OR v_caller_role IS NULL
      OR v_caller_role NOT IN ('member', 'officer', 'leader')
    THEN
      RETURN;
    END IF;

    IF p_guild_code IS NULL OR trim(p_guild_code) = '' THEN
      RETURN;
    END IF;

    IF v_is_admin THEN
      v_allowed := true;
    ELSIF p_guild_code = v_caller_guild THEN
      v_allowed := true;
    ELSE
      SELECT gc.cluster_id INTO v_caller_cluster
      FROM public.guild_config gc
      WHERE gc.guild_code = v_caller_guild
      LIMIT 1;
      SELECT gc.cluster_id INTO v_target_cluster
      FROM public.guild_config gc
      WHERE gc.guild_code = p_guild_code
      LIMIT 1;
      v_allowed := v_caller_cluster IS NOT NULL
        AND v_target_cluster IS NOT NULL
        AND v_caller_cluster = v_target_cluster;
    END IF;

    IF NOT v_allowed THEN
      RETURN;
    END IF;
  END IF;

  IF p_guild_code IS NULL OR p_season IS NULL THEN
    RAISE EXCEPTION 'guild and season are required';
  END IF;

  RETURN QUERY
  WITH cfg AS (
    SELECT coalesce(gc.token_offender_threshold, 4) AS offender_threshold,
           coalesce(gc.token_abuser_threshold, 5) AS abuser_threshold
    FROM public.guild_config gc
    WHERE gc.guild_code = p_guild_code
    LIMIT 1
  ),
  battles AS (
    SELECT e."userId" AS user_id, e."displayName" AS display_name,
           coalesce(e."encounterId", 0) AS encounter_id
    FROM public."EOT_GR_data" e
    WHERE e."Guild" = p_guild_code AND e."Season" = p_season
      AND e."damageType" = 'Battle' AND e."displayName" IS NOT NULL
      AND e."userId" IS NOT NULL AND e."damageDealt" > 0
  ),
  bombs AS (
    SELECT e."userId" AS user_id, count(*) AS bombs_used
    FROM public."EOT_GR_data" e
    WHERE e."Guild" = p_guild_code AND e."Season" = p_season
      AND e."damageType" = 'Bomb' AND e."displayName" IS NOT NULL
      AND e."userId" IS NOT NULL
    GROUP BY e."userId"
  ),
  tokens_per_player AS (
    SELECT b.user_id AS tp_user_id, b.display_name AS tp_display_name,
           count(*) AS tp_tokens_used,
           count(*) FILTER (WHERE b.encounter_id = 0) AS tp_boss_tokens,
           count(*) FILTER (WHERE b.encounter_id <> 0) AS tp_prime_tokens
    FROM battles b
    GROUP BY b.user_id, b.display_name
  ),
  avail_per_player AS (
    SELECT t.tp_user_id AS ap_user_id,
           coalesce(av.tokens_available, 0) AS ap_tokens_available,
           av.token_next_in_seconds AS ap_token_next_in_seconds
    FROM tokens_per_player t
    CROSS JOIN LATERAL public.compute_player_tokens_available(
      p_guild_code := p_guild_code, p_season := p_season,
      p_player_id := t.tp_user_id
    ) av
  ),
  burn_per_player AS (
    SELECT t.tp_user_id AS bp_user_id,
           coalesce(cb.time_over_cap_seconds, 0)::int AS bp_time_over_cap_seconds
    FROM tokens_per_player t
    CROSS JOIN LATERAL public.compute_player_token_burn(
      p_guild_code := p_guild_code, p_season := p_season,
      p_player_id := t.tp_user_id
    ) cb
  ),
  max_tokens_cte AS (
    SELECT least(v_max_possible_hard_cap,
                 coalesce(max(t.tp_tokens_used + a.ap_tokens_available), 0))::integer AS mt_max_tokens
    FROM tokens_per_player t
    JOIN avail_per_player a ON a.ap_user_id = t.tp_user_id
  )
  SELECT t.tp_user_id::text, t.tp_display_name::text,
         t.tp_tokens_used::int,
         (SELECT mt_max_tokens FROM max_tokens_cte)::int,
         ((SELECT mt_max_tokens FROM max_tokens_cte) - t.tp_tokens_used) >= (SELECT offender_threshold FROM cfg),
         ((SELECT mt_max_tokens FROM max_tokens_cte) - t.tp_tokens_used) >= (SELECT abuser_threshold FROM cfg),
         t.tp_boss_tokens::int, t.tp_prime_tokens::int,
         coalesce(b.bombs_used, 0)::int, 0::int,
         greatest(0, floor((SELECT mt_max_tokens FROM max_tokens_cte)
           - t.tp_tokens_used - least(3, greatest(0, a.ap_tokens_available))
           - CASE WHEN least(3, greatest(0, a.ap_tokens_available)) >= 3 THEN 0
                  WHEN coalesce(a.ap_token_next_in_seconds, 0) <= 0 THEN 0
                  ELSE (v_regen_seconds - least(a.ap_token_next_in_seconds, v_regen_seconds)) / v_regen_seconds END))::int,
         coalesce(bp.bp_time_over_cap_seconds, 0)::int,
         a.ap_tokens_available::int, a.ap_token_next_in_seconds::int
  FROM tokens_per_player t
  LEFT JOIN bombs b ON b.user_id = t.tp_user_id
  LEFT JOIN avail_per_player a ON a.ap_user_id = t.tp_user_id
  LEFT JOIN burn_per_player bp ON bp.bp_user_id = t.tp_user_id;
END;
$$;

CREATE FUNCTION public.get_user_access_levels(p_user_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_role text;
  v_mapping_count integer;
  v_guild text;
  v_cluster text;
  v_guild_role text;
  v_is_app_admin boolean;
  v_is_alpha boolean;
  v_is_beta_tester boolean;
BEGIN
  v_role := lower(trim(COALESCE(NULLIF(NULLIF(current_setting('role', true), ''), 'none'), NULLIF(session_user, ''))));
  IF v_role NOT IN ('authenticated', 'service_role') THEN
    RAISE EXCEPTION USING ERRCODE = '42501';
  END IF;

  IF v_role = 'authenticated'
    AND (
      auth.uid() IS NULL
      OR p_user_id IS NULL
      OR p_user_id IS DISTINCT FROM auth.uid()
    )
  THEN
    RAISE EXCEPTION USING ERRCODE = '42501';
  END IF;

  SELECT
    count(pm.id)::integer,
    max(pm.guild_code),
    max(pm.cluster_code),
    max(pm.role::text),
    coalesce(max(pm.is_app_admin::integer), 0) = 1
  INTO
    v_mapping_count,
    v_guild,
    v_cluster,
    v_guild_role,
    v_is_app_admin
  FROM public.player_mapping AS pm
  WHERE pm.user_id = p_user_id
    AND pm.is_current IS TRUE;

  SELECT
    count(fag.user_id) FILTER (
      WHERE fag.access_level = 'alpha_tester'
        AND (fag.expires_at IS NULL OR fag.expires_at > now())
    ) > 0,
    count(fag.user_id) FILTER (
      WHERE fag.access_level = 'beta_tester'
        AND (fag.expires_at IS NULL OR fag.expires_at > now())
    ) > 0
  INTO v_is_alpha, v_is_beta_tester
  FROM public.feature_access_grants AS fag
  WHERE fag.user_id = p_user_id;

  RETURN jsonb_build_object(
    'is_app_admin', coalesce(v_is_app_admin, false),
    'is_admin', coalesce(v_is_app_admin OR v_guild_role = 'admin', false),
    'is_alpha_tester', coalesce(v_is_alpha, false),
    'is_beta_tester', coalesce(v_is_beta_tester, false),
    'has_premium', false,
    'cluster_code', v_cluster,
    'guild_code', v_guild,
    'max_access_level',
      CASE
        WHEN v_is_app_admin OR v_is_alpha THEN 'alpha'
        WHEN v_is_beta_tester THEN 'beta'
        ELSE 'public'
      END
  );
END;
$$;

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

CREATE FUNCTION public.get_player_boss_performance(guild_code_param text, season_param text) RETURNS TABLE(display_name text, boss_name text, encounter_id integer, player_avg numeric, battle_count integer, biggest_hit bigint, player_vs_guild_avg numeric, player_vs_cluster_avg numeric, set_num integer, tier integer, rarity text, boss_preference text)
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
  v_cluster_code TEXT;
BEGIN
  SELECT cluster_code INTO v_cluster_code
  FROM guild_config
  WHERE guild_code = guild_code_param
  LIMIT 1;

  RETURN QUERY
  WITH player_boss_stats AS (
    SELECT
      e."displayName",
      e."Name" as name,
      COALESCE(e."encounterId", 0)::INTEGER as enc_id,
      e.tier as tier_val,
      e.set as set_val,
      e.rarity as rarity_val,
      SUM(e."damageDealt") FILTER (
        WHERE NOT (e."remainingHp" = 0 AND e."maxHp" > 0 AND e."damageDealt" < e."maxHp")
      )::NUMERIC as non_sweep_damage,
      COUNT(*) FILTER (
        WHERE NOT (e."remainingHp" = 0 AND e."maxHp" > 0 AND e."damageDealt" < e."maxHp")
      )::INTEGER as non_sweep_count,
      array_agg(e."damageDealt"::numeric) FILTER (
        WHERE e."remainingHp" = 0 AND e."maxHp" > 0 AND e."damageDealt" < e."maxHp"
      ) as sweep_damages,
      MAX(e."damageDealt") as b_hit
    FROM "EOT_GR_data" e
    WHERE e."Season" = season_param
      AND e."Guild" = guild_code_param
      AND e."damageType" = 'Battle'
      AND e.rarity IN ('Legendary', 'Mythic')
      AND e."damageDealt" > 0
    GROUP BY e."displayName", e."Name", e."encounterId", e.tier, e.set, e.rarity
  ),
  guild_avg AS (
    SELECT
      e."Name" as name,
      COALESCE(e."encounterId", 0)::INTEGER as enc_id,
      e.rarity as rarity_val,
      AVG(e."damageDealt")::NUMERIC as g_avg
    FROM "EOT_GR_data" e
    WHERE e."Season" = season_param
      AND e."Guild" = guild_code_param
      AND e."damageType" = 'Battle'
      AND e.rarity IN ('Legendary', 'Mythic')
      AND e."damageDealt" > 0
      AND NOT (e."remainingHp" = 0 AND e."maxHp" > 0 AND e."damageDealt" < e."maxHp")
    GROUP BY e."Name", e."encounterId", e.rarity
  ),
  cluster_avg AS (
    SELECT
      e."Name" as name,
      COALESCE(e."encounterId", 0)::INTEGER as enc_id,
      e.rarity as rarity_val,
      AVG(e."damageDealt")::NUMERIC as c_avg
    FROM "EOT_GR_data" e
    INNER JOIN guild_config gc ON gc.guild_code = e."Guild"
    WHERE e."Season" = season_param
      AND e."damageType" = 'Battle'
      AND e.rarity IN ('Legendary', 'Mythic')
      AND e."damageDealt" > 0
      AND NOT (e."remainingHp" = 0 AND e."maxHp" > 0 AND e."damageDealt" < e."maxHp")
      AND gc.cluster_code = v_cluster_code
      AND gc.cluster_code IS NOT NULL
    GROUP BY e."Name", e."encounterId", e.rarity
  ),
  boss_prefs AS (
    SELECT
      pm.display_name,
      bp.boss_key,
      bp.preference
    FROM player_mapping pm
    CROSS JOIN LATERAL (
      SELECT key as boss_key, value as preference
      FROM jsonb_each_text(COALESCE(pm.boss_preferences, '{}'::jsonb))
    ) bp
    WHERE pm.guild_code = guild_code_param
      AND pm.is_current = true
  )
  SELECT
    p."displayName" as display_name,
    p.name as boss_name,
    p.enc_id as encounter_id,
    CASE
      WHEN COALESCE(p.non_sweep_count, 0) + COALESCE(qualifying_sweep_count(p.sweep_damages, GREATEST(p.non_sweep_damage / NULLIF(p.non_sweep_count, 0), g.g_avg)), 0) > 0
      THEN (
        (COALESCE(p.non_sweep_damage, 0) + COALESCE(qualifying_sweep_sum(p.sweep_damages, GREATEST(p.non_sweep_damage / NULLIF(p.non_sweep_count, 0), g.g_avg)), 0))
        / (COALESCE(p.non_sweep_count, 0) + COALESCE(qualifying_sweep_count(p.sweep_damages, GREATEST(p.non_sweep_damage / NULLIF(p.non_sweep_count, 0), g.g_avg)), 0))
      )
      ELSE 0
    END as player_avg,
    (COALESCE(p.non_sweep_count, 0) + COALESCE(qualifying_sweep_count(p.sweep_damages, GREATEST(p.non_sweep_damage / NULLIF(p.non_sweep_count, 0), g.g_avg)), 0))::INTEGER as battle_count,
    p.b_hit as biggest_hit,
    CASE
      WHEN g.g_avg > 0 THEN ROUND((
        (
          (COALESCE(p.non_sweep_damage, 0) + COALESCE(qualifying_sweep_sum(p.sweep_damages, GREATEST(p.non_sweep_damage / NULLIF(p.non_sweep_count, 0), g.g_avg)), 0))
          / NULLIF(COALESCE(p.non_sweep_count, 0) + COALESCE(qualifying_sweep_count(p.sweep_damages, GREATEST(p.non_sweep_damage / NULLIF(p.non_sweep_count, 0), g.g_avg)), 0), 0)
          / g.g_avg
        ) - 1) * 100, 2)
      ELSE 0
    END as player_vs_guild_avg,
    CASE
      WHEN c.c_avg > 0 THEN ROUND((
        (
          (COALESCE(p.non_sweep_damage, 0) + COALESCE(qualifying_sweep_sum(p.sweep_damages, GREATEST(p.non_sweep_damage / NULLIF(p.non_sweep_count, 0), c.c_avg)), 0))
          / NULLIF(COALESCE(p.non_sweep_count, 0) + COALESCE(qualifying_sweep_count(p.sweep_damages, GREATEST(p.non_sweep_damage / NULLIF(p.non_sweep_count, 0), c.c_avg)), 0), 0)
          / c.c_avg
        ) - 1) * 100, 2)
      ELSE 0
    END as player_vs_cluster_avg,
    p.set_val as set_num,
    p.tier_val::INTEGER as tier,
    p.rarity_val as rarity,
    COALESCE(bp.preference, 'neutral') as boss_preference
  FROM player_boss_stats p
  LEFT JOIN guild_avg g ON p.name = g.name AND p.enc_id = g.enc_id AND p.rarity_val = g.rarity_val
  LEFT JOIN cluster_avg c ON p.name = c.name AND p.enc_id = c.enc_id AND p.rarity_val = c.rarity_val
  LEFT JOIN boss_prefs bp ON p."displayName" = bp.display_name AND bp.boss_key = CONCAT('main_', p.name)
  ORDER BY p."displayName", p.rarity_val DESC, p.set_val, p.enc_id;
END;
$$;

CREATE FUNCTION public.get_player_boss_performance(p_guild_code text, p_season text, p_display_name text, p_rarities text[] DEFAULT ARRAY['Legendary'::text, 'Mythic'::text]) RETURNS TABLE(display_name text, user_id uuid, boss_name text, tier integer, set integer, rarity text, encounter_id integer, token_usage_label text, player_avg numeric, guild_avg numeric, cluster_avg numeric, battle_count integer, weighted_contribution numeric, vs_cluster_pct numeric, vs_guild_pct numeric)
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
  v_cluster_code TEXT;
BEGIN
  SELECT gc.cluster_code INTO v_cluster_code
  FROM guild_config gc
  WHERE gc.guild_code = p_guild_code
  LIMIT 1;

  RETURN QUERY
  WITH player_boss_stats AS (
    SELECT
      e."displayName" as dn,
      pm.user_id as uid,
      e."Name" as boss,
      COALESCE(e."encounterId", 0)::INTEGER as enc_id,
      e.tier as tier_val,
      e.set as set_val,
      e.rarity as rarity_val,
      SUM(e."damageDealt") FILTER (
        WHERE NOT (e."remainingHp" = 0 AND e."maxHp" > 0 AND e."damageDealt" < e."maxHp")
      )::NUMERIC as non_sweep_damage,
      COUNT(*) FILTER (
        WHERE NOT (e."remainingHp" = 0 AND e."maxHp" > 0 AND e."damageDealt" < e."maxHp")
      )::INTEGER as non_sweep_count,
      array_agg(e."damageDealt"::numeric) FILTER (
        WHERE e."remainingHp" = 0 AND e."maxHp" > 0 AND e."damageDealt" < e."maxHp"
      ) as sweep_damages,
      SUM(e."damageDealt")::NUMERIC as total_dmg
    FROM "EOT_GR_data" e
    LEFT JOIN player_mapping pm ON pm.display_name = e."displayName"
      AND pm.guild_code = e."Guild"
      AND pm.is_current = true
    WHERE e."Season" = p_season
      AND e."Guild" = p_guild_code
      AND e."displayName" = p_display_name
      AND e."damageType" = 'Battle'
      AND e.rarity = ANY(p_rarities)
      AND e."damageDealt" > 0
    GROUP BY e."displayName", pm.user_id, e."Name", e."encounterId", e.tier, e.set, e.rarity
  ),
  guild_avg_cte AS (
    SELECT
      d."Name" as boss,
      COALESCE(d."encounterId", 0)::INTEGER as enc_id,
      d.rarity as rarity_val,
      AVG(d."damageDealt")::NUMERIC as g_avg
    FROM "EOT_GR_data" d
    WHERE d."Season" = p_season
      AND d."Guild" = p_guild_code
      AND d."damageType" = 'Battle'
      AND d.rarity = ANY(p_rarities)
      AND d."damageDealt" > 0
      AND NOT (d."remainingHp" = 0 AND d."maxHp" > 0 AND d."damageDealt" < d."maxHp")
    GROUP BY d."Name", d."encounterId", d.rarity
  ),
  cluster_avg_cte AS (
    SELECT
      e."Name" as boss,
      COALESCE(e."encounterId", 0)::INTEGER as enc_id,
      e.rarity as rarity_val,
      AVG(e."damageDealt")::NUMERIC as c_avg
    FROM "EOT_GR_data" e
    INNER JOIN guild_config gc ON gc.guild_code = e."Guild"
    WHERE e."Season" = p_season
      AND e."damageType" = 'Battle'
      AND e.rarity = ANY(p_rarities)
      AND e."damageDealt" > 0
      AND NOT (e."remainingHp" = 0 AND e."maxHp" > 0 AND e."damageDealt" < e."maxHp")
      AND gc.cluster_code = v_cluster_code
    GROUP BY e."Name", e."encounterId", e.rarity
  ),
  guild_total_cte AS (
    SELECT SUM(d."damageDealt")::NUMERIC as total
    FROM "EOT_GR_data" d
    WHERE d."Season" = p_season
      AND d."Guild" = p_guild_code
      AND d."damageType" = 'Battle'
      AND d.rarity = ANY(p_rarities)
      AND d."damageDealt" > 0
  )
  SELECT
    p.dn,
    p.uid,
    CONCAT(p.boss, '_', p.rarity_val),
    p.tier_val::INTEGER,
    p.set_val,
    p.rarity_val,
    p.enc_id,
    CASE
      WHEN p.enc_id IN (1, 2) THEN 'Leg. Primes'
      ELSE CONCAT('L', p.set_val + 1, ' ', p.boss)
    END,
    CASE
      WHEN COALESCE(p.non_sweep_count, 0) + COALESCE(qualifying_sweep_count(p.sweep_damages, GREATEST(p.non_sweep_damage / NULLIF(p.non_sweep_count, 0), g.g_avg)), 0) > 0
      THEN (
        (COALESCE(p.non_sweep_damage, 0) + COALESCE(qualifying_sweep_sum(p.sweep_damages, GREATEST(p.non_sweep_damage / NULLIF(p.non_sweep_count, 0), g.g_avg)), 0))
        / (COALESCE(p.non_sweep_count, 0) + COALESCE(qualifying_sweep_count(p.sweep_damages, GREATEST(p.non_sweep_damage / NULLIF(p.non_sweep_count, 0), g.g_avg)), 0))
      )
      ELSE 0
    END,
    g.g_avg,
    c.c_avg,
    (COALESCE(p.non_sweep_count, 0) + COALESCE(qualifying_sweep_count(p.sweep_damages, GREATEST(p.non_sweep_damage / NULLIF(p.non_sweep_count, 0), g.g_avg)), 0))::INTEGER,
    CASE
      WHEN gt.total > 0 THEN (p.total_dmg / gt.total) * 100
      ELSE 0
    END,
    CASE
      WHEN c.c_avg > 0 THEN ROUND((
        (
          (COALESCE(p.non_sweep_damage, 0) + COALESCE(qualifying_sweep_sum(p.sweep_damages, GREATEST(p.non_sweep_damage / NULLIF(p.non_sweep_count, 0), c.c_avg)), 0))
          / NULLIF(COALESCE(p.non_sweep_count, 0) + COALESCE(qualifying_sweep_count(p.sweep_damages, GREATEST(p.non_sweep_damage / NULLIF(p.non_sweep_count, 0), c.c_avg)), 0), 0)
          / c.c_avg
        ) - 1) * 100, 2)
      ELSE 0
    END,
    CASE
      WHEN g.g_avg > 0 THEN ROUND((
        (
          (COALESCE(p.non_sweep_damage, 0) + COALESCE(qualifying_sweep_sum(p.sweep_damages, GREATEST(p.non_sweep_damage / NULLIF(p.non_sweep_count, 0), g.g_avg)), 0))
          / NULLIF(COALESCE(p.non_sweep_count, 0) + COALESCE(qualifying_sweep_count(p.sweep_damages, GREATEST(p.non_sweep_damage / NULLIF(p.non_sweep_count, 0), g.g_avg)), 0), 0)
          / g.g_avg
        ) - 1) * 100, 2)
      ELSE 0
    END
  FROM player_boss_stats p
  LEFT JOIN guild_avg_cte g ON p.boss = g.boss AND p.enc_id = g.enc_id AND p.rarity_val = g.rarity_val
  LEFT JOIN cluster_avg_cte c ON p.boss = c.boss AND p.enc_id = c.enc_id AND p.rarity_val = c.rarity_val
  CROSS JOIN guild_total_cte gt
  ORDER BY p.rarity_val DESC, p.set_val, p.enc_id;
END;
$$;

CREATE FUNCTION public.get_player_boss_performance(p_guild_code text, p_season text, p_player_name text, p_boss_name text DEFAULT NULL::text, p_rarity text DEFAULT 'Legendary'::text) RETURNS TABLE(player_id text, player_name text, boss_name text, tier integer, encounter_id integer, rarity text, player_avg numeric, guild_avg numeric, cluster_avg numeric, vs_guild_pct numeric, vs_cluster_pct numeric, battle_count bigint)
    LANGUAGE plpgsql
    AS $$
DECLARE
  target_player_id TEXT;
  cluster_code_var TEXT;
BEGIN
  SELECT pm.player_id INTO target_player_id
  FROM player_mapping pm
  WHERE pm.display_name = p_player_name
    AND pm.is_current = true
  LIMIT 1;

  IF target_player_id IS NULL THEN
    SELECT pm.player_id INTO target_player_id
    FROM player_mapping pm
    WHERE pm.display_name = p_player_name
    ORDER BY pm.updated_at DESC
    LIMIT 1;
  END IF;

  IF target_player_id IS NULL THEN
    RETURN;
  END IF;
  SELECT gc.cluster_code INTO cluster_code_var
  FROM guild_config gc
  WHERE gc.guild_code = p_guild_code;

  RETURN QUERY
  WITH player_stats AS (
    SELECT
      e."userId" as player_id,
      pm.display_name as current_player_name,
      e."Name" as boss_name,
      e."tier",
      e."encounterId",
      e."rarity",
      AVG(e."damageDealt") as avg_damage,
      COUNT(*) as battle_count
    FROM "EOT_GR_data" e
    LEFT JOIN player_mapping pm ON e."userId" = pm.player_id AND pm.is_current = true
    WHERE e."Guild" = p_guild_code
      AND e."Season" = p_season
      AND e."damageType" = 'Battle'
      AND e."damageDealt" > 0
      AND e."userId" = target_player_id
      AND e."rarity" = p_rarity
      AND (p_boss_name IS NULL OR e."Name" = p_boss_name)
    GROUP BY e."userId", pm.display_name, e."Name", e."tier", e."encounterId", e."rarity"
  ),
  guild_stats AS (
    SELECT
      e."Name" as boss_name,
      e."tier",
      e."encounterId",
      e."rarity",
      AVG(e."damageDealt") as guild_avg
    FROM "EOT_GR_data" e
    WHERE e."Guild" = p_guild_code
      AND e."Season" = p_season
      AND e."damageType" = 'Battle'
      AND e."damageDealt" > 0
      AND e."rarity" = p_rarity
      AND (p_boss_name IS NULL OR e."Name" = p_boss_name)
    GROUP BY e."Name", e."tier", e."encounterId", e."rarity"
  ),
  cluster_stats AS (
    SELECT
      e."Name" as boss_name,
      e."tier",
      e."encounterId",
      e."rarity",
      AVG(e."damageDealt") as cluster_avg
    FROM "EOT_GR_data" e
    JOIN guild_config gc ON e."Guild" = gc.guild_code
    WHERE gc.cluster_code = cluster_code_var
      AND e."Season" = p_season
      AND e."damageType" = 'Battle'
      AND e."damageDealt" > 0
      AND e."rarity" = p_rarity
      AND (p_boss_name IS NULL OR e."Name" = p_boss_name)
    GROUP BY e."Name", e."tier", e."encounterId", e."rarity"
  )
  SELECT
    ps.player_id::TEXT,
    COALESCE(ps.current_player_name, 'Unknown Player')::TEXT as player_name,
    ps.boss_name::TEXT,
    ps.tier,
    ps.encounterId,
    ps.rarity::TEXT,
    ps.avg_damage as player_avg,
    gs.guild_avg,
    cs.cluster_avg,
    ROUND(((ps.avg_damage - gs.guild_avg) / NULLIF(gs.guild_avg, 0) * 100)::numeric, 1) as vs_guild_pct,
    ROUND(((ps.avg_damage - cs.cluster_avg) / NULLIF(cs.cluster_avg, 0) * 100)::numeric, 1) as vs_cluster_pct,
    ps.battle_count
  FROM player_stats ps
  LEFT JOIN guild_stats gs ON (
    ps.boss_name = gs.boss_name
    AND ps.tier = gs.tier
    AND ps.encounterId = gs.encounterId
    AND ps.rarity = gs.rarity
  )
  LEFT JOIN cluster_stats cs ON (
    ps.boss_name = cs.boss_name
    AND ps.tier = cs.tier
    AND ps.encounterId = cs.encounterId
    AND ps.rarity = cs.rarity
  )
  ORDER BY ps.boss_name, ps.tier, ps.encounterId;
END;
$$;
