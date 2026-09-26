-- auth_user_emails no longer lends its owner's rights and authenticated loses avatar_url.
-- pgTAP leaves search_path under a switched role, so probes record SQLSTATEs into a temp table.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;
SET LOCAL timezone TO 'UTC';

SELECT NOT EXISTS (
  SELECT 1
  FROM supabase_migrations.schema_migrations
  WHERE version = '20260908011000'
    AND name = 'ps397_auth_user_emails_invoker_avatar_revoke'
) AS ps397_not_applied \gset

-- analytics_ro is a hand-made production login; 8 skips without it.
SELECT NOT EXISTS (
  SELECT 1 FROM pg_roles WHERE rolname = 'analytics_ro'
) AS no_analytics_ro \gset

\if :ps397_not_applied
SELECT plan(12);
SELECT * FROM skip(
  12,
  'this database predates PS-397; the replay lane applies 20260908011000 and then executes this suite fully'
);
SELECT * FROM finish();
ROLLBACK;
\else

SELECT plan(12);

SELECT is(
  current_database()::text,
  'postgres'::text,
  '1. this suite runs against the general database'::text
);

SELECT is(
  (SELECT count(*)::integer
     FROM supabase_migrations.schema_migrations
    WHERE version = '20260908011000'
      AND name = 'ps397_auth_user_emails_invoker_avatar_revoke'),
  1,
  '2. the PS-397 migration is recorded exactly once in the ledger'
);

SELECT ok(
  (SELECT c.reloptions @> ARRAY['security_invoker=on']
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'auth_user_emails'),
  '3. public.auth_user_emails carries security_invoker=on, so it reads auth.users as the caller and the empty policy set on auth.users decides'
);

SELECT is(
  has_column_privilege('authenticated', 'public.player_mapping', 'avatar_url', 'SELECT'),
  false,
  '4. authenticated holds no column SELECT on player_mapping.avatar_url'
);

SELECT is(
  (SELECT count(*)::integer
     FROM (VALUES ('display_name'), ('player_id'), ('guild_code'), ('cluster_code'),
                  ('is_current'), ('avatar_unit_id'))
       AS kept(column_name)
    WHERE NOT has_column_privilege('authenticated', 'public.player_mapping', kept.column_name, 'SELECT')),
  0,
  '5. NOT-AN-OVER-REACH: the rest of the 20260817000000 column allow-list survives'
);

SELECT is(
  (SELECT count(*)::integer
     FROM (VALUES ('discord_user_id'), ('discord_username'), ('user_id'), ('username'))
       AS withheld(column_name)
    WHERE has_column_privilege('authenticated', 'public.player_mapping', withheld.column_name, 'SELECT')),
  0,
  '6. the identifiers 20260817000000 deliberately withheld are still withheld'
);

SELECT is(
  has_table_privilege('service_role', 'public.auth_user_emails', 'SELECT'),
  true,
  '7. INVARIANT 1: service_role keeps SELECT on public.auth_user_emails (the admin search, ban, incident-notification and feature-release paths)'
);

\if :no_analytics_ro
SELECT * FROM skip(
  1,
  '8. analytics_ro does not exist here -- it is a production-only login created by hand (ledger 20260802060000), so the revoke cannot be asserted on this database'
);
\else
SELECT is(
  has_table_privilege('analytics_ro', 'public.auth_user_emails', 'SELECT'),
  false,
  '8. INVARIANT 2: analytics_ro holds no SELECT on public.auth_user_emails'
);
\endif

SELECT is(
  (SELECT count(*)::integer
     FROM (VALUES ('anon'), ('authenticated')) AS r(rolename)
    WHERE has_table_privilege(r.rolename, 'public.auth_user_emails', 'SELECT')),
  0,
  '9. INVARIANT 4: anon and authenticated still cannot read the view (publication_security_boundaries stays green)'
);

CREATE TEMP TABLE ps397_probe(label text PRIMARY KEY, sqlstate text, value text)
  ON COMMIT DROP;

DO $seed$
DECLARE
  v_self uuid := '39700000-0000-4000-8000-000000000001';
  v_peer uuid := '39700000-0000-4000-8000-000000000002';
BEGIN
  INSERT INTO auth.users (id, email, aud, role)
  VALUES (v_self, 'ps397-self@example.invalid', 'authenticated', 'authenticated'),
         (v_peer, 'ps397-peer@example.invalid', 'authenticated', 'authenticated');

  INSERT INTO public.guild_config (guild_code, display_name)
  VALUES ('PS397GUILD', 'PS-397 fixture guild');

  ALTER TABLE public.player_mapping DISABLE TRIGGER USER;

  INSERT INTO public.player_mapping
    (player_id, display_name, user_id, guild_code, avatar_url, is_current, is_active)
  VALUES
    ('PS397SELF', 'PS-397 self', v_self, 'PS397GUILD',
     'https://cdn.discordapp.com/avatars/000000000000000001/ps397self.png', true, true),
    ('PS397PEER', 'PS-397 peer', v_peer, 'PS397GUILD',
     'https://cdn.discordapp.com/avatars/000000000000000002/ps397peer.png', true, true);

  ALTER TABLE public.player_mapping ENABLE TRIGGER USER;
END
$seed$;

DO $probe$
DECLARE
  v_self text := '39700000-0000-4000-8000-000000000001';
  v_own_avatar text;
  v_own_state text;
  v_peer_avatar text;
  v_peer_state text;
  v_peer_name text;
  v_peer_name_state text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_self, true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_self, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- Results are written only after RESET ROLE: the temp table belongs to the suite's role, so writing
  -- it as `authenticated` would raise its own 42501.

  BEGIN
    SELECT m.avatar_url INTO v_own_avatar
      FROM public.current_user_player_mapping AS m
     WHERE m.player_id = 'PS397SELF';
    v_own_state := '00000';
  EXCEPTION WHEN OTHERS THEN
    v_own_state := SQLSTATE;
  END;

  BEGIN
    SELECT m.avatar_url INTO v_peer_avatar
      FROM public.player_mapping AS m
     WHERE m.player_id = 'PS397PEER';
    v_peer_state := '00000';
  EXCEPTION WHEN OTHERS THEN
    v_peer_state := SQLSTATE;
  END;

  -- Not-a-lockout control: the same peer row stays readable through an allow-listed column.
  BEGIN
    SELECT m.display_name INTO v_peer_name
      FROM public.player_mapping AS m
     WHERE m.player_id = 'PS397PEER';
    v_peer_name_state := '00000';
  EXCEPTION WHEN OTHERS THEN
    v_peer_name_state := SQLSTATE;
  END;

  RESET ROLE;

  INSERT INTO ps397_probe VALUES
    ('own_avatar', v_own_state, v_own_avatar),
    ('peer_avatar', v_peer_state, v_peer_avatar),
    ('peer_display_name', v_peer_name_state, v_peer_name);
END
$probe$;

SELECT is(
  (SELECT value FROM ps397_probe WHERE label = 'own_avatar'),
  'https://cdn.discordapp.com/avatars/000000000000000001/ps397self.png'::text,
  '10. INVARIANT 3: the signed-in user still reads its OWN avatar_url through public.current_user_player_mapping'
);

SELECT is(
  (SELECT sqlstate FROM ps397_probe WHERE label = 'peer_avatar'),
  '42501'::text,
  '11. INVARIANT 3: a guild peer selecting avatar_url from public.player_mapping is refused with 42501'
);

SELECT is(
  (SELECT value FROM ps397_probe WHERE label = 'peer_display_name'),
  'PS-397 peer'::text,
  '12. NOT-A-LOCKOUT: the same caller still reads that peer row through a column the allow-list keeps, so assertion 11 is the column grant and not a lockout'
);

SELECT * FROM finish();
ROLLBACK;
\endif
