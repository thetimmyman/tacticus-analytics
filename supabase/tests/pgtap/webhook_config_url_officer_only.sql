BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;
SET LOCAL timezone TO 'UTC';

SELECT plan(24);

SELECT is(current_database()::text, 'postgres'::text, 'general database');
SELECT ok(EXISTS (
  SELECT 1 FROM supabase_migrations.schema_migrations
   WHERE version = '20260928053000' AND name = 'webhook_url_officer_only'
), 'migration is recorded');
SELECT ok(NOT has_table_privilege('authenticated', 'public.webhook_config', 'SELECT'), 'authenticated lacks table SELECT');
SELECT ok(NOT has_column_privilege('authenticated', 'public.webhook_config', 'webhook_url', 'SELECT'), 'authenticated lacks URL SELECT');
SELECT is((
  SELECT count(*)::integer FROM pg_attribute a
   WHERE a.attrelid = 'public.webhook_config'::regclass
     AND a.attnum > 0 AND NOT a.attisdropped AND a.attname <> 'webhook_url'
     AND has_column_privilege('authenticated', 'public.webhook_config', a.attname, 'SELECT')
), 11, 'authenticated reads all metadata columns');
SELECT ok(
  has_table_privilege('authenticated', 'public.webhook_config', 'INSERT')
  AND has_table_privilege('authenticated', 'public.webhook_config', 'UPDATE')
  AND has_table_privilege('authenticated', 'public.webhook_config', 'DELETE')
  AND has_column_privilege('authenticated', 'public.webhook_config', 'webhook_url', 'UPDATE'),
  'authenticated retains write privileges'
);
SELECT ok(NOT has_column_privilege('anon', 'public.webhook_config', 'webhook_url', 'SELECT'), 'anon lacks URL SELECT');
SELECT ok(has_column_privilege('service_role', 'public.webhook_config', 'webhook_url', 'SELECT'), 'service role retains URL SELECT');
SELECT ok(
  NOT has_function_privilege('anon', 'public.get_webhook_url(text, text, text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.get_webhook_url(text, text, text)', 'EXECUTE'),
  'clients cannot execute URL function'
);
SELECT ok(NOT EXISTS (
  SELECT 1 FROM pg_policy p
   WHERE p.polrelid = 'public.webhook_config'::regclass
     AND (coalesce(pg_get_expr(p.polqual, p.polrelid), '') || ' ' ||
          coalesce(pg_get_expr(p.polwithcheck, p.polrelid), ''))
         ~ '(FROM|JOIN)\s+(public\.)?player_mapping\M'
), 'policies avoid base player mapping');

INSERT INTO auth.users (id) VALUES
  ('00000000-0000-4000-8000-0000000000a1'),
  ('00000000-0000-4000-8000-0000000000a2'),
  ('00000000-0000-4000-8000-0000000000a3'),
  ('00000000-0000-4000-8000-0000000000a4'),
  ('00000000-0000-4000-8000-0000000000a5');

INSERT INTO public.clusters (id, cluster_code, display_name) VALUES
  ('00000000-0000-4000-8000-0000000000c1', 'ZZTESTC1', '[TG] Test Cluster One'),
  ('00000000-0000-4000-8000-0000000000c2', 'ZZTESTC2', '[TG] Test Cluster Two');

INSERT INTO public.guild_config (id, guild_code, display_name, cluster_id, cluster_code)
SELECT base.id + g.n, g.guild_code, g.display_name, g.cluster_id, g.cluster_code
FROM (
  SELECT GREATEST(coalesce(max(id), 0), coalesce(pg_sequence_last_value('public.guild_config_id_seq'::regclass), 0)) AS id
  FROM public.guild_config
) base
CROSS JOIN (VALUES
  (1, 'ZZTESTG1', '[TG] Test Guild One', '00000000-0000-4000-8000-0000000000c1'::uuid, 'ZZTESTC1'),
  (2, 'ZZTESTG2', '[TG] Test Guild Two', '00000000-0000-4000-8000-0000000000c1'::uuid, 'ZZTESTC1'),
  (3, 'ZZTESTG3', '[TG] Test Guild Three', '00000000-0000-4000-8000-0000000000c2'::uuid, 'ZZTESTC2')
) g(n, guild_code, display_name, cluster_id, cluster_code);

INSERT INTO public.player_mapping (id, player_id, display_name, guild_code, role, is_current, is_active)
SELECT base.id + p.n, p.player_id, p.display_name, p.guild_code, p.role::public.app_role, true, true
FROM (
  SELECT GREATEST(coalesce(max(id), 0), coalesce(pg_sequence_last_value('public.player_mapping_id_seq'::regclass), 0)) AS id
  FROM public.player_mapping
) base
CROSS JOIN (VALUES
  (1, 'test-player-a', 'TestPlayerA', 'ZZTESTG1', 'member'),
  (2, 'test-player-o', 'TestPlayerO', 'ZZTESTG1', 'officer'),
  (3, 'test-player-l', 'TestPlayerL', 'ZZTESTG2', 'leader'),
  (4, 'test-player-b', 'TestPlayerB', 'ZZTESTG3', 'member')
) p(n, player_id, display_name, guild_code, role);

INSERT INTO public.player_identity_attestations (mapping_id, player_id, subject_user_id, consumed_at, source)
SELECT pm.id, pm.player_id,
       CASE pm.player_id
         WHEN 'test-player-a' THEN '00000000-0000-4000-8000-0000000000a1'::uuid
         WHEN 'test-player-o' THEN '00000000-0000-4000-8000-0000000000a2'::uuid
         WHEN 'test-player-l' THEN '00000000-0000-4000-8000-0000000000a3'::uuid
         ELSE '00000000-0000-4000-8000-0000000000a4'::uuid
       END, now(), 'operator_quarantine_restore'
FROM public.player_mapping pm
WHERE pm.player_id IN ('test-player-a', 'test-player-o', 'test-player-l', 'test-player-b');

UPDATE public.player_mapping pm
   SET user_id = a.subject_user_id, ownership_attestation_id = a.id
  FROM public.player_identity_attestations a
 WHERE a.mapping_id = pm.id
   AND pm.player_id IN ('test-player-a', 'test-player-o', 'test-player-l', 'test-player-b');

INSERT INTO public.webhook_config (id, webhook_type, webhook_url, guild_code, cluster_id, enabled) VALUES
  ('00000000-0000-4000-8000-0000000000d1', 'guild_leaderboard', 'https://discord.com/api/webhooks/1001/PLACEHOLDER-token-g1', 'ZZTESTG1', NULL, true),
  ('00000000-0000-4000-8000-0000000000d2', 'cluster_leaderboard', 'https://discord.com/api/webhooks/1002/PLACEHOLDER-token-c1', NULL, '00000000-0000-4000-8000-0000000000c1', true),
  ('00000000-0000-4000-8000-0000000000d3', 'guild_leaderboard', 'https://discord.com/api/webhooks/1003/PLACEHOLDER-token-g3', 'ZZTESTG3', NULL, true);

CREATE FUNCTION pg_temp.webhook_probe(p_subject uuid, p_key text, p_action text)
RETURNS void LANGUAGE plpgsql AS $probe$
DECLARE
  v_rows integer;
  v_ids text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_subject::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_subject, 'role', 'authenticated')::text, true);
  PERFORM set_config('webhook_probe.' || p_key || '.state', 'none', true);
  PERFORM set_config('webhook_probe.' || p_key || '.rows', 'unset', true);
  PERFORM set_config('webhook_probe.' || p_key || '.ids', 'unset', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    IF p_action = 'url' THEN
      PERFORM webhook_url FROM public.webhook_config;
    ELSIF p_action = 'star' THEN
      PERFORM * FROM public.webhook_config;
    ELSIF p_action = 'filter' THEN
      PERFORM id FROM public.webhook_config WHERE webhook_url IS NOT NULL;
    ELSIF p_action = 'metadata' THEN
      SELECT count(*), string_agg(id::text, ',' ORDER BY id::text) INTO v_rows, v_ids
        FROM (SELECT id, webhook_type, enabled FROM public.webhook_config) q;
      PERFORM set_config('webhook_probe.' || p_key || '.rows', v_rows::text, true);
      PERFORM set_config('webhook_probe.' || p_key || '.ids', coalesce(v_ids, ''), true);
    ELSIF p_action = 'update' THEN
      UPDATE public.webhook_config
         SET webhook_url = 'https://discord.com/api/webhooks/1004/PLACEHOLDER-token-g1-new', enabled = false
       WHERE id = '00000000-0000-4000-8000-0000000000d1';
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      PERFORM set_config('webhook_probe.' || p_key || '.rows', v_rows::text, true);
    ELSIF p_action = 'returning' THEN
      UPDATE public.webhook_config SET enabled = false
       WHERE id = '00000000-0000-4000-8000-0000000000d1'
       RETURNING webhook_url INTO v_ids;
    ELSIF p_action = 'insert' THEN
      INSERT INTO public.webhook_config (webhook_type, webhook_url, guild_code, enabled)
      VALUES ('boss_assignments', 'https://discord.com/api/webhooks/1005/PLACEHOLDER-token-g1-boss', 'ZZTESTG1', true);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('webhook_probe.' || p_key || '.state', SQLSTATE, true);
  END;
  EXECUTE 'RESET ROLE';
END;
$probe$;

SELECT pg_temp.webhook_probe('00000000-0000-4000-8000-0000000000a1', 'member_url', 'url');
SELECT is(current_setting('webhook_probe.member_url.state', true), '42501', 'member URL read is denied');
SELECT pg_temp.webhook_probe('00000000-0000-4000-8000-0000000000a1', 'member_star', 'star');
SELECT is(current_setting('webhook_probe.member_star.state', true), '42501', 'member star read is denied');
SELECT pg_temp.webhook_probe('00000000-0000-4000-8000-0000000000a1', 'member_filter', 'filter');
SELECT is(current_setting('webhook_probe.member_filter.state', true), '42501', 'member URL filter is denied');
SELECT pg_temp.webhook_probe('00000000-0000-4000-8000-0000000000a1', 'member_metadata', 'metadata');
SELECT ok(current_setting('webhook_probe.member_metadata.state', true) = 'none'
  AND current_setting('webhook_probe.member_metadata.rows', true) = '2'
  AND current_setting('webhook_probe.member_metadata.ids', true) =
    '00000000-0000-4000-8000-0000000000d1,00000000-0000-4000-8000-0000000000d2',
  'member sees two matching metadata rows');

SELECT pg_temp.webhook_probe('00000000-0000-4000-8000-0000000000a2', 'officer_url', 'url');
SELECT is(current_setting('webhook_probe.officer_url.state', true), '42501', 'officer URL read is denied');
SELECT pg_temp.webhook_probe('00000000-0000-4000-8000-0000000000a2', 'officer_update', 'update');
SELECT ok(current_setting('webhook_probe.officer_update.state', true) = 'none'
  AND current_setting('webhook_probe.officer_update.rows', true) = '1', 'officer URL update succeeds');
SELECT ok((SELECT webhook_url = 'https://discord.com/api/webhooks/1004/PLACEHOLDER-token-g1-new'
                AND enabled = false FROM public.webhook_config
            WHERE id = '00000000-0000-4000-8000-0000000000d1'), 'officer update persists');
SELECT pg_temp.webhook_probe('00000000-0000-4000-8000-0000000000a2', 'officer_returning', 'returning');
SELECT is(current_setting('webhook_probe.officer_returning.state', true), '42501', 'officer URL returning is denied');
SELECT pg_temp.webhook_probe('00000000-0000-4000-8000-0000000000a2', 'officer_insert', 'insert');
SELECT is(current_setting('webhook_probe.officer_insert.state', true), 'none', 'officer insert succeeds');
SELECT is((SELECT count(*)::integer FROM public.webhook_config
            WHERE guild_code = 'ZZTESTG1' AND webhook_type = 'boss_assignments'), 1, 'officer insert persists');

SELECT pg_temp.webhook_probe('00000000-0000-4000-8000-0000000000a3', 'leader_url', 'url');
SELECT is(current_setting('webhook_probe.leader_url.state', true), '42501', 'leader URL read is denied');
SELECT pg_temp.webhook_probe('00000000-0000-4000-8000-0000000000a5', 'seatless_metadata', 'metadata');
SELECT ok(current_setting('webhook_probe.seatless_metadata.state', true) = 'none'
  AND current_setting('webhook_probe.seatless_metadata.rows', true) = '0', 'seatless user sees no metadata');
SELECT pg_temp.webhook_probe('00000000-0000-4000-8000-0000000000a5', 'seatless_url', 'url');
SELECT is(current_setting('webhook_probe.seatless_url.state', true), '42501', 'seatless URL read is denied');

CREATE FUNCTION pg_temp.webhook_service_probe() RETURNS void LANGUAGE plpgsql AS $probe$
DECLARE
  v_urls text;
BEGIN
  EXECUTE 'SET LOCAL ROLE service_role';
  BEGIN
    SELECT string_agg(webhook_url, ',' ORDER BY id) INTO v_urls
      FROM public.webhook_config
     WHERE id IN ('00000000-0000-4000-8000-0000000000d1',
                  '00000000-0000-4000-8000-0000000000d2',
                  '00000000-0000-4000-8000-0000000000d3');
    PERFORM set_config('webhook_probe.service.urls', v_urls, true);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('webhook_probe.service.urls', SQLSTATE, true);
  END;
  EXECUTE 'RESET ROLE';
END;
$probe$;
SELECT pg_temp.webhook_service_probe();
SELECT is(current_setting('webhook_probe.service.urls', true),
  'https://discord.com/api/webhooks/1004/PLACEHOLDER-token-g1-new,https://discord.com/api/webhooks/1002/PLACEHOLDER-token-c1,https://discord.com/api/webhooks/1003/PLACEHOLDER-token-g3',
  'service role reads fixture URLs');

SELECT * FROM finish();
ROLLBACK;
