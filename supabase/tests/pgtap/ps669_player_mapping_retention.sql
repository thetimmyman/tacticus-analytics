BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;

SELECT plan(11);

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

SELECT NOT EXISTS (
  SELECT 1 FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'is_protected_guild'
) AS no_protected_guild_fn \gset

\if :no_protected_guild_fn
SELECT * FROM skip(
  4,
  'public.is_protected_guild() is a LIVE-ONLY function that no migration in this repository creates, and all three cleanup candidate predicates call it; the behavioural half of this suite cannot run on the replay lane. Run with PGTAP_LIVE_FUNCTIONS= a dump that carries it, or read the catalogue assertions above.'
);
\else

-- A departed member's mapping row keeps an otherwise abandoned guild out of cleanup.
INSERT INTO public.guild_config (guild_code, display_name,
  onboarding_completed, onboarding_completed_at, api_key_encrypted,
  onboarding_started_at)
VALUES
  ('PS669HIST', 'PS669 history guild', false, NULL, NULL,
   now() - INTERVAL '10 days'),
  ('PS669BARE', 'PS669 bare guild', false, NULL, NULL,
   now() - INTERVAL '10 days');

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

\endif

SELECT finish();
ROLLBACK;
