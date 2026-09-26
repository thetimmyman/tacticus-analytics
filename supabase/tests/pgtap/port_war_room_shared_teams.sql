BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;
SET LOCAL timezone TO 'UTC';
SELECT set_config('request.jwt.claims', '', true);
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', '', true);

SELECT plan(40);

SELECT is(
  (
    SELECT count(*)::integer
      FROM supabase_migrations.schema_migrations
     WHERE version = '20260925060000'
       AND name = 'port_war_room_shared_teams'
  ),
  1,
  'the shared-team migration is recorded exactly once'
);

SELECT has_table(
  'public',
  'guild_war_meta_teams',
  'guild_war_meta_teams exists'
);

SELECT is(
  (
    SELECT array_agg(column_name::text ORDER BY ordinal_position)
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'guild_war_meta_teams'
  ),
  ARRAY[
    'id', 'guild_code', 'name', 'side', 'priority', 'notes', 'heroes',
    'created_by', 'created_at', 'updated_at'
  ]::text[],
  'the table has exactly the ten shared-team columns in dependency order'
);

SELECT is(
  (
    SELECT array_agg(format_type(a.atttypid, a.atttypmod)
                    ORDER BY a.attnum)
      FROM pg_attribute a
     WHERE a.attrelid = 'public.guild_war_meta_teams'::regclass
       AND a.attnum > 0
       AND NOT a.attisdropped
  ),
  ARRAY[
    'uuid', 'text', 'text', 'text', 'integer', 'text', 'jsonb', 'uuid',
    'timestamp with time zone', 'timestamp with time zone'
  ]::text[],
  'the shared-team columns retain their SQL types'
);

SELECT is(
  (
    SELECT count(*)::integer
      FROM pg_constraint
     WHERE conrelid = 'public.guild_war_meta_teams'::regclass
       AND contype = 'p'
       AND pg_get_constraintdef(oid) = 'PRIMARY KEY (id)'
  ),
  1,
  'guild_war_meta_teams has its uuid primary key'
);

SELECT is(
  (
    SELECT count(*)::integer
      FROM pg_constraint
     WHERE conrelid = 'public.guild_war_meta_teams'::regclass
       AND conname = 'guild_war_meta_teams_guild_code_fkey'
       AND contype = 'f'
       AND confrelid = 'public.guild_config'::regclass
       AND pg_get_constraintdef(oid) =
         'FOREIGN KEY (guild_code) REFERENCES guild_config(guild_code) ON DELETE CASCADE'
  ),
  1,
  'guild_code cascades from the registered guild'
);

SELECT is(
  (
    SELECT count(*)::integer
      FROM pg_constraint
     WHERE conrelid = 'public.guild_war_meta_teams'::regclass
       AND conname = 'guild_war_meta_teams_unique_name'
       AND contype = 'u'
       AND pg_get_constraintdef(oid) = 'UNIQUE (guild_code, name)'
  ),
  1,
  'team names are unique within a guild'
);

SELECT ok(
  to_regclass('public.idx_guild_war_meta_teams_guild_side') IS NOT NULL,
  'the guild/side/priority read index exists'
);

SELECT is(
  public.tacticus_rank_index('Silver I'),
  9,
  'rank index maps Silver I to 9'
);

SELECT is(
  public.tacticus_rank_name(9),
  'Silver I'::text,
  'rank name maps 9 back to Silver I'
);

SELECT ok(
  public.tacticus_rank_index('Not a rank') IS NULL
    AND public.tacticus_rank_name(99) IS NULL,
  'unknown rank labels and indexes return NULL'
);

SELECT has_function(
  'public',
  'guild_war_meta_teams_validate_heroes',
  ARRAY[]::text[],
  'the hero validation trigger function exists'
);

SELECT has_function(
  'public',
  'guild_war_meta_teams_set_updated_at',
  ARRAY[]::text[],
  'the updated-at trigger function exists'
);

SELECT is(
  (
    SELECT count(*)::integer
      FROM pg_trigger
     WHERE tgrelid = 'public.guild_war_meta_teams'::regclass
       AND NOT tgisinternal
       AND tgname IN (
         'trg_guild_war_meta_teams_validate_heroes',
         'trg_guild_war_meta_teams_updated_at'
       )
  ),
  2,
  'both shared-team maintenance triggers are installed'
);

-- Catalog shape pins the policy set; the behavioural probes prove whom it admits.
SELECT is(
  (
    SELECT count(*)::integer
      FROM pg_policy
     WHERE polrelid = 'public.guild_war_meta_teams'::regclass
  ),
  3,
  'the table has exactly the cluster-read, leadership-write, and service policies'
);

SELECT is(
  (
    SELECT count(*)::integer
      FROM pg_policy
     WHERE polrelid = 'public.guild_war_meta_teams'::regclass
       AND polname = 'guild_war_meta_teams_leader_write'
       AND pg_get_expr(polqual, polrelid) ~ '_pm_caller_policy_rows'
       AND pg_get_expr(polwithcheck, polrelid) ~ '_pm_caller_policy_rows'
  ),
  1,
  'the leadership write policy resolves caller mappings through the TA helper'
);

SELECT is(
  (
    SELECT count(*)::integer
      FROM pg_policy
     WHERE polrelid = 'public.guild_war_meta_teams'::regclass
       AND polname IN (
         'guild_war_meta_teams_member_read',
         'guild_war_meta_teams_leader_write'
       )
       AND (
         pg_get_expr(polqual, polrelid)
           ~ '(FROM|JOIN)\s+(public\.)?player_mapping\M'
         OR pg_get_expr(polwithcheck, polrelid)
           ~ '(FROM|JOIN)\s+(public\.)?player_mapping\M'
       )
  ),
  0,
  'authenticated policies never read player_mapping as a base relation'
);

SELECT ok(
  NOT has_table_privilege(
    'anon', 'public.guild_war_meta_teams', 'SELECT'
  ),
  'anon cannot read shared guild teams'
);

SELECT ok(
  NOT has_table_privilege('authenticated', 'public.guild_war_meta_teams', 'SELECT')
    AND NOT has_column_privilege(
      'authenticated', 'public.guild_war_meta_teams', 'created_by', 'SELECT'
    ),
  'authenticated has no broad SELECT grant and cannot select created_by'
);

SELECT is(
  (
    SELECT array_agg(a.attname::text ORDER BY a.attnum)
      FROM pg_catalog.pg_attribute a
     WHERE a.attrelid = 'public.guild_war_meta_teams'::regclass
       AND a.attnum > 0
       AND NOT a.attisdropped
       AND has_column_privilege(
         'authenticated', a.attrelid, a.attname, 'SELECT'
       )
  ),
  ARRAY[
    'id', 'guild_code', 'name', 'side', 'priority', 'notes', 'heroes',
    'created_at', 'updated_at'
  ]::text[],
  'authenticated can select every shared-team column except created_by'
);

SELECT ok(
  has_table_privilege('authenticated', 'public.guild_war_meta_teams', 'INSERT')
    AND has_table_privilege(
      'authenticated', 'public.guild_war_meta_teams', 'UPDATE'
    )
    AND has_table_privilege(
      'authenticated', 'public.guild_war_meta_teams', 'DELETE'
    ),
  'authenticated retains the table privileges needed by leadership CRUD'
);

SELECT ok(
  has_table_privilege('service_role', 'public.guild_war_meta_teams', 'SELECT')
    AND has_table_privilege(
      'service_role', 'public.guild_war_meta_teams', 'INSERT'
    )
    AND has_table_privilege(
      'service_role', 'public.guild_war_meta_teams', 'UPDATE'
    )
    AND has_table_privilege(
      'service_role', 'public.guild_war_meta_teams', 'DELETE'
    ),
  'service_role retains full table access'
);

-- Hero validation runs as the privileged suite role so RLS cannot mask a trigger defect.
SELECT throws_ok(
  $$
    INSERT INTO public.guild_war_meta_teams (guild_code, name, side, heroes)
    VALUES (
      'WROOM-A', 'Not object', 'offense',
      '[null]'::jsonb
    )
  $$,
  'P0001',
  NULL,
  'the trigger rejects non-object hero entries'
);

SELECT throws_ok(
  $$
    INSERT INTO public.guild_war_meta_teams (guild_code, name, side, heroes)
    VALUES (
      'WROOM-A', 'Missing id', 'offense',
      '[{"role":"core"}]'::jsonb
    )
  $$,
  'P0001',
  NULL,
  'the trigger rejects a hero without unitId'
);

SELECT throws_ok(
  $$
    INSERT INTO public.guild_war_meta_teams (guild_code, name, side, heroes)
    VALUES (
      'WROOM-A', 'Bad role', 'offense',
      '[{"unitId":"alpha","role":"boss"}]'::jsonb
    )
  $$,
  'P0001',
  NULL,
  'the trigger rejects a role outside core/flex/mow'
);

SELECT throws_ok(
  $$
    INSERT INTO public.guild_war_meta_teams (guild_code, name, side, heroes)
    VALUES (
      'WROOM-A', 'Duplicate', 'offense',
      '[{"unitId":"alpha","role":"core"},{"unitId":"alpha","role":"flex"}]'::jsonb
    )
  $$,
  'P0001',
  NULL,
  'the trigger rejects duplicate hero unitIds'
);

SELECT throws_ok(
  $$
    INSERT INTO public.guild_war_meta_teams (guild_code, name, side, heroes)
    VALUES (
      'WROOM-A', 'Too many', 'offense',
      (
        SELECT jsonb_agg(
          jsonb_build_object('unitId', 'hero-' || n, 'role', 'flex')
        )
        FROM generate_series(1, 16) AS n
      )
    )
  $$,
  '23514',
  NULL,
  'the table check rejects more than 15 heroes'
);

-- Identity-attestation triggers are off only for fixture writes.
ALTER TABLE auth.users DISABLE TRIGGER USER;
INSERT INTO auth.users (id, email, aud, role)
VALUES
  (
    '00000000-0000-4000-8000-000000009001',
    'wroom-leader@example.invalid',
    'authenticated',
    'authenticated'
  ),
  (
    '00000000-0000-4000-8000-000000009002',
    'wroom-member@example.invalid',
    'authenticated',
    'authenticated'
  ),
  (
    '00000000-0000-4000-8000-000000009003',
    'wroom-outsider@example.invalid',
    'authenticated',
    'authenticated'
  );
ALTER TABLE auth.users ENABLE TRIGGER USER;

INSERT INTO public.guild_config (guild_code, display_name)
VALUES
  ('WROOM-A', 'War Room A'),
  ('WROOM-B', 'War Room B');

ALTER TABLE public.player_mapping DISABLE TRIGGER USER;
INSERT INTO public.player_mapping (
  player_id, display_name, user_id, guild_code, role, is_current, is_active
)
VALUES
  (
    'WROOM-LEADER', 'War Room Leader',
    '00000000-0000-4000-8000-000000009001',
    'WROOM-A', 'leader'::public.app_role, true, true
  ),
  (
    'WROOM-MEMBER', 'War Room Member',
    '00000000-0000-4000-8000-000000009002',
    'WROOM-A', 'member'::public.app_role, true, true
  ),
  (
    'WROOM-OUTSIDER', 'War Room Outsider',
    '00000000-0000-4000-8000-000000009003',
    'WROOM-B', 'leader'::public.app_role, true, true
  );
ALTER TABLE public.player_mapping ENABLE TRIGGER USER;

-- Transaction-local grants so switched roles can call pgTAP functions.
GRANT USAGE ON SCHEMA extensions TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA extensions TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '00000000-0000-4000-8000-000000009001',
  true
);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000009001","role":"authenticated"}',
  true
);

SELECT lives_ok(
  $$
    INSERT INTO public.guild_war_meta_teams (
      guild_code, name, side, priority, notes, heroes
    )
    VALUES (
      'WROOM-A', 'Ork swarm', 'offense', 2, 'Hold the center',
      '[
        {"unitId":"alpha","role":"core"},
        {"unitId":"beta","role":"core"},
        {"unitId":"gamma","role":"flex"}
      ]'::jsonb
    )
    RETURNING id, guild_code, name, side, priority, notes, heroes,
      created_at, updated_at
  $$,
  'a current guild leader can create and return the safe shared-team columns'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '00000000-0000-4000-8000-000000009002',
  true
);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000009002","role":"authenticated"}',
  true
);

SELECT is(
  (SELECT count(*)::bigint FROM public.guild_war_meta_teams),
  1::bigint,
  'a member of the same guild can read the shared team'
);

SELECT throws_ok(
  $$
    INSERT INTO public.guild_war_meta_teams (
      guild_code, name, side, heroes
    )
    VALUES (
      'WROOM-A', 'Member cannot write', 'defense',
      '[{"unitId":"delta","role":"core"}]'::jsonb
    )
  $$,
  '42501',
  NULL,
  'a same-guild member cannot create a shared team'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '00000000-0000-4000-8000-000000009003',
  true
);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000009003","role":"authenticated"}',
  true
);

SELECT is(
  (SELECT count(*)::bigint FROM public.guild_war_meta_teams),
  0::bigint,
  'a leader of an unclustered other guild sees no shared teams'
);

RESET ROLE;
INSERT INTO public.clusters (id, cluster_code, display_name, created_at)
VALUES (
  '00000000-0000-4000-8000-00000000C101', 'WROOM-C', 'War Room Cluster', now()
);
-- A trigger derives cluster_id, which _pm_caller_cluster_guild_codes() joins on.
UPDATE public.guild_config
   SET cluster_code = 'WROOM-C'
 WHERE guild_code IN ('WROOM-A', 'WROOM-B');
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::bigint FROM public.guild_war_meta_teams),
  1::bigint,
  'a leader of a guild in the same cluster can read the shared team'
);

SELECT throws_ok(
  $$
    INSERT INTO public.guild_war_meta_teams (
      guild_code, name, side, heroes
    )
    VALUES (
      'WROOM-A', 'Outsider cannot write', 'offense',
      '[{"unitId":"epsilon","role":"core"}]'::jsonb
    )
  $$,
  '42501',
  NULL,
  'a leader of another guild cannot write the first guild shared teams'
);

-- leader_write's USING hides the row from a sibling leader, so both touch zero rows.
SELECT lives_ok(
  $$
    UPDATE public.guild_war_meta_teams
       SET notes = 'Outsider overwrite'
     WHERE guild_code = 'WROOM-A'
  $$,
  'an outsider UPDATE on a readable shared team runs without error'
);

SELECT lives_ok(
  $$
    DELETE FROM public.guild_war_meta_teams
     WHERE guild_code = 'WROOM-A'
  $$,
  'an outsider DELETE on a readable shared team runs without error'
);

SELECT is(
  (
    SELECT notes FROM public.guild_war_meta_teams
     WHERE guild_code = 'WROOM-A' AND name = 'Ork swarm'
  ),
  'Hold the center',
  'a leader of another guild cannot update a shared team they can read'
);

SELECT is(
  (SELECT count(*)::bigint FROM public.guild_war_meta_teams),
  1::bigint,
  'a leader of another guild cannot delete a shared team they can read'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '00000000-0000-4000-8000-000000009001',
  true
);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000009001","role":"authenticated"}',
  true
);

SELECT lives_ok(
  $$
    UPDATE public.guild_war_meta_teams
       SET notes = 'Updated through the leadership policy'
     WHERE guild_code = 'WROOM-A'
       AND name = 'Ork swarm'
  $$,
  'a current guild leader can update the shared team'
);

SELECT lives_ok(
  $$
    DELETE FROM public.guild_war_meta_teams
     WHERE guild_code = 'WROOM-A'
       AND name = 'Ork swarm'
  $$,
  'a current guild leader can delete the shared team'
);

RESET ROLE;

SELECT is(
  (SELECT count(*)::bigint FROM public.guild_war_meta_teams),
  0::bigint,
  'the behavioral lifecycle inserted, updated, and deleted exactly the fixture row'
);

SELECT * FROM finish();
ROLLBACK;
