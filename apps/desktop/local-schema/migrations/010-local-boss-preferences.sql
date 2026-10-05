-- Owner boss choices are local preferences, not verified game-account claims.
CREATE FUNCTION public.desktop_validate_boss_preferences() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $preferences$
DECLARE choice record;
BEGIN
 IF NEW.boss_preferences IS NOT DISTINCT FROM OLD.boss_preferences THEN RETURN NEW; END IF;
 IF NEW.boss_preferences IS NULL OR jsonb_typeof(NEW.boss_preferences) <> 'object' OR
    octet_length(NEW.boss_preferences::text) > 16384
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invalid local boss preferences'; END IF;
 FOR choice IN SELECT key,value FROM jsonb_each(NEW.boss_preferences) LOOP
  IF choice.value NOT IN ('"preferred"'::jsonb,'"avoid"'::jsonb) OR
    NOT EXISTS(SELECT 1 FROM public.boss_mapping b WHERE
      choice.key='main_'||b.boss_type OR
      choice.key=CASE WHEN b.encounter_index>0 THEN 'side_' ELSE 'main_' END||b.boss_name)
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invalid local boss preference choice'; END IF;
 END LOOP;
 NEW.preferences_updated_at=statement_timestamp();
 RETURN NEW;
END $preferences$;
REVOKE ALL ON FUNCTION public.desktop_validate_boss_preferences() FROM PUBLIC,anon,authenticated,service_role,desktop_rpc_reader;
CREATE TRIGGER desktop_boss_preferences_write BEFORE UPDATE OF boss_preferences ON public.player_mapping
 FOR EACH ROW EXECUTE FUNCTION public.desktop_validate_boss_preferences();
GRANT UPDATE(boss_preferences) ON public.current_user_player_mapping TO authenticated;
