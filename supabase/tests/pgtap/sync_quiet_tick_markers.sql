-- Only server authority may write quiet-tick markers; a leader pushing them forward suppresses
-- departed-member reconciliation.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;

SELECT plan(8);

SELECT has_column('public', 'guild_config', 'last_roster_refresh_at',
  'guild_config.last_roster_refresh_at exists');
SELECT has_column('public', 'guild_config', 'last_raid_write_at',
  'guild_config.last_raid_write_at exists');
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.guild_config'::regclass
       AND tgname = 'guard_guild_config_sync_markers'
       AND NOT tgisinternal
  ),
  'the sync-marker guard trigger is installed'
);

INSERT INTO public.guild_config (guild_code, display_name)
VALUES ('PS320-MARKERS', 'PR 320 marker fixture')
ON CONFLICT (guild_code) DO NOTHING;

-- RLS bypassed so the trigger, not a policy, is judged.
CREATE ROLE pr320_marker_probe NOLOGIN BYPASSRLS;
GRANT USAGE ON SCHEMA public TO pr320_marker_probe;
GRANT SELECT, UPDATE ON public.guild_config TO pr320_marker_probe;

GRANT USAGE ON SCHEMA extensions TO pr320_marker_probe;
SET LOCAL ROLE pr320_marker_probe;
SELECT lives_ok(
  $$ UPDATE public.guild_config
        SET updated_at = now()
      WHERE guild_code = 'PS320-MARKERS' $$,
  'control: the probe can update an unrelated column'
);
SELECT throws_ok(
  $$ UPDATE public.guild_config
        SET last_roster_refresh_at = now() + interval '10 years'
      WHERE guild_code = 'PS320-MARKERS' $$,
  '42501',
  NULL,
  'a non-server role cannot move last_roster_refresh_at'
);
SELECT throws_ok(
  $$ UPDATE public.guild_config
        SET last_raid_write_at = now()
      WHERE guild_code = 'PS320-MARKERS' $$,
  '42501',
  NULL,
  'a non-server role cannot write last_raid_write_at'
);
RESET ROLE;
SET search_path TO extensions, public, pg_catalog;

SELECT lives_ok(
  $$ UPDATE public.guild_config
        SET last_roster_refresh_at = '2026-09-25T00:00:00Z',
            last_raid_write_at = '2026-09-25T00:05:00Z'
      WHERE guild_code = 'PS320-MARKERS' $$,
  'server authority can stamp both markers'
);
SELECT is(
  (SELECT last_roster_refresh_at FROM public.guild_config
    WHERE guild_code = 'PS320-MARKERS'),
  '2026-09-25T00:00:00Z'::timestamptz,
  'the server stamp persisted'
);

SELECT * FROM finish();
ROLLBACK;
