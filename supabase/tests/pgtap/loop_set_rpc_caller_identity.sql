BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;

SELECT plan(7);

SELECT is(
  (SELECT count(*)::integer
     FROM supabase_migrations.schema_migrations
    WHERE version = '20260825171500'
      AND name = 'restore_loop_set_rpc_caller_identity'),
  1,
  'loop-and-set caller-identity migration is recorded exactly once'
);

SELECT ok(
  (SELECT NOT p.prosecdef
          AND p.proconfig = ARRAY['search_path=""']::text[]
     FROM pg_catalog.pg_proc AS p
    WHERE p.oid =
      'public.get_token_usage_by_loop_and_set(text,text,text[])'::regprocedure),
  'loop-and-set RPC remains SECURITY INVOKER with an empty search_path'
);

SELECT ok(
  (SELECT pg_catalog.pg_get_functiondef(p.oid)
            LIKE '%FROM public._pm_caller_mapping_rows() AS pm%'
          AND pg_catalog.pg_get_functiondef(p.oid)
            NOT LIKE '%FROM public.player_mapping%'
     FROM pg_catalog.pg_proc AS p
    WHERE p.oid =
      'public.get_token_usage_by_loop_and_set(text,text,text[])'::regprocedure),
  'caller identity uses the scoped projection, not player_mapping directly'
);

SELECT ok(
  has_function_privilege(
    'anon',
    'public.get_token_usage_by_loop_and_set(text,text,text[])',
    'EXECUTE'
  ) = false
  AND has_function_privilege(
    'authenticated',
    'public.get_token_usage_by_loop_and_set(text,text,text[])',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.get_token_usage_by_loop_and_set(text,text,text[])',
    'EXECUTE'
  ),
  'RPC remains authenticated/service_role only'
);

INSERT INTO public.guild_config (
  id, guild_code, display_name, created_at, enabled
) VALUES
  (715001, 'LOOPSET-A', 'Loop Set Guild A', now(), true),
  (715002, 'LOOPSET-B', 'Loop Set Guild B', now(), true);

INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES (
  '00000000-0000-0000-0000-000000715001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'loop-set-a@example.test'
);

INSERT INTO public.player_mapping (
  id, player_id, display_name, guild_code, role,
  is_current, is_app_admin, created_at, updated_at
) VALUES (
  715001,
  'loop-set-a',
  'Loop Set Member A',
  'LOOPSET-A',
  'member'::public.app_role,
  true,
  false,
  now(),
  now()
);

INSERT INTO public.player_identity_attestations (
  id, mapping_id, player_id, subject_user_id, consumed_at, attested_at,
  source, guild_code_snapshot
) VALUES (
  '00000000-0000-0000-0000-000000715011',
  715001,
  'loop-set-a',
  '00000000-0000-0000-0000-000000715001',
  clock_timestamp(),
  clock_timestamp(),
  'operator_quarantine_restore',
  'LOOPSET-A'
);

UPDATE public.player_mapping
   SET user_id = '00000000-0000-0000-0000-000000715001',
       ownership_attestation_id =
         '00000000-0000-0000-0000-000000715011'
 WHERE id = 715001;

INSERT INTO public."EOT_GR_data" (
  "Guild", "Season", "damageType", "loopIndex", set,
  rarity, "encounterId"
) VALUES
  ('LOOPSET-A', '715', 'Battle', 0, 0, 'Legendary', 0),
  ('LOOPSET-B', '715', 'Battle', 0, 0, 'Legendary', 0);

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000715001',
  true
);

SELECT lives_ok(
  $$SELECT * FROM public.get_token_usage_by_loop_and_set(
      'LOOPSET-A', '715', ARRAY['Legendary']
    )$$,
  'authenticated caller can execute without direct player_mapping SELECT'
);

SELECT results_eq(
  $$SELECT loop_index, set_key, token_count
      FROM public.get_token_usage_by_loop_and_set(
        'LOOPSET-A', '715', ARRAY['Legendary']
      )$$,
  $$VALUES (0, 'L1'::text, 1)$$,
  'authenticated caller receives its guild token stack'
);

SELECT is(
  (SELECT count(*)::integer
     FROM public.get_token_usage_by_loop_and_set(
       'LOOPSET-B', '715', ARRAY['Legendary']
     )),
  0,
  'authenticated caller cannot read an unrelated guild token stack'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
