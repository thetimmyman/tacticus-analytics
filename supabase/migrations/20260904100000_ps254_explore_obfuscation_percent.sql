-- Make explore_obfuscation_percent govern the served magnitude with a salted,
-- non-invertible per-row factor, and stop serving the percent for those rows.
-- target-db: general
-- Apply only after 20260904140000: with one factor per row, any surface serving a
-- true total reveals the whole row.

BEGIN;

DO $guard$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION
      'This migration targets the General database only; refusing to run on %',
      current_database();
  END IF;
END;
$guard$;

SET LOCAL lock_timeout = '5s';

-- Before-state of grants, ownership and salt; asserted in section 7.

CREATE TEMP TABLE ps254_before ON COMMIT DROP AS
SELECT
  c.oid                                                    AS view_oid,
  pg_get_userbyid(c.relowner)                              AS view_owner,
  has_table_privilege('anon',          c.oid, 'SELECT')    AS anon_sel,
  has_table_privilege('authenticated', c.oid, 'SELECT')    AS auth_sel,
  has_table_privilege('service_role',  c.oid, 'SELECT')    AS svc_sel,
  (SELECT has_table_privilege('anon', b.oid, 'SELECT')
     FROM pg_catalog.pg_class b
    WHERE b.oid = to_regclass('public.public_guild_snapshots'))
                                                           AS base_anon_sel
FROM pg_catalog.pg_class c
WHERE c.oid = to_regclass('public.public_guild_snapshots_explore');

DO $pre$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM ps254_before) THEN
    RAISE EXCEPTION
      'PS-254: public.public_guild_snapshots_explore does not exist; this migration replaces it and refuses to create it from nothing';
  END IF;
  IF NOT (SELECT anon_sel AND auth_sel FROM ps254_before) THEN
    RAISE EXCEPTION
      'PS-254: anon/authenticated do not both hold SELECT on the explore view before the change; refusing to proceed from an unexpected grant state';
  END IF;
END;
$pre$;

-- Dynamic: the corridor may be absent on a database section 1 is about to refuse.
CREATE TEMP TABLE ps254_salt_before (salt_md5 text) ON COMMIT DROP;
DO $saltcap$
BEGIN
  IF to_regclass('internal.cron_secrets') IS NOT NULL THEN
    EXECUTE $q$INSERT INTO ps254_salt_before (salt_md5)
              SELECT md5(value) FROM internal.cron_secrets
               WHERE name = 'explore_obfuscation_salt'$q$;
  END IF;
END;
$saltcap$;

-- Salt is drawn at apply time, never in the repo; DO NOTHING so a re-apply never re-draws a rotated salt.

DO $corridor$
BEGIN
  IF to_regclass('internal.cron_secrets') IS NULL THEN
    RAISE EXCEPTION
      'PS-254: internal.cron_secrets is absent; this migration stores its salt in the PS-22 secret corridor and refuses to invent a second one';
  END IF;
  IF to_regprocedure('internal.get_secret(text)') IS NULL THEN
    RAISE EXCEPTION
      'PS-254: internal.get_secret(text) is absent; the obfuscation helper reads the salt through it';
  END IF;
END;
$corridor$;

INSERT INTO internal.cron_secrets (name, value)
SELECT 'explore_obfuscation_salt',
       replace(gen_random_uuid()::text, '-', '')
       || replace(gen_random_uuid()::text, '-', '')
ON CONFLICT (name) DO NOTHING;

-- EXECUTE only for the view owner. get_byte() avoids the sign trap of ('x'||hex)::bit(32).

CREATE OR REPLACE FUNCTION internal.explore_obfuscate_amount(
  p_value   numeric,
  p_percent integer,
  p_seed    text
) RETURNS bigint
LANGUAGE plpgsql
STABLE
STRICT
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $fn$
DECLARE
  v_salt text;
  v      numeric;
  v_pct  numeric;
  h      bytea;
  frac   numeric;
  sgn    numeric;
  d_lo   numeric;
  d_hi   numeric;
  dev    numeric;
  cand   numeric;
  g1     numeric;
  g2     numeric;
BEGIN
  v_salt := internal.get_secret('explore_obfuscation_salt');
  IF v_salt IS NULL OR length(v_salt) < 32 THEN
    -- Fail loudly rather than returning NULL: a NULL here would be served as a
    -- NULL total_damage, which reads as "no data" instead of "obfuscated".
    RAISE EXCEPTION
      'PS-254: internal.cron_secrets holds no usable explore_obfuscation_salt; the explore obfuscation cannot conceal anything without it';
  END IF;

  v     := GREATEST(p_value, 0::numeric);
  v_pct := LEAST(30, GREATEST(1, p_percent))::numeric;

  IF v <= 0::numeric THEN
    -- Non-positive amounts carry nothing to conceal; matches the pre-fix view.
    RETURN 0::bigint;
  END IF;

  h := decode(md5(v_salt || '|ps254|' || p_seed), 'hex');

  -- frac in [0,1] from 24 bits of the digest
  frac := ( get_byte(h, 0)::numeric * 65536::numeric
          + get_byte(h, 1)::numeric * 256::numeric
          + get_byte(h, 2)::numeric ) / 16777215::numeric;
  -- an independent byte picks the direction
  sgn  := CASE WHEN get_byte(h, 3) % 2 = 0 THEN 1 ELSE -1 END;

  d_lo := v * v_pct / 200::numeric;                    -- p/2 % of the truth
  d_hi := v * v_pct / 100::numeric;                    -- p   % of the truth
  dev  := d_lo * (1::numeric + frac);                  -- somewhere between
  cand := v + sgn * dev;

  g1 := floor(cand / 25000::numeric) * 25000::numeric;
  g2 := ceil (cand / 25000::numeric) * 25000::numeric;

  -- Prefer a 25 000 multiple, but only one that is still inside the band.
  IF abs(g1 - v) BETWEEN ceil(d_lo) AND floor(d_hi)
     AND ( abs(g2 - v) NOT BETWEEN ceil(d_lo) AND floor(d_hi)
           OR abs(g1 - cand) <= abs(g2 - cand) ) THEN
    RETURN g1::bigint;
  END IF;
  IF abs(g2 - v) BETWEEN ceil(d_lo) AND floor(d_hi) THEN
    RETURN g2::bigint;
  END IF;
  -- No qualifying multiple: serve the perturbed value itself.
  IF abs(round(cand) - v) BETWEEN ceil(d_lo) AND floor(d_hi) THEN
    RETURN round(cand)::bigint;
  END IF;
  -- Integer rounding pushed it out of a narrow band: sit on the near edge.
  IF ceil(d_lo) <= floor(d_hi) THEN
    RETURN GREATEST(0::numeric, v + sgn * ceil(d_lo))::bigint;
  END IF;
  -- The band is narrower than one unit (amounts in the single digits).
  RETURN GREATEST(0::numeric, round(cand))::bigint;
END;
$fn$;

ALTER FUNCTION internal.explore_obfuscate_amount(numeric, integer, text)
  OWNER TO postgres;

COMMENT ON FUNCTION internal.explore_obfuscate_amount(numeric, integer, text) IS
  'PS-254: deterministic banded obfuscation for the explore surface. Returns p_value perturbed by between p_percent/2 and p_percent percent, in a direction and amount fixed by md5(secret salt || p_seed), snapped to a 25000 multiple only where one lands inside that band. The salt is the explore_obfuscation_salt row of the PS-22 corridor internal.cron_secrets, read through internal.get_secret(); it is what makes this non-invertible, because without it the seed is public and the draw is reproducible. Lives outside `public` so PostgREST cannot expose it as an RPC oracle. public.public_guild_snapshots_explore is its only caller.';

REVOKE ALL ON FUNCTION internal.explore_obfuscate_amount(numeric, integer, text)
  FROM PUBLIC, anon, authenticated, service_role;

DO $grant$
DECLARE
  v_owner text;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO v_owner
    FROM pg_catalog.pg_class
   WHERE oid = to_regclass('public.public_guild_snapshots_explore');
  EXECUTE format(
    'GRANT EXECUTE ON FUNCTION internal.explore_obfuscate_amount(numeric, integer, text) TO %I',
    v_owner);
  EXECUTE format('GRANT USAGE ON SCHEMA internal TO %I', v_owner);
END;
$grant$;

-- A view checks function EXECUTE against the reader, so it cannot call the
-- owner-only helper for anon; a trigger stores the factor instead. A salt
-- rotation applies on the next write or refresh call.

CREATE TABLE IF NOT EXISTS internal.explore_obfuscation_cache (
  guild_code  text        NOT NULL,
  season      integer     NOT NULL,
  obf_total   bigint      NOT NULL,
  factor      numeric     NOT NULL CHECK (factor > 0),
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_code, season)
);
ALTER TABLE internal.explore_obfuscation_cache OWNER TO postgres;

REVOKE ALL ON TABLE internal.explore_obfuscation_cache
  FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE internal.explore_obfuscation_cache ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE internal.explore_obfuscation_cache IS
  'PS-254: the per-row obfuscation factor for guilds running obfuscate_values, computed at WRITE time by internal.refresh_explore_obfuscation() and read by public.public_guild_snapshots_explore. It exists because a view''s function EXECUTE privilege is checked against the reading role, not the view owner, so the view cannot call the obfuscation helper on anon''s behalf without handing anon an inversion oracle. Holds no secret: these are the numbers already served publicly. A missing row for an obfuscating guild is FAIL-CLOSED -- the view serves NULL, never the truth.';

CREATE OR REPLACE FUNCTION internal.refresh_explore_obfuscation()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $refresh$
DECLARE
  v_rows integer;
BEGIN
  DELETE FROM internal.explore_obfuscation_cache c
   WHERE NOT EXISTS (
     SELECT 1 FROM public.public_guild_snapshots s
      WHERE s.guild_code = c.guild_code
        AND s.season = c.season
        AND s.explore_privacy_mode @> '["obfuscate_values"]'::jsonb);

  INSERT INTO internal.explore_obfuscation_cache
        (guild_code, season, obf_total, factor, computed_at)
  SELECT s.guild_code, s.season, t.obf_total,
         CASE WHEN COALESCE(s.total_damage, 0) > 0
              THEN t.obf_total::numeric / s.total_damage::numeric
              -- A row that obfuscates but has no total still needs a factor
              -- for its averages and hits. Same seed, so it is the same draw;
              -- a fixed magnitude stands in for the missing total.
              ELSE internal.explore_obfuscate_amount(
                     1000000000::numeric, t.pct, t.seed)::numeric
                   / 1000000000::numeric
         END,
         now()
    FROM public.public_guild_snapshots s
    CROSS JOIN LATERAL (
      SELECT least(30, greatest(1,
               round(COALESCE(s.explore_obfuscation_percent, 10)::numeric)::int)) AS pct,
             s.guild_code || '|' || s.season::text || '|row'                       AS seed
    ) k
    CROSS JOIN LATERAL (
      SELECT k.pct, k.seed,
             internal.explore_obfuscate_amount(
               COALESCE(s.total_damage, 0)::numeric, k.pct, k.seed) AS obf_total
    ) t
   WHERE s.explore_privacy_mode @> '["obfuscate_values"]'::jsonb
      ON CONFLICT (guild_code, season) DO UPDATE
      SET obf_total   = EXCLUDED.obf_total,
          factor      = EXCLUDED.factor,
          computed_at = EXCLUDED.computed_at;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$refresh$;

ALTER FUNCTION internal.refresh_explore_obfuscation() OWNER TO postgres;
REVOKE ALL ON FUNCTION internal.refresh_explore_obfuscation()
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION internal.refresh_explore_obfuscation() IS
  'PS-254: recomputes internal.explore_obfuscation_cache from public_guild_snapshots. The ONLY caller of internal.explore_obfuscate_amount. Runs on every write of the base table via the statement trigger below, and once at apply time. Call it by hand after rotating the salt to apply the rotation without waiting for the next refresh.';

-- Must match 20260904140000's leaderboard seed, or the two surfaces desync.

CREATE OR REPLACE FUNCTION internal.tg_refresh_explore_obfuscation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $tg$
BEGIN
  PERFORM internal.refresh_explore_obfuscation();
  RETURN NULL;  -- AFTER ... FOR EACH STATEMENT: the return value is ignored
END;
$tg$;

ALTER FUNCTION internal.tg_refresh_explore_obfuscation() OWNER TO postgres;
REVOKE ALL ON FUNCTION internal.tg_refresh_explore_obfuscation()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS ps254_refresh_explore_obfuscation
  ON public.public_guild_snapshots;

-- TRUNCATE too: the refresh truncates before inserting.
CREATE TRIGGER ps254_refresh_explore_obfuscation
  AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.public_guild_snapshots
  FOR EACH STATEMENT
  EXECUTE FUNCTION internal.tg_refresh_explore_obfuscation();

COMMENT ON TRIGGER ps254_refresh_explore_obfuscation ON public.public_guild_snapshots IS
  'PS-254: keeps internal.explore_obfuscation_cache in step with this table. Statement-level rather than row-level: the cache is small (one row per obfuscating guild-season, four live) and both live writers rewrite the table wholesale.';

DO $seed$
DECLARE
  v_rows    integer;
  v_missing integer;
BEGIN
  v_rows := internal.refresh_explore_obfuscation();
  SELECT count(*) INTO v_missing
    FROM public.public_guild_snapshots s
    LEFT JOIN internal.explore_obfuscation_cache c
      ON c.guild_code = s.guild_code AND c.season = s.season
   WHERE s.explore_privacy_mode @> '["obfuscate_values"]'::jsonb
     AND c.factor IS NULL;
  IF v_missing > 0 THEN
    RAISE EXCEPTION
      'PS-254: % obfuscating row(s) have no precomputed factor after the initial population; the view would serve NULL for them', v_missing;
  END IF;
  RAISE NOTICE 'PS-254: precomputed the obfuscation factor for % row(s)', v_rows;
END;
$seed$;

-- Substituted in place: moving the column would force DROP VIEW and lose grants.

DO $mkview$
DECLARE
  v_passthrough text;
BEGIN
  IF to_regclass('public.public_guild_snapshots') IS NULL THEN
    RAISE EXCEPTION
      'PS-254: public.public_guild_snapshots is absent; refusing to build the explore view over nothing';
  END IF;

  SELECT string_agg(
           CASE WHEN column_name = 'explore_obfuscation_percent'
                THEN $expr$CASE WHEN m.modes @> '["obfuscate_values"]'::jsonb THEN NULL::integer ELSE s.explore_obfuscation_percent END AS explore_obfuscation_percent$expr$
                ELSE format('s.%I', column_name)
           END,
           ', ' ORDER BY ordinal_position)
    INTO v_passthrough
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'public_guild_snapshots'
     AND column_name NOT IN (
       'top_boss_hits', 'votlw_champions',
       'total_damage', 'average_damage', 'avg_damage_per_battle'
     );

  IF v_passthrough IS NULL THEN
    RAISE EXCEPTION
      'PS-254: public.public_guild_snapshots has no pass-through columns; refusing to build a degenerate view';
  END IF;

  IF v_passthrough NOT LIKE '%NULL::integer ELSE s.explore_obfuscation_percent%' THEN
    RAISE EXCEPTION
      'PS-254: the explore_obfuscation_percent substitution did not fire; the view would serve the band width to anon';
  END IF;

  EXECUTE
    'CREATE OR REPLACE VIEW public.public_guild_snapshots_explore AS SELECT '
    || v_passthrough
    || ', '
    || $body$
  -- FAIL-CLOSED throughout: an obfuscating row whose factor has not been
  -- precomputed is served NULL, never the truth. The trigger writes the cache
  -- in the same statement that creates the row, so this should be
  -- unreachable; it is here because "should be unreachable" is not a privacy
  -- guarantee.
  CASE WHEN m.modes @> '["obfuscate_values"]'::jsonb
       THEN o.obf_total
       ELSE s.total_damage END AS total_damage,
  CASE WHEN m.modes @> '["obfuscate_values"]'::jsonb
       THEN CASE
              WHEN o.factor IS NULL THEN NULL::bigint
              WHEN COALESCE(s.average_damage, 0) <= 0 THEN 0::bigint
              -- Scaled by the ROW factor, the same one the total used: same
              -- relative error, and average * battles reconstructs the SERVED
              -- total rather than the true one.
              ELSE GREATEST(0::numeric,
                     round(s.average_damage::numeric * o.factor))::bigint
            END
       ELSE s.average_damage END AS average_damage,
  CASE WHEN m.modes @> '["obfuscate_values"]'::jsonb
       THEN CASE
              WHEN o.factor IS NULL THEN NULL::bigint
              WHEN COALESCE(s.avg_damage_per_battle, 0) <= 0 THEN 0::bigint
              ELSE GREATEST(0::numeric,
                     round(s.avg_damage_per_battle::numeric * o.factor))::bigint
            END
       ELSE s.avg_damage_per_battle END AS avg_damage_per_battle,
  CASE WHEN m.modes @> '["hide_players"]'::jsonb
       THEN COALESCE((
         SELECT jsonb_agg(
                  CASE WHEN jsonb_typeof(c.champ) = 'object'
                       THEN jsonb_set(c.champ, '{player}', '"Anonymous Warrior"'::jsonb)
                       ELSE c.champ END
                  ORDER BY c.ord)
           FROM jsonb_array_elements(
                  CASE WHEN jsonb_typeof(s.votlw_champions::jsonb) = 'array'
                       THEN s.votlw_champions::jsonb
                       ELSE '[]'::jsonb END
                ) WITH ORDINALITY AS c(champ, ord)
       ), '[]'::jsonb)::json
       ELSE s.votlw_champions END AS votlw_champions,
  CASE WHEN m.modes @> '["obfuscate_values"]'::jsonb AND o.factor IS NULL
       THEN '[]'::json
       ELSE COALESCE((
    SELECT jsonb_agg(
             CASE
               WHEN jsonb_typeof(e.hit) <> 'object' THEN e.hit
               WHEN m.modes @> '["obfuscate_values"]'::jsonb THEN
                 (CASE WHEN m.modes @> '["hide_players"]'::jsonb
                       THEN jsonb_set(e.hit, '{player}', '"Anonymous Warrior"'::jsonb)
                       ELSE e.hit END)
                 || jsonb_build_object(
                      -- PS-254: the OBFUSCATED value under both keys. The
                      -- pre-fix view handed the truth back under
                      -- originalDamage, which inverted the whole scheme for
                      -- every hit. obfuscationPercent is NOT emitted: the band
                      -- width is not the reader's to know.
                      'originalDamage', to_jsonb(h.obf_dmg),
                      'damage', to_jsonb(h.obf_dmg),
                      'isObfuscated', to_jsonb(true))
               WHEN m.modes @> '["hide_players"]'::jsonb
                 THEN jsonb_set(e.hit, '{player}', '"Anonymous Warrior"'::jsonb)
               ELSE e.hit
             END
             ORDER BY e.ord)
      FROM jsonb_array_elements(
             CASE WHEN jsonb_typeof(s.top_boss_hits::jsonb) = 'array'
                  THEN s.top_boss_hits::jsonb
                  ELSE '[]'::jsonb END
           ) WITH ORDINALITY AS e(hit, ord)
      CROSS JOIN LATERAL (
        SELECT
          CASE
            WHEN jsonb_typeof(e.hit) <> 'object' THEN NULL::jsonb
            WHEN e.hit ? 'encounterId' AND jsonb_typeof(e.hit -> 'encounterId') <> 'null'
              THEN e.hit -> 'encounterId'
            WHEN e.hit ? 'encounter_id' AND jsonb_typeof(e.hit -> 'encounter_id') <> 'null'
              THEN e.hit -> 'encounter_id'
            ELSE NULL::jsonb
          END AS raw_enc,
          CASE
            WHEN jsonb_typeof(e.hit) <> 'object' THEN NULL::jsonb
            WHEN e.hit ? 'damage' AND jsonb_typeof(e.hit -> 'damage') <> 'null'
              THEN e.hit -> 'damage'
            WHEN e.hit ? 'damageDealt' AND jsonb_typeof(e.hit -> 'damageDealt') <> 'null'
              THEN e.hit -> 'damageDealt'
            WHEN e.hit ? 'damage_dealt' AND jsonb_typeof(e.hit -> 'damage_dealt') <> 'null'
              THEN e.hit -> 'damage_dealt'
            ELSE NULL::jsonb
          END AS raw_dmg
      ) r
      CROSS JOIN LATERAL (
        SELECT
          CASE
            WHEN r.raw_enc IS NULL THEN 0::numeric
            WHEN jsonb_typeof(r.raw_enc) = 'number' THEN (r.raw_enc #>> '{}')::numeric
            WHEN jsonb_typeof(r.raw_enc) = 'string'
                 AND (r.raw_enc #>> '{}') ~ '^\s*-?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?\s*$'
              THEN (r.raw_enc #>> '{}')::numeric
            ELSE 0::numeric
          END AS enc,
          CASE
            WHEN r.raw_dmg IS NULL THEN 0::numeric
            WHEN jsonb_typeof(r.raw_dmg) = 'number' THEN (r.raw_dmg #>> '{}')::numeric
            WHEN jsonb_typeof(r.raw_dmg) = 'string'
                 AND (r.raw_dmg #>> '{}') ~ '^\s*-?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?\s*$'
              THEN (r.raw_dmg #>> '{}')::numeric
            ELSE 0::numeric
          END AS dmg
      ) n
      CROSS JOIN LATERAL (
        SELECT
          -- Gated on the mode: 269 of the 273 live rows short-circuit to NULL
          -- here and never evaluate the arithmetic. NO FUNCTION IS CALLED
          -- ANYWHERE IN THIS VIEW -- the row's precomputed factor is reused --
          -- which is what lets anon read it at all.
          CASE WHEN NOT (m.modes @> '["obfuscate_values"]'::jsonb) THEN NULL::bigint
               WHEN n.dmg <= 0::numeric THEN 0::bigint
               ELSE GREATEST(0::numeric, round(n.dmg * o.factor))::bigint
          END AS obf_dmg
      ) h
     WHERE NOT (m.modes @> '["hide_primes"]'::jsonb AND n.enc IN (1, 2))
  ), '[]'::jsonb)::json END AS top_boss_hits
FROM public.public_guild_snapshots s
CROSS JOIN LATERAL (
  SELECT
    CASE
      WHEN jsonb_typeof(s.explore_privacy_mode) = 'array' THEN s.explore_privacy_mode
      WHEN jsonb_typeof(s.explore_privacy_mode) = 'string'
        THEN jsonb_build_array(s.explore_privacy_mode)
      ELSE '["public"]'::jsonb
    END AS modes,
    least(30, greatest(1, round(COALESCE(s.explore_obfuscation_percent, 10)::numeric)::int)) AS pct
) m
-- ONE draw per row, and it is READ here, not computed. The factor comes from
-- internal.explore_obfuscation_cache, written by the trigger in section 3. A
-- view cannot call the obfuscation helper on anon's behalf: EXECUTE is checked
-- against the reading role, not the view's owner. RELATION privileges ARE
-- checked against the owner, which is why reading this table works and calling
-- that function did not.
LEFT JOIN internal.explore_obfuscation_cache o
  ON o.guild_code = s.guild_code AND o.season = s.season
WHERE NOT (m.modes @> '["hide_all"]'::jsonb)
$body$;
END;
$mkview$;

COMMENT ON VIEW public.public_guild_snapshots_explore IS
  'PS-20/PS-254: privacy-enforcing projection of public_guild_snapshots. Applies explore_privacy_mode server-side and, for obfuscate_values, scales every amount in the row by a single factor drawn from a SECRET salt (the explore_obfuscation_salt row of the PS-22 corridor internal.cron_secrets, read through internal.get_secret()) so the perturbation cannot be reproduced by a reader, landing between explore_obfuscation_percent/2 and explore_obfuscation_percent percent from the truth. explore_obfuscation_percent itself is served NULL for obfuscating rows: the band width is part of the inversion input. This -- not the base table -- is the anon/authenticated read surface for /explore. The browser (packages/app-core/src/explore-privacy.ts) passes these numbers through untouched.';

-- Drop leftovers of unapplied earlier revisions: none may live in PostgREST-exposed public or in private.

DROP FUNCTION IF EXISTS public.explore_obfuscate_amount(numeric, integer, text);
DROP FUNCTION IF EXISTS private.explore_obfuscate_amount(numeric, integer, text);
DROP TABLE    IF EXISTS private.explore_obfuscation_salt;
-- Not CASCADE: anything else in private must stop the migration.
DROP SCHEMA   IF EXISTS private;

GRANT SELECT ON public.public_guild_snapshots_explore TO anon;
GRANT SELECT ON public.public_guild_snapshots_explore TO authenticated;
GRANT SELECT ON public.public_guild_snapshots_explore TO service_role;

DO $verify$
DECLARE
  v_view      oid;
  v_base      oid;
  v_bad       integer;
  v_n         integer;
  v_val       bigint;
  v_err       numeric;
  v_owner     text;
  v_role      text;
  v_digest    text;
  v_seen      integer;
  v_expect    integer;
  r           record;
BEGIN
  v_base := to_regclass('public.public_guild_snapshots');
  IF v_base IS NULL THEN
    RAISE EXCEPTION 'PS-254 verify: base table is missing; this verification would otherwise pass vacuously';
  END IF;

  v_view := to_regclass('public.public_guild_snapshots_explore');
  IF v_view IS NULL THEN
    RAISE EXCEPTION 'PS-254 verify: public.public_guild_snapshots_explore is missing';
  END IF;
  IF (SELECT relkind FROM pg_catalog.pg_class WHERE oid = v_view) <> 'v' THEN
    RAISE EXCEPTION 'PS-254 verify: public.public_guild_snapshots_explore is not a view';
  END IF;

  IF to_regprocedure('internal.explore_obfuscate_amount(numeric, integer, text)') IS NULL THEN
    RAISE EXCEPTION 'PS-254 verify: internal.explore_obfuscate_amount is missing';
  END IF;

  IF (SELECT count(*) FROM internal.cron_secrets
       WHERE name = 'explore_obfuscation_salt'
         AND length(COALESCE(value, '')) >= 32) <> 1 THEN
    RAISE EXCEPTION
      'PS-254 verify: internal.cron_secrets holds no usable explore_obfuscation_salt row';
  END IF;

  -- The second store this pull request briefly created must be gone.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'private') THEN
    RAISE EXCEPTION
      'PS-254 verify: schema private still exists; the salt lives in the PS-22 corridor and there must not be a second store';
  END IF;

  -- (0) Every obfuscating row has a precomputed factor. Without one the view
  --     serves NULL -- fail-closed, but still broken -- so this is asserted
  --     before anything that reads the view.
  SELECT count(*) INTO v_bad
    FROM public.public_guild_snapshots b
    LEFT JOIN internal.explore_obfuscation_cache c
      ON c.guild_code = b.guild_code AND c.season = b.season
   WHERE b.explore_privacy_mode @> '["obfuscate_values"]'::jsonb
     AND (c.factor IS NULL OR c.obf_total IS NULL);
  IF v_bad > 0 THEN
    RAISE EXCEPTION
      'PS-254 verify (0): % obfuscating row(s) have no precomputed obfuscation factor', v_bad;
  END IF;

  -- (0b) THE READ THAT PRODUCTION ACTUALLY MAKES. The previous revision
  --      passed every check here and then failed for anon on the live
  --      database, because a view's FUNCTION EXECUTE privilege is checked
  --      against the READING role while its RELATION privileges are checked
  --      against the owner, and this block runs as the applying superuser.
  --
  --      Note the shape carefully. `SELECT count(*) FROM the view` does NOT
  --      test this: count needs no column, so the planner never evaluates the
  --      obfuscation expression and no privilege is checked. That probe
  --      returns a clean 7 against a view that raises the moment anyone asks
  --      for a number. So this reads every obfuscated column and digests
  --      them, which cannot be optimised away.
  SELECT count(*) INTO v_expect FROM public.public_guild_snapshots_explore;

  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    BEGIN
      EXECUTE format('SET LOCAL ROLE %I', v_role);
      EXECUTE $probe$
        SELECT count(*),
               md5(COALESCE(string_agg(
                 COALESCE(t.total_damage::text, 'null') || '|' ||
                 COALESCE(t.average_damage::text, 'null') || '|' ||
                 COALESCE(t.avg_damage_per_battle::text, 'null') || '|' ||
                 COALESCE(t.top_boss_hits::text, 'null') || '|' ||
                 COALESCE(t.explore_obfuscation_percent::text, 'null'),
                 ',' ORDER BY t.guild_code, t.season), ''))
          FROM public.public_guild_snapshots_explore t
      $probe$ INTO v_seen, v_digest;
      RESET ROLE;
    EXCEPTION WHEN OTHERS THEN
      RESET ROLE;
      RAISE EXCEPTION
        'PS-254 verify (0b): % cannot read the explore view: % -- this is the failure the previous revision shipped, where the view called the obfuscation helper and EXECUTE was checked against the reader',
        v_role, SQLERRM;
    END;

    IF v_seen IS DISTINCT FROM v_expect THEN
      RAISE EXCEPTION
        'PS-254 verify (0b): % sees % row(s) in the explore view, the owner sees %',
        v_role, v_seen, v_expect;
    END IF;
    RAISE NOTICE 'PS-254 verify (0b): % reads % row(s), digest %', v_role, v_seen, v_digest;
  END LOOP;

  -- (a) Synthetic positive control over the live magnitude range. These are
  --     amounts, not identifiers: the largest and smallest live obfuscating
  --     magnitudes, i.e. including the case where the 25 000 grid is coarse
  --     relative to the band.
  FOR v_val, v_n IN
    SELECT * FROM (VALUES (733347326::bigint, 30), (284591::bigint, 10),
                          (93915167::bigint, 10), (589996405::bigint, 30)) AS c(a, p)
  LOOP
    v_err := abs(internal.explore_obfuscate_amount(v_val::numeric, v_n,
                   'ps254-verify|' || v_val::text || '|' || v_n::text) - v_val)::numeric
             / v_val::numeric * 100::numeric;
    IF v_err < v_n::numeric / 2::numeric - 0.01 OR v_err > v_n::numeric + 0.01 THEN
      RAISE EXCEPTION
        'PS-254 verify (a): synthetic control failed -- value % at percent % served %%% off, outside [%, %]',
        v_val, v_n, round(v_err, 4), v_n::numeric / 2, v_n;
    END IF;
  END LOOP;

  -- (a) Every real obfuscating row, on ALL THREE numeric columns. The slack is
  --     one whole unit expressed as a percentage, which is what integer
  --     rounding can cost; it matters only for the smallest amounts.
  FOR r IN
    SELECT b.season,
           k.p,
           col.name        AS col_name,
           col.truth,
           col.served,
           abs(col.served - col.truth)::numeric / col.truth::numeric * 100 AS err,
           GREATEST(0.01, 100::numeric / col.truth::numeric)               AS eps
      FROM public.public_guild_snapshots b
      JOIN public.public_guild_snapshots_explore v
        ON v.guild_code = b.guild_code AND v.season = b.season
      CROSS JOIN LATERAL (
        SELECT least(30, greatest(1, COALESCE(b.explore_obfuscation_percent, 10)))::numeric AS p
      ) k
      CROSS JOIN LATERAL (VALUES
        ('total_damage',          b.total_damage,          v.total_damage),
        ('average_damage',        b.average_damage,        v.average_damage),
        ('avg_damage_per_battle', b.avg_damage_per_battle, v.avg_damage_per_battle)
      ) AS col(name, truth, served)
     WHERE b.explore_privacy_mode @> '["obfuscate_values"]'::jsonb
       AND COALESCE(col.truth, 0) > 0
  LOOP
    IF r.err < r.p / 2 - r.eps OR r.err > r.p + r.eps THEN
      RAISE EXCEPTION
        'PS-254 verify (a): season % column % at percent % is served %%% from the truth, outside [%, %]',
        r.season, r.col_name, r.p, round(r.err, 6), r.p / 2, r.p;
    END IF;
  END LOOP;

  -- (a) Every individual hit of every obfuscating row, same band.
  SELECT count(*) INTO v_bad
    FROM public.public_guild_snapshots b
    JOIN public.public_guild_snapshots_explore v
      ON v.guild_code = b.guild_code AND v.season = b.season
    CROSS JOIN LATERAL (
      SELECT least(30, greatest(1, COALESCE(b.explore_obfuscation_percent, 10)))::numeric AS p
    ) k
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(b.top_boss_hits::jsonb) = 'array'
           THEN b.top_boss_hits::jsonb ELSE '[]'::jsonb END) WITH ORDINALITY AS bt(hit, ord)
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(v.top_boss_hits::jsonb) = 'array'
           THEN v.top_boss_hits::jsonb ELSE '[]'::jsonb END) WITH ORDINALITY AS vt(hit, ord)
   WHERE b.explore_privacy_mode @> '["obfuscate_values"]'::jsonb
     AND NOT (b.explore_privacy_mode @> '["hide_primes"]'::jsonb)
     AND bt.ord = vt.ord
     AND jsonb_typeof(bt.hit -> 'damage') = 'number'
     AND (bt.hit ->> 'damage')::numeric > 0
     AND ( abs((vt.hit ->> 'damage')::numeric - (bt.hit ->> 'damage')::numeric)
             / (bt.hit ->> 'damage')::numeric * 100
             < k.p / 2 - GREATEST(0.01, 100::numeric / (bt.hit ->> 'damage')::numeric)
           OR
           abs((vt.hit ->> 'damage')::numeric - (bt.hit ->> 'damage')::numeric)
             / (bt.hit ->> 'damage')::numeric * 100
             > k.p + GREATEST(0.01, 100::numeric / (bt.hit ->> 'damage')::numeric) );
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'PS-254 verify (a): % individual hit(s) are served outside their band', v_bad;
  END IF;

  -- (a) And the truth must not survive under any adjacent key.
  SELECT count(*) INTO v_bad
    FROM public.public_guild_snapshots b
    JOIN public.public_guild_snapshots_explore v
      ON v.guild_code = b.guild_code AND v.season = b.season
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(v.top_boss_hits::jsonb) = 'array'
           THEN v.top_boss_hits::jsonb ELSE '[]'::jsonb END) AS vh(hit)
   WHERE b.explore_privacy_mode @> '["obfuscate_values"]'::jsonb
     AND ( vh.hit ? 'obfuscationPercent'
           OR (vh.hit ? 'originalDamage'
               AND vh.hit -> 'originalDamage' IS DISTINCT FROM vh.hit -> 'damage') );
  IF v_bad > 0 THEN
    RAISE EXCEPTION
      'PS-254 verify (a): % served hit object(s) still carry the band width or a second, different damage figure', v_bad;
  END IF;

  -- (b) Reconstruction: average x battles must land in the band around the
  --     TRUE total. The extra slack is the source data's own skew between
  --     avg_damage_per_battle * total_battles and the stored total, which this
  --     migration neither creates nor can remove.
  FOR r IN
    SELECT b.season,
           k.p,
           abs(v.avg_damage_per_battle::numeric * b.total_battles::numeric
               - b.total_damage::numeric) / b.total_damage::numeric * 100 AS err,
           abs(b.avg_damage_per_battle::numeric * b.total_battles::numeric
               - b.total_damage::numeric) / b.total_damage::numeric * 100 AS skew
      FROM public.public_guild_snapshots b
      JOIN public.public_guild_snapshots_explore v
        ON v.guild_code = b.guild_code AND v.season = b.season
      CROSS JOIN LATERAL (
        SELECT least(30, greatest(1, COALESCE(b.explore_obfuscation_percent, 10)))::numeric AS p
      ) k
     WHERE b.explore_privacy_mode @> '["obfuscate_values"]'::jsonb
       AND COALESCE(b.total_damage, 0) > 0
       AND COALESCE(b.total_battles, 0) > 0
       AND COALESCE(b.avg_damage_per_battle, 0) > 0
  LOOP
    IF r.err < r.p / 2 - r.skew - 0.01 OR r.err > r.p + r.skew + 0.01 THEN
      RAISE EXCEPTION
        'PS-254 verify (b): season % reconstructs to %%% from the truth at percent %, outside [%, %] (source skew %%%)',
        r.season, round(r.err, 6), r.p, r.p / 2 - r.skew, r.p + r.skew, round(r.skew, 6);
    END IF;
  END LOOP;

  -- (c) The salt is not reachable by any role PostgREST can assume. PS-22
  --     already fails closed twice over on internal.cron_secrets -- no grant
  --     AND row security with no policy -- and this migration must not have
  --     loosened any of it. service_role is included because it is a real
  --     PostgREST role here, not only anon and authenticated.
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF has_schema_privilege(v_role, 'internal', 'USAGE') THEN
      RAISE EXCEPTION 'PS-254 verify (c): % holds USAGE on schema internal', v_role;
    END IF;
    IF has_table_privilege(v_role, 'internal.cron_secrets', 'SELECT') THEN
      RAISE EXCEPTION 'PS-254 verify (c): % can read internal.cron_secrets, where the salt lives', v_role;
    END IF;
    IF has_function_privilege(v_role, 'internal.get_secret(text)', 'EXECUTE') THEN
      RAISE EXCEPTION 'PS-254 verify (c): % may execute internal.get_secret, the corridor''s read path', v_role;
    END IF;
    IF has_function_privilege(v_role,
         'internal.explore_obfuscate_amount(numeric, integer, text)', 'EXECUTE') THEN
      RAISE EXCEPTION 'PS-254 verify (c): % may execute the obfuscation function', v_role;
    END IF;
  END LOOP;

  -- Row security on the corridor table, as PS-22 left it. Not redundant with
  -- the grant checks: it is what fails closed if a future migration grants
  -- SELECT without noticing.
  IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class
           WHERE oid = to_regclass('internal.cron_secrets')) THEN
    RAISE EXCEPTION
      'PS-254 verify (c): row security is no longer enabled on internal.cron_secrets';
  END IF;

  -- (d) Nothing in a PostgREST-exposed schema computes the factor.
  --
  --     SCOPED TO WHAT THIS MIGRATION OWNS, and that scoping is load-bearing
  --     rather than cosmetic. An earlier revision matched any function body
  --     mentioning `cron_secrets` or `get_secret`, which is the wrong test:
  --     the PS-22 corridor is DESIGNED to be read from `public` through narrow
  --     SECURITY DEFINER wrappers, and three of them exist live --
  --     public.get_service_role_key, public.get_cron_secret and
  --     public.call_edge_function. Each passes a hard-coded secret name, so
  --     none of them can be steered at the salt, and none is a defect. That
  --     revision would have counted three violations and rolled the apply
  --     back on the live General database.
  --
  --     What matters is that nothing reachable from PostgREST knows about
  --     THIS secret or THIS arithmetic. Two assertions, both narrow.
  --
  --     The exposed set is PGRST_DB_SCHEMAS, read read-only from both live
  --     PostgREST deployments on 2026-09-05 as `public,graphql_public`; it is
  --     not readable from inside the database, so it is asserted here as the
  --     literal this migration was written against. If that configuration
  --     ever widens, this is the assertion to revisit.
  SELECT count(*) INTO v_bad
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname IN ('public', 'graphql_public')
     AND ( p.proname = 'explore_obfuscate_amount'
           OR COALESCE(p.prosrc, '') ILIKE '%explore_obfuscation_salt%' );
  IF v_bad > 0 THEN
    RAISE EXCEPTION
      'PS-254 verify (d): % function(s) in a PostgREST-exposed schema name the obfuscation salt or its arithmetic', v_bad;
  END IF;

  -- (d2) And there is exactly one implementation, anywhere. A second function
  --      naming the salt -- in any schema, however well guarded -- is either a
  --      duplicate of the arithmetic or a new way to reach the secret, and
  --      both are things a reviewer should see rather than inherit.
  SELECT count(*) INTO v_bad
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace ns ON ns.oid = p.pronamespace
   WHERE COALESCE(p.prosrc, '') ILIKE '%explore_obfuscation_salt%'
     AND NOT (ns.nspname = 'internal' AND p.proname = 'explore_obfuscate_amount');
  IF v_bad > 0 THEN
    RAISE EXCEPTION
      'PS-254 verify (d2): % function(s) besides internal.explore_obfuscate_amount name the obfuscation salt', v_bad;
  END IF;

  -- (e) NEGATIVE CONTROL. This is the reviewer's inversion, verbatim in
  --     method: take the served total, rebuild the draw from the PUBLIC seed
  --     md5('ps254|' || guild_code || '|' || season || '|total_damage'), and
  --     divide it out. Against the previous revision that returned the truth
  --     with a relative error of 1e-5, i.e. a complete break of a 30 % band.
  --     The percent is no longer served, so the reader must also search it:
  --     all 30 values, both directions, 60 candidates per row.
  --
  --     What is asserted, and what is NOT. No banded scheme can stop a reader
  --     bounding the truth by the band -- that is what a band IS, and a
  --     60-candidate sweep will always contain one value near the truth by
  --     arithmetic alone. What must be impossible is PINNING the truth. So:
  --       (e1) no candidate reproduces the truth exactly;
  --       (e2) the reader who is handed the true percent as well -- the
  --            strongest realistic case, and the reviewer's exact method --
  --            misses by more than the previous revision structurally could.
  --            That revision's only error was the 25 000 grid snap, so its
  --            inversion could never be worse than half a grid step, 12500
  --            divided by the truth. That bound is a property of the previous
  --            revision's arithmetic, not a measurement.
  --
  --            The pull request quotes per-row distances either side of that
  --            bound. Those are measurements taken on a THROWAWAY database
  --            carrying the four live magnitudes, not something this block
  --            reconstructs, and they move with every salt draw. Do not read
  --            them as a property of the design. What IS asserted here, and
  --            in-transaction, is the count below: zero rows on the wrong
  --            side of the bound.
  --
  --     (e2) compares two independent draws, so it is a statement about this
  --     salt and not a proof about every salt. If a rotation ever produced a
  --     salt whose draw happened to coincide with the public one for some
  --     row, this assertion would fire -- and rotating again is the correct
  --     response, because for that row the concealment really would have been
  --     accidental. The deterministic companion control, that the served
  --     numbers move when the salt changes, needs a write and therefore lives
  --     in supabase/tests/pgtap/ps254_explore_obfuscation_percent.sql, which
  --     rotates inside a transaction it rolls back.
  SELECT count(*) INTO v_bad
    FROM public.public_guild_snapshots b
    JOIN public.public_guild_snapshots_explore v
      ON v.guild_code = b.guild_code AND v.season = b.season
    CROSS JOIN LATERAL (
      SELECT decode(md5('ps254|' || b.guild_code || '|' || b.season::text
                        || '|total_damage'), 'hex') AS h
    ) pub
    CROSS JOIN LATERAL (
      SELECT ( get_byte(pub.h, 0)::numeric * 65536::numeric
             + get_byte(pub.h, 1)::numeric * 256::numeric
             + get_byte(pub.h, 2)::numeric ) / 16777215::numeric AS frac,
             (CASE WHEN get_byte(pub.h, 3) % 2 = 0 THEN 1 ELSE -1 END)::numeric AS sgn
    ) d
    CROSS JOIN generate_series(1, 30) AS cand_p
    CROSS JOIN (VALUES (1::numeric), (-1::numeric)) AS dir(s)
   WHERE b.explore_privacy_mode @> '["obfuscate_values"]'::jsonb
     AND COALESCE(b.total_damage, 0) > 0
     AND round( v.total_damage::numeric
                / (1::numeric + dir.s * (cand_p::numeric / 200::numeric)
                                      * (1::numeric + d.frac)) )
         = b.total_damage::numeric;
  IF v_bad > 0 THEN
    RAISE EXCEPTION
      'PS-254 verify (e1): the public-seed inversion still recovers the exact truth for % row/candidate pair(s); the salt is not doing its job', v_bad;
  END IF;

  -- (e2) The reviewer's inversion, with the true percent handed over, must
  --      miss by more than half a grid step -- the previous revision's
  --      structural error floor.
  SELECT count(*) INTO v_bad
    FROM public.public_guild_snapshots b
    JOIN public.public_guild_snapshots_explore v
      ON v.guild_code = b.guild_code AND v.season = b.season
    CROSS JOIN LATERAL (
      SELECT decode(md5('ps254|' || b.guild_code || '|' || b.season::text
                        || '|total_damage'), 'hex') AS h,
             least(30, greatest(1, COALESCE(b.explore_obfuscation_percent, 10)))::numeric AS p
    ) pub
    CROSS JOIN LATERAL (
      SELECT ( get_byte(pub.h, 0)::numeric * 65536::numeric
             + get_byte(pub.h, 1)::numeric * 256::numeric
             + get_byte(pub.h, 2)::numeric ) / 16777215::numeric AS frac,
             (CASE WHEN get_byte(pub.h, 3) % 2 = 0 THEN 1 ELSE -1 END)::numeric AS sgn
    ) d
   WHERE b.explore_privacy_mode @> '["obfuscate_values"]'::jsonb
     AND COALESCE(b.total_damage, 0) > 0
     AND abs( round( v.total_damage::numeric
                     / (1::numeric + d.sgn * (pub.p / 200::numeric)
                                           * (1::numeric + d.frac)) )
              - b.total_damage::numeric )
         / b.total_damage::numeric
         <= 12500::numeric / b.total_damage::numeric;
  IF v_bad > 0 THEN
    RAISE EXCEPTION
      'PS-254 verify (e2): the public-seed inversion pins % row(s) to within half a grid step of the truth; that is the previous revision''s failure mode, and rotating the explore_obfuscation_salt row of internal.cron_secrets is the fix', v_bad;
  END IF;

  -- (f) The band width is not served for rows that obfuscate.
  SELECT count(*) INTO v_bad
    FROM public.public_guild_snapshots_explore v
   WHERE v.explore_privacy_mode @> '["obfuscate_values"]'::jsonb
     AND v.explore_obfuscation_percent IS NOT NULL;
  IF v_bad > 0 THEN
    RAISE EXCEPTION
      'PS-254 verify (f): % obfuscating row(s) still serve explore_obfuscation_percent', v_bad;
  END IF;

  -- And it IS still served for rows that do not obfuscate, so this is a
  -- redaction and not a column that stopped working.
  SELECT count(*) INTO v_bad
    FROM public.public_guild_snapshots_explore v
   WHERE NOT (v.explore_privacy_mode @> '["obfuscate_values"]'::jsonb)
     AND v.explore_obfuscation_percent IS NULL;
  IF v_bad > 0 AND EXISTS (
       SELECT 1 FROM public.public_guild_snapshots
        WHERE explore_obfuscation_percent IS NOT NULL
          AND NOT (explore_privacy_mode @> '["obfuscate_values"]'::jsonb)) THEN
    RAISE EXCEPTION
      'PS-254 verify (f): % non-obfuscating row(s) lost explore_obfuscation_percent', v_bad;
  END IF;

  -- (g) Grants and ownership unchanged.
  IF NOT (SELECT anon_sel FROM ps254_before)
     OR NOT has_table_privilege('anon', v_view, 'SELECT') THEN
    RAISE EXCEPTION 'PS-254 verify (g): anon SELECT on the explore view changed';
  END IF;
  IF NOT (SELECT auth_sel FROM ps254_before)
     OR NOT has_table_privilege('authenticated', v_view, 'SELECT') THEN
    RAISE EXCEPTION 'PS-254 verify (g): authenticated SELECT on the explore view changed';
  END IF;
  IF (SELECT svc_sel FROM ps254_before) IS DISTINCT FROM has_table_privilege('service_role', v_view, 'SELECT') THEN
    RAISE EXCEPTION 'PS-254 verify (g): service_role SELECT on the explore view changed';
  END IF;
  SELECT pg_get_userbyid(relowner) INTO v_owner FROM pg_catalog.pg_class WHERE oid = v_view;
  IF (SELECT view_owner FROM ps254_before) IS DISTINCT FROM v_owner THEN
    RAISE EXCEPTION 'PS-254 verify (g): the explore view changed owner';
  END IF;
  IF (SELECT base_anon_sel FROM ps254_before)
       IS DISTINCT FROM has_table_privilege('anon', v_base, 'SELECT') THEN
    RAISE EXCEPTION 'PS-254 verify (g): anon SELECT on the BASE table changed; this migration must not touch base-table grants';
  END IF;

  -- (g) A re-apply must not re-draw the salt: that would move every served
  --     figure for no reason and invalidate anything cached against them.
  IF EXISTS (SELECT 1 FROM ps254_salt_before WHERE salt_md5 IS NOT NULL)
     AND (SELECT salt_md5 FROM ps254_salt_before)
         IS DISTINCT FROM (SELECT md5(value) FROM internal.cron_secrets
                            WHERE name = 'explore_obfuscation_salt') THEN
    RAISE EXCEPTION 'PS-254 verify (g): re-applying this migration regenerated the obfuscation salt';
  END IF;

  RAISE NOTICE 'PS-254 verify: OK -- percent governs magnitude, the draw is salted and not invertible from the served row, the band width is not served, grants and ownership unchanged';
END;
$verify$;

COMMIT;

NOTIFY pgrst, 'reload schema';
