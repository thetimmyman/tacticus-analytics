-- target-db: general
-- Shared teams become readable by current members of any guild in the row guild's
-- cluster. Writes and the readiness RPCs stay same-guild.

BEGIN;

DROP POLICY IF EXISTS guild_war_meta_teams_member_read
  ON public.guild_war_meta_teams;
DROP POLICY IF EXISTS guild_war_meta_teams_authenticated_read
  ON public.guild_war_meta_teams;
DROP POLICY IF EXISTS guild_war_meta_teams_cluster_read
  ON public.guild_war_meta_teams;

CREATE POLICY guild_war_meta_teams_cluster_read
  ON public.guild_war_meta_teams
  FOR SELECT
  TO authenticated
  USING (
    guild_code IN (
      SELECT pm.guild_code
      FROM public._pm_caller_policy_rows() AS pm
      WHERE pm.is_current = true
        AND pm.guild_code IS NOT NULL
    )
    OR guild_code IN (
      SELECT public._pm_caller_cluster_guild_codes()
    )
  );

DO $verify$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policy
     WHERE polrelid = 'public.guild_war_meta_teams'::regclass
       AND polname IN (
         'guild_war_meta_teams_member_read',
         'guild_war_meta_teams_authenticated_read'
       )
  ) THEN
    RAISE EXCEPTION 'war room cluster read: a superseded read policy remains';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
     WHERE polrelid = 'public.guild_war_meta_teams'::regclass
       AND polname = 'guild_war_meta_teams_cluster_read'
       AND polcmd = 'r'
       AND pg_get_expr(polqual, polrelid) ~ '_pm_caller_cluster_guild_codes'
       AND pg_get_expr(polqual, polrelid) ~ '_pm_caller_policy_rows'
  ) THEN
    RAISE EXCEPTION 'war room cluster read: cluster_read policy missing or wrong';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
     WHERE polrelid = 'public.guild_war_meta_teams'::regclass
       AND polname = 'guild_war_meta_teams_leader_write'
  ) THEN
    RAISE EXCEPTION 'war room cluster read: leader_write policy missing';
  END IF;

  IF has_table_privilege('anon', 'public.guild_war_meta_teams', 'SELECT')
     OR has_column_privilege('authenticated', 'public.guild_war_meta_teams',
       'created_by', 'SELECT')
  THEN
    RAISE EXCEPTION 'war room cluster read: grants drifted (anon or created_by)';
  END IF;
END
$verify$;

COMMIT;
