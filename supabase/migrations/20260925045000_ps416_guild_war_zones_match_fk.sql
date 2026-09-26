-- FK every guild_war_zones row to its match, after deleting zones (and attempts)
-- whose match is gone.
-- target-db: general

-- Both zone writers upsert the match first. CASCADE mirrors the sibling FKs.

BEGIN;

CREATE TEMP TABLE ps416_orphan_zone_ids ON COMMIT DROP AS
SELECT z.id
FROM public.guild_war_zones AS z
LEFT JOIN public.guild_war_matches AS m
  ON m.war_id = z.war_id
 AND m.guild_code = z.guild_code
WHERE m.id IS NULL;

DO $ps416_count$
DECLARE
  v_orphan_count bigint;
BEGIN
  SELECT count(*) INTO v_orphan_count FROM ps416_orphan_zone_ids;
  RAISE NOTICE 'PS-416: deleting % orphan guild_war_zones row(s)', v_orphan_count;
END;
$ps416_count$;

-- Delete dependents explicitly: the SET NULL FKs would leave dangling rows.
DELETE FROM public.guild_war_player_attempts AS attempt
USING ps416_orphan_zone_ids AS orphan
WHERE attempt.zone_id = orphan.id;

DELETE FROM public.guild_war_battles AS battle
USING ps416_orphan_zone_ids AS orphan
WHERE battle.zone_id = orphan.id;

DELETE FROM public.guild_war_zone_events AS event
USING ps416_orphan_zone_ids AS orphan
WHERE event.zone_id = orphan.id;

DELETE FROM public.guild_war_zones AS zone
USING ps416_orphan_zone_ids AS orphan
WHERE zone.id = orphan.id;

ALTER TABLE public.guild_war_zones
  ADD CONSTRAINT guild_war_zones_match_fk
  FOREIGN KEY (war_id, guild_code)
  REFERENCES public.guild_war_matches (war_id, guild_code)
  ON UPDATE CASCADE
  ON DELETE CASCADE
  NOT VALID;

ALTER TABLE public.guild_war_zones
  VALIDATE CONSTRAINT guild_war_zones_match_fk;

DO $ps416_verify$
DECLARE
  v_orphans bigint;
  v_validated boolean;
  v_delete_action "char";
  v_update_action "char";
  v_target_ok boolean;
BEGIN
  SELECT count(*) INTO v_orphans
  FROM public.guild_war_zones AS z
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.guild_war_matches AS m
    WHERE m.war_id = z.war_id
      AND m.guild_code = z.guild_code
  );

  IF v_orphans <> 0 THEN
    RAISE EXCEPTION
      'PS-416 verify: % guild_war_zones row(s) still have no matching guild_war_matches row',
      v_orphans;
  END IF;

  SELECT c.convalidated,
         c.confdeltype,
         c.confupdtype,
         c.confrelid = 'public.guild_war_matches'::regclass
    INTO v_validated, v_delete_action, v_update_action, v_target_ok
  FROM pg_catalog.pg_constraint AS c
  WHERE c.conname = 'guild_war_zones_match_fk'
    AND c.conrelid = 'public.guild_war_zones'::regclass
    AND c.contype = 'f';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PS-416 verify: guild_war_zones_match_fk is missing';
  END IF;
  IF NOT v_validated THEN
    RAISE EXCEPTION 'PS-416 verify: guild_war_zones_match_fk is not validated';
  END IF;
  IF v_update_action <> 'c' THEN
    RAISE EXCEPTION 'PS-416 verify: guild_war_zones_match_fk is not ON UPDATE CASCADE';
  END IF;
  IF v_delete_action <> 'c' THEN
    RAISE EXCEPTION 'PS-416 verify: guild_war_zones_match_fk is not ON DELETE CASCADE';
  END IF;
  IF NOT v_target_ok THEN
    RAISE EXCEPTION 'PS-416 verify: guild_war_zones_match_fk does not reference guild_war_matches';
  END IF;
END;
$ps416_verify$;

COMMIT;
