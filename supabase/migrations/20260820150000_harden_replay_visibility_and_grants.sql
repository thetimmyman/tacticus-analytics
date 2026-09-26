-- A new migration because the previous replay repair may already be recorded.

BEGIN;

DO $constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.guild_config'::regclass
      AND conname = 'guild_config_herald_replay_link_mode_check'
  ) THEN
    ALTER TABLE public.guild_config
      ADD CONSTRAINT guild_config_herald_replay_link_mode_check
      CHECK (herald_replay_link_mode IN ('off', 'pinned', 'featured', 'all'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.herald_boss_config'::regclass
      AND conname = 'herald_boss_config_replay_link_mode_check'
  ) THEN
    ALTER TABLE public.herald_boss_config
      ADD CONSTRAINT herald_boss_config_replay_link_mode_check
      CHECK (replay_link_mode IN ('inherit', 'off', 'pinned', 'featured', 'all'));
  END IF;
END
$constraint$;

DROP POLICY IF EXISTS "Users can view playbook replays based on visibility"
  ON public.boss_playbook_replays;
CREATE POLICY "Users can view playbook replays based on visibility"
  ON public.boss_playbook_replays FOR SELECT TO authenticated
  USING (
    visibility = 'public'
    OR (
      visibility = 'assignments'
      AND public.can_view_assigned_playbook(boss_id, (SELECT auth.uid()))
    )
    OR (
      visibility = 'cluster'
      AND cluster_code IS NOT NULL
      AND public.can_view_playbook(cluster_code, NULL, (SELECT auth.uid()))
    )
    OR (
      visibility = 'guild'
      AND guild_code IS NOT NULL
      AND (
        public._pm_caller_is_app_admin()
        OR EXISTS (
          SELECT 1
          FROM public._pm_caller_mapping_rows() caller
          WHERE caller.guild_code = boss_playbook_replays.guild_code
            AND caller.is_current
        )
      )
    )
  );

-- Baseline default privileges over-grant new tables; narrow both to their read boundary.
REVOKE ALL ON public.boss_playbook_replays FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.boss_playbook_replays TO authenticated;
GRANT ALL ON public.boss_playbook_replays TO service_role;

REVOKE ALL ON public.guild_featured_replays FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.guild_featured_replays TO authenticated;
GRANT ALL ON public.guild_featured_replays TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
