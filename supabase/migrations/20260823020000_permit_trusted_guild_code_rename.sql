-- Allow an operator-only guild_code rename to cascade; the app never renames.

-- Only the update rule changes; ON DELETE CASCADE is kept.
ALTER TABLE public.coaching_tasks
  DROP CONSTRAINT IF EXISTS coaching_tasks_guild_code_fkey;
ALTER TABLE public.coaching_tasks
  ADD CONSTRAINT coaching_tasks_guild_code_fkey
  FOREIGN KEY (guild_code) REFERENCES public.guild_config(guild_code)
  ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE public.coaching_task_deliveries
  DROP CONSTRAINT IF EXISTS coaching_task_deliveries_guild_code_fkey;
ALTER TABLE public.coaching_task_deliveries
  ADD CONSTRAINT coaching_task_deliveries_guild_code_fkey
  FOREIGN KEY (guild_code) REFERENCES public.guild_config(guild_code)
  ON UPDATE CASCADE ON DELETE CASCADE;

-- Relabel escape: needs postgres, a transaction-local witness naming the exact old->new
-- pair, and the old code gone from guild_config. The FK cascade fires after guild_config
-- updates, while in a real move the old code still exists.
CREATE OR REPLACE FUNCTION public.guard_attested_guild_membership_move()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.guild_code IS DISTINCT FROM NEW.guild_code
    AND OLD.is_current IS TRUE
    AND OLD.user_id IS NOT NULL
    AND OLD.ownership_attestation_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.player_identity_attestation_revocations AS revoked
      WHERE revoked.attestation_id = OLD.ownership_attestation_id
    )
    AND (
      current_user <> 'postgres'
      OR coalesce(
        current_setting(
          'app.guild_membership_reconciliation_subject', true
        ),
        ''
      ) <> OLD.user_id::text
    )
    AND NOT (
      current_user = 'postgres'
      AND coalesce(
        current_setting('app.guild_code_rename_witness', true), ''
      ) = OLD.guild_code || '->' || NEW.guild_code
      AND NOT EXISTS (
        SELECT 1 FROM public.guild_config AS gc
        WHERE gc.guild_code = OLD.guild_code
      )
    )
  THEN
    RAISE EXCEPTION 'Attested guild membership requires reconciliation'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.guard_attested_guild_membership_move()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_attested_guild_membership_move()
  TO service_role;

-- Sets the witness transaction-locally, then runs the one UPDATE the guard tolerates.
CREATE OR REPLACE FUNCTION public.rename_guild_code(
  p_old_guild_code text,
  p_new_guild_code text,
  p_allow_immutable_skips boolean DEFAULT false
)
RETURNS TABLE (relabelled_table text, rows_relabelled bigint, note text)
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_request_role text := coalesce(
    nullif(nullif(current_setting('role', true), ''), 'none'), session_user
  );
  v_locked text;
  v_rows bigint;
  v_skips text[] := '{}';
  r record;
BEGIN
  IF v_request_role <> 'postgres' AND current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Guild-code rename is an operator-only corridor'
      USING ERRCODE = '42501';
  END IF;
  IF p_old_guild_code IS NULL OR p_new_guild_code IS NULL
     OR p_old_guild_code = p_new_guild_code THEN
    RAISE EXCEPTION 'Guild-code rename needs two distinct codes'
      USING ERRCODE = '22023';
  END IF;

  -- LOCK the source row for the whole transaction. An unlocked existence check
  -- lets two concurrent operator sessions both pass validation; the loser's
  -- UPDATE then matches zero rows and, without the row-count assert below,
  -- reports a cutover that never happened.
  SELECT guild_code INTO v_locked
    FROM public.guild_config
   WHERE guild_code = p_old_guild_code
     FOR UPDATE;
  IF v_locked IS NULL THEN
    RAISE EXCEPTION 'No guild_config row for %', p_old_guild_code
      USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.guild_config WHERE guild_code = p_new_guild_code
  ) THEN
    RAISE EXCEPTION 'guild_code % is already taken', p_new_guild_code
      USING ERRCODE = '22023';
  END IF;

  PERFORM set_config(
    'app.guild_code_rename_witness',
    p_old_guild_code || '->' || p_new_guild_code,
    true
  );
  UPDATE public.guild_config
     SET guild_code = p_new_guild_code
   WHERE guild_code = p_old_guild_code;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'Guild-code rename touched % guild_config rows, expected 1',
      v_rows USING ERRCODE = '25000';
  END IF;
  relabelled_table := 'guild_config (+ FK cascades)';
  rows_relabelled := v_rows;
  note := 'renamed';
  RETURN NEXT;

  -- The 38+2 FK cascades cover only the tables that HAVE an FK. Many
  -- operational tables carry a guild code with no FK at all — `EOT_GR_data`
  -- ("Guild", ~6.2M rows) most consequentially: leaving it behind detaches the
  -- guild's entire raid history, so the dashboard would query the new code and
  -- find nothing while snapshot refreshes aggregate zero.
  --
  -- Discovered from the catalog rather than hard-coded. A hand-written list is
  -- exactly what goes stale when someone adds a table, and the failure is
  -- silent. Matching only rows EQUAL to the old code also makes this safe for
  -- look-alike columns that hold something other than a guild code — they
  -- simply match nothing.
  --
  -- APPEND-ONLY LEDGERS ARE SKIPPED, and that is the correct semantics rather
  -- than a workaround: an immutable audit row records what was true AT THE TIME
  -- and must keep the code the event actually carried. They are also physically
  -- unwritable — their guards raise on UPDATE.
  --
  -- Those guards are detected by CATCHING their rejection, not by matching
  -- trigger names. Two naming conventions already exist here
  -- (`reject_*_ledger_mutation`, `*_reject_mutation`, `*_guard_immutable`, and
  -- `guard_player_identity_quarantine_pii`), and a name-pattern list is the same
  -- staleness trap as a hand-written table list — the dry-run caught exactly
  -- that. `raise_exception` (P0001) is a guard saying "immutable"; it is
  -- recorded in the returned ledger. Every OTHER sqlstate propagates and aborts
  -- the rename, so a genuine failure can never half-relabel a guild.
  FOR r IN
    WITH cols AS (
      SELECT c.oid AS reloid, c.relname AS tbl, a.attname AS col
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      JOIN pg_attribute a ON a.attrelid = c.oid
                         AND a.attnum > 0 AND NOT a.attisdropped
      WHERE c.relkind = 'r'
        AND lower(a.attname) IN ('guild_code', 'guild')
    ),
    fk AS (
      SELECT c.conrelid::regclass::text AS tbl, a.attname AS col
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid
                         AND a.attnum = ANY (c.conkey)
      WHERE c.contype = 'f'
        AND c.confrelid = 'public.guild_config'::regclass
    )
    SELECT cols.tbl, cols.col
    FROM cols
    LEFT JOIN fk ON fk.tbl = cols.tbl AND fk.col = cols.col
    WHERE fk.tbl IS NULL AND cols.tbl <> 'guild_config'
    ORDER BY cols.tbl, cols.col
  LOOP
    BEGIN
      EXECUTE format(
        'UPDATE public.%I SET %I = $1 WHERE %I = $2', r.tbl, r.col, r.col
      ) USING p_new_guild_code, p_old_guild_code;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      IF v_rows > 0 THEN
        relabelled_table := r.tbl || '.' || r.col;
        rows_relabelled := v_rows;
        note := 'relabelled';
        RETURN NEXT;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_skips := v_skips || (r.tbl || '.' || r.col || ' [' || SQLSTATE || '] ' || SQLERRM);
      relabelled_table := r.tbl || '.' || r.col;
      rows_relabelled := 0;
      note := 'SKIPPED [' || SQLSTATE || ']: ' || SQLERRM;
      RETURN NEXT;
    END;
  END LOOP;

  -- FAIL LOUD BY DEFAULT. A skip is never assumed benign: the guards use at
  -- least three different SQLSTATEs (P0001, 55000, 42501) and several naming
  -- conventions, so any rule that decides "this one was fine" on its own would
  -- eventually mis-classify a real failure and half-relabel a guild. Instead
  -- the whole cutover aborts and names what it could not write. The operator
  -- reads the list, confirms every entry is an append-only ledger that SHOULD
  -- keep its historical code, and re-runs with p_allow_immutable_skips => true.
  IF array_length(v_skips, 1) IS NOT NULL AND NOT p_allow_immutable_skips THEN
    RAISE EXCEPTION
      'Guild-code rename aborted: % table(s) could not be relabelled: %',
      array_length(v_skips, 1), array_to_string(v_skips, ' | ')
      USING ERRCODE = '25000',
            HINT = 'Review each entry. If all are append-only ledgers that must keep the historical code, re-run with p_allow_immutable_skips => true.';
  END IF;
END
$function$;

-- Operator-only: reachable only from a superuser session.
REVOKE ALL ON FUNCTION public.rename_guild_code(text, text, boolean)
  FROM PUBLIC, anon, authenticated, service_role;
