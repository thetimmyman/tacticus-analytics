-- Manual acceptance: psql -f - -v subject=<dedicated test account uuid, never a real player>.
-- Ends in ROLLBACK, but legs B and C take real locks and write WAL: a production mutation.

\set ON_ERROR_STOP on

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;

SELECT plan(35);

CREATE TEMP TABLE ps263_expected(conname text PRIMARY KEY, want_confdeltype "char") ON COMMIT DROP;
INSERT INTO ps263_expected VALUES
  ('boss_assignment_configs_updated_by_fkey', 'n'),
  ('boss_playbook_replays_contributor_id_fkey', 'n'),
  ('boss_playbook_tactics_contributor_id_fkey', 'n'),
  ('boss_playbook_tactics_history_changed_by_fkey', 'n'),
  ('boss_playbook_team_requirements_contributor_id_fkey', 'n'),
  ('carousel_items_created_by_fkey', 'n'),
  ('cluster_recruitment_requirements_contributor_id_fkey', 'n'),
  ('coaching_task_deliveries_actor_user_id_fkey', 'n'),
  ('coaching_tasks_created_by_fkey', 'n'),
  ('discord_invite_codes_created_by_fkey', 'n'),
  ('feature_access_grants_granted_by_fkey', 'n'),
  ('guild_raid_season_plans_created_by_fkey', 'n'),
  ('guild_recruitment_requirements_contributor_id_fkey', 'n'),
  ('meta_run_encounter_plans_updated_by_fkey', 'n'),
  ('meta_run_published_clips_published_by_fkey', 'n'),
  ('meta_runs_created_by_fkey', 'n'),
  ('coaching_task_deliveries_subject_user_id_fkey', 'c'),
  ('universal_guild_applications_applicant_user_id_fkey', 'c');

-- LEFT JOIN from the expected list so a vanished constraint reports MISSING.
SELECT is(
  (
    SELECT coalesce(
      string_agg(e.conname || '=' ||
        coalesce(c.confdeltype::text, 'MISSING') ||
        CASE WHEN c.oid IS NULL THEN ''
             WHEN c.convalidated THEN '/valid'
             ELSE '/NOTVALIDATED' END,
        E'\n' ORDER BY e.conname),
      '')
    FROM ps263_expected e
    LEFT JOIN pg_constraint c
      ON c.conname = e.conname
     AND c.contype = 'f'
     AND c.confrelid = 'auth.users'::regclass
     AND c.conrelid IN (SELECT oid FROM pg_class WHERE relnamespace = 'public'::regnamespace)
    WHERE c.oid IS NULL
       OR c.confdeltype <> e.want_confdeltype
       OR NOT c.convalidated
  ),
  '',
  'leg A: all 18 constraints exist, carry the intended delete action and are validated'
);

SELECT is(
  (SELECT count(*)::integer FROM pg_constraint c
   JOIN pg_class cl ON cl.oid = c.conrelid
   WHERE c.contype = 'f' AND c.confrelid = 'auth.users'::regclass
     AND cl.relnamespace = 'public'::regnamespace AND c.confdeltype = 'a'),
  0,
  'leg A: no public foreign key into auth.users is left ON DELETE NO ACTION'
);

SELECT ok(
  NOT (SELECT attnotnull FROM pg_attribute
       WHERE attrelid = 'public.coaching_tasks'::regclass AND attname = 'created_by'),
  'leg A: coaching_tasks.created_by is nullable'
);

SELECT ok(
  NOT (SELECT attnotnull FROM pg_attribute
       WHERE attrelid = 'public.coaching_task_deliveries'::regclass AND attname = 'actor_user_id'),
  'leg A: coaching_task_deliveries.actor_user_id is nullable'
);

SELECT ok(
  (SELECT attnotnull FROM pg_attribute
   WHERE attrelid = 'public.coaching_task_deliveries'::regclass AND attname = 'subject_user_id'),
  'leg A: coaching_task_deliveries.subject_user_id stays NOT NULL (it is CASCADE, not SET NULL)'
);

SELECT is(
  (SELECT c.confdeltype::text FROM pg_constraint c
   WHERE c.conname = 'application_messages_application_id_fkey' AND c.contype = 'f'),
  'c',
  'leg A: the second hop application_messages -> universal_guild_applications is still CASCADE'
);

SELECT is(
  (SELECT count(*)::integer FROM pg_trigger
   WHERE tgrelid = 'auth.users'::regclass
     AND tgname = 'wi6208_revoke_player_identity_on_auth_user_delete'
     AND tgenabled = 'O'),
  1,
  'leg A: the WI-6208 trigger is still present and enabled (this migration does not replace it)'
);

-- Leg C (negative control) restores NO ACTION, so the delete MUST raise 23503; without it
-- leg B proves nothing. Postgres does not promise which of the 18 keys it checks first.

\if :{?subject}
\else
\set subject '00000000-0000-0000-0000-000000000000'
\endif

-- psql does not interpolate variables in dollar-quoted bodies, hence a plain assertion.
SELECT ok(
  EXISTS (SELECT 1 FROM auth.users WHERE id = :'subject'::uuid),
  'legs B and C have a real PS-183 exercise subject (pass -v subject=<uuid> from ~/secrets/exercise-ta.env, key EXERCISE_TA_USER_ID)'
);

ALTER TABLE public.meta_runs
  DROP CONSTRAINT meta_runs_created_by_fkey,
  ADD CONSTRAINT meta_runs_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES auth.users(id);

-- carried_forward_from stays NULL so its unique index cannot collide.
INSERT INTO public.meta_runs (cluster_code, encounter_plan_id, created_by)
SELECT cluster_code, encounter_plan_id, :'subject'::uuid
FROM public.meta_runs WHERE encounter_plan_id IS NOT NULL LIMIT 1;

SELECT throws_ok(
  format('DELETE FROM auth.users WHERE id = %L', :'subject'),
  '23503',
  NULL,
  'leg C (negative control): with meta_runs_created_by_fkey back at NO ACTION the delete raises 23503'
);

SELECT matches(
  (SELECT conname FROM pg_constraint
   WHERE conname = 'meta_runs_created_by_fkey' AND confdeltype = 'a'),
  '^meta_runs_created_by_fkey$',
  'leg C: the control really did restore NO ACTION, so the 23503 above is not a different defect'
);

DELETE FROM public.meta_runs WHERE created_by = :'subject'::uuid;

ALTER TABLE public.meta_runs
  DROP CONSTRAINT meta_runs_created_by_fkey,
  ADD CONSTRAINT meta_runs_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- SET NULL: leg D checks this artefact survived with a NULL author.
CREATE TEMP TABLE ps263_seed(kind text PRIMARY KEY, id uuid) ON COMMIT DROP;

WITH ins AS (
  INSERT INTO public.meta_runs (cluster_code, encounter_plan_id, created_by)
  SELECT cluster_code, encounter_plan_id, :'subject'::uuid
  FROM public.meta_runs WHERE encounter_plan_id IS NOT NULL LIMIT 1
  RETURNING id
)
INSERT INTO ps263_seed SELECT 'meta_run', id FROM ins;

WITH ins AS (
  INSERT INTO public.universal_guild_applications (guild_code, applicant_name, applicant_user_id)
  SELECT guild_code, applicant_name, :'subject'::uuid
  FROM public.universal_guild_applications LIMIT 1
  RETURNING id
)
INSERT INTO ps263_seed SELECT 'application', id FROM ins;

INSERT INTO public.application_messages (application_id, message, sender_type, sender_user_id)
SELECT id, 'PS-263 acceptance seed', 'applicant', :'subject'::uuid
FROM ps263_seed WHERE kind = 'application';

-- Trigger-covered: redacted before any key is checked.
INSERT INTO public.player_invite_codes (code, display_name, expires_at, guild_code, player_id, created_by)
SELECT 'ps263-' || gen_random_uuid()::text, display_name, now() + interval '1 day',
       guild_code, player_id, :'subject'::uuid
FROM public.player_invite_codes LIMIT 1;

SELECT ok(
  (SELECT count(*) FROM public.meta_runs WHERE created_by = :'subject'::uuid) > 0
  AND (SELECT count(*) FROM public.universal_guild_applications WHERE applicant_user_id = :'subject'::uuid) > 0
  AND (SELECT count(*) FROM public.application_messages WHERE sender_user_id = :'subject'::uuid) > 0
  AND (SELECT count(*) FROM public.player_invite_codes WHERE created_by = :'subject'::uuid) > 0,
  'leg B: the subject is seeded behind a SET NULL key, a CASCADE key, its second hop and the trigger-covered key'
);

SELECT lives_ok(
  format('DELETE FROM auth.users WHERE id = %L', :'subject'),
  'leg B: with the migration applied, deleting the subject succeeds'
);

SELECT is(
  (SELECT count(*)::integer FROM auth.users WHERE id = :'subject'::uuid),
  0,
  'leg B: the auth.users row is gone, so the erasure completed rather than half-completing'
);

SELECT is(
  (SELECT count(*)::integer FROM public.meta_runs WHERE created_by = :'subject'::uuid),
  0, 'leg D: meta_runs.created_by holds no reference to the deleted subject'
);
SELECT is(
  (SELECT created_by FROM public.meta_runs
   WHERE id = (SELECT id FROM ps263_seed WHERE kind = 'meta_run')),
  NULL::uuid,
  'leg D: the seeded meta_runs row SURVIVED with a NULL author (SET NULL, not CASCADE)'
);

SELECT is(
  (SELECT count(*)::integer FROM public.universal_guild_applications WHERE applicant_user_id = :'subject'::uuid),
  0, 'leg D: the subject universal_guild_applications row is gone (CASCADE)'
);
SELECT is(
  (SELECT count(*)::integer FROM public.universal_guild_applications
   WHERE id = (SELECT id FROM ps263_seed WHERE kind = 'application')),
  0, 'leg D: that exact application row is gone, not merely unreferenced'
);
SELECT is(
  (SELECT count(*)::integer FROM public.application_messages WHERE sender_user_id = :'subject'::uuid),
  0, 'leg D: the second-hop application_messages thread went with the application'
);

SELECT is(
  (SELECT count(*)::integer FROM public.player_invite_codes WHERE created_by = :'subject'::uuid),
  0, 'leg D: player_invite_codes.created_by holds no reference to the deleted subject'
);

-- Every other decision-table column by name, so a partial apply cannot pass.
SELECT is((SELECT count(*)::integer FROM public.boss_assignment_configs WHERE updated_by = :'subject'::uuid), 0,
  'leg D: boss_assignment_configs.updated_by clean');
SELECT is((SELECT count(*)::integer FROM public.boss_playbook_replays WHERE contributor_id = :'subject'::uuid), 0,
  'leg D: boss_playbook_replays.contributor_id clean');
SELECT is((SELECT count(*)::integer FROM public.boss_playbook_tactics WHERE contributor_id = :'subject'::uuid), 0,
  'leg D: boss_playbook_tactics.contributor_id clean');
SELECT is((SELECT count(*)::integer FROM public.boss_playbook_tactics_history WHERE changed_by = :'subject'::uuid), 0,
  'leg D: boss_playbook_tactics_history.changed_by clean');
SELECT is((SELECT count(*)::integer FROM public.boss_playbook_team_requirements WHERE contributor_id = :'subject'::uuid), 0,
  'leg D: boss_playbook_team_requirements.contributor_id clean');
SELECT is((SELECT count(*)::integer FROM public.carousel_items WHERE created_by = :'subject'::uuid), 0,
  'leg D: carousel_items.created_by clean');
SELECT is((SELECT count(*)::integer FROM public.cluster_recruitment_requirements WHERE contributor_id = :'subject'::uuid), 0,
  'leg D: cluster_recruitment_requirements.contributor_id clean');
SELECT is((SELECT count(*)::integer FROM public.coaching_task_deliveries WHERE actor_user_id = :'subject'::uuid), 0,
  'leg D: coaching_task_deliveries.actor_user_id clean');
SELECT is((SELECT count(*)::integer FROM public.coaching_task_deliveries WHERE subject_user_id = :'subject'::uuid), 0,
  'leg D: coaching_task_deliveries.subject_user_id clean');
SELECT is((SELECT count(*)::integer FROM public.coaching_tasks WHERE created_by = :'subject'::uuid), 0,
  'leg D: coaching_tasks.created_by clean');
SELECT is((SELECT count(*)::integer FROM public.discord_invite_codes WHERE created_by = :'subject'::uuid), 0,
  'leg D: discord_invite_codes.created_by clean');
SELECT is((SELECT count(*)::integer FROM public.feature_access_grants WHERE granted_by = :'subject'::uuid), 0,
  'leg D: feature_access_grants.granted_by clean');
SELECT is((SELECT count(*)::integer FROM public.guild_raid_season_plans WHERE created_by = :'subject'::uuid), 0,
  'leg D: guild_raid_season_plans.created_by clean');
SELECT is((SELECT count(*)::integer FROM public.guild_recruitment_requirements WHERE contributor_id = :'subject'::uuid), 0,
  'leg D: guild_recruitment_requirements.contributor_id clean');
SELECT is((SELECT count(*)::integer FROM public.meta_run_encounter_plans WHERE updated_by = :'subject'::uuid), 0,
  'leg D: meta_run_encounter_plans.updated_by clean');
SELECT is((SELECT count(*)::integer FROM public.meta_run_published_clips WHERE published_by = :'subject'::uuid), 0,
  'leg D: meta_run_published_clips.published_by clean');

SELECT * FROM finish();

ROLLBACK;
