-- Resolve erasure player ids and anonymise battle rows in one transaction: across
-- two requests, a claim in between had the new owner's rows tombstoned.
-- target-db: general
-- FOR SHARE on the mapping rows makes a claim (always an UPDATE) wait or go first;
-- re-resolve and tombstone only ids present in both.

BEGIN;

DO $guard$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'PS-670 (20260925040000) is general-database-only. Refusing to apply to %', current_database();
  END IF;
END
$guard$;

DO $prereq$
BEGIN
  IF to_regprocedure('public.subject_erasure_player_ids(uuid)') IS NULL THEN
    RAISE EXCEPTION 'PS-670 (20260925040000) requires public.subject_erasure_player_ids(uuid) (20260925010500)';
  END IF;
END
$prereq$;

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.anonymize_subject_battle_rows(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
SET lock_timeout TO '5s'
AS $function$
DECLARE
  v_resolved  text[];
  v_rows      integer;
  v_tombstone text := '[DELETED_USER_'
    || floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint::text
    || ']';
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'anonymize_subject_battle_rows: subject is required'
      USING ERRCODE = '22004';
  END IF;

  -- 1. First resolution.
  SELECT coalesce(array_agg(DISTINCT ids.player_id), ARRAY[]::text[])
  INTO v_resolved
  FROM public.subject_erasure_player_ids(p_user_id) AS ids;

  IF cardinality(v_resolved) = 0 THEN
    RETURN 0;
  END IF;

  -- 2. Serialise with any claim of these players (claims UPDATE these rows).
  PERFORM 1
  FROM public.player_mapping AS mapping
  WHERE mapping.player_id = ANY (v_resolved)
  ORDER BY mapping.id
  FOR SHARE;

  -- 3. Re-resolve under the locks (new statement, new snapshot) and anonymise
  --    only ids that were eligible both before and after the locks.
  UPDATE public."EOT_GR_data" AS battle
  SET "displayName" = v_tombstone
  WHERE battle."userId" = ANY (v_resolved)
    AND battle."userId" IN (
      SELECT ids.player_id
      FROM public.subject_erasure_player_ids(p_user_id) AS ids
    );
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END
$function$;

ALTER FUNCTION public.anonymize_subject_battle_rows(uuid) OWNER TO postgres;

COMMENT ON FUNCTION public.anonymize_subject_battle_rows(uuid) IS
  'PS-670: tombstones EOT_GR_data.displayName for the subject''s erasure '
  'player ids (subject_erasure_player_ids) atomically -- resolve, row-lock the '
  'players'' mappings against a concurrent claim, re-resolve, update. Returns '
  'rows anonymised. service_role only.';

-- analytics_ro is absent in throwaway lanes, so its REVOKE is conditional.
REVOKE ALL ON FUNCTION public.anonymize_subject_battle_rows(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.anonymize_subject_battle_rows(uuid)
  FROM anon, authenticated;
DO $revoke$
BEGIN
  IF to_regrole('analytics_ro') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.anonymize_subject_battle_rows(uuid) FROM analytics_ro;
  END IF;
END
$revoke$;
GRANT EXECUTE ON FUNCTION public.anonymize_subject_battle_rows(uuid)
  TO service_role;

DO $verify$
DECLARE
  v_fn   oid := to_regprocedure('public.anonymize_subject_battle_rows(uuid)');
  v_role text;
  v_rows integer;
BEGIN
  IF v_fn IS NULL THEN
    RAISE EXCEPTION 'PS-670 verify: anonymize_subject_battle_rows(uuid) missing on %', current_database();
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid = v_fn AND p.prosecdef AND p.provolatile = 'v'
      AND p.proconfig @> ARRAY['search_path=pg_catalog, public']
  ) THEN
    RAISE EXCEPTION 'PS-670 verify: anonymize_subject_battle_rows must be a VOLATILE SECURITY DEFINER with a pinned search_path';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_fn AND p.proacl IS NULL) THEN
    RAISE EXCEPTION 'PS-670 verify: no ACL -- PUBLIC still holds default EXECUTE';
  END IF;
  FOR v_role IN
    SELECT rolname FROM pg_roles
    WHERE rolname IN ('anon', 'authenticated', 'analytics_ro')
  LOOP
    IF has_function_privilege(v_role, v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'PS-670 verify: % holds EXECUTE on anonymize_subject_battle_rows', v_role;
    END IF;
  END LOOP;
  IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'PS-670 verify: service_role lacks EXECUTE on anonymize_subject_battle_rows';
  END IF;
  v_rows := public.anonymize_subject_battle_rows('00000000-0000-0000-0000-000000000000'::uuid);
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'PS-670 verify: a subject with no players anonymised % rows', v_rows;
  END IF;
  RAISE NOTICE 'PS-670 verify: OK -- anonymize_subject_battle_rows installed on %, service_role only', current_database();
END
$verify$;

NOTIFY pgrst, 'reload schema';

COMMIT;
