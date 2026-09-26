BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;
SET LOCAL timezone TO 'UTC';

-- The target cluster must come from guild_config, not coalesce(p_cluster_code, own cluster).
-- player_with_cluster is a stub table here (a view on live).

SELECT plan(9);

SELECT has_function(
  'public',
  'get_player_token_state',
  ARRAY['text', 'text', 'text', 'text'],
  'get_player_token_state exposes the token-state surface'
);

INSERT INTO public.guild_config (guild_code, display_name, cluster_code)
VALUES
  ('WI3790A',  'WI3790 Home Guild (cluster A)',        'CLUSTERA'),
  ('WI3790A2', 'WI3790 Sibling Guild (cluster A)',     'CLUSTERA'),
  ('WI3790B',  'WI3790 Foreign Guild (cluster B)',     'CLUSTERB')
ON CONFLICT (guild_code) DO NOTHING;

INSERT INTO public.player_with_cluster (user_id, guild_code, cluster_code, role, is_current)
VALUES
  ('00000000-0000-0000-0000-000000037901', 'WI3790A', 'CLUSTERA', 'officer', true),
  ('00000000-0000-0000-0000-000000037906', 'WI3790A', 'CLUSTERA', 'member',  true);

INSERT INTO public.player_mapping (id, player_id, display_name, guild_code, is_current)
VALUES
  (937901, 'wi3790-a-mem',  'WI3790 A Member',  'WI3790A',  true),
  (937902, 'wi3790-a2-mem', 'WI3790 A2 Member', 'WI3790A2', true),
  (937903, 'wi3790-b-mem',  'WI3790 B Member',  'WI3790B',  true);

-- Service-role-only RPC; EXECUTE is granted here to exercise the defense-in-depth branches.
GRANT USAGE ON SCHEMA public, extensions TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA extensions TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_player_token_state(text, text, text, text) TO anon, authenticated;

-- 1 (exploit): cluster-A officer, cluster-B guild, p_cluster_code omitted -> deny.
SELECT set_config('request.jwt.claim.sub',  '00000000-0000-0000-0000-000000037901', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.get_player_token_state('WI3790B', '90000', null, null) s),
  0,
  'CASE 1 exploit: officer (cluster A) reading a cluster-B guild with p_cluster_code OMITTED returns 0 rows (IDOR closed)'
);

-- 2 (spoof): p_cluster_code = own cluster does not override guild_config.
SELECT is(
  (SELECT count(*)::int FROM public.get_player_token_state('WI3790B', '90000', 'CLUSTERA', null) s),
  0,
  'CASE 2 spoof: p_cluster_code spoofed to the requester''s own cluster still returns 0 rows for a cluster-B guild'
);

SELECT ok(
  (SELECT count(*) > 0 FROM public.get_player_token_state('WI3790A2', '90000', null, null) s),
  'CASE 3 allow: officer reading a same-cluster sibling guild still returns rows (legitimate cross-guild access preserved)'
);

SELECT ok(
  (SELECT count(*) > 0 FROM public.get_player_token_state('WI3790A', '90000', null, null) s),
  'CASE 4 baseline: officer reading their own guild returns rows'
);

RESET ROLE;
SELECT set_config('request.jwt.claim.sub',  '', true);
SELECT set_config('request.jwt.claim.role', 'anon', true);
SET LOCAL ROLE anon;

SELECT is(
  (SELECT count(*)::int FROM public.get_player_token_state('WI3790A', '90000', null, null) s),
  0,
  'CASE 5 anon: null uid + explicit anon claim returns 0 rows (WI-3660 in-function deny preserved)'
);

RESET ROLE;
SELECT set_config('request.jwt.claim.sub',  '00000000-0000-0000-0000-000000037906', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.get_player_token_state('WI3790A2', '90000', null, null) s),
  0,
  'CASE 6 member: a member reading another guild (even same-cluster) returns 0 rows (role gate preserved)'
);

-- A service_role JWT claim without the database role returns nothing.
RESET ROLE;
SELECT set_config('request.jwt.claim.sub',  '', true);
SELECT set_config('request.jwt.claim.role', 'service_role', true);

SELECT is(
  (SELECT count(*)::int FROM public.get_player_token_state('WI3790B', '90000', null, null) s),
  0,
  'CASE 7 service claim only: a JWT role claim without the effective service_role database role returns 0 rows'
);

-- Real service_role reads cluster B, proving 1-2 are real denials.
SET LOCAL ROLE service_role;

SELECT ok(
  (SELECT count(*) > 0 FROM public.get_player_token_state('WI3790B', '90000', null, null) s),
  'CASE 8 effective service-role: service_role bypass reads the cluster-B guild (proves the CASE 1-2 fixture is non-empty)'
);

RESET ROLE;
SELECT set_config('request.jwt.claim.sub',  '', true);
SELECT set_config('request.jwt.claim.role', '', true);

SELECT finish();
ROLLBACK;
