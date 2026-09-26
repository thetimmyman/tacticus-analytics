-- Make the three player_invite_codes -> auth.users FKs ON DELETE SET NULL, backing up
-- the BEFORE DELETE trigger that already nulls them.
-- target-db: general
-- SET NULL, not CASCADE: CASCADE would delete live invite codes other players hold.

BEGIN;

-- ACCESS EXCLUSIVE: fail fast rather than queue behind a long reader and block everything.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION
      'PS-39 migration targets the General database (postgres); refusing to run on %',
      current_database();
  END IF;
END;
$$;

-- SET NULL is only legal on a nullable column; assert before altering.
DO $$
DECLARE
  not_nullable text;
BEGIN
  SELECT string_agg(a.attname, ', ' ORDER BY a.attname)
    INTO not_nullable
  FROM pg_attribute a
  WHERE a.attrelid = 'public.player_invite_codes'::regclass
    AND a.attname IN ('created_by', 'revoked_by', 'used_by')
    AND a.attnotnull;

  IF not_nullable IS NOT NULL THEN
    RAISE EXCEPTION
      'PS-39: cannot use ON DELETE SET NULL, these columns are NOT NULL: %',
      not_nullable;
  END IF;
END;
$$;

ALTER TABLE public.player_invite_codes
  DROP CONSTRAINT IF EXISTS player_invite_codes_created_by_fkey;
ALTER TABLE public.player_invite_codes
  ADD CONSTRAINT player_invite_codes_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.player_invite_codes
  DROP CONSTRAINT IF EXISTS player_invite_codes_revoked_by_fkey;
ALTER TABLE public.player_invite_codes
  ADD CONSTRAINT player_invite_codes_revoked_by_fkey
  FOREIGN KEY (revoked_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.player_invite_codes
  DROP CONSTRAINT IF EXISTS player_invite_codes_used_by_fkey;
ALTER TABLE public.player_invite_codes
  ADD CONSTRAINT player_invite_codes_used_by_fkey
  FOREIGN KEY (used_by) REFERENCES auth.users(id) ON DELETE SET NULL;

DO $$
DECLARE
  wrong text;
BEGIN
  SELECT string_agg(c.conname || '=' || c.confdeltype::text, ', ' ORDER BY c.conname)
    INTO wrong
  FROM pg_constraint c
  WHERE c.conrelid = 'public.player_invite_codes'::regclass
    AND c.confrelid = 'auth.users'::regclass
    AND c.conname IN (
      'player_invite_codes_created_by_fkey',
      'player_invite_codes_revoked_by_fkey',
      'player_invite_codes_used_by_fkey'
    )
    AND c.confdeltype <> 'n';

  IF wrong IS NOT NULL THEN
    RAISE EXCEPTION 'PS-39: constraint(s) not ON DELETE SET NULL: %', wrong;
  END IF;

  IF (
    SELECT count(*)
    FROM pg_constraint c
    WHERE c.conrelid = 'public.player_invite_codes'::regclass
      AND c.confrelid = 'auth.users'::regclass
      AND c.confdeltype = 'n'
      AND c.conname IN (
        'player_invite_codes_created_by_fkey',
        'player_invite_codes_revoked_by_fkey',
        'player_invite_codes_used_by_fkey'
      )
  ) <> 3 THEN
    RAISE EXCEPTION
      'PS-39: expected 3 ON DELETE SET NULL constraints on player_invite_codes';
  END IF;
END;
$$;

COMMIT;
