-- Stop cleanup-incomplete-registrations deleting departed members' player_mapping
-- rows: its predicate (is_current = false, 7+ days old) matched every leaver.
-- target-db: general
-- The new predicate is a strict subset of the old one. No PostgREST role holds EXECUTE.

BEGIN;

DO $guard$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION
      'PS-670 (20260924203000) targets the General database (postgres) only; refusing to run on %',
      current_database();
  END IF;
END;
$guard$;

SET LOCAL lock_timeout = '5s';

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
  v_deleted    bigint;
BEGIN
  IF p_max_rows IS NULL OR p_max_rows < 1 THEN
    RAISE EXCEPTION
      'prune_incomplete_player_registrations: p_max_rows must be >= 1, got %',
      p_max_rows
      USING ERRCODE = '22023';
  END IF;

  v_cutoff := clock_timestamp() - make_interval(days => c_grace_days);

  DELETE FROM public.player_mapping AS victim
   WHERE victim.id IN (
     SELECT candidate.id
       FROM public.player_mapping AS candidate
      -- the old job's predicate, verbatim in meaning (strict-subset anchor)
      WHERE candidate.is_current = false
        AND candidate.created_at IS NOT NULL
        AND candidate.created_at < v_cutoff
        AND candidate.protected IS NOT TRUE
        -- never observed in any roster
        AND candidate.auto_generated IS NOT TRUE
        -- never claimed, never credentialed, never linked
        AND candidate.user_id IS NULL
        AND candidate.ownership_attestation_id IS NULL
        AND candidate.discord_user_id IS NULL
        AND candidate.discord_username IS NULL
        AND candidate.username IS NULL
        AND candidate.tacticus_api_key_encrypted IS NULL
        AND candidate.tacticus_share_url IS NULL
        -- TA-only identity / officer-authored columns
        AND candidate.patreon_user_id IS NULL
        AND candidate.is_app_admin IS NOT TRUE
        AND candidate.assigned_by IS NULL
        AND candidate.officer_notes IS NULL
        AND candidate.player_notes IS NULL
        -- carries no display identity worth preserving
        AND (
          candidate.display_name IS NULL
          OR btrim(candidate.display_name) = ''
          OR candidate.display_name = candidate.player_id
          OR candidate.display_name ~ '^Player#[0-9A-Fa-f]{1,12}$'
          OR candidate.display_name ~ '^Player-[0-9A-Za-z_-]{1,32}$'
        )
        -- erasure tombstones are deliberate state. The IS NULL arm is
        -- load-bearing: NULL NOT LIKE '...' is NULL, not TRUE.
        AND (
          candidate.display_name IS NULL
          OR candidate.display_name NOT LIKE '[DELETED\_USER\_%'
        )
        -- anchors no raid history: keeps a departed name off Player#
        AND NOT EXISTS (
          SELECT 1
            FROM public."EOT_GR_data" AS raid
           WHERE raid."userId" = candidate.player_id
        )
        -- never attested: attestations survive erasure of the claim columns
        -- (same evidence cleanup_orphaned_guilds relies on, PS-669)
        AND NOT EXISTS (
          SELECT 1
            FROM public.player_identity_attestations AS pia
           WHERE pia.mapping_id = candidate.id
              OR pia.player_id = candidate.player_id
        )
      ORDER BY candidate.id
      LIMIT p_max_rows
   );
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN format(
    'prune_incomplete_player_registrations: deleted=%s cutoff=%s max_rows=%s',
    v_deleted, v_cutoff, p_max_rows
  );
END;
$fn$;

ALTER FUNCTION public.prune_incomplete_player_registrations(integer) OWNER TO postgres;

COMMENT ON FUNCTION public.prune_incomplete_player_registrations(integer) IS
  'PS-670 (general). Deletes ABANDONED player_mapping registration stubs only: '
  'is_current = false rows older than 7 days that were never observed in a '
  'roster, never claimed/credentialed, carry only a placeholder display_name and '
  'anchor no "EOT_GR_data" history. Departed members are retained. Called by '
  'pg_cron job cleanup-incomplete-registrations; no PostgREST role holds EXECUTE.';

REVOKE ALL ON FUNCTION public.prune_incomplete_player_registrations(integer) FROM PUBLIC;

DO $revoke$
DECLARE
  v_role text;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
      EXECUTE format(
        'REVOKE ALL ON FUNCTION public.prune_incomplete_player_registrations(integer) FROM %I',
        v_role);
    END IF;
  END LOOP;
END;
$revoke$;

-- alter_job in place keeps the jobid and run history.

DO $cron$
DECLARE
  v_jobid bigint;
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE NOTICE
      'PS-670: pg_cron is not installed on database % -- function created, job NOT repointed. Expected on the pgTAP replay lane only.',
      current_database();
    RETURN;
  END IF;

  SELECT jobid INTO v_jobid
    FROM cron.job
   WHERE jobname = 'cleanup-incomplete-registrations'
     AND database = 'postgres';

  IF v_jobid IS NULL THEN
    RAISE NOTICE 'PS-670: no cleanup-incomplete-registrations job on postgres; nothing to repoint';
    RETURN;
  END IF;

  PERFORM cron.alter_job(
    job_id   := v_jobid,
    schedule := '0 */4 * * *',
    command  := 'SELECT public.prune_incomplete_player_registrations();',
    database := 'postgres',
    active   := true
  );

  RAISE NOTICE 'PS-670: repointed cleanup-incomplete-registrations (jobid %)', v_jobid;
END;
$cron$;

DO $verify$
DECLARE
  v_fn   oid;
  v_role text;
BEGIN
  v_fn := to_regprocedure('public.prune_incomplete_player_registrations(integer)');
  IF v_fn IS NULL THEN
    RAISE EXCEPTION 'PS-670 verify: function missing on %', current_database();
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_fn AND p.prosecdef) THEN
    RAISE EXCEPTION 'PS-670 verify: function is SECURITY DEFINER; must be INVOKER';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
     WHERE p.oid = v_fn
       AND p.prosrc LIKE '%candidate.is_current = false%'
       AND p.prosrc LIKE '%auto_generated IS NOT TRUE%'
       AND p.prosrc LIKE '%candidate.user_id IS NULL%'
       AND p.prosrc LIKE '%patreon_user_id IS NULL%'
       AND p.prosrc LIKE '%EOT_GR_data%'
       AND p.prosrc LIKE '%player_identity_attestations%'
       AND position('DELETED\_USER\_' in p.prosrc) > 0
  ) THEN
    RAISE EXCEPTION 'PS-670 verify: installed body is missing a retention clause';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_fn AND p.proacl IS NULL) THEN
    RAISE EXCEPTION 'PS-670 verify: proacl IS NULL -- PUBLIC still holds default EXECUTE';
  END IF;

  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role)
       AND has_function_privilege(v_role, v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'PS-670 verify: % still holds EXECUTE', v_role;
    END IF;
  END LOOP;

  IF to_regclass('cron.job') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM cron.job
       WHERE command ~* 'DELETE\s+FROM\s+(public\.)?player_mapping\M.*is_current\s*=\s*false'
    ) THEN
      RAISE EXCEPTION 'PS-670 verify: a cron job still carries the blanket is_current=false DELETE';
    END IF;
  END IF;

  RAISE NOTICE 'PS-670 verify: OK on %', current_database();
END;
$verify$;

NOTIFY pgrst, 'reload schema';

COMMIT;
