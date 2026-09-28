-- Anon sees no boss playbook content; the global fallback tier stays visible to logged-in
-- clusterless users. A pre-migration database skips via the ledger guard.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;

SELECT NOT EXISTS (
  SELECT 1
  FROM supabase_migrations.schema_migrations
  WHERE version = '20260908010000'
    AND name = 'ps387_playbook_anon_guard'
) AS tp387_not_applied \gset

\if :tp387_not_applied
SELECT plan(10);
SELECT * FROM skip(
  10,
  'this database predates the playbook anon guard; apply 20260908010000 and this suite executes fully'
);
SELECT * FROM finish();
ROLLBACK;
\else

SELECT plan(10);

-- The ledger row itself, so a suite that matched nothing cannot pass.
SELECT is(
  (SELECT count(*)::integer
     FROM supabase_migrations.schema_migrations
    WHERE version = '20260908010000'
      AND name = 'ps387_playbook_anon_guard'),
  1,
  '1. the ps387_playbook_anon_guard migration is recorded exactly once in the ledger'
);

-- ...a1/...a2 are the global tier (visible), ...b1/...b2 are in cluster TP387X (invisible).
INSERT INTO auth.users (id, email)
VALUES ('a5387000-0000-4000-8000-000000000001'::uuid, 'tp387-subject@example.invalid');

INSERT INTO public.guild_config (guild_code, display_name, cluster_code)
VALUES ('TP387G', 'Test clusterless fixture guild', NULL),
       ('TP387H', 'Test other-cluster fixture guild', 'TP387X');

-- The identity trigger needs an attestation naming the mapping id, hence the insert order.
INSERT INTO public.player_mapping (player_id, display_name, guild_code, is_current)
VALUES ('tp387-player', 'Test subject', 'TP387G', true);

INSERT INTO public.player_identity_attestations
  (mapping_id, player_id, subject_user_id, consumed_at, source)
SELECT m.id, m.player_id,
       'a5387000-0000-4000-8000-000000000001'::uuid, now(),
       'operator_quarantine_restore'
  FROM public.player_mapping AS m
 WHERE m.player_id = 'tp387-player';

UPDATE public.player_mapping AS m
   SET user_id = 'a5387000-0000-4000-8000-000000000001'::uuid,
       ownership_attestation_id = a.id
  FROM public.player_identity_attestations AS a
 WHERE a.mapping_id = m.id
   AND m.player_id = 'tp387-player';

INSERT INTO public.boss_playbook_team_requirements
  (id, boss_id, guild_code, cluster_code, hero_requirements)
VALUES
  ('a5387000-0000-4000-8000-0000000000a1'::uuid, 'tp387-boss', NULL, NULL, '[]'::jsonb),
  ('a5387000-0000-4000-8000-0000000000b1'::uuid, 'tp387-boss', 'TP387H', 'TP387X', '[]'::jsonb);

INSERT INTO public.boss_playbook_tactics
  (id, boss_id, content, guild_code, cluster_code, encounter_type)
VALUES
  ('a5387000-0000-4000-8000-0000000000a2'::uuid, 'tp387-boss',
   'Test global-tier tactic', 'TP387G', NULL, 'main'),
  ('a5387000-0000-4000-8000-0000000000b2'::uuid, 'tp387-boss',
   'Test other-cluster tactic', 'TP387H', 'TP387X', 'main');

INSERT INTO public.boss_playbook_tactics_history
  (tactics_id, content, content_format, version)
VALUES
  ('a5387000-0000-4000-8000-0000000000a2'::uuid, 'Test history of the global-tier tactic', 'tiptap', 1),
  ('a5387000-0000-4000-8000-0000000000b2'::uuid, 'Test history of the other-cluster tactic', 'tiptap', 1);

GRANT USAGE ON SCHEMA extensions TO authenticated, anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA extensions TO authenticated, anon;

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', NULL, true);
SELECT set_config('request.jwt.claim.sub', NULL, true);

SELECT is(
  (SELECT count(*)::integer FROM public.boss_playbook_tactics_history),
  0,
  '2. anon sees NO boss_playbook_tactics_history rows at all (live before-state: 31)'
);

SELECT is(
  (SELECT count(*)::integer FROM public.boss_playbook_team_requirements),
  0,
  '3. anon sees NO boss_playbook_team_requirements rows at all (live before-state: 6)'
);

-- Empty, not broken: a REVOKE would raise 42501 and break anon_definer_oracles.sql.
SELECT lives_ok(
  $$ SELECT count(*) FROM public.boss_playbook_team_requirements $$,
  '4. the anon SELECT still executes rather than raising -- a policy fix, not a REVOKE'
);

RESET ROLE;

SET LOCAL ROLE authenticated;
-- Live auth.uid() reads the JSON claims, the shim reads claim.sub.
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"a5387000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
SELECT set_config('request.jwt.claim.sub', 'a5387000-0000-4000-8000-000000000001', true);

SELECT is(
  (SELECT count(*)::integer FROM public.boss_playbook_tactics t
    WHERE t.id = 'a5387000-0000-4000-8000-0000000000a2'::uuid),
  1,
  '5. the clusterless subject CAN see the global-tier parent tactic'
);

SELECT is(
  (SELECT count(*)::integer FROM public.boss_playbook_tactics_history h
    WHERE h.tactics_id = 'a5387000-0000-4000-8000-0000000000a2'::uuid),
  1,
  '6. ...and therefore its history: the policy resolves THROUGH the parent'
);

SELECT is(
  (SELECT count(*)::integer FROM public.boss_playbook_tactics t
    WHERE t.id = 'a5387000-0000-4000-8000-0000000000b2'::uuid),
  0,
  '7. the subject CANNOT see a tactic in a cluster that is not theirs'
);

SELECT is(
  (SELECT count(*)::integer FROM public.boss_playbook_tactics_history h
    WHERE h.tactics_id = 'a5387000-0000-4000-8000-0000000000b2'::uuid),
  0,
  '8. ...and cannot see its history either -- history is never more permissive than its parent'
);

-- The member-gaps/strength-overrides routes read the global tier via the session client, so 9
-- must stay non-zero.
SELECT is(
  (SELECT count(*)::integer FROM public.boss_playbook_team_requirements r
    WHERE r.id = 'a5387000-0000-4000-8000-0000000000a1'::uuid),
  1,
  '9. a logged-in clusterless user STILL sees the global-tier requirement row'
);

SELECT is(
  (SELECT count(*)::integer FROM public.boss_playbook_team_requirements r
    WHERE r.id = 'a5387000-0000-4000-8000-0000000000b1'::uuid),
  0,
  '10. ...and still does NOT see a requirement row belonging to another cluster'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
\endif
