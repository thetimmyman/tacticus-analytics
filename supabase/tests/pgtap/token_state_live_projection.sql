BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;
-- last_sync_at is timestamp without time zone; pin UTC so fixture math is exact.
SET LOCAL timezone TO 'UTC';

SELECT plan(60);

SELECT has_function(
  'public',
  'get_player_token_state',
  ARRAY['text', 'text', 'text', 'text'],
  'get_player_token_state exposes the token-state surface'
);

-- Parent rows first: live schema has the player_mapping -> guild_config FK.
INSERT INTO public.guild_config (guild_code, display_name)
VALUES
  ('TW2570', 'TW2570 pgTAP fixture guild'),
  ('TW2570LEX', 'TW2570LEX pgTAP fixture guild')
ON CONFLICT (guild_code) DO NOTHING;

INSERT INTO public.player_mapping (
  id,
  player_id,
  display_name,
  guild_code,
  is_current,
  tacticus_api_key_encrypted,
  api_key_is_valid,
  last_sync_tokens,
  next_token_seconds,
  last_sync_at,
  last_sync_bombs,
  next_bomb_seconds
) VALUES
  -- 13h ago at 1/3, due in 1h: pops at +1h and +13h -> 3/3, paused.
  (925700, 'tw2570-popped', 'TW2570 Popped', 'TW2570', true,
   'enc-test-key', true, 1, 3600, (now() - interval '13 hours')::timestamp, 1, null),
  -- 2h ago at 0/3, token due 3h, bomb due 1h: no token yet, bomb back.
  (925701, 'tw2570-decayed', 'TW2570 Decayed', 'TW2570', true,
   'enc-test-key', true, 0, 10800, (now() - interval '2 hours')::timestamp, 0, 3600),
  (925702, 'tw2570-capped', 'TW2570 Capped', 'TW2570', true,
   'enc-test-key', true, 3, null, (now() - interval '20 hours')::timestamp, 1, null),
  -- 26h ago at 0/3, due in 1h: third pop clipped by the cap -> 3/3.
  (925703, 'tw2570-clipped', 'TW2570 Clipped', 'TW2570', true,
   'enc-test-key', true, 0, 3600, (now() - interval '26 hours')::timestamp, 1, null),
  -- Below cap with no usable countdown: cannot project, keep the snapshot.
  (925704, 'tw2570-notimer', 'TW2570 NoTimer', 'TW2570', true,
   'enc-test-key', true, 2, null, (now() - interval '20 hours')::timestamp, 1, null),
  (925705, 'tw2570-nokey', 'TW2570 NoKey', 'TW2570', true,
   null, null, null, null, null, null, null),
  -- 15h ago at 0/3, due in 1h: pops at +1h, +13h; third due in 36000s -> 2/3.
  (925706, 'tw2570-midcycle', 'TW2570 MidCycle', 'TW2570', true,
   'enc-test-key', true, 0, 3600, (now() - interval '15 hours')::timestamp, 1, null),
  (925707, 'tw2570-spent', 'TW2570 Spent', 'TW2570', true,
   'enc-test-key', true, 1, 3600, (now() - interval '26 hours')::timestamp, 1, null),
  -- No age cutoff: an old spend-free snapshot projects to cap.
  (925708, 'tw2570-rotten', 'TW2570 Rotten', 'TW2570', true,
   'enc-test-key', true, 1, 3600, (now() - interval '72 hours')::timestamp, 1, null),
  -- A later bomb falls back only the bomb fields.
  (925713, 'tw2570-bombed', 'TW2570 Bombed', 'TW2570', true,
   'enc-test-key', true, 2, 3600, (now() - interval '2 hours')::timestamp, 1, null),
  (925714, 'tw2570-prevszn', 'TW2570 PrevSzn', 'TW2570', true,
   'enc-test-key', true, 1, 3600, (now() - interval '26 hours')::timestamp, 1, null),
  (925715, 'tw2570-renamed', 'TW2570 NewName', 'TW2570', true,
   'enc-test-key', true, 1, 3600, (now() - interval '26 hours')::timestamp, 1, null),
  (925720, 'tw2640-capspend', 'TW2640 CapSpend', 'TW2570', true,
   'enc-test-key', true, 3, null, (now() - interval '10 hours')::timestamp, 1, null),
  (925721, 'tw2640-twospend', 'TW2640 TwoSpend', 'TW2570', true,
   'enc-test-key', true, 2, 3600, (now() - interval '20 hours')::timestamp, 1, null),
  (925722, 'tw2640-bombspend', 'TW2640 BombSpend', 'TW2570', true,
   'enc-test-key', true, 3, null, (now() - interval '6 hours')::timestamp, 1, null),
  (925723, 'tw2640-overspend', 'TW2640 OverSpend', 'TW2570', true,
   'enc-test-key', true, 1, 3600, (now() - interval '3 hours')::timestamp, 1, null),
  -- (userId, startedOn) is not unique: per-encounter rows of one battle = ONE spend.
  (925724, 'tw2640-duprows', 'TW2640 DupRows', 'TW2570', true,
   'enc-test-key', true, 3, null, (now() - interval '10 hours')::timestamp, 1, null);

-- season_num is GENERATED ALWAYS (from "Season"); never insert it directly.
INSERT INTO public."EOT_GR_data"
  ("userId", "displayName", "Guild", "Season", "encounterId", "damageType", "damageDealt", "startedOn")
VALUES
  ('tw2570-spent', 'TW2570 Spent', 'TW2570', '92570', 0, 'Battle', 100, (now() - interval '20 hours')),
  ('tw2570-spent', 'TW2570 Spent', 'TW2570', '92570', 0, 'Battle', 100, (now() - interval '14 hours')),
  ('tw2570-spent', 'TW2570 Spent', 'TW2570', '92570', 0, 'Battle', 100, (now() - interval '8 hours')),
  ('tw2570-spent', 'TW2570 Spent', 'TW2570', '92570', 0, 'Battle', 100, (now() - interval '2 hours')),
  -- '99' beats '104' under TEXT max; the no-season path must pick '104'.
  ('tw2570-lex', 'TW2570 Lex', 'TW2570LEX', '99', 0, 'Battle', 100, (now() - interval '30 hours')),
  ('tw2570-lex', 'TW2570 Lex', 'TW2570LEX', '104', 0, 'Battle', 100, (now() - interval '3 hours')),
  ('tw2570-lex', 'TW2570 Lex', 'TW2570LEX', '104', 0, 'Battle', 100, (now() - interval '1 hours')),
  ('tw2570-bombed', 'TW2570 Bombed', 'TW2570', '92570', 0, 'Bomb', 500, (now() - interval '1 hours')),
  ('tw2570-prevszn', 'TW2570 PrevSzn', 'TW2570', '92569', 0, 'Battle', 100, (now() - interval '20 hours')),
  ('tw2570-renamed', 'TW2570 OldName', 'TW2570', '92570', 0, 'Battle', 100, (now() - interval '8 hours')),
  ('tw2570-renamed', 'TW2570 OldName', 'TW2570', '92570', 0, 'Battle', 100, (now() - interval '2 hours')),
  ('tw2640-capspend', 'TW2640 CapSpend', 'TW2570', '92570', 0, 'Battle', 100, (now() - interval '4 hours')),
  ('tw2640-twospend', 'TW2640 TwoSpend', 'TW2570', '92570', 0, 'Battle', 100, (now() - interval '18 hours')),
  ('tw2640-twospend', 'TW2640 TwoSpend', 'TW2570', '92570', 0, 'Battle', 100, (now() - interval '5 hours')),
  ('tw2640-bombspend', 'TW2640 BombSpend', 'TW2570', '92570', 0, 'Bomb', 500, (now() - interval '2 hours')),
  ('tw2640-overspend', 'TW2640 OverSpend', 'TW2570', '92570', 0, 'Battle', 100, (now() - interval '150 minutes')),
  ('tw2640-overspend', 'TW2640 OverSpend', 'TW2570', '92570', 0, 'Battle', 100, (now() - interval '120 minutes')),
  ('tw2640-overspend', 'TW2640 OverSpend', 'TW2570', '92570', 0, 'Battle', 100, (now() - interval '90 minutes')),
  ('tw2640-duprows', 'TW2640 DupRows', 'TW2570', '92570', 0, 'Battle', 100, (now() - interval '4 hours')),
  ('tw2640-duprows', 'TW2640 DupRows', 'TW2570', '92570', 1, 'Battle', 60, (now() - interval '4 hours'));

INSERT INTO public.player_mapping (
  id, player_id, display_name, guild_code, is_current
) VALUES
  (925709, 'tw2570-lex', 'TW2570 Lex', 'TW2570LEX', true);

-- Authority comes from the effective role; these grants only expose pgTAP plumbing.
GRANT USAGE ON SCHEMA public, auth, extensions TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA extensions TO service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO service_role;
SET LOCAL ROLE service_role;

SELECT is(
  (SELECT s.tokens_available FROM public.get_player_token_state('TW2570', '92570', null, 'tw2570-popped') s),
  3,
  'live snapshot 13h stale at 1/3 (token due in 1h) projects to 3/3'
);

SELECT is(
  (SELECT s.token_next_in_seconds FROM public.get_player_token_state('TW2570', '92570', null, 'tw2570-popped') s),
  null::int,
  'projected-capped player has no token countdown'
);

SELECT is(
  (SELECT s.is_capped FROM public.get_player_token_state('TW2570', '92570', null, 'tw2570-popped') s),
  true,
  'projected-capped player reports is_capped'
);

SELECT is(
  (SELECT s.tokens_available FROM public.get_player_token_state('TW2570', '92570', null, 'tw2570-decayed') s),
  0,
  'live snapshot 2h stale at 0/3 (token due in 3h) stays 0/3'
);

SELECT is(
  (SELECT s.token_next_in_seconds FROM public.get_player_token_state('TW2570', '92570', null, 'tw2570-decayed') s),
  3600,
  'in-flight countdown decays by the elapsed time (10800s - 7200s)'
);

SELECT is(
  (SELECT s.bombs_available FROM public.get_player_token_state('TW2570', '92570', null, 'tw2570-decayed') s),
  1,
  'bomb whose synced cooldown elapsed comes back'
);

SELECT is(
  (SELECT s.bomb_next_in_seconds FROM public.get_player_token_state('TW2570', '92570', null, 'tw2570-decayed') s),
  null::int,
  'returned bomb has no cooldown'
);

SELECT is(
  (SELECT s.tokens_available FROM public.get_player_token_state('TW2570', '92570', null, 'tw2570-capped') s),
  3,
  'capped-at-sync snapshot stays 3/3 regardless of staleness (regen paused)'
);

SELECT is(
  (SELECT s.tokens_available FROM public.get_player_token_state('TW2570', '92570', null, 'tw2570-clipped') s),
  3,
  'projection clips at the 3-token cap (0/3 + 26h with token due in 1h)'
);

SELECT is(
  (SELECT s.tokens_available FROM public.get_player_token_state('TW2570', '92570', null, 'tw2570-notimer') s),
  2,
  'below-cap snapshot without a countdown keeps the snapshot (cannot project)'
);

SELECT is(
  (SELECT s.data_source FROM public.get_player_token_state('TW2570', '92570', null, 'tw2570-nokey') s),
  'calculated',
  'members without an API key stay on the calculated branch'
);

SELECT is(
  (SELECT s.tokens_available FROM public.get_player_token_state('TW2570', '92570', null, 'tw2570-midcycle') s),
  2,
  'multi-pop projection lands mid-cycle below cap (0/3 + 15h, token due in 1h)'
);

SELECT is(
  (SELECT s.token_next_in_seconds FROM public.get_player_token_state('TW2570', '92570', null, 'tw2570-midcycle') s),
  36000,
  'mid-cycle countdown is the remainder of the in-progress 12h cycle'
);

-- tw2570-spent (snap -26h 1/3; spends -20h/-14h/-8h/-2h): 2/3->1/3, 0/3, 1/3->0/3,
-- clamp 0/3; now +1 -> 1/3, next 39600.
SELECT is(
  (SELECT s.data_source FROM public.get_player_token_state('TW2570', '92570', null, 'tw2570-spent') s),
  'live',
  'Phase 3: battles after the snapshot no longer flip the row to calculated'
);

SELECT is(
  (SELECT s.tokens_available FROM public.get_player_token_state('TW2570', '92570', null, 'tw2570-spent') s),
  1,
  'snapshot projected through 4 post-snapshot spends lands at the hand-traced 1/3'
);

SELECT is(
  (SELECT s.tokens_available + s.tokens_used FROM public.get_player_token_state('TW2570', '92570', null, 'tw2570-spent') s),
  5,
  'accrual (used + available) matches the projected walk (4 used + 1 available)'
);

SELECT is(
  (SELECT s.data_source FROM public.get_player_token_state('TW2570', '92570', null, 'tw2570-rotten') s),
  'live',
  'old snapshots with no post-snapshot spends stay on the live projection'
);

SELECT is(
  (SELECT s.tokens_available FROM public.get_player_token_state('TW2570', '92570', null, 'tw2570-rotten') s),
  3,
  '72h-old spend-free snapshot projects to cap instead of pinning at the no-battle 2/3'
);

SELECT is(
  (SELECT s.tokens_available FROM public.get_player_token_state('TW2570', '92570', null, 'tw2570-bombed') s),
  3,
  'post-snapshot bomb does NOT invalidate the token snapshot (still projects 2/3 -> 3/3)'
);

SELECT is(
  (SELECT s.data_source FROM public.get_player_token_state('TW2570', '92570', null, 'tw2570-bombed') s),
  'live',
  'bomb-only spender keeps the live token source'
);

SELECT is(
  (SELECT s.bombs_available FROM public.get_player_token_state('TW2570', '92570', null, 'tw2570-bombed') s),
  0,
  'post-snapshot bomb DOES invalidate the bomb snapshot (battle-history: bomb on 18h cooldown)'
);

SELECT is(
  (SELECT s.bomb_next_in_seconds FROM public.get_player_token_state('TW2570', '92570', null, 'tw2570-bombed') s),
  61200,
  'invalidated bomb falls back to the 18h battle-history cooldown (64800s - 3600s)'
);

-- -20h regen to 2/3, spend -> 1/3; now +2 regen caps at 3/3.
SELECT is(
  (SELECT s.data_source FROM public.get_player_token_state('TW2570', '92570', null, 'tw2570-prevszn') s),
  'live',
  'Phase 3: a previous-season post-snapshot battle keeps the row live (projected)'
);

SELECT is(
  (SELECT s.tokens_available FROM public.get_player_token_state('TW2570', '92570', null, 'tw2570-prevszn') s),
  3,
  'rollover projection walks the previous-season spend then regens to cap (1 -1 spend, pops at -25h/-13h/-1h)'
);

-- -8h caps at 3/3, spend -> 2/3 (timer -8h); -2h spend -> 1/3; next = 43200 - 28800.
SELECT is(
  (SELECT s.data_source FROM public.get_player_token_state('TW2570', '92570', null, 'tw2570-renamed') s),
  'live',
  'Phase 3: battles under an old display name (same userId) feed the projection, not a fallback'
);

SELECT is(
  (SELECT s.tokens_available FROM public.get_player_token_state('TW2570', '92570', null, 'tw2570-renamed') s),
  1,
  'projection walks spends by userId, so renamed players'' spends are counted (3/3 would mean they were missed)'
);

SELECT is(
  (SELECT s.tokens_used FROM public.get_player_token_state('TW2570LEX', null, null, 'tw2570-lex') s),
  2,
  'no-season calls resolve the latest season numerically (104 beats 99 despite text order)'
);

-- pgTAP is the only gate here (no TS twin).
SELECT is(
  (SELECT s.post_snapshot_spends FROM public.get_player_token_state('TW2570', '92570', null, 'tw2570-spent') s),
  4,
  'post_snapshot_spends counts the post-snapshot Battle rows the projection walked'
);

SELECT is(
  (SELECT s.post_snapshot_spends FROM public.get_player_token_state('TW2570', '92570', null, 'tw2570-popped') s),
  0,
  'pure snapshot projection (no post-snapshot battles) reports post_snapshot_spends = 0'
);

SELECT is(
  (SELECT s.post_snapshot_spends FROM public.get_player_token_state('TW2570', '92570', null, 'tw2570-nokey') s),
  null::int,
  'calculated rows report post_snapshot_spends NULL'
);

SELECT is(
  (SELECT s.post_snapshot_spends FROM public.get_player_token_state('TW2570', '92570', null, 'tw2570-prevszn') s),
  1,
  'post_snapshot_spends includes previous-season post-snapshot battles (rollover window)'
);

-- Spend from cap -> 2/3, timer starts at -4h; next = 43200 - 14400.
SELECT is(
  (SELECT s.tokens_available FROM public.get_player_token_state('TW2570', '92570', null, 'tw2640-capspend') s),
  2,
  '3/3 snapshot + one post-snapshot spend projects to 2/3'
);

SELECT is(
  (SELECT s.token_next_in_seconds FROM public.get_player_token_state('TW2570', '92570', null, 'tw2640-capspend') s),
  28800,
  'spend-from-cap starts the regen timer at the spend time (4h elapsed of 12h -> 28800s left)'
);

SELECT is(
  (SELECT s.data_source FROM public.get_player_token_state('TW2570', '92570', null, 'tw2640-capspend') s),
  'live',
  'a post-snapshot spend does NOT flip data_source to calculated (condition B1)'
);

SELECT is(
  (SELECT s.post_snapshot_spends FROM public.get_player_token_state('TW2570', '92570', null, 'tw2640-capspend') s),
  1,
  'single-spend projection reports post_snapshot_spends = 1'
);

-- Snap -20h 2/3: -18h caps, spend -> 2/3; -5h pops, caps, spend -> 2/3; next = 43200 - 18000.
SELECT is(
  (SELECT s.tokens_available FROM public.get_player_token_state('TW2570', '92570', null, 'tw2640-twospend') s),
  2,
  'two post-snapshot spends straddling a regen boundary land at the hand-traced 2/3'
);

SELECT is(
  (SELECT s.token_next_in_seconds FROM public.get_player_token_state('TW2570', '92570', null, 'tw2640-twospend') s),
  25200,
  'timer after the second spend-from-cap runs from that spend (5h elapsed -> 25200s left)'
);

SELECT is(
  (SELECT s.post_snapshot_spends FROM public.get_player_token_state('TW2570', '92570', null, 'tw2640-twospend') s),
  2,
  'two-spend projection reports post_snapshot_spends = 2'
);

-- Snap -3h 1/3: spend -> 0/3; pop then spend -> 0/3; spend clamps without rebase; next 36000.
SELECT is(
  (SELECT s.tokens_available FROM public.get_player_token_state('TW2570', '92570', null, 'tw2640-overspend') s),
  0,
  'more post-snapshot spends than tokens available clamps at 0, never negative'
);

SELECT is(
  (SELECT s.token_next_in_seconds FROM public.get_player_token_state('TW2570', '92570', null, 'tw2640-overspend') s),
  36000,
  'clamped spend does not rebase the timer (runs from the -2h pop: 2h elapsed -> 36000s left)'
);

SELECT is(
  (SELECT s.post_snapshot_spends FROM public.get_player_token_state('TW2570', '92570', null, 'tw2640-overspend') s),
  3,
  'over-spend projection still reports all 3 post-snapshot Battle rows'
);

-- Bomb cap 1, 64800s: spend from cap at -2h -> 0; next = 64800 - 7200.
SELECT is(
  (SELECT s.bombs_available FROM public.get_player_token_state('TW2570', '92570', null, 'tw2640-bombspend') s),
  0,
  '1-bomb snapshot + post-snapshot Bomb row projects to 0 bombs'
);

SELECT is(
  (SELECT s.bomb_next_in_seconds FROM public.get_player_token_state('TW2570', '92570', null, 'tw2640-bombspend') s),
  57600,
  'bomb cooldown runs 18h from the post-snapshot bomb spend (2h elapsed -> 57600s left)'
);

SELECT is(
  (SELECT s.tokens_available FROM public.get_player_token_state('TW2570', '92570', null, 'tw2640-bombspend') s),
  3,
  'a post-snapshot bomb leaves the TOKEN snapshot on the pure projection (3/3 stays)'
);

SELECT is(
  (SELECT s.post_snapshot_spends FROM public.get_player_token_state('TW2570', '92570', null, 'tw2640-bombspend') s),
  0,
  'post_snapshot_spends counts Battle rows only — bomb spends do not inflate it'
);

-- Without DISTINCT the two rows would decrement twice (1/3).
SELECT is(
  (SELECT s.tokens_available FROM public.get_player_token_state('TW2570', '92570', null, 'tw2640-duprows') s),
  2,
  'two rollup rows with an identical post-snapshot startedOn decrement exactly ONE token'
);

SELECT is(
  (SELECT s.post_snapshot_spends FROM public.get_player_token_state('TW2570', '92570', null, 'tw2640-duprows') s),
  1,
  'duplicate-startedOn rollup rows count as ONE post_snapshot_spend'
);

SELECT is(
  (SELECT s.token_next_in_seconds FROM public.get_player_token_state('TW2570', '92570', null, 'tw2640-duprows') s),
  28800,
  'deduped single spend-from-cap starts the timer once (4h elapsed -> 28800s left)'
);

SELECT ok(
  current_setting('role') = 'service_role' AND auth.uid() IS NULL,
  'sanity: this suite exercises the effective service_role corridor with a NULL auth.uid()'
);

SELECT ok(
  (SELECT count(*) > 0 FROM public.get_player_token_state('TW2570', '92570', null, null)),
  'effective service_role guild-wide call still returns rows'
);

RESET ROLE;

-- The helper also backs get_token_usage_for_guild.
SELECT is(
  (SELECT h.available
   FROM public.project_token_snapshot(
     3, null, now() - interval '10 hours',
     array[now() - interval '4 hours']::timestamptz[],
     now(), 3, 43200) h),
  2,
  'project_token_snapshot: spend from a paused 3/3 snapshot yields 2'
);

SELECT is(
  (SELECT h.next_in_seconds
   FROM public.project_token_snapshot(
     3, null, now() - interval '10 hours',
     array[now() - interval '4 hours']::timestamptz[],
     now(), 3, 43200) h),
  28800,
  'project_token_snapshot: spend-from-cap starts the timer at the spend time'
);

SELECT is(
  (SELECT h.available
   FROM public.project_token_snapshot(
     3, null, now() - interval '10 hours',
     array[now() - interval '11 hours']::timestamptz[],
     now(), 3, 43200) h),
  3,
  'project_token_snapshot: spends at/before the snapshot are ignored (already reflected)'
);

SELECT is(
  (SELECT h.next_in_seconds
   FROM public.project_token_snapshot(
     3, null, now() - interval '10 hours',
     array[now() - interval '11 hours']::timestamptz[],
     now(), 3, 43200) h),
  null::int,
  'project_token_snapshot: capped output has no countdown'
);

SELECT is(
  (SELECT h.available
   FROM public.project_token_snapshot(
     null, 3600, now() - interval '1 hour',
     array[]::timestamptz[],
     now(), 3, 43200) h),
  null::int,
  'project_token_snapshot: NULL snapshot count short-circuits to a NULL row (null-safe single-row contract)'
);

SELECT is(
  (SELECT p.prosecdef FROM pg_proc p
   JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'project_token_snapshot'),
  false,
  'project_token_snapshot is SECURITY INVOKER'
);

SELECT is(
  (SELECT p.prosecdef FROM pg_proc p
   JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'get_player_token_state'),
  true,
  'get_player_token_state remains SECURITY DEFINER'
);

-- The helper runs as owner inside DEFINER bodies; client roles must not reach it via /rest/v1/rpc.
SELECT ok(
  NOT has_function_privilege(
    'anon',
    'public.project_token_snapshot(int, int, timestamptz, timestamptz[], timestamptz, int, bigint)',
    'EXECUTE'),
  'anon cannot execute project_token_snapshot (default PUBLIC EXECUTE revoked)'
);

SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.project_token_snapshot(int, int, timestamptz, timestamptz[], timestamptz, int, bigint)',
    'EXECUTE'),
  'authenticated cannot execute project_token_snapshot (internal helper seam only)'
);

SELECT finish();
ROLLBACK;
