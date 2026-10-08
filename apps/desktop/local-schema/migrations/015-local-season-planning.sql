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
