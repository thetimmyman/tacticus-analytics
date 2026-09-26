-- target-db: postgres  (Tacticus Analytics / tacticusanalytics.com)
-- Declare the event_id schema production has, then backfill NULL event_ids. Run after
-- the edge writer fix, before the app roll; re-runnable.

-- Natural key decoupled from the uuid PK so re-syncs update in place.
ALTER TABLE public.guild_war_player_attempts
  ADD COLUMN IF NOT EXISTS event_id uuid;

-- Arbiter for onConflict 'war_id,guild_code,event_id'; production's name avoids a duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS guild_war_player_attempts_war_guild_event_key
  ON public.guild_war_player_attempts (war_id, guild_code, event_id);

-- Operator utility: repoint battles and attempts after a match's key is corrected;
-- collisions are reported, never overwritten. Created only where absent.
DO $wi8210_repoint$
BEGIN
  -- Guard by NAME, not signature: production's out-of-band definition is
  -- repoint_guild_war_child_rows(text, text, text) RETURNS jsonb (observed
  -- 2026-09-01), so a signature-exact check would miss it and add a second
  -- overload beside the real one. Any existing overload means "do nothing".
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'repoint_guild_war_child_rows'
  ) THEN
    RAISE NOTICE 'WI-8210: repoint_guild_war_child_rows already exists (out-of-band production definition) — left untouched';
    RETURN;
  END IF;

  EXECUTE $create$
CREATE FUNCTION public.repoint_guild_war_child_rows(
  p_old_war_id character varying,
  p_old_guild_code text,
  p_new_war_id character varying,
  p_new_guild_code text
)
RETURNS TABLE (
  table_name text,
  repointed_count bigint,
  skipped_count bigint
)
LANGUAGE plpgsql
AS $function$
DECLARE
  v_battles_repointed bigint := 0;
  v_battles_skipped bigint := 0;
  v_attempts_repointed bigint := 0;
  v_attempts_skipped bigint := 0;
  v_zones_repointed bigint := 0;
  v_zones_skipped bigint := 0;
BEGIN
  -- guild_war_zones FIRST. Both fact tables reference zones by zone_id, and
  -- attempts cascade-delete with their zone, so moving facts while their
  -- zones stay under the old pair strands them from zone/map statistics and
  -- makes an old-zone cleanup delete them. Zones whose zone_number is free
  -- under the new pair move with their ids intact (no fact needs touching);
  -- zones that collide stay, and their facts are re-keyed onto the target
  -- pair's same-numbered zone below.
  WITH movable AS (
    SELECT z.id
    FROM public.guild_war_zones z
    WHERE z.war_id = p_old_war_id
      AND z.guild_code = p_old_guild_code
      AND NOT EXISTS (
        SELECT 1 FROM public.guild_war_zones existing
        WHERE existing.war_id = p_new_war_id
          AND existing.guild_code = p_new_guild_code
          AND existing.zone_number = z.zone_number
      )
  ), updated AS (
    UPDATE public.guild_war_zones z
    SET war_id = p_new_war_id,
        guild_code = p_new_guild_code,
        updated_at = now()
    FROM movable
    WHERE z.id = movable.id
    RETURNING z.id
  )
  SELECT count(*) INTO v_zones_repointed FROM updated;

  SELECT count(*) INTO v_zones_skipped
  FROM public.guild_war_zones z
  WHERE z.war_id = p_old_war_id
    AND z.guild_code = p_old_guild_code;

  -- Facts still attached to a zone left under the old pair (a collided
  -- zone_number): point them at the target pair's zone of the same number.
  UPDATE public.guild_war_player_attempts a
  SET zone_id = t.id
  FROM public.guild_war_zones oz
  JOIN public.guild_war_zones t
    ON t.war_id = p_new_war_id
   AND t.guild_code = p_new_guild_code
   AND t.zone_number = oz.zone_number
  WHERE a.zone_id = oz.id
    AND oz.war_id = p_old_war_id
    AND oz.guild_code = p_old_guild_code
    AND a.war_id = p_old_war_id
    AND a.guild_code = p_old_guild_code;

  UPDATE public.guild_war_battles b
  SET zone_id = t.id
  FROM public.guild_war_zones oz
  JOIN public.guild_war_zones t
    ON t.war_id = p_new_war_id
   AND t.guild_code = p_new_guild_code
   AND t.zone_number = oz.zone_number
  WHERE b.zone_id = oz.id
    AND oz.war_id = p_old_war_id
    AND oz.guild_code = p_old_guild_code
    AND b.war_id = p_old_war_id
    AND b.guild_code = p_old_guild_code;

  -- guild_war_battles: repoint rows that would NOT collide with an
  -- existing (new_war_id, new_guild_code, event_id) row; count the rest as
  -- skipped rather than touching them.
  WITH movable AS (
    SELECT b.id
    FROM public.guild_war_battles b
    WHERE b.war_id = p_old_war_id
      AND b.guild_code = p_old_guild_code
      AND NOT EXISTS (
        SELECT 1 FROM public.guild_war_battles existing
        WHERE existing.war_id = p_new_war_id
          AND existing.guild_code = p_new_guild_code
          AND existing.event_id IS NOT DISTINCT FROM b.event_id
      )
  ), updated AS (
    UPDATE public.guild_war_battles b
    SET war_id = p_new_war_id,
        guild_code = p_new_guild_code,
        updated_at = now()
    FROM movable
    WHERE b.id = movable.id
    RETURNING b.id
  )
  SELECT count(*) INTO v_battles_repointed FROM updated;

  SELECT count(*) INTO v_battles_skipped
  FROM public.guild_war_battles b
  WHERE b.war_id = p_old_war_id
    AND b.guild_code = p_old_guild_code;

  -- guild_war_player_attempts: same rule, same guard.
  WITH movable AS (
    SELECT a.id
    FROM public.guild_war_player_attempts a
    WHERE a.war_id = p_old_war_id
      AND a.guild_code = p_old_guild_code
      AND NOT EXISTS (
        SELECT 1 FROM public.guild_war_player_attempts existing
        WHERE existing.war_id = p_new_war_id
          AND existing.guild_code = p_new_guild_code
          AND existing.event_id IS NOT DISTINCT FROM a.event_id
      )
  ), updated AS (
    UPDATE public.guild_war_player_attempts a
    SET war_id = p_new_war_id,
        guild_code = p_new_guild_code,
        updated_at = now()
    FROM movable
    WHERE a.id = movable.id
    RETURNING a.id
  )
  SELECT count(*) INTO v_attempts_repointed FROM updated;

  SELECT count(*) INTO v_attempts_skipped
  FROM public.guild_war_player_attempts a
  WHERE a.war_id = p_old_war_id
    AND a.guild_code = p_old_guild_code;

  RETURN QUERY
    SELECT 'guild_war_zones'::text, v_zones_repointed, v_zones_skipped
    UNION ALL
    SELECT 'guild_war_battles'::text, v_battles_repointed, v_battles_skipped
    UNION ALL
    SELECT 'guild_war_player_attempts'::text, v_attempts_repointed, v_attempts_skipped;
END;
$function$;
$create$;

  EXECUTE $comment$
COMMENT ON FUNCTION public.repoint_guild_war_child_rows(character varying, text, character varying, text) IS
  'Repoints guild_war_battles/guild_war_player_attempts rows from an old '
  '(war_id, guild_code) pair to a new one, skipping any row that would '
  'collide with an existing row under the new natural key. Created by '
  'WI-8210 (2026-08-31) ONLY when absent — production keeps its '
  'out-of-band definition; this body is a from-need reconstruction for '
  'fresh checkouts, not a copy of the production definition.';
$comment$;
END
$wi8210_repoint$;

-- Backfill event_id = id (the historical unique identity); rows whose key already
-- exists are real duplicates, skipped and reported.
DO $$
DECLARE
  v_skipped_count bigint;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS wi8210_backfill_skipped_rows (
    id uuid,
    war_id character varying(255),
    guild_code text
  ) ON COMMIT PRESERVE ROWS;

  INSERT INTO wi8210_backfill_skipped_rows (id, war_id, guild_code)
  SELECT a.id, a.war_id, a.guild_code
  FROM public.guild_war_player_attempts a
  WHERE a.event_id IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.guild_war_player_attempts existing
      WHERE existing.war_id = a.war_id
        AND existing.guild_code = a.guild_code
        AND existing.event_id = a.id
    );

  GET DIAGNOSTICS v_skipped_count = ROW_COUNT;

  IF v_skipped_count > 0 THEN
    RAISE NOTICE 'WI-8210 backfill: % row(s) skipped — an existing row '
      'already occupies (war_id, guild_code, id) as its event_id. These '
      'are real duplicates and need human inspection; see the temp table '
      'wi8210_backfill_skipped_rows for this session.', v_skipped_count;
  END IF;
END
$$;

UPDATE public.guild_war_player_attempts a
SET event_id = a.id
WHERE a.event_id IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.guild_war_player_attempts existing
    WHERE existing.war_id = a.war_id
      AND existing.guild_code = a.guild_code
      AND existing.event_id = a.id
  );

-- The untracked batch backfill assumes battles.id = attempts.id: withdraw client EXECUTE.
DO $$
BEGIN
  IF to_regprocedure('public.gw_backfill_guild_war_battles_batch(integer)') IS NOT NULL THEN
    -- PUBLIC holds EXECUTE on every function by default and the clean baseline
    -- grants anon/authenticated explicitly, so revoking from authenticated
    -- alone leaves the RPC callable. Strip every non-service grantee.
    REVOKE EXECUTE ON FUNCTION public.gw_backfill_guild_war_battles_batch(integer)
      FROM PUBLIC, anon, authenticated;

    COMMENT ON FUNCTION public.gw_backfill_guild_war_battles_batch(integer) IS
      'DO NOT RUN as of WI-8210. Its "no battles row where b.id = a.id" guard '
      'assumed battles.id = attempts.id, which stopped holding when war fact '
      'rows moved to UNIQUE (war_id, guild_code, event_id) and took independent '
      'gen_random_uuid() primary keys. It now treats every new attempt as '
      'un-backfilled. Re-key the guard and the INSERT onto the natural key '
      'before using it again. EXECUTE revoked from PUBLIC, anon and authenticated 2026-08-31.';
  END IF;
END
$$;
