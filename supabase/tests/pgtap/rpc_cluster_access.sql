BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;

-- The get_cluster_guilds family stays dropped: its result type declares api_key text.

SELECT plan(6);

INSERT INTO public.clusters (id, cluster_code, display_name, created_at)
VALUES
  ('00000000-0000-0000-0000-00000000E001', 'CLU', 'Cluster Prime', now()),
  ('00000000-0000-0000-0000-00000000A002', 'AUX', 'Auxiliary Cluster', now());

INSERT INTO public.guild_config (
  id,
  guild_code,
  display_name,
  cluster_code,
  cluster_id,
  created_at,
  enabled
)
VALUES
  (90001, 'CLU-ALPHA', 'CLU Alpha', 'CLU', '00000000-0000-0000-0000-00000000E001', now(), true),
  (90002, 'CLU-BETA', 'CLU Beta', 'CLU', '00000000-0000-0000-0000-00000000E001', now(), true),
  (90003, 'AUX-OMEGA', 'Aux Omega', 'AUX', '00000000-0000-0000-0000-00000000A002', now(), true);

ALTER TABLE auth.users DISABLE TRIGGER USER;
INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'leader-one@rpc-cluster-access.test'),
  ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'officer-two@rpc-cluster-access.test');

INSERT INTO public.player_mapping (
  id,
  user_id,
  player_id,
  display_name,
  guild_code,
  cluster_code,
  role,
  is_current,
  created_at,
  updated_at
)
VALUES
  (
    91001,
    '00000000-0000-0000-0000-000000000001',
    'player-leader',
    'Leader One',
    'CLU-ALPHA',
    'CLU',
    'leader'::public.app_role,
    true,
    now(),
    now()
  ),
  (
    91002,
    '00000000-0000-0000-0000-000000000002',
    'player-officer',
    'Officer Two',
    'AUX-OMEGA',
    'AUX',
    'officer'::public.app_role,
    true,
    now(),
    now()
  );

SELECT has_function(
  'public',
  'get_user_cluster_context',
  ARRAY['uuid'],
  'get_user_cluster_context(uuid) exists'
);

SELECT row_eq(
  $$
    SELECT cluster_code, cluster_name, is_leader, is_officer
    FROM public.get_user_cluster_context('00000000-0000-0000-0000-000000000001'::uuid)
  $$,
  ROW('CLU'::varchar, 'Cluster Prime'::text, true, true),
  'Leader context resolves to the expected cluster metadata'
);

SELECT row_eq(
  $$
    SELECT cluster_code, cluster_name, is_leader, is_officer
    FROM public.get_user_cluster_context('00000000-0000-0000-0000-000000000002'::uuid)
  $$,
  ROW('AUX'::varchar, 'Auxiliary Cluster'::text, false, true),
  'Officer context resolves to the expected cluster metadata'
);

SELECT hasnt_function(
  'public',
  'get_cluster_guilds',
  ARRAY[]::text[],
  'get_cluster_guilds() was dropped (WI-4550)'
);

SELECT hasnt_function(
  'public',
  'get_cluster_guilds',
  ARRAY['character varying'],
  'get_cluster_guilds(varchar) was dropped (WI-4550)'
);

SELECT hasnt_function(
  'public',
  'get_cluster_guilds_by_code',
  ARRAY['text'],
  'get_cluster_guilds_by_code(text) was dropped (WI-4550)'
);

SELECT finish();
ROLLBACK;
