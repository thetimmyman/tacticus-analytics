-- Rollback of 20261007120000: re-opens anon EXECUTE on the six claim-trusting
-- SECURITY DEFINER functions; use only for a confirmed regression on a
-- logged-out path. PUBLIC is deliberately not restored: that grant is what let
-- direct login roles set request.jwt.claims and act as any user.
-- target-db: general

BEGIN;

DO $guard$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION
      'This rollback targets the General database (postgres); refusing to run on %',
      current_database();
  END IF;
END;
$guard$;

GRANT EXECUTE ON FUNCTION public.update_player_boss_assignments_admin(text, text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.update_player_boss_preferences_admin(text, jsonb) TO anon;
GRANT EXECUTE ON FUNCTION public.update_player_meta_teams_admin(text, text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.update_player_notes_admin(text, text, text) TO anon;

DO $application_messages$
DECLARE
  v_signature text;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.send_application_message(uuid, text, text, text)',
    'public.mark_application_messages_read(uuid, text)'
  ] LOOP
    CONTINUE WHEN to_regprocedure(v_signature) IS NULL;
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon', to_regprocedure(v_signature));
  END LOOP;
END;
$application_messages$;

COMMIT;

NOTIFY pgrst, 'reload schema';
