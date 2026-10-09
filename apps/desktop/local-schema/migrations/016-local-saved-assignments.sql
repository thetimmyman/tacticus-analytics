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
