-- target-db: general
-- Roster verification is separate from token freshness. No provider quota or
-- synchronization cadence is changed by this migration.
BEGIN;
DO $guard$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'Roster snapshot state requires the General database';
  END IF;
END;
$guard$;


CREATE TABLE IF NOT EXISTS public.player_roster_sync_state (
  player_mapping_id integer CONSTRAINT player_roster_sync_state_pkey PRIMARY KEY
    REFERENCES public.player_mapping(id) ON DELETE CASCADE,
  owner_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  attempt_id uuid NOT NULL,
  attempted_at timestamptz NOT NULL,
  verified_at timestamptz,
  snapshot_hash text CONSTRAINT player_roster_sync_state_hash_check
    CHECK (snapshot_hash IS NULL OR snapshot_hash ~ '^[0-9a-f]{64}$'),
  receipt jsonb
);
ALTER TABLE public.player_roster_sync_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.player_roster_sync_state FROM PUBLIC,anon,authenticated,service_role;
GRANT ALL ON public.player_roster_sync_state TO postgres;

-- An observation token orders results; it neither dispatches nor schedules a read.
CREATE OR REPLACE FUNCTION public.begin_player_roster_refresh(
  p_player_mapping_id integer,p_user_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public AS $function$
DECLARE
  resolved_id integer:=p_player_mapping_id;
  candidates integer;
  mapping public.player_mapping%ROWTYPE;
  attempt uuid:=gen_random_uuid();
  observed timestamptz;
BEGIN
  IF resolved_id IS NULL THEN
    IF p_user_id IS NULL THEN RAISE EXCEPTION 'Invalid roster owner' USING ERRCODE='22023'; END IF;
    SELECT min(id),count(*) INTO resolved_id,candidates FROM public.player_mapping
      WHERE user_id=p_user_id AND is_current IS TRUE;
    IF candidates<>1 THEN RAISE EXCEPTION 'Invalid roster owner' USING ERRCODE='22023'; END IF;
  END IF;
  SELECT * INTO mapping FROM public.player_mapping WHERE id=resolved_id FOR UPDATE;
  IF NOT FOUND OR mapping.is_current IS NOT TRUE OR mapping.user_id IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'Invalid roster owner' USING ERRCODE='22023';
  END IF;
  observed:=clock_timestamp();
  INSERT INTO public.player_roster_sync_state AS prior
    (player_mapping_id,owner_user_id,attempt_id,attempted_at)
  VALUES (resolved_id,p_user_id,attempt,observed)
  ON CONFLICT (player_mapping_id) DO UPDATE SET
    owner_user_id=EXCLUDED.owner_user_id,attempt_id=EXCLUDED.attempt_id,
    attempted_at=EXCLUDED.attempted_at,receipt=NULL,
    verified_at=CASE WHEN prior.owner_user_id IS NOT DISTINCT FROM EXCLUDED.owner_user_id THEN prior.verified_at END,
    snapshot_hash=CASE WHEN prior.owner_user_id IS NOT DISTINCT FROM EXCLUDED.owner_user_id THEN prior.snapshot_hash END;
  RETURN jsonb_build_object('playerMappingId',resolved_id,'attemptId',attempt,'observedAt',observed);
END $function$;

CREATE OR REPLACE FUNCTION public.persist_player_roster_snapshot(
  p_player_mapping_id integer,p_user_id uuid,p_attempt_id uuid,
  p_rows jsonb,p_player_power bigint,p_complete boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public AS $function$
DECLARE
  resolved_id integer:=p_player_mapping_id;
  mapping public.player_mapping%ROWTYPE;
  state public.player_roster_sync_state%ROWTYPE;
  canonical jsonb;
  content_hash text;
  changed integer:=0;
  power_changed integer:=0;
  snapshot_receipt jsonb;
  complete boolean;
BEGIN
  IF resolved_id IS NULL OR p_attempt_id IS NULL OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array'
    OR p_player_power<0 THEN
    RAISE EXCEPTION 'Invalid roster snapshot' USING ERRCODE='22023';
  END IF;
  IF jsonb_array_length(p_rows)>1000 THEN
    RAISE EXCEPTION 'Invalid roster snapshot' USING ERRCODE='22023';
  END IF;
  IF EXISTS (SELECT FROM jsonb_array_elements(p_rows) r WHERE jsonb_typeof(r) IS DISTINCT FROM 'object') THEN
    RAISE EXCEPTION 'Invalid roster snapshot' USING ERRCODE='22023';
  END IF;
  IF EXISTS (SELECT FROM jsonb_array_elements(p_rows) r,LATERAL jsonb_object_keys(r) k
    WHERE k NOT IN ('hero_mapping_id','rank_name','stars','progression_index','rarity','xp_level','active_ability_level','passive_ability_level','crit_item_id','crit_item_level','defensive_item_id','defensive_item_level','booster_item_id','booster_item_level')) THEN
    RAISE EXCEPTION 'Invalid roster snapshot' USING ERRCODE='22023';
  END IF;
  SELECT * INTO mapping FROM public.player_mapping WHERE id=resolved_id FOR UPDATE;
  IF NOT FOUND OR mapping.is_current IS NOT TRUE OR mapping.user_id IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'Invalid roster owner' USING ERRCODE='22023';
  END IF;
  SELECT * INTO state FROM public.player_roster_sync_state WHERE player_mapping_id=resolved_id FOR UPDATE;
  IF NOT FOUND OR state.attempt_id<>p_attempt_id OR state.owner_user_id IS DISTINCT FROM p_user_id THEN
    RETURN jsonb_build_object('status','superseded','upserted',0,'playerPowerUpdated',false,'unchanged',false,'complete',false);
  END IF;
  IF state.receipt IS NOT NULL THEN
    RETURN state.receipt || jsonb_build_object('idempotent',true);
  END IF;
  IF EXISTS (SELECT FROM jsonb_populate_recordset(NULL::public.player_roster,p_rows) r
    WHERE r.hero_mapping_id IS NULL OR r.hero_mapping_id<=0 OR r.rank_name IS NULL) OR
    (SELECT count(DISTINCT r.hero_mapping_id) FROM jsonb_populate_recordset(NULL::public.player_roster,p_rows) r)<>jsonb_array_length(p_rows) THEN
    RAISE EXCEPTION 'Invalid roster snapshot' USING ERRCODE='22023';
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'hero_mapping_id',r.hero_mapping_id,
    'rank_name',r.rank_name,
    'stars',r.stars,
    'progression_index',r.progression_index,
    'rarity',r.rarity,
    'xp_level',r.xp_level,
    'active_ability_level',r.active_ability_level,
    'passive_ability_level',r.passive_ability_level,
    'crit_item_id',r.crit_item_id,
    'crit_item_level',r.crit_item_level,
    'defensive_item_id',r.defensive_item_id,
    'defensive_item_level',r.defensive_item_level,
    'booster_item_id',r.booster_item_id,
    'booster_item_level',r.booster_item_level
  ) ORDER BY r.hero_mapping_id),'[]'::jsonb) INTO canonical
    FROM jsonb_populate_recordset(NULL::public.player_roster,p_rows) r;
  content_hash:=encode(sha256(convert_to(jsonb_build_object(
    'owner',p_user_id,'mapping',resolved_id,'rows',canonical,'power',p_player_power
  )::text,'UTF8')),'hex');
  UPDATE public.player_mapping SET player_power=p_player_power,updated_at=clock_timestamp()
    WHERE id=resolved_id AND p_player_power IS NOT NULL AND player_power IS DISTINCT FROM p_player_power;
  GET DIAGNOSTICS power_changed=ROW_COUNT;
  IF p_user_id IS NOT NULL THEN
    INSERT INTO public.player_roster AS roster
      (user_id,player_mapping_id,hero_mapping_id,rank_name,stars,progression_index,rarity,xp_level,active_ability_level,passive_ability_level,crit_item_id,crit_item_level,defensive_item_id,defensive_item_level,booster_item_id,booster_item_level,synced_at)
    SELECT p_user_id,NULL,r.hero_mapping_id,r.rank_name,r.stars,r.progression_index,r.rarity,r.xp_level,r.active_ability_level,r.passive_ability_level,r.crit_item_id,r.crit_item_level,r.defensive_item_id,r.defensive_item_level,r.booster_item_id,r.booster_item_level,state.attempted_at
      FROM jsonb_populate_recordset(NULL::public.player_roster,p_rows) AS r
    ON CONFLICT (user_id,hero_mapping_id) DO UPDATE SET
      rank_name=EXCLUDED.rank_name,
      stars=EXCLUDED.stars,
      progression_index=EXCLUDED.progression_index,
      rarity=EXCLUDED.rarity,
      xp_level=EXCLUDED.xp_level,
      active_ability_level=EXCLUDED.active_ability_level,
      passive_ability_level=EXCLUDED.passive_ability_level,
      crit_item_id=EXCLUDED.crit_item_id,
      crit_item_level=EXCLUDED.crit_item_level,
      defensive_item_id=EXCLUDED.defensive_item_id,
      defensive_item_level=EXCLUDED.defensive_item_level,
      booster_item_id=EXCLUDED.booster_item_id,
      booster_item_level=EXCLUDED.booster_item_level,
      synced_at=EXCLUDED.synced_at
    WHERE ROW(roster.rank_name,roster.stars,roster.progression_index,roster.rarity,roster.xp_level,roster.active_ability_level,roster.passive_ability_level,roster.crit_item_id,roster.crit_item_level,roster.defensive_item_id,roster.defensive_item_level,roster.booster_item_id,roster.booster_item_level)
      IS DISTINCT FROM ROW(EXCLUDED.rank_name,EXCLUDED.stars,EXCLUDED.progression_index,EXCLUDED.rarity,EXCLUDED.xp_level,EXCLUDED.active_ability_level,EXCLUDED.passive_ability_level,EXCLUDED.crit_item_id,EXCLUDED.crit_item_level,EXCLUDED.defensive_item_id,EXCLUDED.defensive_item_level,EXCLUDED.booster_item_id,EXCLUDED.booster_item_level);
  ELSE
    INSERT INTO public.player_roster AS roster
      (user_id,player_mapping_id,hero_mapping_id,rank_name,stars,progression_index,rarity,xp_level,active_ability_level,passive_ability_level,crit_item_id,crit_item_level,defensive_item_id,defensive_item_level,booster_item_id,booster_item_level,synced_at)
    SELECT NULL,resolved_id,r.hero_mapping_id,r.rank_name,r.stars,r.progression_index,r.rarity,r.xp_level,r.active_ability_level,r.passive_ability_level,r.crit_item_id,r.crit_item_level,r.defensive_item_id,r.defensive_item_level,r.booster_item_id,r.booster_item_level,state.attempted_at
      FROM jsonb_populate_recordset(NULL::public.player_roster,p_rows) AS r
    ON CONFLICT (player_mapping_id,hero_mapping_id) DO UPDATE SET
      rank_name=EXCLUDED.rank_name,
      stars=EXCLUDED.stars,
      progression_index=EXCLUDED.progression_index,
      rarity=EXCLUDED.rarity,
      xp_level=EXCLUDED.xp_level,
      active_ability_level=EXCLUDED.active_ability_level,
      passive_ability_level=EXCLUDED.passive_ability_level,
      crit_item_id=EXCLUDED.crit_item_id,
      crit_item_level=EXCLUDED.crit_item_level,
      defensive_item_id=EXCLUDED.defensive_item_id,
      defensive_item_level=EXCLUDED.defensive_item_level,
      booster_item_id=EXCLUDED.booster_item_id,
      booster_item_level=EXCLUDED.booster_item_level,
      synced_at=EXCLUDED.synced_at
    WHERE ROW(roster.rank_name,roster.stars,roster.progression_index,roster.rarity,roster.xp_level,roster.active_ability_level,roster.passive_ability_level,roster.crit_item_id,roster.crit_item_level,roster.defensive_item_id,roster.defensive_item_level,roster.booster_item_id,roster.booster_item_level)
      IS DISTINCT FROM ROW(EXCLUDED.rank_name,EXCLUDED.stars,EXCLUDED.progression_index,EXCLUDED.rarity,EXCLUDED.xp_level,EXCLUDED.active_ability_level,EXCLUDED.passive_ability_level,EXCLUDED.crit_item_id,EXCLUDED.crit_item_level,EXCLUDED.defensive_item_id,EXCLUDED.defensive_item_level,EXCLUDED.booster_item_id,EXCLUDED.booster_item_level);
  END IF;
  GET DIAGNOSTICS changed=ROW_COUNT;
  complete:=p_complete IS TRUE AND jsonb_array_length(p_rows)>0;
  snapshot_receipt:=jsonb_build_object('status','applied','upserted',changed,
    'playerPowerUpdated',power_changed>0,'unchanged',changed=0 AND power_changed=0,'complete',complete);
  UPDATE public.player_roster_sync_state SET
    snapshot_hash=CASE WHEN complete THEN content_hash END,
    verified_at=CASE WHEN complete THEN state.attempted_at ELSE verified_at END,
    receipt=snapshot_receipt
    WHERE player_mapping_id=resolved_id;
  RETURN snapshot_receipt;
END $function$;

-- Only enabled background cohorts participate. Failed attempts rotate behind
-- never-attempted members; token stamps and row-change stamps are not evidence.
CREATE OR REPLACE FUNCTION public.get_player_roster_refresh_candidates(
  p_mapping_ids integer[],p_fresh_seconds integer,p_retry_seconds integer,
  p_require_enabled_guild boolean DEFAULT true
) RETURNS SETOF integer LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public AS $function$
BEGIN
  IF p_mapping_ids IS NULL OR p_require_enabled_guild IS NULL OR cardinality(p_mapping_ids)>10000
    OR EXISTS(SELECT FROM unnest(p_mapping_ids) id WHERE id IS NULL OR id<=0)
    OR p_fresh_seconds IS NULL OR p_fresh_seconds NOT BETWEEN 60 AND 31536000
    OR p_retry_seconds IS NULL OR p_retry_seconds NOT BETWEEN 1 AND p_fresh_seconds THEN
    RAISE EXCEPTION 'Invalid roster selection' USING ERRCODE='22023';
  END IF;
  RETURN QUERY SELECT mapping.id FROM public.player_mapping mapping
    LEFT JOIN public.player_roster_sync_state state
      ON state.player_mapping_id=mapping.id AND state.owner_user_id IS NOT DISTINCT FROM mapping.user_id
    WHERE mapping.id=ANY(p_mapping_ids) AND mapping.is_current IS TRUE
      AND (p_require_enabled_guild IS FALSE OR EXISTS(SELECT FROM public.guild_config guild
        WHERE guild.guild_code=mapping.guild_code AND guild.enabled IS TRUE AND guild.auto_sync_enabled IS TRUE))
      AND (state.snapshot_hash IS NULL OR state.verified_at IS NULL
        OR state.verified_at<statement_timestamp()-make_interval(secs=>p_fresh_seconds))
      AND (state.attempted_at IS NULL
        OR state.attempted_at<statement_timestamp()-make_interval(secs=>p_retry_seconds))
    ORDER BY state.attempted_at NULLS FIRST,mapping.id;
END $function$;

-- Recheck under the same mapping lock before assigning a background observation.
-- This coalesces a concurrently selected cohort; it creates no provider permit.
CREATE OR REPLACE FUNCTION public.try_begin_player_roster_refresh(
  p_player_mapping_id integer,p_user_id uuid,p_fresh_seconds integer,
  p_retry_seconds integer,p_require_enabled_guild boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public AS $function$
BEGIN
  PERFORM 1 FROM public.player_mapping WHERE id=p_player_mapping_id
    AND is_current IS TRUE AND user_id IS NOT DISTINCT FROM p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invalid roster owner' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS (SELECT FROM public.get_player_roster_refresh_candidates(
    ARRAY[p_player_mapping_id],p_fresh_seconds,p_retry_seconds,p_require_enabled_guild)) THEN
    RETURN 'null'::jsonb;
  END IF;
  RETURN public.begin_player_roster_refresh(p_player_mapping_id,p_user_id);
END $function$;

REVOKE ALL ON FUNCTION public.begin_player_roster_refresh(integer,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.get_player_roster_verification_summary(
  p_mapping_ids integer[],p_fresh_seconds integer
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public AS $function$
DECLARE summary jsonb;
BEGIN
  IF p_mapping_ids IS NULL OR cardinality(p_mapping_ids)>10000
    OR EXISTS(SELECT FROM unnest(p_mapping_ids) id WHERE id IS NULL OR id<=0)
    OR p_fresh_seconds IS NULL OR p_fresh_seconds NOT BETWEEN 60 AND 31536000 THEN
    RAISE EXCEPTION 'Invalid roster selection' USING ERRCODE='22023';
  END IF;
  WITH verification AS (
    SELECT CASE WHEN state.snapshot_hash IS NOT NULL THEN state.verified_at END AS verified_at
      FROM public.player_mapping mapping
      LEFT JOIN public.player_roster_sync_state state ON state.player_mapping_id=mapping.id
        AND state.owner_user_id IS NOT DISTINCT FROM mapping.user_id
      WHERE mapping.id=ANY(p_mapping_ids) AND mapping.is_current IS TRUE
  ) SELECT jsonb_build_object('total',count(*),'verified',count(verified_at),
      'fresh',count(*) FILTER(WHERE verified_at>=statement_timestamp()-make_interval(secs=>p_fresh_seconds)),
      'oldestVerifiedAt',min(verified_at)) INTO summary FROM verification;
  RETURN summary;
END $function$;
REVOKE ALL ON FUNCTION public.get_player_roster_verification_summary(integer[],integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_player_roster_verification_summary(integer[],integer) TO service_role;
REVOKE ALL ON FUNCTION public.persist_player_roster_snapshot(integer,uuid,uuid,jsonb,bigint,boolean) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.get_player_roster_refresh_candidates(integer[],integer,integer,boolean) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.try_begin_player_roster_refresh(integer,uuid,integer,integer,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.begin_player_roster_refresh(integer,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.persist_player_roster_snapshot(integer,uuid,uuid,jsonb,bigint,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_player_roster_refresh_candidates(integer[],integer,integer,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.try_begin_player_roster_refresh(integer,uuid,integer,integer,boolean) TO service_role;

DO $ledger$
BEGIN
  IF EXISTS (SELECT FROM supabase_migrations.schema_migrations WHERE version='20261015020000' AND name IS DISTINCT FROM 'atomic_roster_snapshots') THEN
    RAISE EXCEPTION 'Conflicting roster snapshot migration receipt';
  END IF;
  INSERT INTO supabase_migrations.schema_migrations(version,name)
    VALUES ('20261015020000','atomic_roster_snapshots') ON CONFLICT(version) DO NOTHING;
END $ledger$;
NOTIFY pgrst,'reload schema';

COMMIT;
