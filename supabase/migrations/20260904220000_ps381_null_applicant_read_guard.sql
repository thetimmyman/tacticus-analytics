-- get_application_with_messages denied nothing when applicant_user_id was NULL:
-- the deny branch's IF evaluated NULL and was skipped.
-- target-db: general
-- IS NULL OR IS DISTINCT FROM auth.uid() keeps v_is_applicant two-valued; a bare
-- IS DISTINCT FROM treats two NULLs as equal.

BEGIN;

DO $guard$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'PS-381 requires database postgres, got %', current_database();
  END IF;
END;
$guard$;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Stop rather than recreate a retired surface or overwrite a drifted body.
DO $pre$
DECLARE
  v_src text;
BEGIN
  IF to_regprocedure('public.get_application_with_messages(uuid)') IS NULL THEN
    RAISE EXCEPTION
      'PS-381: public.get_application_with_messages(uuid) is absent; this migration repairs an existing function and will not invent one';
  END IF;

  IF NOT (SELECT prosecdef FROM pg_catalog.pg_proc
           WHERE oid = to_regprocedure('public.get_application_with_messages(uuid)')) THEN
    RAISE EXCEPTION
      'PS-381: public.get_application_with_messages is no longer SECURITY DEFINER; the body below assumes definer rights and re-installing it as an invoker-rights function would change who it can read';
  END IF;

  SELECT p.prosrc INTO v_src
    FROM pg_catalog.pg_proc p
   WHERE p.oid = to_regprocedure('public.get_application_with_messages(uuid)');

  -- Two bodies are acceptable and a third is not.
  --
  --   the measured pre-state           -> repair it (the ordinary path)
  --   this migration's own output      -> re-install it unchanged, so a second
  --                                       ladder run or a replay is a no-op
  --                                       rather than a hard failure
  --   anything else                    -> STOP. Somebody rewrote this function
  --                                       after 2026-09-06 and overwriting it
  --                                       with a body reviewed against the old
  --                                       one would silently revert their work.
  IF v_src ~ 'v_is_applicant\s*:=\s*NOT\s*\('
     AND v_src ~ 'applicant_user_id\s+IS\s+DISTINCT\s+FROM\s+auth\.uid\(\)' THEN
    RAISE NOTICE
      'PS-381: the deployed body already carries the repair; re-installing it unchanged';
  ELSIF v_src !~ 'v_is_applicant\s*:=\s*v_app_record\.applicant_user_id\s*=\s*auth\.uid\(\)' THEN
    RAISE EXCEPTION
      'PS-381: the deployed body is neither the measured pre-state nor this migration''s own output; re-read the live definition before applying, rather than overwriting an unreviewed body';
  END IF;

  IF to_regclass('public.universal_guild_applications') IS NULL THEN
    RAISE EXCEPTION
      'PS-381: public.universal_guild_applications is absent; the function this migration installs reads it';
  END IF;

  IF to_regclass('public.application_messages') IS NULL THEN
    RAISE EXCEPTION
      'PS-381: public.application_messages is absent; the function this migration installs reads it';
  END IF;
END;
$pre$;

-- Snapshot the ACL so verify can prove no grant moved.
CREATE TEMP TABLE ps381_acl_before ON COMMIT DROP AS
SELECT a.grantee, a.privilege_type
  FROM pg_catalog.pg_proc p,
       LATERAL aclexplode(coalesce(
         p.proacl,
         acldefault('f', p.proowner)
       )) AS a
 WHERE p.oid = to_regprocedure('public.get_application_with_messages(uuid)');

-- Only the v_is_applicant assignment differs from the deployed body.
CREATE OR REPLACE FUNCTION public.get_application_with_messages(p_application_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
    v_result JSON;
    v_app_record RECORD;
    v_is_applicant BOOLEAN;
    v_is_guild_officer BOOLEAN;
BEGIN
    SELECT * INTO v_app_record
    FROM universal_guild_applications
    WHERE id = p_application_id;

    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    -- Check permissions.
    --
    -- PS-381: two-valued on purpose. `applicant_user_id = auth.uid()` is NULL
    -- whenever either side is NULL, and a NULL v_is_applicant makes the deny
    -- IF below evaluate to NULL for a non-officer caller, which PL/pgSQL
    -- treats as false -- so the deny branch, and the app-admin fallback nested
    -- inside it, are skipped and the whole application plus its messages are
    -- returned. Every application row on this database has a NULL
    -- applicant_user_id. Both disjuncts are required: IS DISTINCT FROM alone
    -- treats two NULLs as equal, which would authorise a logged-out caller
    -- against an unowned row. Same predicate as
    -- mark_application_messages_read and send_application_message.
    v_is_applicant := NOT (
        v_app_record.applicant_user_id IS NULL
        OR v_app_record.applicant_user_id IS DISTINCT FROM auth.uid()
    );
    v_is_guild_officer := EXISTS (
        SELECT 1 FROM player_mapping pm
        WHERE pm.guild_code = v_app_record.guild_code
        AND pm.user_id = auth.uid()
        AND pm.role IN ('leader', 'officer')
    );

    IF NOT v_is_applicant AND NOT v_is_guild_officer THEN
        -- Check if app admin
        IF NOT EXISTS (
            SELECT 1 FROM player_mapping pm
            WHERE pm.user_id = auth.uid()
            AND pm.is_app_admin = TRUE
        ) THEN
            RETURN NULL;
        END IF;
    END IF;

    SELECT json_build_object(
        'application', row_to_json(v_app_record),
        'messages', COALESCE(
            (SELECT json_agg(row_to_json(m) ORDER BY m.created_at ASC)
             FROM application_messages m
             WHERE m.application_id = p_application_id),
            '[]'::json
        ),
        'viewer_type', CASE
            WHEN v_is_applicant THEN 'applicant'
            ELSE 'guild'
        END
    ) INTO v_result;

    RETURN v_result;
END;
$function$;

COMMENT ON FUNCTION public.get_application_with_messages(uuid) IS
  'PS-381 (2026-09-06): the applicant check is two-valued. It used to read '
  'v_is_applicant := applicant_user_id = auth.uid(), which is NULL when the '
  'row has no applicant_user_id; NOT NULL AND NOT false is NULL, PL/pgSQL '
  'treats a NULL IF condition as false, and the ONLY deny path in this '
  'function -- together with the app-admin fallback nested inside it -- was '
  'skipped, returning the application row (applicant_name, applicant_email, '
  'applicant_discord, internal_notes, player_stats) and every '
  'application_messages row to any caller. All 79 application rows on this '
  'database have a NULL applicant_user_id. Grants are NOT the fix: PS-285 '
  'revoked EXECUTE from PUBLIC/anon/authenticated and one GRANT would re-open '
  'all 79. Both disjuncts are required -- IS DISTINCT FROM alone treats two '
  'NULLs as equal. Same predicate as mark_application_messages_read and '
  'send_application_message (POS-SEC-10, 20260827181000). Rollback: the '
  'verbatim pre-PS-381 body is in the header of '
  'supabase/migrations/20260904220000_ps381_null_applicant_read_guard.sql.';

-- Both directions: the guard is present and everything else is unchanged.
DO $verify$
DECLARE
  v_src   text;
  v_def   text;
  v_moved bigint;
BEGIN
  SELECT p.prosrc, pg_get_functiondef(p.oid) INTO v_src, v_def
    FROM pg_catalog.pg_proc p
   WHERE p.oid = to_regprocedure('public.get_application_with_messages(uuid)');

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'PS-381: the function is gone after the replace';
  END IF;

  -- POSITIVE presence of the adopted form. Asserting the ABSENCE of the old
  -- spelling would pass against any equally-broken rewrite.
  IF v_src !~ 'applicant_user_id\s+IS\s+NULL' THEN
    RAISE EXCEPTION 'PS-381: the NULL disjunct is missing from the repaired body';
  END IF;
  IF v_src !~ 'applicant_user_id\s+IS\s+DISTINCT\s+FROM\s+auth\.uid\(\)' THEN
    RAISE EXCEPTION 'PS-381: the NULL-safe comparison is missing from the repaired body';
  END IF;

  -- ... and the absence of the laundering assignment, so a partially-applied
  -- edit that left both spellings in place cannot pass.
  IF v_src ~ 'v_is_applicant\s*:=\s*v_app_record\.applicant_user_id\s*=\s*auth\.uid\(\)' THEN
    RAISE EXCEPTION 'PS-381: the NULL-laundering assignment is still in the body';
  END IF;

  -- Not a lockout, and not a rewrite of anything else.
  IF v_src !~ 'is_app_admin' THEN
    RAISE EXCEPTION 'PS-381: the app-admin fallback is missing; this migration is not allowed to remove it';
  END IF;
  IF v_src !~ 'leader' OR v_src !~ 'officer' THEN
    RAISE EXCEPTION 'PS-381: the guild-officer branch is missing; this migration is not allowed to remove it';
  END IF;
  IF v_src !~ 'application_messages' THEN
    RAISE EXCEPTION 'PS-381: the message aggregation is missing from the repaired body';
  END IF;

  IF NOT (SELECT prosecdef FROM pg_catalog.pg_proc
           WHERE oid = to_regprocedure('public.get_application_with_messages(uuid)')) THEN
    RAISE EXCEPTION 'PS-381: the replaced function is not SECURITY DEFINER';
  END IF;
  IF v_def !~ 'SET search_path' THEN
    RAISE EXCEPTION 'PS-381: the replaced function lost its pinned search_path';
  END IF;

  -- The ACL, both directions: nothing gained, nothing lost.
  SELECT count(*) INTO v_moved
    FROM (
      (SELECT grantee, privilege_type FROM ps381_acl_before
       EXCEPT
       SELECT a.grantee, a.privilege_type
         FROM pg_catalog.pg_proc p,
              LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) AS a
        WHERE p.oid = to_regprocedure('public.get_application_with_messages(uuid)'))
      UNION ALL
      (SELECT a.grantee, a.privilege_type
         FROM pg_catalog.pg_proc p,
              LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) AS a
        WHERE p.oid = to_regprocedure('public.get_application_with_messages(uuid)')
       EXCEPT
       SELECT grantee, privilege_type FROM ps381_acl_before)
    ) AS delta;
  IF v_moved <> 0 THEN
    RAISE EXCEPTION
      'PS-381: the function ACL changed by % entr(y/ies); this migration replaces a body and is not allowed to move a grant',
      v_moved;
  END IF;
END;
$verify$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260904220000', 'ps381_null_applicant_read_guard')
ON CONFLICT (version) DO NOTHING;

NOTIFY pgrst, 'reload schema';

COMMIT;
