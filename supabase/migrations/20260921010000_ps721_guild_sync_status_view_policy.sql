-- guild_sync_status' SELECT policy read player_mapping.user_id, which authenticated
-- cannot read (42501); use _pm_caller_guild_codes() as webhook_config does.
-- target-db: general
-- The INSERT/UPDATE siblings share the defect and are deliberately left.

BEGIN;

SET LOCAL lock_timeout = '5s';

DROP POLICY IF EXISTS authenticated_users_can_view ON public.guild_sync_status;

CREATE POLICY authenticated_users_can_view ON public.guild_sync_status
  FOR SELECT TO authenticated
  USING (guild_code IN (SELECT public._pm_caller_guild_codes()));

COMMENT ON TABLE public.guild_sync_status IS
  'Per-guild sync bookkeeping. PS-721: the authenticated SELECT policy resolves '
  'the caller''s guilds through public._pm_caller_guild_codes(), a SECURITY '
  'DEFINER helper, because a policy expression is evaluated with the CALLER''s '
  'privileges and authenticated holds no SELECT on player_mapping.user_id '
  '(20260817000000). Reading that column from a policy makes every SELECT on '
  'this table fail with 42501 for the audience the policy exists to admit.';

DO $verify$
DECLARE
  v_qual text;
  v_rows bigint;
BEGIN
  SELECT pg_get_expr(pol.polqual, pol.polrelid) INTO v_qual
  FROM pg_policy pol
  WHERE pol.polrelid = 'public.guild_sync_status'::regclass
    AND pol.polname = 'authenticated_users_can_view';

  IF v_qual IS NULL THEN
    RAISE EXCEPTION
      'PS-721 verify: policy authenticated_users_can_view is missing from guild_sync_status';
  END IF;

  IF v_qual !~ '_pm_caller_guild_codes' THEN
    RAISE EXCEPTION
      'PS-721 verify: the policy does not resolve guilds through _pm_caller_guild_codes(): %',
      v_qual;
  END IF;

  -- The defect itself, as a catalogue assertion: no base-relation read of
  -- player_mapping from this policy, whatever the spelling.
  IF v_qual ~ '(FROM|JOIN)\s+(public\.)?player_mapping\M' THEN
    RAISE EXCEPTION
      'PS-721 verify: the policy still reads player_mapping as a base relation: %',
      v_qual;
  END IF;

  -- Not a lockout, and not an over-reach: it is still a SELECT policy, still
  -- addressed to authenticated only, and service_role keeps its own policy.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    WHERE pol.polrelid = 'public.guild_sync_status'::regclass
      AND pol.polname = 'authenticated_users_can_view'
      AND pol.polcmd = 'r'
      AND pol.polroles = ARRAY['authenticated'::regrole]::oid[]
  ) THEN
    RAISE EXCEPTION
      'PS-721 verify: authenticated_users_can_view is no longer a SELECT-only policy addressed to authenticated alone';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    WHERE pol.polrelid = 'public.guild_sync_status'::regclass
      AND pol.polname = 'service_role_all_access'
  ) THEN
    RAISE EXCEPTION
      'PS-721 verify: service_role_all_access disappeared from guild_sync_status';
  END IF;

  -- BEHAVIOURAL. The statement that raised 42501 must now complete. It is run
  -- as authenticated with no session, which selects zero rows -- completion,
  -- not a row count, is what the defect made impossible. RESET ROLE runs on
  -- both paths so a failure cannot leave the session role switched.
  BEGIN
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_rows FROM public.guild_sync_status;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    RAISE EXCEPTION
      'PS-721 verify: authenticated still cannot SELECT guild_sync_status: % (%)',
      SQLERRM, SQLSTATE;
  END;

  RAISE NOTICE
    'PS-721 verify: OK -- the SELECT policy resolves guilds through _pm_caller_guild_codes(), reads no player_mapping column directly, and an authenticated SELECT completes';
END;
$verify$;

COMMIT;

NOTIFY pgrst, 'reload schema';
