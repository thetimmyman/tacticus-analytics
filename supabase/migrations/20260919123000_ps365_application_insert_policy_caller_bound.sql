-- Bind universal_guild_applications' INSERT policy to the caller: WITH CHECK true
-- let anyone file an application as anyone.
-- target-db: general
-- WITH CHECK fails on NULL, so the uid comparison also rejects NULL. The table is
-- live-only, so every statement is a no-op when it is absent.

BEGIN;

DO $guard$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION
      'PS-365 (20260919123000) targets the General database (postgres); refusing to run on %',
      current_database();
  END IF;
END
$guard$;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- One DO block with dynamic SQL: CREATE POLICY has no table-existence guard.
DO $ps365$
DECLARE
  v_table               regclass;
  v_old_roles           name[];
  v_old_cmd             text;
  v_old_permissive      text;
  v_old_withcheck       text;
  v_new_roles           name[];
  v_new_cmd             text;
  v_new_permissive      text;
  v_new_withcheck       text;
  v_applicant_col_exists boolean;
  v_anon_has_insert     boolean;
  v_policy_count_before int;
  v_policy_count_after  int;
BEGIN
  v_table := to_regclass('public.universal_guild_applications');

  IF v_table IS NULL THEN
    RAISE NOTICE
      'PS-365: public.universal_guild_applications does not exist on this database; nothing to repair here. This table is live-only -- no migration in this repository creates it (see PS-381, PS-399 for the same fact about its sibling objects) -- so this is a no-op on any database seeded only from this repository''s migrations, and a real repair only on the live General database.';
    RETURN;
  END IF;

  -- -------------------------------------------------------------------------
  -- Preconditions. Every one of these is a reason to STOP rather than to
  -- silently overwrite a policy whose shape no longer matches what PS-365
  -- measured.
  -- -------------------------------------------------------------------------
  SELECT EXISTS (
    SELECT 1 FROM pg_attribute a
     WHERE a.attrelid = v_table
       AND a.attname = 'applicant_user_id'
       AND NOT a.attisdropped
  ) INTO v_applicant_col_exists;

  IF NOT v_applicant_col_exists THEN
    RAISE EXCEPTION
      'PS-365: public.universal_guild_applications.applicant_user_id is absent; this migration repairs a policy keyed on that column and will not invent one';
  END IF;

  -- The safety argument in the WHY section above depends on anon holding no
  -- INSERT grant on this table. If that ever changes, narrowing this policy
  -- to TO authenticated stops covering anon's path and the ticket's "safe
  -- because" no longer holds -- refuse rather than apply blind to a changed
  -- precondition.
  SELECT has_table_privilege('anon', v_table, 'INSERT') INTO v_anon_has_insert;
  IF v_anon_has_insert THEN
    RAISE EXCEPTION
      'PS-365: anon now holds INSERT on public.universal_guild_applications; the safety argument for scoping this policy to TO authenticated no longer holds without addressing anon separately first';
  END IF;

  SELECT p.roles, p.cmd, p.permissive, p.with_check
    INTO v_old_roles, v_old_cmd, v_old_permissive, v_old_withcheck
    FROM pg_policies p
   WHERE p.schemaname = 'public'
     AND p.tablename  = 'universal_guild_applications'
     AND p.policyname = 'Anyone can submit applications';

  IF v_old_cmd IS NULL THEN
    RAISE EXCEPTION
      'PS-365: policy "Anyone can submit applications" is absent on public.universal_guild_applications; this migration repairs an existing policy and will not invent one';
  END IF;

  -- Two bodies are acceptable and a third is not: the measured pre-state
  -- (PERMISSIVE, roles {public}, FOR INSERT, WITH CHECK true), or this
  -- migration's own previously-applied output (an idempotent replay, e.g. a
  -- second ladder run). Anything else means somebody already edited this
  -- policy after PS-365 was filed, and overwriting an unreviewed body with
  -- one written against the old one would silently revert their work.
  -- `IS NOT TRUE`, not `NOT (...)`: a policy with no WITH CHECK clause at all
  -- reports with_check NULL, which makes both disjuncts NULL, and PL/pgSQL
  -- treats a NULL `IF` condition as false -- so a bare `NOT (...)` would fall
  -- through and overwrite exactly the unreviewed policy this guard exists to
  -- refuse. NULL is an unexpected shape and must raise like any other.
  IF (
    (v_old_roles = ARRAY['public']::name[]
     AND v_old_cmd = 'INSERT'
     AND v_old_permissive = 'PERMISSIVE'
     AND v_old_withcheck = 'true')
    OR
    (v_old_roles = ARRAY['authenticated']::name[]
     AND v_old_cmd = 'INSERT'
     AND v_old_permissive = 'PERMISSIVE'
     AND v_old_withcheck = '(applicant_user_id = ( SELECT auth.uid() AS uid))')
  ) IS NOT TRUE THEN
    RAISE EXCEPTION
      'PS-365: policy "Anyone can submit applications" is neither the measured pre-state (PERMISSIVE, roles {public}, WITH CHECK true) nor this migration''s own output; roles=%, cmd=%, permissive=%, with_check=%. Re-read the live definition before applying, rather than overwriting an unreviewed policy.',
      v_old_roles, v_old_cmd, v_old_permissive, v_old_withcheck;
  END IF;

  SELECT count(*) INTO v_policy_count_before
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'universal_guild_applications';

  -- -------------------------------------------------------------------------
  -- The repair. Same policy name, same command, tightened roles and
  -- WITH CHECK.
  -- -------------------------------------------------------------------------
  EXECUTE 'DROP POLICY IF EXISTS "Anyone can submit applications" ON public.universal_guild_applications';
  EXECUTE 'CREATE POLICY "Anyone can submit applications" ON public.universal_guild_applications '
       || 'FOR INSERT TO authenticated '
       || 'WITH CHECK (applicant_user_id = (SELECT auth.uid()))';

  -- -------------------------------------------------------------------------
  -- Verify -- in the same transaction, so a wrong result rolls the whole
  -- file back rather than shipping a receipt for nothing.
  -- -------------------------------------------------------------------------
  SELECT p.roles, p.cmd, p.permissive, p.with_check
    INTO v_new_roles, v_new_cmd, v_new_permissive, v_new_withcheck
    FROM pg_policies p
   WHERE p.schemaname = 'public'
     AND p.tablename  = 'universal_guild_applications'
     AND p.policyname = 'Anyone can submit applications';

  IF v_new_cmd IS DISTINCT FROM 'INSERT' THEN
    RAISE EXCEPTION 'PS-365: verify: policy is not scoped to INSERT after the replace (cmd=%)', v_new_cmd;
  END IF;
  IF v_new_permissive IS DISTINCT FROM 'PERMISSIVE' THEN
    RAISE EXCEPTION 'PS-365: verify: policy is not PERMISSIVE after the replace (permissive=%)', v_new_permissive;
  END IF;
  IF v_new_roles IS DISTINCT FROM ARRAY['authenticated']::name[] THEN
    RAISE EXCEPTION 'PS-365: verify: policy roles are % after the replace, expected {authenticated}', v_new_roles;
  END IF;
  IF v_new_withcheck IS NULL OR v_new_withcheck !~ 'auth\.uid\(\)' THEN
    RAISE EXCEPTION 'PS-365: verify: WITH CHECK does not reference auth.uid() after the replace: %', v_new_withcheck;
  END IF;
  IF v_new_withcheck !~ 'applicant_user_id' THEN
    RAISE EXCEPTION 'PS-365: verify: WITH CHECK does not reference applicant_user_id after the replace: %', v_new_withcheck;
  END IF;
  IF trim(v_new_withcheck) IN ('true', '(true)') THEN
    RAISE EXCEPTION 'PS-365: verify: WITH CHECK is still bare true after the replace';
  END IF;

  SELECT count(*) INTO v_policy_count_after
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'universal_guild_applications';
  IF v_policy_count_after <> v_policy_count_before THEN
    RAISE EXCEPTION
      'PS-365: verify: policy count on the table changed from % to %; this migration replaces exactly one policy and must not add or remove any other',
      v_policy_count_before, v_policy_count_after;
  END IF;

  -- Not a lockout: the ALL policy applicants use to read and manage their
  -- own applications must survive this untouched.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'universal_guild_applications'
       AND policyname = 'Applicants can view and manage their own applications'
  ) THEN
    RAISE EXCEPTION
      'PS-365: verify: "Applicants can view and manage their own applications" is missing after this migration; it must not be touched';
  END IF;

  -- Grants unmoved. A policy edit is catalog-only and must not touch the
  -- table ACL in either direction.
  IF has_table_privilege('anon', v_table, 'INSERT') THEN
    RAISE EXCEPTION
      'PS-365: verify: anon gained INSERT on public.universal_guild_applications; a policy edit must not move a grant';
  END IF;

  RAISE NOTICE
    'PS-365: policy "Anyone can submit applications" on public.universal_guild_applications repaired -- WITH CHECK now binds applicant_user_id to the caller''s own auth.uid() instead of accepting any value';
END
$ps365$;

-- No ledger INSERT: the CLI records each file itself and a second row collides.

NOTIFY pgrst, 'reload schema';

COMMIT;
