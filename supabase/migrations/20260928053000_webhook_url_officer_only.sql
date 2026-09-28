-- webhook_url is a Discord bearer secret: clients keep SELECT on every other column and
-- the URL is read only by service-role server code after the officer/leader check.
-- Client policies match production, which resolves the caller via _pm_caller_policy_rows().
-- target-db: general
-- Rollback: GRANT SELECT ON public.webhook_config TO authenticated (re-exposes every URL).

BEGIN;

DO $guard$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'webhook URL protection requires postgres, got %', current_database();
  END IF;
  IF to_regprocedure('public.get_webhook_url(text, text, text)') IS NULL THEN
    RAISE EXCEPTION 'get_webhook_url(text, text, text) is missing';
  END IF;
END
$guard$;

SET LOCAL lock_timeout = '5s';

DO $privileges$
DECLARE
  v_safe_columns text;
  v_role text;
BEGIN
  SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum)
    INTO v_safe_columns
    FROM pg_attribute
   WHERE attrelid = 'public.webhook_config'::regclass
     AND attnum > 0 AND NOT attisdropped AND attname <> 'webhook_url';

  IF v_safe_columns IS NULL THEN
    RAISE EXCEPTION 'webhook_config has no safe metadata columns';
  END IF;

  REVOKE SELECT ON public.webhook_config FROM PUBLIC;
  REVOKE SELECT (webhook_url) ON public.webhook_config FROM PUBLIC;
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
      EXECUTE format('REVOKE SELECT ON public.webhook_config FROM %I', v_role);
      EXECUTE format('REVOKE SELECT (webhook_url) ON public.webhook_config FROM %I', v_role);
    END IF;
  END LOOP;
  EXECUTE format('GRANT SELECT (%s) ON public.webhook_config TO authenticated', v_safe_columns);
END
$privileges$;

DROP POLICY IF EXISTS "Officers and leaders can manage guild webhooks" ON public.webhook_config;
CREATE POLICY "Officers and leaders can manage guild webhooks" ON public.webhook_config AS PERMISSIVE FOR ALL TO PUBLIC
  USING ((guild_code IN ( SELECT player_mapping.guild_code
   FROM _pm_caller_policy_rows() player_mapping(player_id, user_id, guild_code, cluster_code, role, is_current, is_app_admin)
  WHERE ((player_mapping.user_id = ( SELECT ( SELECT auth.uid() AS uid) AS uid)) AND (player_mapping.is_current = true) AND (player_mapping.role = ANY (ARRAY['officer'::app_role, 'leader'::app_role]))))));

DROP POLICY IF EXISTS "Officers and leaders can view their guild webhooks" ON public.webhook_config;
CREATE POLICY "Officers and leaders can view their guild webhooks" ON public.webhook_config AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (((guild_code IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM _pm_caller_policy_rows() pm(player_id, user_id, guild_code, cluster_code, role, is_current, is_app_admin)
  WHERE ((pm.user_id = ( SELECT auth.uid() AS uid)) AND (pm.guild_code = webhook_config.guild_code) AND (pm.is_current = true) AND (pm.role = ANY (ARRAY['officer'::app_role, 'leader'::app_role, 'Officer'::app_role, 'Leader'::app_role])))))));

DROP POLICY IF EXISTS webhook_config_leader_cluster_manage ON public.webhook_config;
CREATE POLICY webhook_config_leader_cluster_manage ON public.webhook_config AS PERMISSIVE FOR ALL TO authenticated
  USING (((EXISTS ( SELECT 1
   FROM (_pm_caller_policy_rows() pm(player_id, user_id, guild_code, cluster_code, role, is_current, is_app_admin)
     JOIN guild_config gc ON ((gc.guild_code = pm.guild_code)))
  WHERE ((pm.user_id = ( SELECT auth.uid() AS uid)) AND (pm.is_current = true) AND (lower((pm.role)::text) = 'leader'::text) AND (((webhook_config.cluster_id IS NOT NULL) AND (webhook_config.cluster_id = gc.cluster_id)) OR ((webhook_config.guild_code IS NOT NULL) AND (webhook_config.guild_code IN ( SELECT g2.guild_code
           FROM guild_config g2
          WHERE (g2.cluster_id = gc.cluster_id)))))))) OR ((cluster_id IS NOT NULL) AND (cluster_id IN ( SELECT c.id
   FROM clusters c
  WHERE (c.created_by = ( SELECT auth.uid() AS uid)))))))
  WITH CHECK (((EXISTS ( SELECT 1
   FROM (_pm_caller_policy_rows() pm(player_id, user_id, guild_code, cluster_code, role, is_current, is_app_admin)
     JOIN guild_config gc ON ((gc.guild_code = pm.guild_code)))
  WHERE ((pm.user_id = ( SELECT auth.uid() AS uid)) AND (pm.is_current = true) AND (lower((pm.role)::text) = 'leader'::text) AND (((webhook_config.cluster_id IS NOT NULL) AND (webhook_config.cluster_id = gc.cluster_id)) OR ((webhook_config.guild_code IS NOT NULL) AND (webhook_config.guild_code IN ( SELECT g2.guild_code
           FROM guild_config g2
          WHERE (g2.cluster_id = gc.cluster_id)))))))) OR ((cluster_id IS NOT NULL) AND (cluster_id IN ( SELECT c.id
   FROM clusters c
  WHERE (c.created_by = ( SELECT auth.uid() AS uid)))))));

DROP POLICY IF EXISTS webhook_config_member_read ON public.webhook_config;
CREATE POLICY webhook_config_member_read ON public.webhook_config AS PERMISSIVE FOR SELECT TO authenticated
  USING ((((guild_code IS NOT NULL) AND (guild_code IN ( SELECT _pm_caller_guild_codes() AS _pm_caller_guild_codes))) OR ((cluster_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM (_pm_caller_policy_rows() pm(player_id, user_id, guild_code, cluster_code, role, is_current, is_app_admin)
     JOIN guild_config gc ON ((gc.guild_code = pm.guild_code)))
  WHERE ((pm.user_id = ( SELECT auth.uid() AS uid)) AND (pm.is_current = true) AND (gc.cluster_id = webhook_config.cluster_id)))))));

REVOKE ALL ON FUNCTION public.get_webhook_url(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_webhook_url(text, text, text) TO service_role;

DO $verify$
DECLARE
  v_column record;
BEGIN
  IF has_table_privilege('authenticated', 'public.webhook_config', 'SELECT')
     OR has_column_privilege('authenticated', 'public.webhook_config', 'webhook_url', 'SELECT')
     OR has_column_privilege('anon', 'public.webhook_config', 'webhook_url', 'SELECT') THEN
    RAISE EXCEPTION 'client role can still read webhook_url';
  END IF;

  FOR v_column IN
    SELECT attname FROM pg_attribute
     WHERE attrelid = 'public.webhook_config'::regclass
       AND attnum > 0 AND NOT attisdropped AND attname <> 'webhook_url'
  LOOP
    IF NOT has_column_privilege('authenticated', 'public.webhook_config', v_column.attname, 'SELECT') THEN
      RAISE EXCEPTION 'authenticated cannot read metadata column %', v_column.attname;
    END IF;
  END LOOP;

  IF NOT (has_table_privilege('authenticated', 'public.webhook_config', 'INSERT')
      AND has_table_privilege('authenticated', 'public.webhook_config', 'UPDATE')
      AND has_table_privilege('authenticated', 'public.webhook_config', 'DELETE')
      AND has_column_privilege('authenticated', 'public.webhook_config', 'webhook_url', 'UPDATE')
      AND has_column_privilege('service_role', 'public.webhook_config', 'webhook_url', 'SELECT')) THEN
    RAISE EXCEPTION 'webhook write or service privilege changed';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policy p
     WHERE p.polrelid = 'public.webhook_config'::regclass
       AND (coalesce(pg_get_expr(p.polqual, p.polrelid), '') || ' ' ||
            coalesce(pg_get_expr(p.polwithcheck, p.polrelid), ''))
           ~ '(FROM|JOIN)\s+(public\.)?player_mapping\M'
  ) THEN
    RAISE EXCEPTION 'webhook policy reads player_mapping as a base relation';
  END IF;

  IF has_function_privilege('anon', 'public.get_webhook_url(text, text, text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.get_webhook_url(text, text, text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.get_webhook_url(text, text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'get_webhook_url execute privileges are unsafe';
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
COMMIT;
