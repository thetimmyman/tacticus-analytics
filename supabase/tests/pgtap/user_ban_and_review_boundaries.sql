BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;

SELECT plan(24);

SELECT has_function(
  'public',
  'prevent_active_ban_identity_binding',
  ARRAY[]::text[],
  'durable-ban identity binding trigger function exists'
);

SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.prevent_active_ban_identity_binding()',
    'EXECUTE'
  ),
  'authenticated users cannot invoke the privileged trigger function directly'
);

SELECT has_function(
  'public',
  'prevent_active_ban_auth_identity_binding',
  ARRAY[]::text[],
  'provider identity durable-ban binding trigger function exists'
);

SELECT has_function(
  'public',
  'serialize_user_ban_subject',
  ARRAY[]::text[],
  'durable-ban insertion serialization trigger function exists'
);

SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.serialize_user_ban_subject()',
    'EXECUTE'
  ),
  'authenticated users cannot invoke ban serialization directly'
);

SELECT ok(
  pg_get_functiondef(
    'public.prevent_active_ban_identity_binding()'::regprocedure
  ) ~ 'acquire_user_ban_subject_lock',
  'Discord identity binding takes the shared transaction advisory lock'
);

SELECT ok(
  pg_get_functiondef(
    'public.serialize_user_ban_subject()'::regprocedure
  ) ~ 'acquire_user_ban_subject_lock'
  AND pg_get_functiondef(
    'public.serialize_user_ban_subject()'::regprocedure
  ) ~ 'is_app_admin IS TRUE'
  AND pg_get_functiondef(
    'public.serialize_user_ban_subject()'::regprocedure
  ) ~ 'discord_user_id',
  'ban insertion takes the same subject lock and rejects admin owners'
);

SELECT ok(
  pg_get_functiondef(
    'public.set_player_app_admin_bulk(uuid[],boolean)'::regprocedure
  ) ~ 'acquire_user_ban_subject_lock'
  AND pg_get_functiondef(
    'public.set_player_app_admin_bulk(uuid[],boolean)'::regprocedure
  ) ~ 'JOIN public.user_bans'
  AND pg_get_functiondef(
    'public.set_player_app_admin_bulk(uuid[],boolean)'::regprocedure
  ) ~ 'auth.identities',
  'app-admin grants share subject locks and recheck the durable ban ledger'
);

INSERT INTO public.clusters (id, cluster_code, display_name, created_at)
VALUES
  (
    '00000000-0000-0000-0000-000000824130',
    'RV24',
    'Review Boundary Cluster',
    now()
  ),
  (
    '00000000-0000-0000-0000-000000824133',
    'STALE24',
    'Stale Mapping Cluster',
    now()
  );

INSERT INTO public.guild_config (
  id,
  guild_code,
  display_name,
  cluster_code,
  cluster_id,
  enabled
) VALUES (
  824130,
  'RV24-A',
  'Review Boundary Guild',
  'RV24',
  '00000000-0000-0000-0000-000000824130',
  true
);

INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES
  (
    '00000000-0000-0000-0000-000000824131',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'banned@review-boundary.test'
  ),
  (
    '00000000-0000-0000-0000-000000824132',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'officer@review-boundary.test'
  );

INSERT INTO public.user_bans (
  ban_group_id,
  auth_user_id,
  subject_type,
  subject_value,
  reason
) VALUES (
  '00000000-0000-0000-0000-000000824144',
  '00000000-0000-0000-0000-000000824131',
  'discord_user_id',
  '111111111111111111',
  'pgTAP provider binding serialization fixture'
);

SELECT throws_ok(
  $$
    INSERT INTO auth.identities (
      id,
      user_id,
      identity_data,
      provider,
      provider_id,
      created_at,
      updated_at
    ) VALUES (
      '00000000-0000-0000-0000-000000824144',
      '00000000-0000-0000-0000-000000824132',
      '{"provider_id":"111111111111111111","sub":"111111111111111111"}'::jsonb,
      'discord',
      '111111111111111111',
      clock_timestamp(),
      clock_timestamp()
    )
  $$,
  '42501',
  'Account suspended',
  'a provider identity binding cannot cross a committed durable ban'
);

UPDATE public.user_bans
SET lifted_at = clock_timestamp(),
    lifted_by = '00000000-0000-0000-0000-000000824131'
WHERE ban_group_id = '00000000-0000-0000-0000-000000824144';

INSERT INTO auth.identities (
  id,
  user_id,
  identity_data,
  provider,
  provider_id,
  created_at,
  updated_at
) VALUES (
  '00000000-0000-0000-0000-000000824143',
  '00000000-0000-0000-0000-000000824132',
  '{"provider_id":"987654321098765432","sub":"987654321098765432"}'::jsonb,
  'discord',
  '987654321098765432',
  clock_timestamp(),
  clock_timestamp()
);

INSERT INTO public.user_bans (
  ban_group_id,
  auth_user_id,
  subject_type,
  subject_value,
  reason
) VALUES (
  '00000000-0000-0000-0000-000000824139',
  '00000000-0000-0000-0000-000000824131',
  'player_id',
  'banned-player',
  'pgTAP boundary fixture'
);

INSERT INTO public.player_mapping (
  id,
  player_id,
  display_name,
  guild_code,
  cluster_code,
  role,
  is_current
) VALUES
  (824131, 'BANNED-PLAYER', 'Banned Player', 'RV24-A', 'RV24', 'member', true),
  (824132, 'review-officer', 'Review Officer', 'RV24-A', 'RV24', 'Officer', true);

INSERT INTO public.player_identity_attestations (
  id,
  mapping_id,
  player_id,
  subject_user_id,
  consumed_at,
  attested_at,
  source,
  guild_code_snapshot
) VALUES
  (
    '00000000-0000-0000-0000-000000824141',
    824131,
    'BANNED-PLAYER',
    '00000000-0000-0000-0000-000000824131',
    clock_timestamp(),
    clock_timestamp(),
    'operator_quarantine_restore',
    'RV24-A'
  ),
  (
    '00000000-0000-0000-0000-000000824142',
    824132,
    'review-officer',
    '00000000-0000-0000-0000-000000824132',
    clock_timestamp(),
    clock_timestamp(),
    'operator_quarantine_restore',
    'RV24-A'
  );

SELECT throws_ok(
  $$
    UPDATE public.player_mapping
    SET user_id = '00000000-0000-0000-0000-000000824131',
        ownership_attestation_id = '00000000-0000-0000-0000-000000824141'
    WHERE id = 824131
  $$,
  '42501',
  'Account suspended',
  'a replacement account cannot bind a banned Tacticus identity'
);

UPDATE public.player_mapping
SET user_id = '00000000-0000-0000-0000-000000824132',
    ownership_attestation_id = '00000000-0000-0000-0000-000000824142',
    cluster_code = 'STALE24',
    is_app_admin = true
WHERE id = 824132;

SELECT throws_ok(
  $$
    INSERT INTO public.user_bans (
      ban_group_id,
      auth_user_id,
      subject_type,
      subject_value,
      reason
    ) VALUES (
      '00000000-0000-0000-0000-000000824138',
      '00000000-0000-0000-0000-000000824131',
      'user_id',
      '00000000-0000-0000-0000-000000824132',
      'pgTAP app-admin boundary fixture'
    )
  $$,
  '42501',
  'Remove the app admin role from every matched identity owner before banning',
  'a durable ban cannot cover a current app-admin owner'
);

SELECT throws_ok(
  $$
    INSERT INTO public.user_bans (
      ban_group_id,
      auth_user_id,
      subject_type,
      subject_value,
      reason
    ) VALUES (
      '00000000-0000-0000-0000-000000824136',
      '00000000-0000-0000-0000-000000824131',
      'discord_user_id',
      '987654321098765432',
      'pgTAP provider identity owner boundary fixture'
    )
  $$,
  '42501',
  'Remove the app admin role from every matched identity owner before banning',
  'a provider Discord identity cannot be banned while its owner is an app admin'
);

UPDATE public.player_mapping
SET is_app_admin = false
WHERE id = 824132;

INSERT INTO public.user_bans (
  ban_group_id,
  auth_user_id,
  subject_type,
  subject_value,
  reason
) VALUES (
  '00000000-0000-0000-0000-000000824135',
  '00000000-0000-0000-0000-000000824131',
  'discord_user_id',
  '987654321098765432',
  'pgTAP provider identity grant boundary fixture'
);

SET LOCAL ROLE service_role;
SELECT throws_ok(
  $$
    SELECT *
    FROM public.set_player_app_admin_bulk(
      ARRAY['00000000-0000-0000-0000-000000824132']::uuid[],
      true
    )
  $$,
  '42501',
  'Cannot grant app admin access to an actively banned user',
  'an app-admin grant cannot cross a provider Discord identity ban'
);
RESET ROLE;

UPDATE public.user_bans
SET lifted_at = clock_timestamp(),
    lifted_by = '00000000-0000-0000-0000-000000824131'
WHERE ban_group_id = '00000000-0000-0000-0000-000000824135';

INSERT INTO public.user_bans (
  ban_group_id,
  auth_user_id,
  subject_type,
  subject_value,
  reason
) VALUES (
  '00000000-0000-0000-0000-000000824137',
  '00000000-0000-0000-0000-000000824132',
  'user_id',
  '00000000-0000-0000-0000-000000824132',
  'pgTAP app-admin grant boundary fixture'
);

SET LOCAL ROLE service_role;
SELECT throws_ok(
  $$
    SELECT *
    FROM public.set_player_app_admin_bulk(
      ARRAY['00000000-0000-0000-0000-000000824132']::uuid[],
      true
    )
  $$,
  '42501',
  'Cannot grant app admin access to an actively banned user',
  'an app-admin grant cannot cross a committed durable ban'
);
RESET ROLE;

UPDATE public.user_bans
SET lifted_at = clock_timestamp(),
    lifted_by = '00000000-0000-0000-0000-000000824131'
WHERE ban_group_id = '00000000-0000-0000-0000-000000824137';

INSERT INTO public."EOT_GR_data" (
  id,
  "Guild",
  "Season",
  "displayName",
  "damageType",
  "damageDealt",
  "userId",
  "encounterId",
  cluster_code
) VALUES
  (8241301, 'RV24-A', '824', 'Alpha', 'Battle', 200, 'alpha', 0, 'RV24'),
  (8241302, 'RV24-A', '824', 'Beta', 'Battle', 101, 'beta', 0, 'RV24'),
  (8241303, 'RV24-A', '824', 'Gamma', 'Battle', 100, 'gamma', 0, 'RV24');

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000824132',
  true
);

SELECT is(
  public.get_cluster_damage_rank('824', 'RV24', 'gamma'),
  3,
  'cluster damage rank aggregates the complete season on the server'
);

SELECT is(
  public.get_cluster_damage_rank('824', 'OTHER', 'gamma'),
  NULL::integer,
  'cluster damage rank rejects a non-admin cross-cluster request'
);

SELECT lives_ok(
  $$
    INSERT INTO public.boss_target_tokens (
      guild_code,
      boss_name,
      rarity,
      set,
      target_tokens,
      source,
      season_number,
      updated_by
    ) VALUES (
      'RV24-A',
      'Avatar of Khaine',
      'Legendary',
      1,
      3,
      'officer_manual',
      '824',
      '00000000-0000-0000-0000-000000824132'
    )
  $$,
  'mixed-case Officer can write boss targets under RLS'
);

SELECT is(
  public._pm_caller_can_manage_player_meta(
    '00000000-0000-0000-0000-000000824132'
  ),
  true,
  'mixed-case Officer can manage a current same-guild player meta record'
);

RESET ROLE;

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_db_role_setting AS setting
    CROSS JOIN LATERAL unnest(setting.setconfig) AS config(value)
    WHERE setting.setrole = 'authenticator'::regrole
      AND config.value =
        'pgrst.db_pre_request=public.enforce_request_user_ban'
  ),
  'PostgREST is configured to enforce bans before every database request'
);

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000824131',
  true
);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

SELECT throws_ok(
  $$ SELECT public.enforce_request_user_ban() $$,
  '42501',
  'Account suspended',
  'an existing banned JWT is rejected at the PostgREST boundary'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000824132',
  true
);

SELECT lives_ok(
  $$ SELECT public.enforce_request_user_ban() $$,
  'an unbanned authenticated request passes the PostgREST boundary'
);

RESET ROLE;

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', 'service_role', true);

SELECT is(
  public.get_cluster_damage_rank('824', 'RV24', 'gamma'),
  3,
  'service-role home summary can calculate the complete cluster rank'
);

RESET ROLE;

SELECT ok(
  (
    SELECT pg_get_expr(policy.polqual, policy.polrelid)
    FROM pg_policy AS policy
    WHERE policy.polrelid = 'public.boss_target_tokens'::regclass
      AND policy.polname = 'boss_target_tokens_write'
  ) ~ 'lower\('
  AND (
    SELECT pg_get_expr(policy.polqual, policy.polrelid)
    FROM pg_policy AS policy
    WHERE policy.polrelid = 'public.boss_target_tokens'::regclass
      AND policy.polname = 'boss_target_tokens_write'
  ) ~ 'gc_user'
  AND (
    SELECT pg_get_expr(policy.polqual, policy.polrelid)
    FROM pg_policy AS policy
    WHERE policy.polrelid = 'public.boss_target_tokens'::regclass
      AND policy.polname = 'boss_target_tokens_write'
  ) !~ 'pm\.cluster_code',
  'boss target policy normalizes roles and derives cluster authority from guild configuration'
);

SELECT ok(
  pg_get_functiondef(
    'public._pm_caller_can_manage_player_meta(uuid)'::regprocedure
  ) ~ 'lower\('
  AND (
      SELECT pg_get_expr(policy.polqual, policy.polrelid)
      FROM pg_policy AS policy
      WHERE policy.polrelid = 'public.player_meta_roles'::regclass
        AND policy.polname = 'player_meta_roles_leader_write'
    ) ~ '_pm_caller_can_manage_player_meta',
  'player meta role policy uses a mixed-case-safe definer boundary'
);

SELECT finish();
ROLLBACK;
