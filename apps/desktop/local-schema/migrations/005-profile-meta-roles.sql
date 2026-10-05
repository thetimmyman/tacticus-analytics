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
