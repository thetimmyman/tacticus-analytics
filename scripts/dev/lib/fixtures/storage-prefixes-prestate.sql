-- Disposable replay pre-state for storage.prefixes (Supabase Storage v1.22.13), not an app migration.
-- Runs as supabase_admin and only creates missing objects, owned by postgres.
DO $fixture$
BEGIN
  IF to_regnamespace('storage') IS NULL THEN
    EXECUTE 'CREATE SCHEMA storage AUTHORIZATION postgres';
  END IF;

  IF to_regclass('storage.buckets') IS NULL THEN
    EXECUTE $ddl$
      CREATE TABLE storage.buckets (
        id text PRIMARY KEY,
        name text NOT NULL,
        owner uuid,
        created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now(),
        public boolean DEFAULT false
      )
    $ddl$;
    ALTER TABLE storage.buckets OWNER TO postgres;
  END IF;

  IF to_regclass('storage.prefixes') IS NULL
     AND to_regprocedure('storage.get_level(text)') IS NULL THEN
    EXECUTE $ddl$
      CREATE FUNCTION storage.get_level(name text)
      RETURNS integer
      LANGUAGE sql
      IMMUTABLE
      STRICT
      AS 'SELECT array_length(string_to_array(name, ''/''), 1)'
    $ddl$;
    ALTER FUNCTION storage.get_level(text) OWNER TO postgres;
  END IF;

  IF to_regclass('storage.prefixes') IS NULL THEN
    EXECUTE $ddl$
      CREATE TABLE storage.prefixes (
        bucket_id text,
        name text COLLATE "C" NOT NULL,
        level integer GENERATED ALWAYS AS (storage.get_level(name)) STORED,
        created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now(),
        CONSTRAINT prefixes_bucketId_fkey
          FOREIGN KEY (bucket_id) REFERENCES storage.buckets(id),
        PRIMARY KEY (bucket_id, level, name)
      )
    $ddl$;
    ALTER TABLE storage.prefixes OWNER TO postgres;
    ALTER TABLE storage.prefixes ENABLE ROW LEVEL SECURITY;

    -- The measured pre-migration privilege shape; service SELECT stays because the migration proves it intact.
    REVOKE ALL ON storage.prefixes FROM PUBLIC, anon, authenticated, service_role;
    GRANT SELECT ON storage.prefixes TO anon;
    GRANT SELECT, INSERT, DELETE ON storage.prefixes TO authenticated;
    GRANT SELECT ON storage.prefixes TO service_role;
  END IF;
END
$fixture$;
