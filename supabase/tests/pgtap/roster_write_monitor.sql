-- Fires when the roster writer is dead but claim-corridor writes keep max(updated_at) fresh.
-- monitoring.notify runs QUIET (state only): the replay lane has no webhook URL.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;
SET LOCAL timezone TO 'UTC';

SELECT plan(31);

SELECT is(
  current_database()::text,
  'postgres'::text,
  '1. this suite runs against the general database'
);

SELECT is(
  (SELECT count(*)::integer FROM supabase_migrations.schema_migrations
    WHERE version = '20260910010000'),
  1,
  '2. the roster write monitor migration is recorded as applied'
);

-- If defaults stop covering every parameter, the zero-argument cron call fails silently.
SELECT is(
  (SELECT (p.pronargdefaults = p.pronargs)
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'check_guild_roster_write_health'),
  true,
  '3. check_guild_roster_write_health() is callable with zero arguments (the pg_cron command)'
);

-- TP513DEAD: rows 20 days old plus 2 fresh claim-corridor writes; TP513LIVE: all rewritten an hour ago.
DO $seed$
DECLARE
  i integer;
BEGIN
  INSERT INTO public.guild_config
    (guild_code, display_name, enabled, last_successful_sync,
     consecutive_sync_failures, consecutive_loki_failures)
  VALUES
    ('TP513DEAD', 'Test dead-writer guild', true, now() - INTERVAL '4 minutes', 0, 0),
    ('TP513LIVE', 'Test healthy guild',     true, now() - INTERVAL '4 minutes', 0, 0);

  ALTER TABLE public.player_mapping DISABLE TRIGGER USER;

  FOR i IN 1..29 LOOP
    INSERT INTO public.player_mapping
      (player_id, display_name, guild_code, is_current, is_active, updated_at)
    VALUES (
      'TP513DEAD-' || i, 'dead ' || i, 'TP513DEAD', true, true,
      CASE WHEN i <= 2 THEN now() - INTERVAL '3 minutes'
           ELSE now() - INTERVAL '20 days' END);

    INSERT INTO public.player_mapping
      (player_id, display_name, guild_code, is_current, is_active, updated_at)
    VALUES ('TP513LIVE-' || i, 'live ' || i, 'TP513LIVE', true, true,
            now() - INTERVAL '1 hour');
  END LOOP;

  ALTER TABLE public.player_mapping ENABLE TRIGGER USER;
END
$seed$;

SELECT is(
  (SELECT count(*)::integer FROM public.player_mapping
    WHERE guild_code IN ('TP513DEAD', 'TP513LIVE') AND is_current),
  58,
  '4. fixture seeded: 29 is_current rows on each guild'
);

-- Blind-spot control: max(updated_at), the measure this monitor avoids, calls the dead guild healthy.
SELECT ok(
  (SELECT max(updated_at) FROM public.player_mapping
    WHERE guild_code = 'TP513DEAD' AND is_current) > now() - INTERVAL '1 hour',
  '5. BLIND-SPOT CONTROL: max(player_mapping.updated_at) on the dead guild is under an hour old, so a max-based alert stays green'
);

SELECT is(
  (SELECT verdict FROM public.guild_roster_write_health()
    WHERE guild_code = 'TP513DEAD'),
  'stale'::text,
  '6. the dead-writer guild reads stale'
);

SELECT is(
  (SELECT verdict FROM public.guild_roster_write_health()
    WHERE guild_code = 'TP513LIVE'),
  'ok'::text,
  '7. POSITIVE CONTROL: the healthy guild reads ok on the same call'
);

SELECT is(
  (SELECT rows_written_in_window FROM public.guild_roster_write_health()
    WHERE guild_code = 'TP513DEAD'),
  2,
  '8. only the two claim-corridor rows moved inside the window'
);

SELECT is(
  (SELECT sync_looks_healthy FROM public.guild_roster_write_health()
    WHERE guild_code = 'TP513DEAD'),
  true,
  '9. the dead guild is simultaneously reporting a healthy sync'
);

-- Own statement: a call inside the assertion's FROM would not see its alert_state write.
DO $run$ BEGIN PERFORM public.check_guild_roster_write_health(7, 0.5, 3, true); END $run$;

SELECT is(
  (SELECT status FROM monitoring.alert_state
    WHERE alert_key = 'roster.write.TP513DEAD'),
  'firing'::text,
  '10. THE MONITOR FIRES: check_guild_roster_write_health() raised roster.write.TP513DEAD'
);

SELECT is(
  (SELECT status FROM monitoring.alert_state
    WHERE alert_key = 'roster.write.TP513LIVE'),
  'cleared'::text,
  '11. PER-GUILD: the healthy guild on the same run is cleared, not firing'
);

DO $revive$
BEGIN
  ALTER TABLE public.player_mapping DISABLE TRIGGER USER;
  UPDATE public.player_mapping SET updated_at = now()
   WHERE guild_code = 'TP513DEAD' AND is_current;
  ALTER TABLE public.player_mapping ENABLE TRIGGER USER;
END
$revive$;

SELECT is(
  (SELECT verdict FROM public.guild_roster_write_health()
    WHERE guild_code = 'TP513DEAD'),
  'ok'::text,
  '12. with the roster written again the guild reads ok'
);

DO $run$ BEGIN PERFORM public.check_guild_roster_write_health(7, 0.5, 3, true); END $run$;

SELECT is(
  (SELECT status FROM monitoring.alert_state
    WHERE alert_key = 'roster.write.TP513DEAD'),
  'cleared'::text,
  '13. THE MONITOR GOES QUIET: the same alert key clears'
);

-- A thrown roster write alerts even with fresh rows, so `completed` cannot hide it.
DO $rec$ BEGIN
  PERFORM public.record_roster_write_outcome('TP513DEAD', false, NULL, 'upsert threw');
END $rec$;

SELECT is(
  (SELECT roster_write_failures FROM public.sync_health
    WHERE guild_code = 'TP513DEAD'),
  1,
  '14. record_roster_write_outcome(false) increments the roster-write failure counter'
);

SELECT is(
  (SELECT verdict FROM public.guild_roster_write_health()
    WHERE guild_code = 'TP513DEAD'),
  'failing'::text,
  '15. the counter alone flips the verdict, with every row still fresh'
);

DO $run$ BEGIN PERFORM public.check_guild_roster_write_health(7, 0.5, 3, true); END $run$;

SELECT is(
  (SELECT status FROM monitoring.alert_state
    WHERE alert_key = 'roster.write.TP513DEAD'),
  'firing'::text,
  '16. the monitor fires again on the counter alone'
);

DO $rec$ BEGIN
  PERFORM public.record_roster_write_outcome('TP513DEAD', true, 29, NULL);
END $rec$;

SELECT ok(
  (SELECT roster_write_failures = 0
            AND roster_rows_written_last_pass = 29
            AND last_roster_write_at > now() - INTERVAL '1 minute'
     FROM public.sync_health WHERE guild_code = 'TP513DEAD'),
  '17. a successful pass resets the counter, stamps last_roster_write_at and records the rows it wrote'
);

-- sync_dead needs both: every sync lane skips the guild AND no clean sync landed in the window.
DO $syncdead$
BEGIN
  INSERT INTO public.guild_config
    (guild_code, display_name, enabled, last_successful_sync, api_key_encrypted,
     api_key_is_valid, consecutive_sync_failures, consecutive_loki_failures, auto_sync_enabled)
  VALUES
    ('TP513SYNCOFF',  'Synthetic keyless sync-off guild',  true, now() - INTERVAL '20 days', NULL,        NULL,  0, 0, false),
    ('TP513SYNCFAIL', 'Synthetic keyless gave-up guild',   true, now() - INTERVAL '20 days', NULL,        NULL,  5, 0, true),
    ('TP513BADKEY',   'Synthetic invalid-key guild',       true, now() - INTERVAL '20 days', 'synthetic', false, 0, 0, true),
    ('TP513KEYOFF',   'Synthetic scheduler-served guild',  true, now() - INTERVAL '20 days', 'synthetic', NULL,  0, 0, false),
    ('TP513FLAKY',    'Synthetic flaky-sync guild',        true, now() - INTERVAL '2 hours', 'synthetic', NULL,  2, 0, true),
    ('TP513FRESHBAD', 'Synthetic freshly-invalid guild',   true, now() - INTERVAL '1 hour',  'synthetic', false, 0, 0, true),
    ('TP513EDGE',     'Synthetic in-window invalid guild', true, now() - INTERVAL '6 days',  'synthetic', false, 0, 0, true),
    ('TP513FEWDEAD',  'Synthetic tiny keyless guild',      true, now() - INTERVAL '20 days', NULL,        NULL,  0, 0, false),
    ('TP513SYNCNULL', 'Synthetic keyless unset-sync guild', true, now() - INTERVAL '20 days', NULL,        NULL,  0, 0, NULL);
  ALTER TABLE public.player_mapping DISABLE TRIGGER USER;
  INSERT INTO public.player_mapping
    (player_id, display_name, guild_code, is_current, is_active, updated_at)
  SELECT g || '-' || i, 'sync ' || i, g, true, true, now() - INTERVAL '20 days'
    FROM unnest(ARRAY['TP513SYNCOFF', 'TP513SYNCFAIL', 'TP513BADKEY', 'TP513KEYOFF',
                      'TP513FLAKY', 'TP513FRESHBAD', 'TP513EDGE', 'TP513SYNCNULL']) AS g,
         generate_series(1, 29) AS i;
  INSERT INTO public.player_mapping
    (player_id, display_name, guild_code, is_current, is_active, updated_at)
  SELECT 'TP513FEWDEAD-' || i, 'few ' || i, 'TP513FEWDEAD', true, true, now() - INTERVAL '20 days'
    FROM generate_series(1, 2) AS i;
  ALTER TABLE public.player_mapping ENABLE TRIGGER USER;
  -- Each sync-dead guild starts out firing, so clearing is a real transition.
  PERFORM monitoring.notify('roster.write.' || g, 'firing',
    'Roster write stalled: ' || g, 'synthetic prior alert', true)
    FROM unnest(ARRAY['TP513SYNCOFF', 'TP513SYNCFAIL', 'TP513BADKEY']) AS g;
END
$syncdead$;

SELECT is(
  (SELECT verdict FROM public.guild_roster_write_health()
    WHERE guild_code = 'TP513SYNCOFF'),
  'sync_dead'::text,
  '18. no key, auto sync off, no clean sync in the window: sync_dead, not stale'
);

SELECT is(
  (SELECT verdict FROM public.guild_roster_write_health()
    WHERE guild_code = 'TP513SYNCFAIL'),
  'sync_dead'::text,
  '19. no key, batch sync gave up at 5 failures, no clean sync in the window: sync_dead'
);

SELECT is(
  (SELECT verdict FROM public.guild_roster_write_health()
    WHERE guild_code = 'TP513BADKEY'),
  'sync_dead'::text,
  '20. API key marked invalid, no clean sync in the window: sync_dead'
);

SELECT is(
  (SELECT verdict FROM public.guild_roster_write_health()
    WHERE guild_code = 'TP513KEYOFF'),
  'stale'::text,
  '21. auto sync off but a usable key: the scheduler still serves it, so stale'
);

SELECT is(
  (SELECT verdict FROM public.guild_roster_write_health()
    WHERE guild_code = 'TP513FLAKY'),
  'stale'::text,
  '22. NEGATIVE CONTROL: failures below the give-up count and a sync 2 hours ago keep stale'
);

SELECT is(
  (SELECT verdict FROM public.guild_roster_write_health()
    WHERE guild_code = 'TP513FRESHBAD'),
  'stale'::text,
  '23. key marked invalid but a clean sync landed an hour ago: the clock outranks the flag'
);

SELECT is(
  (SELECT verdict FROM public.guild_roster_write_health()
    WHERE guild_code = 'TP513EDGE'),
  'stale'::text,
  '24. key marked invalid, last clean sync 6 days ago is inside the 7-day window: stale'
);

SELECT is(
  (SELECT verdict FROM public.guild_roster_write_health()
    WHERE guild_code = 'TP513FEWDEAD'),
  'too_few_rows'::text,
  '25. a sync-dead guild with too few rows stays too_few_rows: cannot tell is not cleared'
);

SELECT is(
  public.check_guild_roster_write_health(7, 0.5, 3, true),
  (SELECT count(*)::integer FROM public.guild_roster_write_health(7, 0.5, 3)
    WHERE verdict IN ('failing', 'stale')),
  '26. the monitor counts exactly the failing and stale guilds as firing, not sync_dead'
);

SELECT is(
  (SELECT count(*)::integer FROM monitoring.alert_state
    WHERE alert_key IN ('roster.write.TP513SYNCOFF', 'roster.write.TP513SYNCFAIL',
                        'roster.write.TP513BADKEY')
      AND status = 'cleared'),
  3,
  '27. the monitor clears the firing roster alert of every sync_dead guild'
);

SELECT is(
  (SELECT count(*)::integer FROM monitoring.alert_state
    WHERE alert_key IN ('roster.write.TP513KEYOFF', 'roster.write.TP513FLAKY',
                        'roster.write.TP513FRESHBAD', 'roster.write.TP513EDGE')
      AND status = 'firing'),
  4,
  '28. the same run still fires for every stale guild a lane still serves or recently synced'
);

SELECT ok(
  (SELECT last_body FROM monitoring.alert_state
    WHERE alert_key = 'roster.write.TP513SYNCOFF')
    LIKE '%every sync lane skips this guild and no clean sync landed in the last 7 day(s)%',
  '29. the clearing message names the sync outage and the window'
);

-- A recorded roster-write error outranks a dead sync: the writer itself threw.
DO $rec$ BEGIN
  PERFORM public.record_roster_write_outcome('TP513BADKEY', false, NULL, 'upsert threw');
END $rec$;

SELECT is(
  (SELECT verdict FROM public.guild_roster_write_health()
    WHERE guild_code = 'TP513BADKEY'),
  'failing'::text,
  '30. a sync-dead guild with a recorded roster-write failure still reads failing'
);

-- Batch sync skips a NULL auto_sync_enabled as it skips false, so a keyless guild with it unset is dead.
SELECT is(
  (SELECT verdict FROM public.guild_roster_write_health()
    WHERE guild_code = 'TP513SYNCNULL'),
  'sync_dead'::text,
  '31. no key, auto sync unset (NULL), no clean sync in the window: sync_dead'
);

SELECT * FROM finish();
ROLLBACK;
