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

-- Canonical achievement evaluation inputs.
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
