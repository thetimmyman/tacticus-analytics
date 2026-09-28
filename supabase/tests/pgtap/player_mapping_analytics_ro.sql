-- analytics_ro holds no SELECT on player_mapping and nobody lost capability. pgtap-throwaway.sh
-- creates the role with the live column grants (3 fails without it); probes record into a temp table.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;
SET LOCAL timezone TO 'UTC';

SELECT plan(14);

-- No ledger skip: pre-migration must read RED.
SELECT is(
  current_database()::text,
  'postgres'::text,
  '1. this suite runs against the general database'
);

SELECT is(
  (SELECT count(*)::integer
     FROM supabase_migrations.schema_migrations
    WHERE version = '20260908013000'
      AND name = 'ps472_player_mapping_analytics_ro_column_grants'),
  1,
  '2. the player_mapping analytics_ro column-grant migration is recorded exactly once in the ledger'
);

SELECT ok(
  EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'analytics_ro'),
  '3. FIXTURE CONTROL: analytics_ro exists here, so the role-guarded revoke in the migration was actually reached and assertions 7, 8 and 12 are not vacuous'
);

-- The controls keeping the grant latent (forced RLS, no policy for it).
SELECT is(
  (SELECT (c.relrowsecurity AND c.relforcerowsecurity)
     FROM pg_class c WHERE c.oid = 'public.player_mapping'::regclass),
  true,
  '4. player_mapping still has RLS enabled AND forced'
);

SELECT is(
  (SELECT count(*)::integer
     FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'player_mapping'
      AND (roles::text ILIKE '%analytics_ro%' OR roles::text ILIKE '%public%')),
  0,
  '5. no policy on player_mapping names analytics_ro or public'
);

SELECT is(
  (SELECT rolbypassrls FROM pg_roles WHERE rolname = 'analytics_ro'),
  false,
  '6. analytics_ro cannot bypass RLS'
);

SELECT is(
  (SELECT count(*)::integer
     FROM (VALUES ('discord_user_id'), ('discord_username'), ('avatar_url'),
                  ('patreon_user_id'), ('user_id'), ('username'),
                  ('officer_notes'), ('player_notes'), ('tacticus_share_url'))
       AS leaked(column_name)
    WHERE has_column_privilege('analytics_ro', 'public.player_mapping',
                               leaked.column_name, 'SELECT')),
  0,
  '7. analytics_ro holds no column SELECT on any of the nine player_mapping identifier columns'
);

SELECT is(
  (SELECT count(*)::integer
     FROM pg_attribute a
    WHERE a.attrelid = 'public.player_mapping'::regclass
      AND a.attnum > 0 AND NOT a.attisdropped
      AND has_column_privilege('analytics_ro', 'public.player_mapping',
                               a.attname, 'SELECT')),
  0,
  '8. the table-level REVOKE cleared the COLUMN-level grants too: analytics_ro holds SELECT on zero columns of player_mapping'
);

SELECT is(
  has_table_privilege('service_role', 'public.player_mapping', 'SELECT'),
  true,
  '9. INVARIANT 1: service_role keeps table SELECT on public.player_mapping'
);

SELECT is(
  (SELECT count(*)::integer
     FROM (VALUES ('display_name'), ('player_id'), ('guild_code'),
                  ('cluster_code'), ('is_current'), ('avatar_unit_id'))
       AS kept(column_name)
    WHERE NOT has_column_privilege('authenticated', 'public.player_mapping',
                                   kept.column_name, 'SELECT')),
  0,
  '10. INVARIANT 2: authenticated keeps the column allow-list 20260817000000 established and the avatar-column revoke trimmed'
);

-- Read as analytics_ro now, with the pre-state grant restored, and as a role meant to see the rows.
CREATE TEMP TABLE tp472_probe(label text PRIMARY KEY, sqlstate text, rows integer)
  ON COMMIT DROP;

DO $seed$
DECLARE
  v_a uuid := '47200000-0000-4000-8000-000000000001';
  v_b uuid := '47200000-0000-4000-8000-000000000002';
BEGIN
  INSERT INTO auth.users (id, email, aud, role)
  VALUES (v_a, 'tp472-a@example.invalid', 'authenticated', 'authenticated'),
         (v_b, 'tp472-b@example.invalid', 'authenticated', 'authenticated');

  INSERT INTO public.guild_config (guild_code, display_name)
  VALUES ('TP472GUILD', 'Test fixture guild');

  ALTER TABLE public.player_mapping DISABLE TRIGGER USER;

  INSERT INTO public.player_mapping
    (player_id, display_name, user_id, guild_code, discord_user_id,
     is_current, is_active)
  VALUES
    ('TP472A', 'Test a', v_a, 'TP472GUILD', '000000000000000001', true, true),
    ('TP472B', 'Test b', v_b, 'TP472GUILD', '000000000000000002', true, true);

  ALTER TABLE public.player_mapping ENABLE TRIGGER USER;
END
$seed$;

DO $after$
DECLARE
  v_rows integer;
  v_state text;
BEGIN
  SET LOCAL ROLE analytics_ro;
  BEGIN
    SELECT count(*) INTO v_rows FROM public.player_mapping;
    v_state := '00000';
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE;
    v_rows := 0;      -- refused is zero rows read, and is the stronger outcome
  END;
  RESET ROLE;
  INSERT INTO tp472_probe VALUES ('after', v_state, v_rows);
END
$after$;

-- Pre-state restored in-transaction (all but the two live withholds).
DO $before$
DECLARE
  v_cols text;
  v_rows integer;
  v_state text;
  v_grants integer;
BEGIN
  SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum)
    INTO v_cols
    FROM pg_attribute a
   WHERE a.attrelid = 'public.player_mapping'::regclass
     AND a.attnum > 0 AND NOT a.attisdropped
     AND a.attname NOT IN ('tacticus_api_key_encrypted', 'ownership_attestation_id');
  EXECUTE format(
    'GRANT SELECT (%s) ON TABLE public.player_mapping TO analytics_ro', v_cols);

  SELECT count(*) INTO v_grants
    FROM pg_attribute a
   WHERE a.attrelid = 'public.player_mapping'::regclass
     AND a.attnum > 0 AND NOT a.attisdropped
     AND has_column_privilege('analytics_ro', 'public.player_mapping',
                              a.attname, 'SELECT');

  SET LOCAL ROLE analytics_ro;
  BEGIN
    SELECT count(*) INTO v_rows FROM public.player_mapping;
    v_state := '00000';
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE;
    v_rows := -1;
  END;
  RESET ROLE;

  INSERT INTO tp472_probe VALUES
    ('before', v_state, v_rows),
    ('before_grants', NULL, v_grants);
END
$before$;

DO $control$
DECLARE
  v_rows integer;
BEGIN
  SET LOCAL ROLE service_role;
  SELECT count(*) INTO v_rows
    FROM public.player_mapping WHERE guild_code = 'TP472GUILD';
  RESET ROLE;
  INSERT INTO tp472_probe VALUES ('control', '00000', v_rows);
END
$control$;

SELECT is(
  (SELECT rows FROM tp472_probe WHERE label = 'before'),
  0,
  '11. DELTA, before: with the 55-column pre-state grant restored, analytics_ro reads 0 rows of player_mapping -- forced RLS and no matching policy, so the grant was worth nothing'
);

SELECT is(
  (SELECT sqlstate FROM tp472_probe WHERE label = 'after'),
  '42501'::text,
  '12. DELTA, after: analytics_ro is refused player_mapping outright with 42501, so it reads 0 rows by privilege as well as by policy'
);

SELECT is(
  (SELECT rows FROM tp472_probe WHERE label = 'before_grants'),
  (SELECT count(*)::integer
     FROM pg_attribute a
    WHERE a.attrelid = 'public.player_mapping'::regclass
      AND a.attnum > 0 AND NOT a.attisdropped
      AND a.attname NOT IN ('tacticus_api_key_encrypted', 'ownership_attestation_id')),
  '13. DELTA, grant count: the restored pre-state is a SELECT grant on every player_mapping column but the two live withholds (55 on production), against 0 after the revoke -- and assertions 11 and 12 show that whole difference bought analytics_ro no rows'
);

SELECT cmp_ok(
  (SELECT rows FROM tp472_probe WHERE label = 'control'),
  '>',
  0,
  '14. NOT AN EMPTY TABLE: service_role reads the seeded rows, so the zeros in 11 to 13 are the policy set and the ACL, not a fixture that seeded nothing'
);

SELECT * FROM finish();
ROLLBACK;
