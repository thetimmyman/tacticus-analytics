BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;

-- Only the service tier writes storage.objects. Client-role statements run through
-- pg_temp.tw7290_probe (pgtap is unreachable under them). With the ledger row, a missing policy fails.
SELECT NOT EXISTS (
  SELECT 1
  FROM supabase_migrations.schema_migrations
  WHERE version = '20260901220000'
    AND name = 'wi7290_storage_objects_rls_authorization'
) AS tw7290_not_applied \gset

\if :tw7290_not_applied
SELECT plan(17);
SELECT * FROM skip(
  17,
  'this database predates the storage.objects RLS authorization migration; apply 20260901220000 and re-run — full production teeth are the post-apply verification queries in the migration header'
);
SELECT * FROM finish();
ROLLBACK;
\else

SELECT plan(17);

SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'storage.objects'::regclass),
  'A1: storage.objects has RLS enabled'
);
SELECT ok(
  (SELECT NOT relforcerowsecurity FROM pg_class WHERE oid = 'storage.objects'::regclass),
  'A2: RLS is not FORCED — the storage service owner/maintenance path stays unbound'
);

SELECT is(
  (SELECT count(*)::integer
   FROM unnest(ARRAY['INSERT', 'UPDATE', 'DELETE']) AS priv
   WHERE has_table_privilege('authenticated', 'storage.objects', priv)),
  0,
  'B1: authenticated holds no write privilege on storage.objects (no authenticated corridor exists in this application)'
);
SELECT is(
  (SELECT count(*)::integer
   FROM unnest(ARRAY['INSERT', 'UPDATE', 'DELETE']) AS priv
   WHERE has_table_privilege('anon', 'storage.objects', priv)),
  0,
  'B2: anon holds no write privilege on storage.objects'
);
SELECT is(
  (SELECT count(*)::integer
   FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) AS priv
   WHERE has_table_privilege('service_role', 'storage.objects', priv)),
  4,
  'B3: service_role keeps SELECT+INSERT+UPDATE+DELETE'
);
SELECT ok(
  has_table_privilege('authenticated', 'storage.buckets', 'SELECT')
    AND has_table_privilege('anon', 'storage.buckets', 'SELECT'),
  'B4: the client tiers can read storage.buckets — the public-read policy subquery evaluates as the querying role'
);

SELECT is(
  (SELECT count(*)::integer
   FROM pg_policy p
   WHERE p.polrelid = 'storage.objects'::regclass
     AND p.polcmd IN ('a', 'w', 'd', '*')
     AND p.polname <> 'storage_objects_service_writes'),
  0,
  'C1: no write-capable policy exists on storage.objects other than the service policy'
);
SELECT is(
  (SELECT p.polcmd::text
   FROM pg_policy p
   WHERE p.polrelid = 'storage.objects'::regclass
     AND p.polname = 'storage_objects_service_writes'),
  '*',
  'C2: storage_objects_service_writes exists and is FOR ALL'
);
SELECT is(
  (SELECT array_agg(pg_get_userbyid(r)::text ORDER BY pg_get_userbyid(r)::text)
   FROM pg_policy p, unnest(p.polroles) AS r
   WHERE p.polrelid = 'storage.objects'::regclass
     AND p.polname = 'storage_objects_service_writes'),
  ARRAY['service_role'],
  'C3: the service write policy targets exactly service_role'
);
SELECT is(
  (SELECT p.polcmd::text
   FROM pg_policy p
   WHERE p.polrelid = 'storage.objects'::regclass
     AND p.polname = 'storage_objects_public_bucket_read'),
  'r',
  'C4: storage_objects_public_bucket_read exists and is FOR SELECT'
);

INSERT INTO storage.buckets (id, name, public)
VALUES ('tw7290-public-test', 'tw7290-public-test', true),
       ('tw7290-private-test', 'tw7290-private-test', false);
INSERT INTO storage.objects (bucket_id, name)
VALUES ('tw7290-private-test', 'secret/export.json');

CREATE TEMP TABLE tw7290_probe_results (
  probe text PRIMARY KEY,
  sqlstate text NOT NULL,
  result text
);
CREATE FUNCTION pg_temp.tw7290_probe(p_probe text, p_role text, p_sql text, p_scalar boolean DEFAULT false)
RETURNS void
LANGUAGE plpgsql
AS $probe$
DECLARE
  v_result text;
BEGIN
  BEGIN
    EXECUTE format('SET LOCAL ROLE %I', p_role);
    IF p_scalar THEN
      EXECUTE p_sql INTO v_result;
    ELSE
      EXECUTE p_sql;
    END IF;
    RESET ROLE;
    INSERT INTO tw7290_probe_results (probe, sqlstate, result)
    VALUES (p_probe, '00000', v_result);
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    INSERT INTO tw7290_probe_results (probe, sqlstate, result)
    VALUES (p_probe, SQLSTATE, NULL);
  END;
END
$probe$;

SELECT pg_temp.tw7290_probe('D1', 'authenticated',
  $$INSERT INTO storage.objects (bucket_id, name)
    VALUES ('tw7290-public-test', 'attacker/overwrite.png')$$);
SELECT is(
  (SELECT sqlstate FROM tw7290_probe_results WHERE probe = 'D1'),
  '42501',
  'D1: an authenticated INSERT into storage.objects is refused'
);
SELECT pg_temp.tw7290_probe('D2', 'authenticated',
  $$UPDATE storage.objects SET name = 'attacker/moved.json'
    WHERE bucket_id = 'tw7290-private-test'$$);
SELECT is(
  (SELECT sqlstate FROM tw7290_probe_results WHERE probe = 'D2'),
  '42501',
  'D2: an authenticated UPDATE of storage.objects is refused'
);
SELECT pg_temp.tw7290_probe('D3', 'authenticated',
  $$DELETE FROM storage.objects WHERE bucket_id = 'tw7290-private-test'$$);
SELECT is(
  (SELECT sqlstate FROM tw7290_probe_results WHERE probe = 'D3'),
  '42501',
  'D3: an authenticated DELETE from storage.objects is refused'
);

SELECT pg_temp.tw7290_probe('D4', 'anon',
  $$INSERT INTO storage.objects (bucket_id, name)
    VALUES ('tw7290-public-test', 'anon/drop.txt')$$);
SELECT is(
  (SELECT sqlstate FROM tw7290_probe_results WHERE probe = 'D4'),
  '42501',
  'D4: an anon INSERT into storage.objects is refused'
);

SELECT pg_temp.tw7290_probe('D5', 'service_role',
  $$INSERT INTO storage.objects (bucket_id, name)
    VALUES ('tw7290-public-test', 'assets/icon.png')$$);
SELECT is(
  (SELECT sqlstate FROM tw7290_probe_results WHERE probe = 'D5'),
  '00000',
  'D5: a service-tier INSERT still succeeds (the GDPR export writer corridor)'
);

-- Counted under authenticated (RLS applies), asserted as postgres.
SELECT pg_temp.tw7290_probe('D6', 'authenticated',
  $$SELECT count(*)::text FROM storage.objects
    WHERE bucket_id = 'tw7290-public-test'$$,
  true);
SELECT is(
  (SELECT sqlstate || '|' || coalesce(result, '<error>')
     FROM tw7290_probe_results WHERE probe = 'D6'),
  '00000|1',
  'D6: an authenticated read still sees objects in a public bucket'
);
SELECT pg_temp.tw7290_probe('D7', 'authenticated',
  $$SELECT count(*)::text FROM storage.objects
    WHERE bucket_id = 'tw7290-private-test'$$,
  true);
SELECT is(
  (SELECT sqlstate || '|' || coalesce(result, '<error>')
     FROM tw7290_probe_results WHERE probe = 'D7'),
  '00000|0',
  'D7: an authenticated read is filtered away from private-bucket objects'
);

SELECT * FROM finish();
ROLLBACK;

\endif
