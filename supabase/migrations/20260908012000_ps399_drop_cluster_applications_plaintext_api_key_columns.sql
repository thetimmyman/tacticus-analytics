-- Null and drop the two plaintext API-key columns on live-only cluster_applications.
-- Backups keep the old value until rotated.
-- target-db: general
-- The repo never creates this table, so every statement is a no-op when it is absent.
BEGIN;

-- Erase before dropping. Dynamic SQL: a static UPDATE on a dropped column fails to parse on re-run.
DO $ps399_null$
DECLARE
  v_nulled bigint := 0;
BEGIN
  IF to_regclass('public.cluster_applications') IS NULL THEN
    RAISE NOTICE 'PS-399: public.cluster_applications is absent; nothing to null';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'cluster_applications'
      AND column_name IN ('guild_leader_api_key', 'player_api_key')
  ) THEN
    RAISE NOTICE 'PS-399: neither key column is present; nothing to null';
    RETURN;
  END IF;

  EXECUTE $sql$
    UPDATE public.cluster_applications
       SET guild_leader_api_key = NULL,
           player_api_key = NULL
     WHERE guild_leader_api_key IS NOT NULL
        OR player_api_key IS NOT NULL
  $sql$;

  GET DIAGNOSTICS v_nulled = ROW_COUNT;
  RAISE NOTICE 'PS-399: nulled the key columns on % row(s)', v_nulled;
END;
$ps399_null$;

ALTER TABLE IF EXISTS public.cluster_applications
  DROP COLUMN IF EXISTS guild_leader_api_key,
  DROP COLUMN IF EXISTS player_api_key;

-- get_guild_applications' cached row type would keep advertising the dropped columns.
NOTIFY pgrst, 'reload schema';

-- Scoped to BASE TABLEs: a view's aggregate *_api_key count is not a credential.
DO $ps399_verify$
DECLARE
  v_offenders text;
  v_count integer;
BEGIN
  SELECT count(*), string_agg(c.table_name || '.' || c.column_name, ', ' ORDER BY 1)
    INTO v_count, v_offenders
    FROM information_schema.columns AS c
    JOIN information_schema.tables AS t
      ON t.table_schema = c.table_schema
     AND t.table_name = c.table_name
   WHERE c.table_schema = 'public'
     AND t.table_type = 'BASE TABLE'
     AND c.column_name ~ '_api_key$'
     AND c.column_name !~ '_encrypted$';

  IF v_count <> 0 THEN
    RAISE EXCEPTION
      'PS-399: % bare plaintext API-key column(s) remain on public base tables: %',
      v_count, v_offenders;
  END IF;

  IF to_regclass('public.cluster_applications') IS NULL THEN
    RAISE NOTICE 'PS-399: verified on a database without cluster_applications; census is 0';
  ELSE
    RAISE NOTICE 'PS-399: cluster_applications retains no bare plaintext API-key column';
  END IF;
END;
$ps399_verify$;

COMMIT;
