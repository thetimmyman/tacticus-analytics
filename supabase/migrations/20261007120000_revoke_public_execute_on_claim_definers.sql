-- Revoke PUBLIC/anon EXECUTE on six SECURITY DEFINER functions whose caller is
-- auth.uid(), read from request.jwt.claims: a direct login can SET those
-- claims itself, so PUBLIC lets any role with CONNECT act as any officer.
-- authenticated and service_role keep EXECUTE.
-- target-db: general
-- Rollback: supabase/snippets/20261007120000_rollback_revoke_public_execute_on_claim_definers.sql

BEGIN;

DO $guard$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION
      'This migration targets the General database (postgres); refusing to run on %',
      current_database();
  END IF;
END;
$guard$;

SET LOCAL lock_timeout = '5s';

-- to_regprocedure pins each signature, so a drifted overload fails loudly.
DO $preflight$
DECLARE
  v_signature text;
  v_missing text[] := ARRAY[]::text[];
  v_not_definer text[] := ARRAY[]::text[];
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.update_player_boss_assignments_admin(text, text, text, text)',
    'public.update_player_boss_preferences_admin(text, jsonb)',
    'public.update_player_meta_teams_admin(text, text, text, text)',
    'public.update_player_notes_admin(text, text, text)',
    'public.send_application_message(uuid, text, text, text)',
    'public.mark_application_messages_read(uuid, text)'
  ] LOOP
    IF to_regprocedure(v_signature) IS NULL THEN
      IF v_signature NOT LIKE 'public.%application_message%' THEN
        v_missing := v_missing || v_signature;
      END IF;
    ELSIF NOT EXISTS (
      SELECT 1 FROM pg_proc WHERE oid = to_regprocedure(v_signature) AND prosecdef
    ) THEN
      v_not_definer := v_not_definer || v_signature;
    END IF;
  END LOOP;

  IF array_length(v_missing, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'claim definer revoke: these functions do not exist on this database: %',
      array_to_string(v_missing, ', ');
  END IF;
  IF array_length(v_not_definer, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'claim definer revoke: no longer SECURITY DEFINER, so this migration is reasoning about something else: %',
      array_to_string(v_not_definer, ', ');
  END IF;
END;
$preflight$;

-- PUBLIC always goes with anon: anon inherits PUBLIC.
REVOKE EXECUTE ON FUNCTION public.update_player_boss_assignments_admin(text, text, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.update_player_boss_preferences_admin(text, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.update_player_meta_teams_admin(text, text, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.update_player_notes_admin(text, text, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.update_player_boss_assignments_admin(text, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_player_boss_preferences_admin(text, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_player_meta_teams_admin(text, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_player_notes_admin(text, text, text) TO authenticated, service_role;

-- No migration here creates these two, so a replayed database lacks them.
DO $application_messages$
DECLARE
  v_signature text;
  v_revoked text[] := ARRAY[]::text[];
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.send_application_message(uuid, text, text, text)',
    'public.mark_application_messages_read(uuid, text)'
  ] LOOP
    CONTINUE WHEN to_regprocedure(v_signature) IS NULL;
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', to_regprocedure(v_signature));
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', to_regprocedure(v_signature));
    v_revoked := v_revoked || v_signature;
  END LOOP;
  RAISE NOTICE 'claim definer revoke: application message functions revoked: %',
    coalesce(nullif(array_to_string(v_revoked, ', '), ''), 'none present');
END;
$application_messages$;

-- No PUBLIC entry, and no login role reaches EXECUTE except a superuser or one
-- that inherits authenticated or service_role.
DO $verify$
DECLARE
  v_fn regprocedure;
  v_public text[] := ARRAY[]::text[];
  v_anon text[] := ARRAY[]::text[];
  v_locked_out text[] := ARRAY[]::text[];
  v_login_reach text[];
BEGIN
  FOR v_fn IN
    SELECT to_regprocedure(s)
      FROM unnest(ARRAY[
        'public.update_player_boss_assignments_admin(text, text, text, text)',
        'public.update_player_boss_preferences_admin(text, jsonb)',
        'public.update_player_meta_teams_admin(text, text, text, text)',
        'public.update_player_notes_admin(text, text, text)',
        'public.send_application_message(uuid, text, text, text)',
        'public.mark_application_messages_read(uuid, text)'
      ]) AS s
     WHERE to_regprocedure(s) IS NOT NULL
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
       WHERE p.oid = v_fn AND a.grantee = 0 AND a.privilege_type = 'EXECUTE'
    ) OR (SELECT proacl IS NULL FROM pg_proc WHERE oid = v_fn) THEN
      v_public := v_public || v_fn::text;
    END IF;
    IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN
      v_anon := v_anon || v_fn::text;
    END IF;
    IF NOT has_function_privilege('authenticated', v_fn, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      v_locked_out := v_locked_out || v_fn::text;
    END IF;
  END LOOP;

  SELECT coalesce(array_agg(DISTINCT r.rolname || ':' || f.fn::text ORDER BY r.rolname || ':' || f.fn::text), ARRAY[]::text[])
    INTO v_login_reach
    FROM pg_roles r
    CROSS JOIN LATERAL (
      SELECT to_regprocedure(s) AS fn
        FROM unnest(ARRAY[
          'public.update_player_boss_assignments_admin(text, text, text, text)',
          'public.update_player_boss_preferences_admin(text, jsonb)',
          'public.update_player_meta_teams_admin(text, text, text, text)',
          'public.update_player_notes_admin(text, text, text)',
          'public.send_application_message(uuid, text, text, text)',
          'public.mark_application_messages_read(uuid, text)'
        ]) AS s
       WHERE to_regprocedure(s) IS NOT NULL
    ) f
   WHERE r.rolcanlogin
     AND NOT r.rolsuper
     AND NOT pg_has_role(r.oid, 'authenticated', 'USAGE')
     AND NOT pg_has_role(r.oid, 'service_role', 'USAGE')
     AND has_function_privilege(r.oid, f.fn, 'EXECUTE');

  IF array_length(v_public, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'claim definer revoke verify: PUBLIC still holds EXECUTE on %', array_to_string(v_public, ', ');
  END IF;
  IF array_length(v_anon, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'claim definer revoke verify: anon still holds EXECUTE on %', array_to_string(v_anon, ', ');
  END IF;
  IF array_length(v_locked_out, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'claim definer revoke verify: authenticated or service_role lost EXECUTE on %', array_to_string(v_locked_out, ', ');
  END IF;
  IF array_length(v_login_reach, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'claim definer revoke verify: a direct login role still reaches %', array_to_string(v_login_reach, ', ');
  END IF;
END;
$verify$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20261007120000', 'revoke_public_execute_on_claim_definers')
ON CONFLICT (version) DO NOTHING;

COMMIT;

NOTIFY pgrst, 'reload schema';
