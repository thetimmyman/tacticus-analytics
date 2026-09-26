BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;

SELECT plan(7);

SELECT is(
  (SELECT count(*)::integer
     FROM supabase_migrations.schema_migrations
    WHERE version = '20260903200000'
      AND name = 'guild_member_stats_rpc'),
  1,
  'guild-member-stats migration is recorded exactly once'
);

SELECT ok(
  (SELECT NOT p.prosecdef
          AND p.provolatile = 's'
          AND p.proconfig = ARRAY['search_path=""']::text[]
     FROM pg_catalog.pg_proc AS p
    WHERE p.oid =
      'public.get_guild_member_stats(text,text)'::regprocedure),
  'guild-member-stats RPC is stable, invoker-owned, and search-path hardened'
);

SELECT ok(
  has_function_privilege(
    'anon', 'public.get_guild_member_stats(text,text)', 'EXECUTE'
  ) = false
  AND has_function_privilege(
    'authenticated', 'public.get_guild_member_stats(text,text)', 'EXECUTE'
  )
  AND has_function_privilege(
    'service_role', 'public.get_guild_member_stats(text,text)', 'EXECUTE'
  ),
  'RPC is executable only by authenticated and service roles'
);

INSERT INTO public.guild_config (
  id, guild_code, display_name, created_at, enabled,
  token_offender_threshold, token_abuser_threshold
) VALUES
  (932001, 'MEMBER-STATS-A', 'Member Stats Guild A', now(), true, 1, 2),
  (932002, 'MEMBER-STATS-B', 'Member Stats Guild B', now(), true, 1, 2);

INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES (
  '00000000-0000-0000-0000-000000932001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'member-stats-a@example.test'
);

INSERT INTO public.player_mapping (
  id, player_id, display_name, guild_code, role,
  is_current, is_app_admin, created_at, updated_at
) VALUES
  (
    932001, 'member-stats-a', 'Member Stats A', 'MEMBER-STATS-A',
    'member'::public.app_role, true, false,
    now() - interval '2 days', now() - interval '2 days'
  ),
  (
    932002, 'member-stats-b', 'Member Stats B', 'MEMBER-STATS-B',
    'member'::public.app_role, true, false,
    now() - interval '2 days', now() - interval '2 days'
  );

INSERT INTO public.player_identity_attestations (
  id, mapping_id, player_id, subject_user_id, consumed_at, attested_at,
  source, guild_code_snapshot
) VALUES (
  '00000000-0000-0000-0000-000000932011',
  932001,
  'member-stats-a',
  '00000000-0000-0000-0000-000000932001',
  clock_timestamp(),
  clock_timestamp(),
  'operator_quarantine_restore',
  'MEMBER-STATS-A'
);

UPDATE public.player_mapping
   SET user_id = '00000000-0000-0000-0000-000000932001',
       ownership_attestation_id =
         '00000000-0000-0000-0000-000000932011'
 WHERE id = 932001;

INSERT INTO public."EOT_GR_data" (
  "Guild", "Season", "damageType", rarity, "Name", "userId",
  "damageDealt", "timestamp", "encounterId"
) VALUES
  (
    'MEMBER-STATS-A', '932', 'Battle', 'Legendary', 'Boss One',
    'member-stats-a', 100, now() - interval '1 day', 932001
  ),
  (
    'MEMBER-STATS-A', '932', 'Battle', 'Mythic', 'Boss Two',
    'member-stats-a', 200, now() - interval '1 hour', 932002
  ),
  (
    'MEMBER-STATS-A', '932', 'Bomb', 'Legendary', 'Boss Two',
    'member-stats-a', 50, now() - interval '30 minutes', 932003
  ),
  (
    'MEMBER-STATS-B', '932', 'Battle', 'Legendary', 'Foreign Boss',
    'member-stats-b', 999, now() - interval '1 hour', 932004
  );

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000932001',
  true
);

SELECT lives_ok(
  $$SELECT * FROM public.get_guild_member_stats('MEMBER-STATS-A', '932')$$,
  'authenticated caller can aggregate its guild under RLS'
);

SELECT results_eq(
  $$SELECT total_damage, battle_count, bomb_count, tokens_used,
           average_damage, max_damage, token_status
      FROM public.get_guild_member_stats('MEMBER-STATS-A', '932')$$,
  $$VALUES (350::bigint, 2, 1, 2, 175::double precision,
            200::bigint, 'offender'::text)$$,
  'RPC preserves the existing damage, token, and threshold calculations'
);

SELECT results_eq(
  $$SELECT legendary_battles, unique_bosses_fought, battles_last_7_days
      FROM public.get_guild_member_stats('MEMBER-STATS-A', '932')$$,
  $$VALUES (3, 2, 3)$$,
  'RPC computes rarity, unique-boss, and recent-battle statistics'
);

SELECT is(
  (SELECT count(*)::integer
     FROM public.get_guild_member_stats('MEMBER-STATS-B', '932')),
  0,
  'authenticated caller cannot aggregate an unrelated guild'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
