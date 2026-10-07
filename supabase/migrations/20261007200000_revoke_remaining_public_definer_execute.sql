-- Direct SQL logins can forge request.jwt* settings. Their PUBLIC grant
-- must not reach these definers. Preserve explicit API grants: API callers
-- receive their claims from the gateway, and RLS policies use these helpers.
-- target-db: general
-- Rollback: supabase/snippets/20261007200000_rollback_remaining_public_definer_execute.sql
-- Capture the pre-apply ACLs before execution; the ledger records the exact target statements.
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $guard$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'This migration targets General (postgres); refusing to run on %', current_database();
  END IF;
END;
$guard$;

CREATE TEMP TABLE remaining_public_definers(signature text, required boolean) ON COMMIT DROP;
INSERT INTO remaining_public_definers VALUES
  ('public._pm_caller_cluster_guild_codes()', true),
  ('public._pm_caller_guild_codes()', true),
  ('public._pm_caller_is_app_admin()', true),
  ('public.get_auth_role()', true),
  ('public.get_auth_uid()', true),
  ('public.get_user_accessible_guilds()', true),
  ('public.is_current_user_app_admin()', true),
  ('public.handle_boss_playbook_tactics_update()', true),
  ('public.set_playbook_cluster_code()', true),
  ('public.update_guild_theme_updated_by()', true),
  ('public.apply_pending_supporter_grants()', true),
  ('public.audit_login()', true),
  ('public.categorize_team_composition(text[])', true),
  ('public.check_guild_exists(text)', true),
  ('public.check_guild_registration_status(text)', true),
  ('public.generate_verification_code()', true),
  ('public.get_invite_code_info(text)', true),
  ('public.get_public_stats()', true),
  ('public.has_active_guilds(uuid)', true),
  ('public.validate_guild_in_cluster(character varying, character varying)', true),
  ('public.validate_guild_not_exists(character varying)', true);

-- An operator may supply an explicit JSON signature manifest for legacy
-- objects not defined by this repository. Capture and review their ACLs and
-- dependencies before applying. No private identifiers belong in this source.
DO $legacy_manifest$
DECLARE
  v_raw text := current_setting('app.legacy_definer_revoke_targets', true);
  v_manifest jsonb;
  v_entry jsonb;
  v_signature text;
BEGIN
  IF nullif(v_raw, '') IS NULL THEN RETURN; END IF;
  v_manifest := v_raw::jsonb;
  IF jsonb_typeof(v_manifest) <> 'array' THEN
    RAISE EXCEPTION 'legacy definer manifest must be a JSON array of public signatures';
  END IF;
  FOR v_entry IN SELECT value FROM jsonb_array_elements(v_manifest) LOOP
    IF jsonb_typeof(v_entry) <> 'string' THEN
      RAISE EXCEPTION 'legacy definer manifest entries must be strings';
    END IF;
    v_signature := v_entry #>> '{}';
    IF v_signature NOT LIKE 'public.%' OR to_regprocedure(v_signature) IS NULL THEN
      RAISE EXCEPTION 'legacy definer manifest signature is missing or outside public: %', v_signature;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE p.oid=to_regprocedure(v_signature) AND n.nspname='public') THEN
      RAISE EXCEPTION 'legacy definer manifest signature is outside public: %', v_signature;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM remaining_public_definers f
      WHERE to_regprocedure(f.signature)=to_regprocedure(v_signature)) THEN
      INSERT INTO remaining_public_definers VALUES (v_signature, true);
    END IF;
  END LOOP;
END;
$legacy_manifest$;

DO $revoke$
DECLARE
  v_entry record;
  v_fn regprocedure;
BEGIN
  FOR v_entry IN SELECT * FROM remaining_public_definers LOOP
    v_fn := to_regprocedure(v_entry.signature);
    IF v_fn IS NULL THEN
      IF v_entry.required THEN
        RAISE EXCEPTION 'remaining definer revoke: required signature missing: %', v_entry.signature;
      END IF;
      CONTINUE;
    END IF;
    IF NOT (SELECT prosecdef FROM pg_proc WHERE oid=v_fn) THEN
      RAISE EXCEPTION 'remaining definer revoke: no longer SECURITY DEFINER: %', v_fn;
    END IF;
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', v_fn);
    IF NOT has_function_privilege('anon', v_fn, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', v_fn, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'remaining definer revoke: explicit API grant drift on %', v_fn;
    END IF;
  END LOOP;
END;
$revoke$;

DO $verify$
DECLARE
  v_bad text;
BEGIN
  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.oid::regprocedure::text)
  INTO v_bad
  FROM remaining_public_definers f JOIN pg_proc p ON p.oid=to_regprocedure(f.signature),
    LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  WHERE a.grantee=0 AND a.privilege_type='EXECUTE';
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'remaining definer revoke: PUBLIC still executes %', v_bad;
  END IF;

  -- A drifted policy must not silently lose its helper. The reviewed
  -- dependencies target authenticated, which keeps its explicit grant.
  SELECT string_agg(pol.polname || ':' || f.signature || ':' || r::text, ', ')
  INTO v_bad
  FROM remaining_public_definers f
  JOIN pg_depend d ON d.refclassid='pg_proc'::regclass AND d.refobjid=to_regprocedure(f.signature)
    AND d.classid='pg_policy'::regclass
  JOIN pg_policy pol ON pol.oid=d.objid
  CROSS JOIN LATERAL unnest(pol.polroles) r
  WHERE CASE WHEN r=0 THEN true
    ELSE NOT has_function_privilege(r, to_regprocedure(f.signature), 'EXECUTE') END;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'remaining definer revoke: policy role would lose execution: %', v_bad;
  END IF;

  SELECT string_agg(r.rolname || ':' || f.signature, ', ' ORDER BY r.rolname, f.signature)
  INTO v_bad
  FROM pg_roles r CROSS JOIN remaining_public_definers f
  WHERE r.rolcanlogin AND NOT r.rolsuper
    AND has_database_privilege(r.oid, current_database(), 'CONNECT')
    AND to_regprocedure(f.signature) IS NOT NULL
    AND NOT pg_has_role(r.oid, 'anon', 'USAGE')
    AND NOT pg_has_role(r.oid, 'authenticated', 'USAGE')
    AND NOT pg_has_role(r.oid, 'service_role', 'USAGE')
    AND has_function_privilege(r.oid, to_regprocedure(f.signature), 'EXECUTE');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'remaining definer revoke: unexpected direct-login execution: %', v_bad;
  END IF;
END;
$verify$;

INSERT INTO supabase_migrations.schema_migrations(version, name, statements)
SELECT '20261007200000', 'revoke_remaining_public_definer_execute',
  array_agg(format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', to_regprocedure(signature)) ORDER BY signature)
FROM remaining_public_definers
ON CONFLICT(version) DO NOTHING;
COMMIT;
NOTIFY pgrst, 'reload schema';
