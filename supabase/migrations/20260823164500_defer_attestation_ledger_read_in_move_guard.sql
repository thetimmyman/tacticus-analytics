-- target-db: general
-- The ledger read is its own statement: inside one IF a generic plan kept the subplan
-- and denied service_role on every roster upsert.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.guard_attested_guild_membership_move()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
DECLARE
  v_escape_opens boolean;
  v_attestation_revoked boolean;
  v_ledger_readable boolean;
BEGIN
  -- (1) Guarded transition? These four conjuncts reference no relation and no
  --     non-PUBLIC function, so this expression has no RTE and no relation
  --     privilege is checked, under any plan shape, for any role. Every row of
  --     every roster upsert lands here and returns.
  IF OLD.guild_code IS DISTINCT FROM NEW.guild_code
    AND OLD.is_current IS TRUE
    AND OLD.user_id IS NOT NULL
    AND OLD.ownership_attestation_id IS NOT NULL
  THEN
    v_escape_opens := false;

    -- (2) The two operator escapes, both gated on current_user = 'postgres'.
    IF current_user = 'postgres' THEN
      -- Escape 1 (20260820180000): the locked reconciliation RPC names exactly
      -- one subject in a transaction-local GUC.
      IF coalesce(
           current_setting('app.guild_membership_reconciliation_subject', true),
           ''
         ) = OLD.user_id::text
      THEN
        v_escape_opens := true;
      END IF;

      -- Escape 2 (20260823020000): a guild-code RELABEL cascading from
      -- rename_guild_code, distinguished from a per-player move by the old code
      -- already being absent from guild_config.
      --
      -- `IS NOT FALSE` is deliberate and preserves the original's three-valued
      -- behaviour: the pre-fix body suppressed the RAISE via `AND NOT (...)`,
      -- which yields NULL -- not TRUE -- when OLD.guild_code or NEW.guild_code
      -- is NULL, and `IF NULL` does not raise. Plain boolean tests here would
      -- TIGHTEN that edge. This migration changes no verdict, so the quirk is
      -- reproduced verbatim. If it is later judged a bug, close it in its own
      -- change with its own reasoning.
      IF NOT v_escape_opens
        AND (
          coalesce(current_setting('app.guild_code_rename_witness', true), '')
            = OLD.guild_code || '->' || NEW.guild_code
          AND NOT EXISTS (
            SELECT 1 FROM public.guild_config AS gc
            WHERE gc.guild_code = OLD.guild_code
          )
        ) IS NOT FALSE
      THEN
        v_escape_opens := true;
      END IF;
    END IF;

    IF NOT v_escape_opens THEN
      -- (3) The identity-ledger read. THIS IS THE ONLY STATEMENT THAT TOUCHES
      --     A WI-6270 BOUNDARY TABLE, and it is reached only for a genuine
      --     attested move that no escape covers.
      v_ledger_readable := true;
      BEGIN
        SELECT EXISTS (
          SELECT 1
          FROM public.player_identity_attestation_revocations AS revoked
          WHERE revoked.attestation_id = OLD.ownership_attestation_id
        ) INTO v_attestation_revoked;
      EXCEPTION WHEN insufficient_privilege THEN
        -- Cannot see the ledger => assume the attestation is live => deny.
        v_ledger_readable := false;
        v_attestation_revoked := false;
      END;

      -- IS NOT TRUE, not NOT: deny-by-default must be structural. A future edit
      -- to a row-returning form (SELECT 1 ... INTO) leaves the variable NULL on
      -- NOT FOUND, and `IF NOT NULL` takes the ELSE branch -- silently
      -- converting this guard to fail-OPEN for every non-postgres caller.
      IF v_attestation_revoked IS NOT TRUE THEN
        RAISE LOG
          'guard_attested_guild_membership_move: denied guild_code move on player_mapping id=% caller_role=% attestation_ledger_readable=%',
          OLD.id, current_user, v_ledger_readable;
        RAISE EXCEPTION 'Attested guild membership requires reconciliation'
          USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END
$function$;

ALTER FUNCTION public.guard_attested_guild_membership_move() OWNER TO postgres;

COMMENT ON FUNCTION public.guard_attested_guild_membership_move() IS
  'BEFORE UPDATE OF guild_code on player_mapping. Blocks a generic roster sync '
  'from moving a live attested account between guilds. SECURITY INVOKER ON '
  'PURPOSE: both escape hatches key on current_user = ''postgres'', so DEFINER '
  'would hand them to every caller. The revocations read is a separate '
  'statement inside the guarded branch so its relation privilege is checked '
  'only when a real attested move is attempted -- ExecutorStart checks RTE '
  'permissions before quals, so short-circuiting inside one expression does '
  'not work. Non-postgres callers cannot read that ledger (WI-6270) and are '
  'failed closed.';

-- CREATE OR REPLACE keeps an existing ACL; this aligns clean replay (PUBLIC EXECUTE).
REVOKE ALL ON FUNCTION public.guard_attested_guild_membership_move()
  FROM PUBLIC, anon, authenticated;

-- analytics_ro is production-only; an unconditional REVOKE would abort clean replays.
DO $guard_move_analytics_ro$
BEGIN
  IF to_regrole('analytics_ro') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.guard_attested_guild_membership_move()
      FROM analytics_ro;
  END IF;
END;
$guard_move_analytics_ro$;

GRANT EXECUTE ON FUNCTION public.guard_attested_guild_membership_move()
  TO service_role;

-- Backfill the ledger row of hand-applied 20260823020000 so a later apply cannot restore
-- the old guard. Guarded on rename_guild_code, which only that migration creates.
DO $backfill_20260823020000$
BEGIN
  IF to_regprocedure('public.rename_guild_code(text,text,boolean)') IS NOT NULL THEN
    INSERT INTO supabase_migrations.schema_migrations (version, name)
    VALUES ('20260823020000', 'permit_trusted_guild_code_rename')
    ON CONFLICT (version) DO NOTHING;
  END IF;
END;
$backfill_20260823020000$;

-- Asserts only this function: the baseline still grants the revocations table.
DO $guard_posture_assert$
DECLARE
  v_secdef boolean;
  v_owner name;
  v_config text[];
  v_unexpected integer;
BEGIN
  SELECT p.prosecdef, pg_get_userbyid(p.proowner), p.proconfig
    INTO v_secdef, v_owner, v_config
    FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'guard_attested_guild_membership_move';

  IF v_secdef IS DISTINCT FROM false THEN
    RAISE EXCEPTION
      'guard_attested_guild_membership_move must remain SECURITY INVOKER (prosecdef=%)',
      v_secdef;
  END IF;

  IF v_owner IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION
      'guard_attested_guild_membership_move owner drifted to %', v_owner;
  END IF;

  IF v_config IS NULL OR NOT ('search_path=public' = ANY (v_config)) THEN
    RAISE EXCEPTION
      'guard_attested_guild_membership_move lost its pinned search_path (proconfig=%)',
      v_config;
  END IF;

  SELECT count(*) INTO v_unexpected
    FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
    CROSS JOIN LATERAL aclexplode(
      coalesce(p.proacl, acldefault('f', p.proowner))
    ) AS acl
   WHERE n.nspname = 'public'
     AND p.proname = 'guard_attested_guild_membership_move'
     AND acl.grantee <> p.proowner
     AND acl.grantee IS DISTINCT FROM to_regrole('service_role')::oid;

  IF v_unexpected <> 0 THEN
    RAISE EXCEPTION
      'guard_attested_guild_membership_move holds % unexpected EXECUTE grant(s)',
      v_unexpected;
  END IF;
END;
$guard_posture_assert$;

COMMIT;
