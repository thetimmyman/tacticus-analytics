-- Explore privacy part A: a view applying each guild's privacy mode server-side, since
-- anon can read every base column. Apply A, roll the app, then B.
-- target-db: general
-- Mirrors packages/app-core/src/explore-privacy.ts except that average_damage is obfuscated
-- too (total/avg would invert it) and votlw_champions is anonymised under hide_players.

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

-- Columns come from information_schema so live-only base columns pass through.

DO $mkview$
DECLARE
  v_passthrough text;
BEGIN
  IF to_regclass('public.public_guild_snapshots') IS NULL THEN
    RAISE EXCEPTION
      'PS-20: public.public_guild_snapshots is absent; refusing to build the explore view over nothing';
  END IF;

  SELECT string_agg(format('s.%I', column_name), ', ' ORDER BY ordinal_position)
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
      'PS-20: public.public_guild_snapshots has no pass-through columns; refusing to build a degenerate view';
  END IF;

  EXECUTE
    'CREATE OR REPLACE VIEW public.public_guild_snapshots_explore AS SELECT '
    || v_passthrough
    || ', '
    || $body$
  CASE WHEN m.modes @> '["obfuscate_values"]'::jsonb
       THEN CASE WHEN COALESCE(s.total_damage, 0) <= 0 THEN 0::bigint
                 ELSE (round(s.total_damage::numeric / 25000) * 25000)::bigint END
       ELSE s.total_damage END AS total_damage,
  CASE WHEN m.modes @> '["obfuscate_values"]'::jsonb
       THEN CASE WHEN COALESCE(s.average_damage, 0) <= 0 THEN 0::bigint
                 ELSE (round(s.average_damage::numeric / 25000) * 25000)::bigint END
       ELSE s.average_damage END AS average_damage,
  CASE WHEN m.modes @> '["obfuscate_values"]'::jsonb
       THEN CASE WHEN COALESCE(s.avg_damage_per_battle, 0) <= 0 THEN 0::bigint
                 ELSE (round(s.avg_damage_per_battle::numeric / 25000) * 25000)::bigint END
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
  COALESCE((
    SELECT jsonb_agg(
             CASE
               WHEN jsonb_typeof(e.hit) <> 'object' THEN e.hit
               WHEN m.modes @> '["obfuscate_values"]'::jsonb THEN
                 (CASE WHEN m.modes @> '["hide_players"]'::jsonb
                       THEN jsonb_set(e.hit, '{player}', '"Anonymous Warrior"'::jsonb)
                       ELSE e.hit END)
                 || jsonb_build_object(
                      'originalDamage', to_jsonb(n.dmg),
                      'damage', to_jsonb(
                        CASE WHEN n.dmg <= 0 THEN 0::numeric
                             ELSE round(n.dmg / 25000) * 25000 END),
                      'isObfuscated', to_jsonb(true),
                      'obfuscationPercent', to_jsonb(m.pct))
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
     WHERE NOT (m.modes @> '["hide_primes"]'::jsonb AND n.enc IN (1, 2))
  ), '[]'::jsonb)::json AS top_boss_hits
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
WHERE NOT (m.modes @> '["hide_all"]'::jsonb)
$body$;
END;
$mkview$;

COMMENT ON VIEW public.public_guild_snapshots_explore IS
  'PS-20: privacy-enforcing projection of public_guild_snapshots. Applies explore_privacy_mode / explore_obfuscation_percent server-side, mirroring packages/app-core/src/explore-privacy.ts. This -- not the base table -- is the anon/authenticated read surface for /explore.';

-- The service_role policy lands before part B drops PUBLIC, so refresh never needs BYPASSRLS.

GRANT SELECT ON public.public_guild_snapshots_explore TO anon;
GRANT SELECT ON public.public_guild_snapshots_explore TO authenticated;
GRANT SELECT ON public.public_guild_snapshots_explore TO service_role;

DO $policy$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'public_guild_snapshots'
       AND policyname = 'ps20_service_role_read'
  ) THEN
    CREATE POLICY ps20_service_role_read
      ON public.public_guild_snapshots
      FOR SELECT TO service_role
      USING (true);
  END IF;
END;
$policy$;

-- Raises before part A; asserts the base table exists so it cannot pass vacuously.

DO $verifya$
DECLARE
  v_rel oid;
  v_view oid;
BEGIN
  v_rel := to_regclass('public.public_guild_snapshots');
  IF v_rel IS NULL THEN
    RAISE EXCEPTION
      'PS-20 verify A: base table public.public_guild_snapshots does not exist; this verification would otherwise pass vacuously';
  END IF;

  v_view := to_regclass('public.public_guild_snapshots_explore');
  IF v_view IS NULL THEN
    RAISE EXCEPTION
      'PS-20 verify A: view public.public_guild_snapshots_explore is missing';
  END IF;

  IF (SELECT relkind FROM pg_catalog.pg_class WHERE oid = v_view) <> 'v' THEN
    RAISE EXCEPTION
      'PS-20 verify A: public.public_guild_snapshots_explore exists but is not a view';
  END IF;

  IF NOT has_table_privilege('anon', v_view, 'SELECT') THEN
    RAISE EXCEPTION
      'PS-20 verify A: anon cannot SELECT public.public_guild_snapshots_explore';
  END IF;

  IF NOT has_table_privilege('authenticated', v_view, 'SELECT') THEN
    RAISE EXCEPTION
      'PS-20 verify A: authenticated cannot SELECT public.public_guild_snapshots_explore';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'public_guild_snapshots'
       AND policyname = 'ps20_service_role_read'
  ) THEN
    RAISE EXCEPTION
      'PS-20 verify A: policy ps20_service_role_read is missing from public.public_guild_snapshots';
  END IF;

  RAISE NOTICE 'PS-20 verify A: OK -- redacting view in place and readable; base-table grants deliberately untouched (part B closes them)';
END;
$verifya$;

COMMIT;

NOTIFY pgrst, 'reload schema';
