BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;

SELECT plan(18);

SELECT ok(
  EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version = '20260919012000'
  ),
  'PS-669 migration is recorded'
);

SELECT ok(
  pg_get_functiondef('public.cleanup_incomplete_registrations()'::regprocedure)
    NOT LIKE '%pm.is_current%',
  'cleanup_incomplete_registrations does not gate on pm.is_current'
);

SELECT ok(
  pg_get_functiondef(
    'public.cleanup_abandoned_onboarding(boolean, integer)'::regprocedure
  ) NOT LIKE '%pm.is_current%',
  'cleanup_abandoned_onboarding does not gate on pm.is_current'
);

SELECT ok(
  pg_get_functiondef('public.cleanup_orphaned_guilds()'::regprocedure)
    NOT LIKE '%pm.is_current%',
  'cleanup_orphaned_guilds does not gate on pm.is_current'
);

SELECT ok(
  pg_get_functiondef('public.cleanup_orphaned_guilds()'::regprocedure)
    LIKE '%ownership_attestation_id IS NULL%',
  'cleanup_orphaned_guilds deletes only unclaimed mappings'
);

-- Deactivation NULLs user_id, so the orphan probe relies on the never-deleted attestation trail.
SELECT ok(
  pg_get_functiondef('public.cleanup_orphaned_guilds()'::regprocedure)
    LIKE '%player_identity_attestations%',
  'cleanup_orphaned_guilds probes the attestation trail, not just claim columns'
);

SELECT ok(
  pg_get_functiondef('public.cleanup_orphaned_guilds()'::regprocedure)
    LIKE '%pia.mapping_id = pm.id%',
  'cleanup_orphaned_guilds joins attestations to the mapping row it may delete'
);

SELECT ok(
  pg_get_functiondef('public.cleanup_orphaned_guilds()'::regprocedure)
    NOT LIKE '%DELETE FROM "EOT_GR_data"%',
  'cleanup_orphaned_guilds never deletes battle history'
);

SELECT ok(
  pg_get_functiondef('public.cleanup_long_stale_guilds(integer,integer)'::regprocedure)
    NOT LIKE '%DELETE FROM "EOT_GR_data"%',
  'cleanup_long_stale_guilds never deletes battle history'
);

SELECT ok(
  pg_get_functiondef('public.cleanup_orphaned_guilds()'::regprocedure)
    LIKE '%claimed_mappings%',
  'cleanup_orphaned_guilds retains the claimed-mapping fail-closed backstop'
);

SELECT NOT EXISTS (
  SELECT 1 FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'is_protected_guild'
) AS no_protected_guild_fn \gset

\if :no_protected_guild_fn
SELECT * FROM skip(
  8,
  'public.is_protected_guild() is a LIVE-ONLY function that no migration in this repository creates, and all three cleanup candidate predicates call it; the behavioural half of this suite cannot run on the replay lane. Run with PGTAP_LIVE_FUNCTIONS= a dump that carries it, or read the catalogue assertions above.'
);
\else

-- A departed member's mapping row keeps an otherwise abandoned guild out of cleanup.
INSERT INTO public.guild_config (guild_code, display_name,
  onboarding_completed, onboarding_completed_at, api_key_encrypted,
  onboarding_started_at, last_successful_sync)
VALUES
  ('PS669HIST', 'PS669 history guild', false, NULL, NULL,
   now() - INTERVAL '10 days', now() - INTERVAL '2 days'),
  ('PS669BTTL', 'PS669 battle guild', true, now(), NULL,
   now() - INTERVAL '10 days', now() - INTERVAL '2 days'),
  ('PS669BARE', 'PS669 bare guild', false, NULL, NULL,
   now() - INTERVAL '10 days', now() - INTERVAL '2 days'),
  ('PS669ORPH', 'PS669 empty orphan guild', true, now(), NULL,
   now() - INTERVAL '10 days', now() - INTERVAL '2 days');

INSERT INTO public."EOT_GR_data" (id, "Guild", "Season", "encounterId")
VALUES
  (nextval('public."EOT_GR_data_id_seq"'), 'PS669BTTL', '70', 1),
  (nextval('public."EOT_GR_data_id_seq"'), 'PS669BTTL', 'historic', 2);

INSERT INTO public.player_mapping (
  id, player_id, display_name, guild_code, user_id, role,
  is_current, is_active, created_at, updated_at
)
VALUES
  (669001, 'ps669-departed', 'Departed Member', 'PS669HIST', NULL,
   'member'::public.app_role, false, false, now(), now());

SELECT lives_ok(
  $$SELECT public.cleanup_incomplete_registrations()$$,
  'cleanup_incomplete_registrations runs'
);

SELECT ok(
  EXISTS (SELECT 1 FROM public.guild_config WHERE guild_code = 'PS669HIST'),
  'a guild holding a departed members mapping is not cleaned up'
);

SELECT is(
  (SELECT display_name FROM public.player_mapping
   WHERE player_id = 'ps669-departed'),
  'Departed Member',
  'the departed members retained row and its display_name survive'
);

SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.guild_config WHERE guild_code = 'PS669BARE'),
  'a registration with no mapping history at all is still cleaned up'
);

SELECT lives_ok(
  $$SELECT public.cleanup_orphaned_guilds()$$,
  'cleanup_orphaned_guilds runs with retained battle history'
);

SELECT is(
  (SELECT count(*)::integer FROM public."EOT_GR_data" WHERE "Guild" = 'PS669BTTL'),
  2,
  'season 70 and non-numeric battle records both survive orphan cleanup'
);

SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.guild_config WHERE guild_code = 'PS669BTTL'),
  'an orphan guild with battle history is still cleaned up'
);

SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.guild_config WHERE guild_code = 'PS669ORPH'),
  'a truly empty orphan guild is still cleaned up'
);

\endif

SELECT finish();
ROLLBACK;
