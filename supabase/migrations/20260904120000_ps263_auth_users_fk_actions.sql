-- Give the 18 NO ACTION public FKs into auth.users an explicit delete action;
-- any row behind one blocks account deletion (23503).
-- target-db: general
-- SET NULL for attribution, CASCADE for the subject's own data. Two columns lose
-- NOT NULL; their generated types are widened by hand.

BEGIN;

DO $guard$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION
      'PS-263 (20260904120000) targets the General database (postgres); refusing to run on %',
      current_database();
  END IF;
END
$guard$;

-- ADD CONSTRAINT locks auth.users, written on every sign-in; fail fast.
SET LOCAL lock_timeout = '5s';

-- SET NULL: attribution and audit columns.

ALTER TABLE public.boss_assignment_configs
  DROP CONSTRAINT IF EXISTS boss_assignment_configs_updated_by_fkey,
  ADD CONSTRAINT boss_assignment_configs_updated_by_fkey
    FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.boss_playbook_replays
  DROP CONSTRAINT IF EXISTS boss_playbook_replays_contributor_id_fkey,
  ADD CONSTRAINT boss_playbook_replays_contributor_id_fkey
    FOREIGN KEY (contributor_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.boss_playbook_tactics
  DROP CONSTRAINT IF EXISTS boss_playbook_tactics_contributor_id_fkey,
  ADD CONSTRAINT boss_playbook_tactics_contributor_id_fkey
    FOREIGN KEY (contributor_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.boss_playbook_tactics_history
  DROP CONSTRAINT IF EXISTS boss_playbook_tactics_history_changed_by_fkey,
  ADD CONSTRAINT boss_playbook_tactics_history_changed_by_fkey
    FOREIGN KEY (changed_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.boss_playbook_team_requirements
  DROP CONSTRAINT IF EXISTS boss_playbook_team_requirements_contributor_id_fkey,
  ADD CONSTRAINT boss_playbook_team_requirements_contributor_id_fkey
    FOREIGN KEY (contributor_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.carousel_items
  DROP CONSTRAINT IF EXISTS carousel_items_created_by_fkey,
  ADD CONSTRAINT carousel_items_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.cluster_recruitment_requirements
  DROP CONSTRAINT IF EXISTS cluster_recruitment_requirements_contributor_id_fkey,
  ADD CONSTRAINT cluster_recruitment_requirements_contributor_id_fkey
    FOREIGN KEY (contributor_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- CASCADE would delete a third party's record because the actor closed their account.
ALTER TABLE public.coaching_task_deliveries
  ALTER COLUMN actor_user_id DROP NOT NULL;

ALTER TABLE public.coaching_task_deliveries
  DROP CONSTRAINT IF EXISTS coaching_task_deliveries_actor_user_id_fkey,
  ADD CONSTRAINT coaching_task_deliveries_actor_user_id_fkey
    FOREIGN KEY (actor_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- The task belongs to its subject, not to the coach who created it.
ALTER TABLE public.coaching_tasks
  ALTER COLUMN created_by DROP NOT NULL;

ALTER TABLE public.coaching_tasks
  DROP CONSTRAINT IF EXISTS coaching_tasks_created_by_fkey,
  ADD CONSTRAINT coaching_tasks_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.discord_invite_codes
  DROP CONSTRAINT IF EXISTS discord_invite_codes_created_by_fkey,
  ADD CONSTRAINT discord_invite_codes_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- The grant itself already follows its holder via user_id (CASCADE).
ALTER TABLE public.feature_access_grants
  DROP CONSTRAINT IF EXISTS feature_access_grants_granted_by_fkey,
  ADD CONSTRAINT feature_access_grants_granted_by_fkey
    FOREIGN KEY (granted_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.guild_raid_season_plans
  DROP CONSTRAINT IF EXISTS guild_raid_season_plans_created_by_fkey,
  ADD CONSTRAINT guild_raid_season_plans_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.guild_recruitment_requirements
  DROP CONSTRAINT IF EXISTS guild_recruitment_requirements_contributor_id_fkey,
  ADD CONSTRAINT guild_recruitment_requirements_contributor_id_fkey
    FOREIGN KEY (contributor_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.meta_run_encounter_plans
  DROP CONSTRAINT IF EXISTS meta_run_encounter_plans_updated_by_fkey,
  ADD CONSTRAINT meta_run_encounter_plans_updated_by_fkey
    FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.meta_run_published_clips
  DROP CONSTRAINT IF EXISTS meta_run_published_clips_published_by_fkey,
  ADD CONSTRAINT meta_run_published_clips_published_by_fkey
    FOREIGN KEY (published_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.meta_runs
  DROP CONSTRAINT IF EXISTS meta_runs_created_by_fkey,
  ADD CONSTRAINT meta_runs_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- CASCADE: the row is the subject's personal data.

ALTER TABLE public.coaching_task_deliveries
  DROP CONSTRAINT IF EXISTS coaching_task_deliveries_subject_user_id_fkey,
  ADD CONSTRAINT coaching_task_deliveries_subject_user_id_fkey
    FOREIGN KEY (subject_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- A NULLed row would be invisible to the applicant policy and unremovable.
ALTER TABLE public.universal_guild_applications
  DROP CONSTRAINT IF EXISTS universal_guild_applications_applicant_user_id_fkey,
  ADD CONSTRAINT universal_guild_applications_applicant_user_id_fkey
    FOREIGN KEY (applicant_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

DO $verify$
DECLARE
  v_expected CONSTANT text[][] := ARRAY[
    ['boss_assignment_configs_updated_by_fkey', 'n'],
    ['boss_playbook_replays_contributor_id_fkey', 'n'],
    ['boss_playbook_tactics_contributor_id_fkey', 'n'],
    ['boss_playbook_tactics_history_changed_by_fkey', 'n'],
    ['boss_playbook_team_requirements_contributor_id_fkey', 'n'],
    ['carousel_items_created_by_fkey', 'n'],
    ['cluster_recruitment_requirements_contributor_id_fkey', 'n'],
    ['coaching_task_deliveries_actor_user_id_fkey', 'n'],
    ['coaching_tasks_created_by_fkey', 'n'],
    ['discord_invite_codes_created_by_fkey', 'n'],
    ['feature_access_grants_granted_by_fkey', 'n'],
    ['guild_raid_season_plans_created_by_fkey', 'n'],
    ['guild_recruitment_requirements_contributor_id_fkey', 'n'],
    ['meta_run_encounter_plans_updated_by_fkey', 'n'],
    ['meta_run_published_clips_published_by_fkey', 'n'],
    ['meta_runs_created_by_fkey', 'n'],
    ['coaching_task_deliveries_subject_user_id_fkey', 'c'],
    ['universal_guild_applications_applicant_user_id_fkey', 'c']
  ];
  v_name    text;
  v_want    text;
  v_got     text;
  v_valid   boolean;
  v_checked int := 0;
  v_left    int;
BEGIN
  FOR i IN 1 .. array_length(v_expected, 1) LOOP
    v_name := v_expected[i][1];
    v_want := v_expected[i][2];

    SELECT c.confdeltype, c.convalidated INTO v_got, v_valid
    FROM pg_constraint c
    JOIN pg_class cl ON cl.oid = c.conrelid
    WHERE c.contype = 'f'
      AND c.confrelid = 'auth.users'::regclass
      AND cl.relnamespace = 'public'::regnamespace
      AND c.conname = v_name;

    IF v_got IS NULL THEN
      RAISE EXCEPTION 'PS-263 verify: constraint % is absent after the rewrite', v_name;
    END IF;
    IF v_got <> v_want THEN
      RAISE EXCEPTION 'PS-263 verify: % has confdeltype %, expected %', v_name, v_got, v_want;
    END IF;
    IF NOT v_valid THEN
      RAISE EXCEPTION 'PS-263 verify: % is not validated (convalidated = false)', v_name;
    END IF;
    v_checked := v_checked + 1;
  END LOOP;

  IF v_checked <> 18 THEN
    RAISE EXCEPTION 'PS-263 verify: checked % constraints, expected 18', v_checked;
  END IF;

  -- No public foreign key into auth.users may be left NO ACTION. This is the
  -- assertion that actually closes the ticket: it fails if a key was missed
  -- here, and it fails again if a later migration reintroduces one.
  SELECT count(*) INTO v_left
  FROM pg_constraint c
  JOIN pg_class cl ON cl.oid = c.conrelid
  WHERE c.contype = 'f'
    AND c.confrelid = 'auth.users'::regclass
    AND cl.relnamespace = 'public'::regnamespace
    AND c.confdeltype = 'a';

  IF v_left <> 0 THEN
    RAISE EXCEPTION 'PS-263 verify: % public foreign keys into auth.users are still NO ACTION', v_left;
  END IF;

  IF (SELECT attnotnull FROM pg_attribute
      WHERE attrelid = 'public.coaching_tasks'::regclass AND attname = 'created_by') THEN
    RAISE EXCEPTION 'PS-263 verify: coaching_tasks.created_by is still NOT NULL';
  END IF;

  IF (SELECT attnotnull FROM pg_attribute
      WHERE attrelid = 'public.coaching_task_deliveries'::regclass AND attname = 'actor_user_id') THEN
    RAISE EXCEPTION 'PS-263 verify: coaching_task_deliveries.actor_user_id is still NOT NULL';
  END IF;

  RAISE NOTICE 'PS-263 verify: 18 constraints carry their intended delete action, 0 public foreign keys into auth.users remain NO ACTION, both columns are nullable';
END
$verify$;

COMMIT;
