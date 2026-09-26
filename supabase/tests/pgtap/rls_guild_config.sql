BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;

SELECT plan(7);

INSERT INTO public.clusters (id, cluster_code, display_name, created_at)
VALUES
  ('00000000-0000-0000-0000-00000000E101', 'CLU', 'Cluster Prime', now()),
  ('00000000-0000-0000-0000-00000000A202', 'CLV', 'Cluster Second', now());

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
  (95001, 'CLU-PRIME', 'CLU Prime', 'CLU', '00000000-0000-0000-0000-00000000E101', now(), true),
  (95002, 'CLU-SIGMA', 'CLU Sigma', 'CLU', '00000000-0000-0000-0000-00000000E101', now(), true),
  (95003, 'CLV-OMEGA', 'Aux Omega', 'CLV', '00000000-0000-0000-0000-00000000A202', now(), true);

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
    96001,
    '00000000-0000-0000-0000-00000000E111',
    'leader-prime',
    'Leader Prime',
    'CLU-PRIME',
    'CLU',
    'leader'::public.app_role,
    true,
    now(),
    now()
  ),
  (
    96002,
    '00000000-0000-0000-0000-00000000A222',
    'officer-aux',
    'Officer Aux',
    'CLV-OMEGA',
    'CLV',
    'officer'::public.app_role,
    true,
    now(),
    now()
  );

SELECT has_policy(
  'public',
  'guild_config',
  'Leaders can update their guild config',
  'Policy for leader-owned guild updates exists'
);

SELECT has_policy(
  'public',
  'guild_config',
  'Leaders can update cluster guild configs',
  'Policy for cluster-wide leader updates exists'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000E111', true);
SELECT is(
  (
    SELECT count(*)::int
    FROM (
      UPDATE public.guild_config
      SET tagline = 'Leader updated own guild', updated_at = now()
      WHERE guild_code = 'CLU-PRIME'
      RETURNING 1
    ) AS updated
  ),
  1,
  'Guild leader can update their own guild config'
);
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', true);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000E111', true);
SELECT is(
  (
    SELECT count(*)::int
    FROM (
      UPDATE public.guild_config
      SET tagline = 'Leader updated cluster guild', updated_at = now()
      WHERE guild_code = 'CLU-SIGMA'
      RETURNING 1
    ) AS updated
  ),
  1,
  'Cluster leader can update other guilds within their cluster'
);
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', true);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000E111', true);
SELECT is(
  (
    SELECT count(*)::int
    FROM (
      UPDATE public.guild_config
      SET tagline = 'Leader attempted cross-cluster update', updated_at = now()
      WHERE guild_code = 'CLV-OMEGA'
      RETURNING 1
    ) AS updated
  ),
  0,
  'Cluster leader cannot update guilds in other clusters'
);
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', true);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000A222', true);
SELECT is(
  (
    SELECT count(*)::int
    FROM (
      UPDATE public.guild_config
      SET tagline = 'Officer attempted guild update', updated_at = now()
      WHERE guild_code = 'CLV-OMEGA'
      RETURNING 1
    ) AS updated
  ),
  0,
  'Officers cannot update guild configs'
);
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', true);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000FFFF', true);
SELECT is(
  (
    SELECT count(*)::int
    FROM (
      UPDATE public.guild_config
      SET tagline = 'Unaffiliated attempt', updated_at = now()
      WHERE guild_code = 'CLU-PRIME'
      RETURNING 1
    ) AS updated
  ),
  0,
  'Users without a player mapping cannot update guild configs'
);
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', true);

SELECT finish();
ROLLBACK;
