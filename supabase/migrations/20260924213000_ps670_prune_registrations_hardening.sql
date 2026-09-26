-- The prune now SELECTs FOR UPDATE SKIP LOCKED, then DELETEs re-checking
-- eligibility: IN (...) let EvalPlanQual re-check only id.
-- target-db: general
-- Eligibility (one helper, NULL fails closed) also requires is_active, no sync data
-- and no referencing row: auto_generated = false does not prove it was never rostered.

BEGIN;

DO $guard$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION
      'PS-670 hardening (20260924213000) targets the General database (postgres) only; refusing to run on %',
      current_database();
  END IF;
END;
$guard$;

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.player_mapping_is_abandoned_registration_stub(
  p_row public.player_mapping,
  p_cutoff timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  -- Anchor: the previous job's `is_current = false`, verbatim (strict-subset
  -- anchor), and past the grace window.
  IF (p_row.is_current = false
      AND p_row.created_at IS NOT NULL
      AND p_cutoff IS NOT NULL
      AND p_row.created_at < p_cutoff
      AND p_row.protected IS NOT TRUE) IS NOT TRUE THEN
    RETURN false;
  END IF;

  -- Never observed in a roster, never departed. is_active = false is the
  -- deactivate_player_mappings() fingerprint of a member who LEFT.
  IF (p_row.auto_generated IS NOT TRUE
      AND p_row.is_active IS NOT FALSE) IS NOT TRUE THEN
    RETURN false;
  END IF;

  -- Never claimed, credentialed, linked, promoted or annotated.
  IF (p_row.user_id IS NULL
      AND p_row.ownership_attestation_id IS NULL
      AND p_row.discord_user_id IS NULL
      AND p_row.discord_username IS NULL
      AND p_row.username IS NULL
      AND p_row.tacticus_api_key_encrypted IS NULL
      AND p_row.tacticus_share_url IS NULL
      AND p_row.patreon_user_id IS NULL
      AND p_row.is_app_admin IS NOT TRUE
      AND coalesce(p_row.role::text, 'member') = 'member'
      AND p_row.assigned_by IS NULL
      AND p_row.assigned_at IS NULL
      AND p_row.officer_notes IS NULL
      AND p_row.player_notes IS NULL
      AND p_row.assignment_notes IS NULL) IS NOT TRUE THEN
    RETURN false;
  END IF;

  -- No sync / game data ever written onto the row.
  IF (p_row.last_sync_at IS NULL
      AND p_row.last_sync_tokens IS NULL
      AND p_row.last_sync_bombs IS NULL
      AND p_row.next_token_seconds IS NULL
      AND p_row.next_bomb_seconds IS NULL
      AND p_row.player_level IS NULL
      AND p_row.player_power IS NULL
      AND p_row.last_battle_time IS NULL
      AND p_row.last_active_at IS NULL
      AND p_row.avatar_unit_id IS NULL
      AND p_row.avatar_url IS NULL
      AND p_row.api_key_added_at IS NULL
      AND p_row.api_key_last_verified IS NULL
      AND p_row.last_api_key_failure_at IS NULL
      AND p_row.primary_boss IS NULL
      AND p_row.secondary_boss IS NULL
      AND p_row.primary_team IS NULL
      AND p_row.secondary_team IS NULL
      AND p_row.tertiary_team IS NULL
      AND p_row.original_display_name IS NULL
      AND p_row.has_duplicate_name IS NOT TRUE) IS NOT TRUE THEN
    RETURN false;
  END IF;

  -- Only a placeholder name. The IS NULL arm of the tombstone clause is
  -- load-bearing: NULL NOT LIKE '...' is NULL, not TRUE.
  IF ((p_row.display_name IS NULL
       OR btrim(p_row.display_name) = ''
       OR p_row.display_name = p_row.player_id
       OR p_row.display_name ~ '^Player#[0-9A-Fa-f]{1,12}$'
       OR p_row.display_name ~ '^Player-[0-9A-Za-z_-]{1,32}$')
      AND (p_row.display_name IS NULL
           OR p_row.display_name NOT LIKE '[DELETED\_USER\_%')) IS NOT TRUE THEN
    RETURN false;
  END IF;

  -- Referenced nowhere. player_roster first: it is the ON DELETE CASCADE
  -- target, i.e. exactly the rows a delete would destroy.
  RETURN NOT EXISTS (SELECT 1 FROM public.player_roster AS r
                      WHERE r.player_mapping_id = p_row.id)
     AND NOT EXISTS (SELECT 1 FROM public."EOT_GR_data" AS raid
                      WHERE raid."userId" = p_row.player_id)
     AND NOT EXISTS (SELECT 1 FROM public.player_identity_attestations AS pia
                      WHERE pia.mapping_id = p_row.id
                         OR pia.player_id = p_row.player_id)
     AND NOT EXISTS (SELECT 1 FROM public.player_identity_quarantine_pii AS q
                      WHERE q.mapping_id = p_row.id
                         OR q.player_id = p_row.player_id)
     AND NOT EXISTS (SELECT 1 FROM public.bomb_tracking AS e
                      WHERE e.player_id = p_row.player_id)
     AND NOT EXISTS (SELECT 1 FROM public.guild_war_player_attempts AS e
                      WHERE e.player_id = p_row.player_id)
     AND NOT EXISTS (SELECT 1 FROM public.upcoming_season_assignments AS e
                      WHERE e.player_id = p_row.player_id)
     AND NOT EXISTS (SELECT 1 FROM public.player_claim_audit AS e
                      WHERE e.player_id = p_row.player_id)
     AND NOT EXISTS (SELECT 1 FROM public.player_invite_codes AS e
                      WHERE e.player_id = p_row.player_id)
     AND NOT EXISTS (SELECT 1 FROM public.token_burn_state AS e
                      WHERE e.player_id = p_row.player_id)
     AND NOT EXISTS (SELECT 1 FROM public.token_audit_snapshots AS e
                      WHERE e.player_id = p_row.player_id)
     AND NOT EXISTS (SELECT 1 FROM public.token_notification_events AS e
                      WHERE e.player_id = p_row.player_id)
     AND NOT EXISTS (SELECT 1 FROM public.token_notification_preferences AS e
                      WHERE e.player_id = p_row.player_id)
     AND NOT EXISTS (SELECT 1 FROM public.guild_war_zone_assignment_entries AS e
                      WHERE e.player_id = p_row.player_id)
     AND NOT EXISTS (SELECT 1 FROM public.guild_raid_season_plan_assignments AS e
                      WHERE e.player_id = p_row.player_id)
     AND NOT EXISTS (SELECT 1 FROM public.guild_raid_season_plan_sessions AS e
                      WHERE e.player_id = p_row.player_id)
     AND NOT EXISTS (SELECT 1 FROM public.role_reconciliation_events AS e
                      WHERE e.player_id = p_row.player_id)
     AND NOT EXISTS (SELECT 1 FROM public.guild_membership_move_permits AS e
                      WHERE e.player_id = p_row.player_id);
END;
$fn$;

ALTER FUNCTION public.player_mapping_is_abandoned_registration_stub(public.player_mapping, timestamptz)
  OWNER TO postgres;

COMMENT ON FUNCTION public.player_mapping_is_abandoned_registration_stub(public.player_mapping, timestamptz) IS
  'PS-670. The single eligibility predicate for '
  'prune_incomplete_player_registrations(): true only for a non-current, '
  'never-deactivated, never-claimed player_mapping row older than the cutoff '
  'with a placeholder name, no on-row sync data and no row in player_roster '
  '(the ON DELETE CASCADE target) or any roster/sync evidence table. '
  'NULL-safe: any unknown clause returns false.';

CREATE OR REPLACE FUNCTION public.prune_incomplete_player_registrations(
  p_max_rows integer DEFAULT 500
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
AS $fn$
DECLARE
  c_grace_days CONSTANT integer := 7;
  v_cutoff     timestamptz;
  v_locked     integer[];
  v_deleted    bigint;
BEGIN
  IF p_max_rows IS NULL OR p_max_rows < 1 THEN
    RAISE EXCEPTION
      'prune_incomplete_player_registrations: p_max_rows must be >= 1, got %',
      p_max_rows
      USING ERRCODE = '22023';
  END IF;

  v_cutoff := clock_timestamp() - make_interval(days => c_grace_days);

  -- 1. Lock eligible rows. SKIP LOCKED: never wait on, never take, a row
  --    another transaction is writing. EvalPlanQual re-runs the helper on the
  --    newest version of any row updated since this statement's snapshot.
  SELECT coalesce(array_agg(locked.id ORDER BY locked.id), ARRAY[]::integer[])
    INTO v_locked
    FROM (
      SELECT candidate.id
        FROM public.player_mapping AS candidate
       WHERE candidate.is_current = false
         AND candidate.created_at < v_cutoff
         AND public.player_mapping_is_abandoned_registration_stub(candidate, v_cutoff)
       ORDER BY candidate.id
       LIMIT p_max_rows
         FOR UPDATE OF candidate SKIP LOCKED
    ) AS locked;

  IF cardinality(v_locked) = 0 THEN
    RETURN format(
      'prune_incomplete_player_registrations: deleted=0 cutoff=%s max_rows=%s',
      v_cutoff, p_max_rows
    );
  END IF;

  -- 2. Fresh snapshot, rows held: re-check eligibility on the DELETE's own
  --    quals, so evidence committed before our lock is honoured.
  DELETE FROM public.player_mapping AS victim
   WHERE victim.id = ANY(v_locked)
     AND public.player_mapping_is_abandoned_registration_stub(victim, v_cutoff);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN format(
    'prune_incomplete_player_registrations: deleted=%s locked=%s cutoff=%s max_rows=%s',
    v_deleted, cardinality(v_locked), v_cutoff, p_max_rows
  );
END;
$fn$;

ALTER FUNCTION public.prune_incomplete_player_registrations(integer) OWNER TO postgres;

COMMENT ON FUNCTION public.prune_incomplete_player_registrations(integer) IS
  'PS-670. Deletes ABANDONED player_mapping registration stubs only, as '
  'defined by player_mapping_is_abandoned_registration_stub(). Locks '
  'candidates FOR UPDATE SKIP LOCKED, then re-checks eligibility in the '
  'DELETE under a fresh snapshot, so a row a roster sync is writing or has '
  'just re-activated is never deleted. Departed members (is_current = false, '
  'is_active = false) are retained. Called by pg_cron job '
  'cleanup-incomplete-registrations; no PostgREST role holds EXECUTE.';

REVOKE ALL ON FUNCTION public.player_mapping_is_abandoned_registration_stub(public.player_mapping, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prune_incomplete_player_registrations(integer) FROM PUBLIC;

DO $revoke$
DECLARE
  v_role text;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
      EXECUTE format(
        'REVOKE ALL ON FUNCTION public.player_mapping_is_abandoned_registration_stub(public.player_mapping, timestamptz) FROM %I',
        v_role);
      EXECUTE format(
        'REVOKE ALL ON FUNCTION public.prune_incomplete_player_registrations(integer) FROM %I',
        v_role);
    END IF;
  END LOOP;
END;
$revoke$;

DO $verify$
DECLARE
  v_prune  oid := to_regprocedure('public.prune_incomplete_player_registrations(integer)');
  v_helper oid := to_regprocedure('public.player_mapping_is_abandoned_registration_stub(public.player_mapping,timestamp with time zone)');
  v_fn     oid;
  v_role   text;
BEGIN
  IF v_prune IS NULL OR v_helper IS NULL THEN
    RAISE EXCEPTION 'PS-670 hardening verify: a function is missing on %', current_database();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
     WHERE p.oid = v_prune
       AND p.prosrc LIKE '%SKIP LOCKED%'
       AND p.prosrc LIKE '%victim.id = ANY(v_locked)%'
       AND p.prosrc LIKE '%player_mapping_is_abandoned_registration_stub(victim%'
  ) THEN
    RAISE EXCEPTION 'PS-670 hardening verify: prune body lacks the lock/re-check shape';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
     WHERE p.oid = v_helper
       AND p.prosrc LIKE '%public.player_roster AS r%'
       AND p.prosrc LIKE '%is_active IS NOT FALSE%'
       AND p.prosrc LIKE '%auto_generated IS NOT TRUE%'
       AND p.prosrc LIKE '%EOT_GR_data%'
       AND p.prosrc LIKE '%player_identity_attestations%'
       AND p.prosrc LIKE '%guild_membership_move_permits%'
       AND p.prosrc LIKE '%is_current = false%'
       AND position('DELETED\_USER\_' in p.prosrc) > 0
  ) THEN
    RAISE EXCEPTION 'PS-670 hardening verify: helper is missing a retention clause';
  END IF;

  FOREACH v_fn IN ARRAY ARRAY[v_prune, v_helper] LOOP
    IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_fn AND (p.prosecdef OR p.proacl IS NULL)) THEN
      RAISE EXCEPTION 'PS-670 hardening verify: % is SECURITY DEFINER or still has default (PUBLIC) EXECUTE', v_fn::regprocedure;
    END IF;
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role)
         AND has_function_privilege(v_role, v_fn, 'EXECUTE') THEN
        RAISE EXCEPTION 'PS-670 hardening verify: % holds EXECUTE on %', v_role, v_fn::regprocedure;
      END IF;
    END LOOP;
    IF NOT has_function_privilege('postgres', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'PS-670 hardening verify: postgres lost EXECUTE on %', v_fn::regprocedure;
    END IF;
  END LOOP;

  RAISE NOTICE 'PS-670 hardening verify: OK on %', current_database();
END;
$verify$;

NOTIFY pgrst, 'reload schema';

COMMIT;
