-- Objects missing from the clean baseline; additive and idempotent, so also a forward repair.

BEGIN;

ALTER TABLE public.guild_config
  ADD COLUMN IF NOT EXISTS herald_replay_link_mode text NOT NULL DEFAULT 'off';

ALTER TABLE public.herald_boss_config
  ADD COLUMN IF NOT EXISTS pinned_replay_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS replay_auto_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS replay_link_mode text NOT NULL DEFAULT 'inherit';

CREATE TABLE IF NOT EXISTS public.boss_playbook_replays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  boss_id text NOT NULL,
  difficulty text,
  rarity_set text,
  damage integer,
  units text[] DEFAULT '{}',
  title text NOT NULL,
  description text,
  video_type text NOT NULL,
  video_url text,
  thumbnail_url text,
  team_used text,
  meta_team_id uuid REFERENCES public.meta_teams(id),
  meta_team_ids text[] DEFAULT '{}',
  tags text[] DEFAULT '{}',
  contributor_id uuid REFERENCES auth.users(id),
  is_featured boolean DEFAULT false,
  featured_for_season boolean DEFAULT false,
  view_count integer DEFAULT 0,
  cluster_code varchar,
  guild_code text,
  visibility text DEFAULT 'cluster',
  season text,
  map_id text,
  encounter_role text,
  side text,
  strategy text,
  source_system text,
  source_creator text,
  source_published_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.boss_playbook_replays
  ADD COLUMN IF NOT EXISTS encounter_role text,
  ADD COLUMN IF NOT EXISTS side text,
  ADD COLUMN IF NOT EXISTS strategy text,
  ADD COLUMN IF NOT EXISTS source_system text,
  ADD COLUMN IF NOT EXISTS source_creator text,
  ADD COLUMN IF NOT EXISTS source_published_at timestamptz;

ALTER TABLE public.boss_playbook_replays ENABLE ROW LEVEL SECURITY;

DO $policy$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'boss_playbook_replays'
      AND policyname = 'Users can view playbook replays based on visibility'
  ) THEN
    CREATE POLICY "Users can view playbook replays based on visibility"
      ON public.boss_playbook_replays FOR SELECT TO authenticated
      USING (
        visibility = 'public'
        OR (visibility = 'assignments' AND public.can_view_assigned_playbook(boss_id, (SELECT auth.uid())))
        OR (visibility IN ('cluster', 'guild') AND public.can_view_playbook(cluster_code, guild_code, (SELECT auth.uid())))
      );
  END IF;
END
$policy$;

GRANT SELECT ON public.boss_playbook_replays TO authenticated;
GRANT ALL ON public.boss_playbook_replays TO service_role;

CREATE INDEX IF NOT EXISTS idx_boss_playbook_replays_boss_difficulty
  ON public.boss_playbook_replays (boss_id, difficulty);
CREATE INDEX IF NOT EXISTS idx_boss_playbook_replays_source_system
  ON public.boss_playbook_replays (source_system);

CREATE TABLE IF NOT EXISTS public.guild_featured_replays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_code text NOT NULL,
  boss_id text NOT NULL,
  encounter_role text NOT NULL DEFAULT 'boss',
  season text,
  replay_id uuid NOT NULL REFERENCES public.boss_playbook_replays(id) ON DELETE CASCADE,
  pinned_by uuid,
  pinned_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT guild_featured_replays_encounter_role_check
    CHECK (encounter_role IN ('boss', 'prime', 'sideboss'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_guild_featured_replays_slot
  ON public.guild_featured_replays
  (guild_code, boss_id, encounter_role, COALESCE(season, ''));

ALTER TABLE public.guild_featured_replays ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS guild_featured_replays_member_read
  ON public.guild_featured_replays;
CREATE POLICY guild_featured_replays_member_read
  ON public.guild_featured_replays FOR SELECT TO authenticated
  USING (
    public._pm_caller_is_app_admin()
    OR EXISTS (
      SELECT 1 FROM public._pm_caller_mapping_rows() caller
      WHERE caller.guild_code = guild_featured_replays.guild_code
        AND caller.is_current
    )
  );

GRANT SELECT ON public.guild_featured_replays TO authenticated;
GRANT ALL ON public.guild_featured_replays TO service_role;

-- No browser reader remains, so drop the client grant.
REVOKE ALL ON public.member_stats_summary FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.member_stats_summary TO service_role;

-- Backstop against a future permissive policy; RLS already limits raw raid rows.
REVOKE ALL ON public."EOT_GR_data" FROM PUBLIC, anon;

NOTIFY pgrst, 'reload schema';

COMMIT;
