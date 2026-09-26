BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;

SELECT plan(25);

SELECT is(
  (
    SELECT count(*)::integer
    FROM supabase_migrations.schema_migrations
    WHERE version = '20260820210000'
      AND name = 'wi7370_out_of_band_grant_allowance'
  ),
  1,
  'production out-of-band grant allowance remains represented in lineage'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM supabase_migrations.schema_migrations
    WHERE version = '20260820220000'
      AND name = 'harden_guild_reconciliation_races'
  ),
  1,
  'race-hardening migration is recorded exactly once'
);

SELECT has_column(
  'public', 'onboarding_progress', 'guild_attempt_generation',
  'onboarding progress carries a monotonic guild-attempt generation'
);

SELECT ok(
  has_function_privilege(
    'service_role',
    'public.deactivate_player_mappings_observed(text,text[],text,text,timestamptz)',
    'EXECUTE'
  ),
  'service role can use observed roster deactivation'
);

SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.deactivate_player_mappings_observed(text,text[],text,text,timestamptz)',
    'EXECUTE'
  ),
  'authenticated callers cannot deactivate roster mappings'
);

SELECT ok(
  has_function_privilege(
    'service_role',
    'public.begin_guild_roster_observation()',
    'EXECUTE'
  ),
  'service role can mint a database roster observation'
);

SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.begin_guild_roster_observation()',
    'EXECUTE'
  ),
  'authenticated callers cannot mint roster observations'
);

SET LOCAL ROLE service_role;
SELECT ok(
  public.begin_guild_roster_observation()
    BETWEEN clock_timestamp() - interval '5 seconds' AND clock_timestamp(),
  'roster observations are minted on the database clock'
);
RESET ROLE;

SELECT ok(
  NOT has_function_privilege(
    'service_role',
    'public.deactivate_player_mappings_legacy_impl(text,text[],text,text,timestamptz)',
    'EXECUTE'
  ),
  'the internal authority-clearing implementation is not an RPC surface'
);

SELECT ok(
  has_function_privilege(
    'service_role',
    'public.begin_own_guild_onboarding_attempt(uuid)',
    'EXECUTE'
  ),
  'service role can begin a server-bound guild attempt'
);

SELECT ok(
  has_function_privilege(
    'service_role',
    'public.settle_own_guild_onboarding_attempt(uuid,bigint,text,text,text,text,text,text,text)',
    'EXECUTE'
  ),
  'service role can settle a server-bound guild attempt'
);

SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.begin_own_guild_onboarding_attempt(uuid)',
    'EXECUTE'
  ),
  'authenticated callers cannot mint guild-attempt generations directly'
);

SET LOCAL ROLE service_role;
SELECT is(
  (
    public.reconcile_own_guild_membership(
      '82021000-0000-0000-0000-000000000099',
      'legacy-player', 'OLD1', 'old-id', 'NEW1', 'new-id',
      'leader', repeat('f', 64)
    ) ->> 'error_code'
  ),
  'ATTEMPT_GENERATION_REQUIRED',
  'the old reconciliation signature fails closed during rollout'
);
RESET ROLE;

INSERT INTO public.guild_config (
  id, guild_code, display_name, guild_id, enabled
) VALUES (
  820210001, 'T821SYNC', 'Observed Sync Guild', 't821-sync', true
);

INSERT INTO public.player_mapping (
  id, player_id, display_name, guild_code, role,
  is_current, is_active, updated_at
) VALUES (
  820210001, 't821-player', 'Observed Player', 'T821SYNC',
  'member'::public.app_role, true, true, clock_timestamp()
);

INSERT INTO public.player_mapping (
  id, player_id, display_name, guild_code, role,
  is_current, is_active, updated_at
) VALUES (
  820210002, 't821-null-time', 'Legacy Timestamp Player', 'T821SYNC',
  'member'::public.app_role, true, true, NULL
);

SET LOCAL ROLE service_role;
SELECT is(
  (
    public.deactivate_player_mappings_observed(
      'T821SYNC', ARRAY['t821-player'], 'roster_deactivation',
      'pgtap.observed-roster', clock_timestamp() - interval '1 minute'
    ) ->> 'observation_stale'
  ),
  'true',
  'a roster older than the mapping fails closed'
);
RESET ROLE;

SELECT is(
  (
    SELECT mapping.is_current::text || ':' || mapping.is_active::text
    FROM public.player_mapping AS mapping
    WHERE mapping.id = 820210001
  ),
  'true:true',
  'stale roster evidence leaves the mapping active'
);

SET LOCAL ROLE service_role;
SELECT is(
  (
    public.deactivate_player_mappings_observed(
      'T821SYNC', ARRAY['t821-null-time'], 'roster_deactivation',
      'pgtap.observed-roster', clock_timestamp()
    ) ->> 'observation_stale'
  ),
  'true',
  'a legacy NULL mapping timestamp fails closed'
);
RESET ROLE;

SELECT is(
  (
    SELECT mapping.is_current::text || ':' || mapping.is_active::text
    FROM public.player_mapping AS mapping
    WHERE mapping.id = 820210002
  ),
  'true:true',
  'NULL-timestamp fallback leaves the mapping active'
);

UPDATE public.player_mapping
SET tacticus_api_key_encrypted = 'legacy-ciphertext',
    api_key_is_valid = true,
    api_key_last_verified = clock_timestamp(),
    api_key_added_at = clock_timestamp(),
    patreon_user_id = 'legacy-patreon',
    username = 'Former Owner',
    player_notes = 'private note',
    notify_boss_kills = true
WHERE id = 820210001;

SET LOCAL ROLE service_role;
SELECT is(
  (
    public.deactivate_player_mappings_observed(
      'T821SYNC', ARRAY['t821-player'], 'roster_deactivation',
      'pgtap.observed-roster', clock_timestamp()
    ) ->> 'success'
  ),
  'true',
  'fresh roster evidence can deactivate the exact mapping'
);
RESET ROLE;

SELECT is(
  (
    SELECT mapping.is_current::text || ':' || mapping.is_active::text
    FROM public.player_mapping AS mapping
    WHERE mapping.id = 820210001
  ),
  'false:false',
  'fresh deactivation clears current and active state'
);

SELECT is(
  (
    SELECT (
      mapping.tacticus_api_key_encrypted IS NULL
      AND mapping.api_key_is_valid IS NULL
      AND mapping.api_key_last_verified IS NULL
      AND mapping.api_key_added_at IS NULL
      AND mapping.patreon_user_id IS NULL
      AND mapping.username IS NULL
      AND mapping.player_notes IS NULL
      AND mapping.notify_boss_kills IS FALSE
    )::text
    FROM public.player_mapping AS mapping
    WHERE mapping.id = 820210001
  ),
  'true',
  'deactivation clears account-owned credential and profile residue'
);

INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES (
  '82021000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'attempt@t821.test'
);

INSERT INTO public.onboarding_progress (
  user_id, guild_attempt_generation
) VALUES (
  '82021000-0000-0000-0000-000000000001', 0
) ON CONFLICT (user_id) DO UPDATE
SET guild_attempt_generation = 0;

SET LOCAL ROLE service_role;

SELECT is(
  ARRAY[
    public.begin_own_guild_onboarding_attempt(
      '82021000-0000-0000-0000-000000000001'
    ),
    public.begin_own_guild_onboarding_attempt(
      '82021000-0000-0000-0000-000000000001'
    )
  ],
  ARRAY[1::bigint, 2::bigint],
  'overlapping attempts receive increasing generations'
);

SELECT is(
  (
    public.settle_own_guild_onboarding_attempt(
      '82021000-0000-0000-0000-000000000001',
      1, 'complete', 'new_guild', 'leader',
      'T821OLD', 'Stale Attempt', 'complete', NULL
    ) ->> 'error_code'
  ),
  'ATTEMPT_SUPERSEDED',
  'an older attempt cannot finalize after a newer attempt begins'
);

SELECT is(
  (
    public.settle_own_guild_onboarding_attempt(
      '82021000-0000-0000-0000-000000000001',
      2, 'complete', 'new_guild', 'leader',
      'T821NEW', 'Latest Attempt', 'complete', NULL
    ) ->> 'success'
  ),
  'true',
  'the latest attempt can finalize'
);

SELECT is(
  (
    public.settle_own_guild_onboarding_attempt(
      '82021000-0000-0000-0000-000000000001',
      1, 'failed', NULL, NULL, NULL, NULL, NULL, 'stale failure'
    ) ->> 'error_code'
  ),
  'ATTEMPT_SUPERSEDED',
  'an older failure cannot overwrite a newer success'
);
RESET ROLE;

SELECT is(
  (
    SELECT progress.guild_attempt_generation::text || ':'
      || progress.guild_status || ':' || progress.guild_code
    FROM public.onboarding_progress AS progress
    WHERE progress.user_id =
      '82021000-0000-0000-0000-000000000001'
  ),
  '2:complete:T821NEW',
  'progress remains bound to the latest generation and guild'
);

SELECT * FROM finish();
ROLLBACK;
