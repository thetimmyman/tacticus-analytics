-- Stop raid re-syncs and re-inserts restoring an erased subject's real name in
-- EOT_GR_data."displayName"; writers use PostgREST upserts, so the table is the choke point.
-- target-db: general
-- UPDATE keeps a tombstone; INSERT re-tombstones ledger players' pre-erasure
-- battles. Erasure takes a per-player advisory lock exclusive, the insert guard shared.

BEGIN;

DO $guard$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'eot_gr_data_preserve_erasure_tombstone (20260925160000) is general-database-only. Refusing to apply to %', current_database();
  END IF;
END
$guard$;

-- EOT_GR_data is hot; fail fast rather than hold writers behind a long reader.
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.battle_row_erasures (
  player_key    text        PRIMARY KEY
    CHECK (player_key = lower(btrim(player_key)) AND player_key <> ''),
  erased_at     timestamptz NOT NULL,
  erased_season integer,
  tombstone     text        NOT NULL
    CHECK (tombstone ~ '^\[DELETED_USER_[0-9]{13}\]$'),
  -- A retry of the same erasure keeps the original cutoff.
  subject_user_id uuid
);

COMMENT ON TABLE public.battle_row_erasures IS
  'Durable record of account-erased player ids (lower(btrim(player_id))), written by anonymize_subject_battle_rows. The EOT_GR_data BEFORE INSERT trigger tombstones pre-erasure battles for these ids. No API access.';

ALTER TABLE public.battle_row_erasures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.battle_row_erasures FROM PUBLIC;
REVOKE ALL ON TABLE public.battle_row_erasures
  FROM anon, authenticated, service_role;

-- Seed from existing epoch tombstones. The EXCLUSIVE lock waits out in-flight
-- erasures (they lock player_mapping FOR SHARE) so none commits unrecorded.
LOCK TABLE public.player_mapping IN EXCLUSIVE MODE;

WITH erased AS (
  SELECT DISTINCT ON (lower(btrim(g."userId")))
         lower(btrim(g."userId")) AS player_key,
         to_timestamp(substring(g."displayName" FROM 15 FOR 13)::numeric / 1000) AS erased_at,
         g."displayName" AS tombstone
    FROM public."EOT_GR_data" g
   WHERE g."displayName" ~ '^\[DELETED_USER_[0-9]{13}\]$'
     AND g."userId" IS NOT NULL
     AND btrim(g."userId") <> ''
     -- Skip ids a live account owns now.
     AND NOT EXISTS (
       SELECT 1 FROM public.player_mapping m
        WHERE lower(btrim(m.player_id)) = lower(btrim(g."userId"))
          AND m.user_id IS NOT NULL
     )
   ORDER BY lower(btrim(g."userId")), g."displayName" DESC
)
INSERT INTO public.battle_row_erasures (player_key, erased_at, erased_season, tombstone)
SELECT erased.player_key, erased.erased_at,
       coalesce(
         (SELECT max(c.season_id) FROM public.season_calendar c
           WHERE c.starts_at <= erased.erased_at),
         (SELECT s.season_num FROM public."EOT_GR_data" s
           WHERE s."completedOn" <= erased.erased_at
           ORDER BY s."completedOn" DESC LIMIT 1)),
       erased.tombstone
  FROM erased
ON CONFLICT (player_key) DO NOTHING;

-- Also seed erasures with no battle rows (same exclusions); the latest erasure wins.
WITH disputed AS (
  SELECT rv.attestation_id
    FROM public.player_identity_attestation_revocations rv
   WHERE rv.reason IN ('admin_unlink', 'support_reverify', 'authority_recovery',
                       'mapping_delete')
      OR (rv.reason = 'player_id_correction'
          AND rv.source IS DISTINCT FROM 'profile/change-player-id')
),
erasures AS (
  SELECT r.attestation_id, r.revoked_at AS erased_at
    FROM public.player_identity_attestation_revocations r
   WHERE r.reason IN ('account_delete', 'gdpr_erasure')
  UNION ALL
  -- ...or the authority block, when the attestation was already revoked earlier.
  SELECT a.id, b.blocked_at
    FROM public.player_identity_subject_authority_blocks b
    JOIN public.player_identity_attestations a ON a.subject_user_id = b.subject_user_id
   WHERE b.reason IN ('account_delete', 'gdpr_erasure', 'auth_delete')
),
revoked AS (
  SELECT lower(btrim(a.player_id)) AS player_key, max(x.erased_at) AS erased_at,
         (array_agg(a.subject_user_id ORDER BY x.erased_at DESC))[1] AS subject_user_id
    FROM erasures x
    JOIN public.player_identity_attestations a ON a.id = x.attestation_id
   WHERE btrim(a.player_id) <> ''
     AND NOT EXISTS (SELECT 1 FROM disputed d WHERE d.attestation_id = a.id)
     AND NOT EXISTS (
       SELECT 1 FROM public.player_mapping m
        WHERE lower(btrim(m.player_id)) = lower(btrim(a.player_id))
          AND m.user_id IS NOT NULL
     )
     AND NOT EXISTS (
       SELECT 1
         FROM public.player_identity_attestations a2
         JOIN auth.users u ON u.id = a2.subject_user_id
        WHERE lower(btrim(a2.player_id)) = lower(btrim(a.player_id))
          AND a2.subject_user_id <> a.subject_user_id
          AND NOT EXISTS (SELECT 1 FROM disputed d WHERE d.attestation_id = a2.id)
     )
   GROUP BY 1
)
INSERT INTO public.battle_row_erasures (player_key, erased_at, erased_season, tombstone, subject_user_id)
SELECT revoked.player_key, revoked.erased_at,
       coalesce(
         (SELECT max(c.season_id) FROM public.season_calendar c
           WHERE c.starts_at <= revoked.erased_at),
         (SELECT s.season_num FROM public."EOT_GR_data" s
           WHERE s."completedOn" <= revoked.erased_at
           ORDER BY s."completedOn" DESC LIMIT 1)),
       '[DELETED_USER_'
         || lpad(floor(extract(epoch FROM revoked.erased_at) * 1000)::bigint::text, 13, '0')
         || ']',
       revoked.subject_user_id
  FROM revoked
-- Revocation lands later in the same flow, so it moves a seeded cutoff only if 7+ days newer.
ON CONFLICT (player_key) DO UPDATE
   SET erased_at       = CASE WHEN EXCLUDED.erased_at > battle_row_erasures.erased_at + interval '7 days'
                              THEN EXCLUDED.erased_at ELSE battle_row_erasures.erased_at END,
       erased_season   = CASE WHEN EXCLUDED.erased_at > battle_row_erasures.erased_at + interval '7 days'
                              THEN EXCLUDED.erased_season ELSE battle_row_erasures.erased_season END,
       tombstone       = CASE WHEN EXCLUDED.erased_at > battle_row_erasures.erased_at + interval '7 days'
                              THEN EXCLUDED.tombstone ELSE battle_row_erasures.tombstone END,
       subject_user_id = CASE WHEN EXCLUDED.erased_at > battle_row_erasures.erased_at + interval '7 days'
                              THEN EXCLUDED.subject_user_id
                              ELSE coalesce(battle_row_erasures.subject_user_id, EXCLUDED.subject_user_id) END
 WHERE EXCLUDED.erased_at > battle_row_erasures.erased_at + interval '7 days'
    OR battle_row_erasures.subject_user_id IS NULL;

-- Same body as 20260925040000 plus the ledger upsert; owner and ACL kept.
CREATE OR REPLACE FUNCTION public.anonymize_subject_battle_rows(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
SET lock_timeout TO '5s'
AS $function$
DECLARE
  v_resolved  text[];
  v_final     text[];
  v_retry     text[];
  v_accepted  text[];
  v_rows      integer;
  v_now       timestamptz;
  v_tombstone text;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'anonymize_subject_battle_rows: subject is required'
      USING ERRCODE = '22004';
  END IF;

  -- 1. First resolution.
  SELECT coalesce(array_agg(DISTINCT ids.player_id), ARRAY[]::text[])
  INTO v_resolved
  FROM public.subject_erasure_player_ids(p_user_id) AS ids;

  IF cardinality(v_resolved) = 0 THEN
    RETURN 0;
  END IF;

  -- 2. Serialise with any claim of these players (claims UPDATE these rows).
  --    Also lock case/space variants of the ids: the ledger key below is
  --    normalised, and its ownership re-check reads those rows.
  PERFORM 1
  FROM public.player_mapping AS mapping
  WHERE mapping.player_id = ANY (v_resolved)
     OR lower(btrim(mapping.player_id)) IN (
          SELECT lower(btrim(r.pid)) FROM unnest(v_resolved) AS r(pid))
  ORDER BY mapping.id
  FOR SHARE;

  -- 3. Re-resolve under the locks (new statement, new snapshot); only ids
  --    eligible both before and after the locks are erased.
  SELECT coalesce(array_agg(DISTINCT ids.player_id), ARRAY[]::text[])
  INTO v_final
  FROM public.subject_erasure_player_ids(p_user_id) AS ids
  WHERE ids.player_id = ANY (v_resolved);

  IF cardinality(v_final) = 0 THEN
    RETURN 0;
  END IF;

  -- 4. Serialise with concurrent sync inserts of these players: the insert
  --    guard takes the same per-player lock SHARED before reading the ledger,
  --    so an insert either commits before this point (and the UPDATE below
  --    sees and tombstones it) or waits and then sees the committed ledger
  --    row. Sorted order keeps two erasures from deadlocking each other.
  PERFORM pg_advisory_xact_lock(hashtextextended('battle_row_erasures:' || k, 0))
     FROM (SELECT DISTINCT lower(btrim(fid.pid)) AS k FROM unnest(v_final) AS fid(pid)
            WHERE btrim(fid.pid) <> '' ORDER BY 1) AS keys;

  -- The erasure time is taken only now, after every lock: a sync that held
  -- the shared lock has committed, so its battles are at or before v_now.
  v_now := clock_timestamp();
  v_tombstone := '[DELETED_USER_'
    || floor(extract(epoch FROM v_now) * 1000)::bigint::text || ']';

  -- The normalised keys this erasure may act on. subject_erasure_player_ids
  -- compares ids exactly; the ledger key is normalised, so re-check its
  -- live-owner and co-attestor exclusions on the normalised key. Only these
  -- keys are recorded AND anonymised below.
  SELECT coalesce(array_agg(DISTINCT lower(btrim(fid.pid))), ARRAY[]::text[])
  INTO v_accepted
  FROM unnest(v_final) AS fid(pid)
  WHERE btrim(fid.pid) <> ''
     AND NOT EXISTS (
       SELECT 1 FROM public.player_mapping m
        WHERE lower(btrim(m.player_id)) = lower(btrim(fid.pid))
          AND m.user_id IS NOT NULL AND m.user_id <> p_user_id
     )
     AND NOT EXISTS (
       SELECT 1
         FROM public.player_identity_attestations a2
         JOIN auth.users u ON u.id = a2.subject_user_id
        WHERE lower(btrim(a2.player_id)) = lower(btrim(fid.pid))
          AND a2.subject_user_id <> p_user_id
          AND NOT EXISTS (
            SELECT 1 FROM public.player_identity_attestation_revocations rv
             WHERE rv.attestation_id = a2.id
               AND (rv.reason IN ('admin_unlink', 'support_reverify',
                                  'authority_recovery', 'mapping_delete')
                    OR (rv.reason = 'player_id_correction'
                        AND rv.source IS DISTINCT FROM 'profile/change-player-id')))
     );

  -- Keys this subject already erased (a retry of the same erasure): they
  -- keep their original cutoff.
  SELECT coalesce(array_agg(e.player_key), ARRAY[]::text[])
  INTO v_retry
  FROM public.battle_row_erasures e
  WHERE e.player_key = ANY (v_accepted)
    AND e.subject_user_id = p_user_id;

  -- 5. Record the erasure durably -- also for ids with no battle rows yet.
  INSERT INTO public.battle_row_erasures AS e
         (player_key, erased_at, erased_season, tombstone, subject_user_id)
  SELECT acc.k, v_now,
         -- the season running now, from the season calendar (a battle's
         -- completedOn can be synthesised from now() by the sync transforms,
         -- so the latest battle is only the fallback)
         coalesce(
           (SELECT max(c.season_id) FROM public.season_calendar c
             WHERE c.starts_at <= v_now),
           (SELECT g.season_num FROM public."EOT_GR_data" g
             WHERE g."completedOn" <= v_now
             ORDER BY g."completedOn" DESC LIMIT 1)),
         v_tombstone,
         p_user_id
    FROM unnest(v_accepted) AS acc(k)
  -- A different (later) owner's erasure moves the cutoff forward; a retry of
  -- the SAME subject's erasure (the scheduled executor re-runs the whole
  -- sequence after a later step fails) keeps the original cutoff, so battles
  -- ingested after the first run stay post-erasure guild data.
  ON CONFLICT (player_key) DO UPDATE
     SET erased_at       = EXCLUDED.erased_at,
         erased_season   = EXCLUDED.erased_season,
         tombstone       = EXCLUDED.tombstone,
         subject_user_id = EXCLUDED.subject_user_id
   WHERE EXCLUDED.erased_at > e.erased_at
     AND e.subject_user_id IS DISTINCT FROM EXCLUDED.subject_user_id;

  -- 6. Anonymise the rows (a fresh statement snapshot, taken after the locks).
  --    Each row takes its player's ledger tombstone. A first (or different-
  --    owner) erasure anonymises EVERY stored row -- the advisory lock proves
  --    they predate it, whatever their payload timestamp says. Only a retry
  --    of the same erasure is limited to battles at or before the original
  --    cutoff, leaving post-erasure play alone. An id the normalised
  --    ownership re-check rejected has no ledger row and is NOT touched: its
  --    spelling belongs to another live owner.
  UPDATE public."EOT_GR_data" AS battle
  SET "displayName" = t.tombstone
  FROM (
    SELECT b.id, e.tombstone
      FROM public."EOT_GR_data" b
      JOIN public.battle_row_erasures e
        ON e.player_key = lower(btrim(b."userId"))
     WHERE b."userId" = ANY (v_final)
       AND e.player_key = ANY (v_accepted)
       AND (
             NOT (e.player_key = ANY (v_retry))
          OR (b.season_num IS NOT NULL AND b.season_num < e.erased_season)
          OR (b."completedOn" IS NOT NULL AND b."completedOn" <= e.erased_at)
          OR (b."completedOn" IS NULL
              AND (b.season_num IS NULL OR e.erased_season IS NULL
                   OR b.season_num <= e.erased_season))
       )
  ) AS t
  WHERE battle.id = t.id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END
$function$;

CREATE OR REPLACE FUNCTION public.eot_gr_data_preserve_erasure_tombstone()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  -- The WHEN clause established that OLD is a tombstone and NEW differs.
  -- Accept only a re-erasure by the battle-row writer (13-digit epoch-ms).
  IF NOT coalesce(NEW."displayName" ~ '^\[DELETED_USER_[0-9]{13}\]$', false) THEN
    NEW."displayName" := OLD."displayName";
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.eot_gr_data_preserve_erasure_tombstone() IS
  'BEFORE UPDATE on EOT_GR_data: an erasure tombstone in "displayName" is only ever replaced by another [DELETED_USER_<epoch-ms>], so a raid re-sync cannot undo account erasure.';

REVOKE ALL ON FUNCTION public.eot_gr_data_preserve_erasure_tombstone() FROM PUBLIC;

-- Not DROP + CREATE: DROP TRIGGER takes ACCESS EXCLUSIVE even when absent.
CREATE OR REPLACE TRIGGER trg_eot_gr_data_preserve_erasure_tombstone
  BEFORE UPDATE ON public."EOT_GR_data"
  FOR EACH ROW
  WHEN (
    starts_with(OLD."displayName", '[DELETED_USER_')
    AND NEW."displayName" IS DISTINCT FROM OLD."displayName"
  )
  EXECUTE FUNCTION public.eot_gr_data_preserve_erasure_tombstone();

-- SECURITY DEFINER only to read the ledger; it touches nothing but NEW.
CREATE OR REPLACE FUNCTION public.eot_gr_data_retombstone_erased_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_erasure public.battle_row_erasures%ROWTYPE;
  v_season  integer;
BEGIN
  -- Pairs with the exclusive lock anonymize_subject_battle_rows takes: wait
  -- out an in-flight erasure of this player, then read its committed ledger
  -- row (each PL/pgSQL statement takes a fresh snapshot under READ COMMITTED).
  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('battle_row_erasures:' || lower(btrim(NEW."userId")), 0));

  SELECT e.* INTO v_erasure
    FROM public.battle_row_erasures e
   WHERE e.player_key = lower(btrim(NEW."userId"));
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- season_num is a generated column and not yet computed in a BEFORE trigger.
  v_season := CASE WHEN NEW."Season" ~ '^\d+$' THEN NEW."Season"::integer END;

  IF (v_season IS NOT NULL AND v_season < v_erasure.erased_season)
     OR (NEW."completedOn" IS NOT NULL AND NEW."completedOn" <= v_erasure.erased_at)
     OR (NEW."completedOn" IS NULL
         AND (v_season IS NULL OR v_erasure.erased_season IS NULL
              OR v_season <= v_erasure.erased_season)) THEN
    NEW."displayName" := v_erasure.tombstone;
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.eot_gr_data_retombstone_erased_insert() OWNER TO postgres;

COMMENT ON FUNCTION public.eot_gr_data_retombstone_erased_insert() IS
  'BEFORE INSERT on EOT_GR_data: a pre-erasure battle for a player id in battle_row_erasures is written with the erasure tombstone instead of the upstream name.';

-- Trigger functions need no EXECUTE; default privileges would let a service
-- role attach this definer to its own table and probe the ledger.
REVOKE ALL ON FUNCTION public.eot_gr_data_retombstone_erased_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eot_gr_data_retombstone_erased_insert(),
                       public.eot_gr_data_preserve_erasure_tombstone()
  FROM anon, authenticated, service_role;

CREATE OR REPLACE TRIGGER trg_eot_gr_data_retombstone_erased_insert
  BEFORE INSERT ON public."EOT_GR_data"
  FOR EACH ROW
  WHEN (
    NEW."userId" IS NOT NULL
    AND NOT coalesce(NEW."displayName" ~ '^\[DELETED_USER_[0-9]{13}\]$', false)
  )
  EXECUTE FUNCTION public.eot_gr_data_retombstone_erased_insert();

-- Re-tombstone already-overwritten pre-erasure rows, now that both triggers exist.
UPDATE public."EOT_GR_data" AS g
   SET "displayName" = e.tombstone
  FROM public.battle_row_erasures AS e
 WHERE g."userId" = ANY (
         ARRAY(SELECT e2.player_key FROM public.battle_row_erasures e2
               UNION
               SELECT a.player_id FROM public.player_identity_attestations a
                 JOIN public.battle_row_erasures e3
                   ON e3.player_key = lower(btrim(a.player_id))
               UNION
               SELECT m.player_id FROM public.player_mapping m
                 JOIN public.battle_row_erasures e4
                   ON e4.player_key = lower(btrim(m.player_id))))
   AND lower(btrim(g."userId")) = e.player_key
   AND g."displayName" IS DISTINCT FROM e.tombstone
   AND NOT coalesce(g."displayName" ~ '^\[DELETED_USER_[0-9]{13}\]$', false)
   AND (
         (g.season_num IS NOT NULL AND g.season_num < e.erased_season)
      OR (g."completedOn" IS NOT NULL AND g."completedOn" <= e.erased_at)
      OR (g."completedOn" IS NULL
          AND (g.season_num IS NULL OR e.erased_season IS NULL
               OR g.season_num <= e.erased_season))
   );

COMMIT;
