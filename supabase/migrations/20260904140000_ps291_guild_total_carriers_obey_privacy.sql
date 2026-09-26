-- Make every anon/authenticated carrier of a guild total obey obfuscate_values:
-- one true total divides out 20260904100000's row factor.
-- target-db: general
-- The leaderboard reuses the view's helper and seed, so both serve one factor.
-- Cluster peers can still sum raw EOT_GR_data rows under its RLS, by design.

SET lock_timeout = '5s';

BEGIN;

-- Stop rather than half-apply: without the helper the replaced function fails for every caller.

DO $pre$
DECLARE
  v_owner text;
BEGIN
  IF to_regprocedure('internal.explore_obfuscate_amount(numeric, integer, text)') IS NULL THEN
    RAISE EXCEPTION
      'PS-291: internal.explore_obfuscate_amount is absent; apply 20260904100000 (PS-254) first -- this migration refuses to invent a second obfuscation body';
  END IF;

  IF to_regclass('internal.cron_secrets') IS NULL THEN
    RAISE EXCEPTION
      'PS-291: internal.cron_secrets is absent; PS-254 stores the explore_obfuscation_salt there and this migration has no other source for the factor';
  END IF;

  IF (SELECT count(*) FROM internal.cron_secrets
       WHERE name = 'explore_obfuscation_salt'
         AND coalesce(length(value), 0) >= 32) <> 1 THEN
    RAISE EXCEPTION
      'PS-291: internal.cron_secrets holds no usable explore_obfuscation_salt row; the carriers cannot be made to agree with a view that cannot draw a factor';
  END IF;

  IF to_regclass('public.public_guild_snapshots_explore') IS NULL THEN
    RAISE EXCEPTION
      'PS-291: public.public_guild_snapshots_explore is absent; there is no privacy-gated surface for the other carriers to agree with';
  END IF;

  IF to_regclass('public.public_guild_snapshots') IS NULL THEN
    RAISE EXCEPTION
      'PS-291: public.public_guild_snapshots is absent; the per-guild factor is drawn from its rows';
  END IF;

  IF to_regprocedure('public.get_public_global_leaderboard(integer)') IS NULL THEN
    RAISE EXCEPTION
      'PS-291: public.get_public_global_leaderboard(integer) is absent; section 4 replaces it and will not create a surface that was retired';
  END IF;

  IF to_regprocedure('public.get_guild_showcase(text)') IS NULL THEN
    RAISE EXCEPTION
      'PS-291: public.get_guild_showcase(text) is absent; section 2 moves its grants and will not silently no-op';
  END IF;

  IF to_regclass('public.global_leaderboard') IS NULL THEN
    RAISE EXCEPTION
      'PS-291: public.global_leaderboard is absent; section 3 moves its grants and will not silently no-op';
  END IF;

  -- The definer's owner is what actually executes the helper call added in
  -- section 4. PS-254 granted EXECUTE to the explore view's owner; assert that
  -- this is the same role rather than trusting that both happen to be postgres.
  SELECT pg_get_userbyid(proowner) INTO v_owner
    FROM pg_catalog.pg_proc
   WHERE oid = to_regprocedure('public.get_public_global_leaderboard(integer)');

  IF NOT (SELECT prosecdef FROM pg_catalog.pg_proc
           WHERE oid = to_regprocedure('public.get_public_global_leaderboard(integer)')) THEN
    RAISE EXCEPTION
      'PS-291: public.get_public_global_leaderboard is no longer SECURITY DEFINER; as an invoker-rights function it would need EXECUTE on the helper granted to anon, which is the oracle PS-254 deleted';
  END IF;

  IF NOT has_function_privilege(v_owner,
        'internal.explore_obfuscate_amount(numeric, integer, text)', 'EXECUTE') THEN
    RAISE EXCEPTION
      'PS-291: % owns get_public_global_leaderboard but holds no EXECUTE on internal.explore_obfuscate_amount; grant it to that role only (never to anon or authenticated) and re-run', v_owner;
  END IF;

  IF NOT has_schema_privilege(v_owner, 'internal', 'USAGE') THEN
    RAISE EXCEPTION
      'PS-291: % holds no USAGE on schema internal and cannot reach the helper', v_owner;
  END IF;
END;
$pre$;

-- Grants only: the live body has a literal the snapshot scope gate forbids.

REVOKE EXECUTE ON FUNCTION public.get_guild_showcase(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_guild_showcase(text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.get_guild_showcase(text) FROM PUBLIC;

COMMENT ON FUNCTION public.get_guild_showcase(text) IS
  'PS-291: NOT a public read path. This function joins public_guild_snapshots directly and has no explore_privacy_mode branch, so an anon caller read the true total_damage of a guild that had chosen obfuscate_values -- exactly the figure public.public_guild_snapshots_explore exists to conceal. EXECUTE is service_role only. Anything that needs a guild total for a public surface reads public_guild_snapshots_explore, which applies the privacy mode. If this RPC is ever wired to a public page, it must first select its totals from that view rather than from the base table.';

-- security_invoker=true, so fixing it in place would grant authenticated the helper.

REVOKE SELECT ON public.global_leaderboard FROM authenticated;
REVOKE ALL ON public.global_leaderboard FROM anon;

COMMENT ON VIEW public.global_leaderboard IS
  'PS-291: service_role and analytics_ro only. This view serves raw per-player season totals with no explore_privacy_mode branch, and it is security_invoker=true, so it cannot call the internal obfuscation helper without that helper being granted to authenticated -- the oracle PS-254 removed. The privacy-aware read path is public.get_public_global_leaderboard(integer), which anon and authenticated keep. Its own current_season CTE takes max("Season"), which is text and therefore lexicographic; that is a separate defect and is not fixed here.';

-- Amounts use the view's row factor, and the score and sort key use served values.
-- Gated on the privacy flag, not the factor: mid-refresh a flagged guild gets NULL, never the truth.

CREATE OR REPLACE FUNCTION public.get_public_global_leaderboard(p_limit integer DEFAULT 10)
RETURNS TABLE(rank bigint, display_name text, guild_display_name text,
              cluster_display_name text, battle_count bigint,
              total_damage numeric, avg_damage numeric, max_damage bigint,
              performance_score numeric, is_obfuscated boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH current_season AS (
    -- season_num, NOT max("Season"): the latter is text and lexicographic.
    SELECT max(e.season_num) AS season_num FROM public."EOT_GR_data" e
  ),
  visible AS (
    SELECT
      e."displayName"                                        AS display_name,
      e."Guild"                                              AS guild_code,
      gc.display_name                                        AS guild_display_name,
      COALESCE(c.display_name, 'Independent'::varchar)       AS cluster_display_name,
      count(*)                                               AS battle_count,
      sum(e."damageDealt")                                   AS total_damage,
      round(avg(e."damageDealt"), 0)                         AS avg_damage,
      max(e."damageDealt")                                   AS max_damage,
      COALESCE(gc.explore_privacy_mode, '["public"]'::jsonb) AS modes
    FROM public."EOT_GR_data" e
    CROSS JOIN current_season cs
    LEFT JOIN public.guild_config gc ON gc.guild_code = e."Guild"
    LEFT JOIN public.clusters c ON c.cluster_code::text = e.cluster_code::text
    WHERE e.season_num = cs.season_num
      AND e."damageDealt" > 0
      AND NOT (COALESCE(gc.explore_privacy_mode, '["public"]'::jsonb) ? 'hide_all')
    GROUP BY e."displayName", e."Guild", e.cluster_code,
             gc.display_name, c.display_name, gc.explore_privacy_mode
  ),
  -- PS-291: ONE draw per obfuscating guild, from PS-254's helper, on the
  -- guild's own snapshot total, with the seed expression copied verbatim from
  -- public.public_guild_snapshots_explore. factor is therefore identical to
  -- that view's o.factor, and the two surfaces agree by construction.
  guild_factor AS (
    SELECT
      s.guild_code,
      CASE
        WHEN COALESCE(s.total_damage, 0) > 0
          THEN internal.explore_obfuscate_amount(
                 COALESCE(s.total_damage, 0)::numeric, m.pct,
                 s.guild_code || '|' || s.season::text || '|row')::numeric
               / s.total_damage::numeric
        -- The view's own fallback: a row that obfuscates but has no total
        -- still needs a factor. Same seed, so it is the same draw.
        ELSE internal.explore_obfuscate_amount(
               1000000000::numeric, m.pct,
               s.guild_code || '|' || s.season::text || '|row')::numeric
             / 1000000000::numeric
      END AS factor
    FROM public.public_guild_snapshots s
    CROSS JOIN current_season cs
    CROSS JOIN LATERAL (
      SELECT
        CASE
          WHEN jsonb_typeof(s.explore_privacy_mode) = 'array' THEN s.explore_privacy_mode
          WHEN jsonb_typeof(s.explore_privacy_mode) = 'string'
            THEN jsonb_build_array(s.explore_privacy_mode)
          ELSE '["public"]'::jsonb
        END AS modes,
        least(30, greatest(1,
          round(COALESCE(s.explore_obfuscation_percent, 10)::numeric)::int)) AS pct
    ) m
    WHERE s.season = cs.season_num
      AND m.modes @> '["obfuscate_values"]'::jsonb
  ),
  served AS (
    SELECT
      CASE WHEN v.modes ? 'hide_players' THEN 'Anonymous Warrior' ELSE v.display_name END AS display_name,
      v.guild_display_name,
      v.cluster_display_name,
      v.battle_count,
      -- PS-291: the FLAG decides, and the factor's absence is not the flag.
      -- guild_config is the switch the guild actually operates; the snapshot
      -- row is included so a guild the snapshot flags is covered too, whichever
      -- of the two is ahead during a refresh. A row that is flagged and has no
      -- factor is served NULL below rather than the truth.
      (v.modes ? 'obfuscate_values' OR f.guild_code IS NOT NULL) AS is_obfuscated,
      CASE WHEN NOT (v.modes ? 'obfuscate_values' OR f.guild_code IS NOT NULL)
             THEN v.total_damage
           WHEN f.factor IS NULL THEN NULL::numeric
           ELSE GREATEST(round(v.total_damage * f.factor), 0::numeric) END AS total_damage,
      CASE WHEN NOT (v.modes ? 'obfuscate_values' OR f.guild_code IS NOT NULL)
             THEN v.avg_damage
           WHEN f.factor IS NULL THEN NULL::numeric
           ELSE GREATEST(round(v.avg_damage * f.factor), 0::numeric) END AS avg_damage,
      CASE WHEN NOT (v.modes ? 'obfuscate_values' OR f.guild_code IS NOT NULL)
             THEN v.max_damage
           WHEN f.factor IS NULL THEN NULL::bigint
           ELSE GREATEST(round(v.max_damage::numeric * f.factor), 0::numeric)::bigint END AS max_damage
    FROM visible v
    LEFT JOIN guild_factor f ON f.guild_code = v.guild_code
  ),
  scored AS (
    -- PS-291: computed from the SERVED amounts. Computing it from the true
    -- ones, as this did, made the score a sharper oracle than the served
    -- total itself.
    SELECT s.*,
      round(
          s.total_damage  / NULLIF(max(s.total_damage)  OVER (), 0::numeric) * 60::numeric
        + s.avg_damage    / NULLIF(max(s.avg_damage)    OVER (), 0::numeric) * 30::numeric
        + s.battle_count::numeric
                          / NULLIF(max(s.battle_count)  OVER (), 0)::numeric * 10::numeric
      , 1) AS performance_score
    FROM served s
  )
  SELECT
    -- PS-291: the ordering key is the served total. Ranking on the true one
    -- bracketed every obfuscated row between its unobfuscated neighbours and
    -- gave away the exact ordering the obfuscation is meant to blur.
    row_number() OVER (ORDER BY m.total_damage DESC NULLS LAST) AS rank,
    m.display_name,
    m.guild_display_name,
    m.cluster_display_name::text AS cluster_display_name,
    m.battle_count,
    m.total_damage,
    m.avg_damage,
    m.max_damage,
    m.performance_score,
    m.is_obfuscated
  FROM scored m
  ORDER BY m.total_damage DESC NULLS LAST
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 10), 1), 25);
$function$;

COMMENT ON FUNCTION public.get_public_global_leaderboard(integer) IS
  'PS-20/PS-254/PS-291: the privacy-aware public leaderboard, and the only global leaderboard anon or authenticated may read. Rows whose guild runs explore_privacy_mode = obfuscate_values are scaled by the SAME per-row factor public.public_guild_snapshots_explore uses -- drawn once per guild from internal.explore_obfuscate_amount() with that view''s seed expression -- so the two surfaces cannot serve two differently-obfuscated values whose ratio recovers the factor. performance_score and the rank ordering are computed from the served amounts, not the true ones: the score is a linear combination of ratios to the set maxima and, computed from the truth, pinned an obfuscated total far more tightly than the served figure did. Whether a row obfuscates is decided by the FLAG -- guild_config, or the season''s snapshot row -- and never by whether a factor happens to exist. A guild that is flagged but has no snapshot row for the season, which is the state refresh_public_guild_snapshots leaves behind for up to a quarter of an hour on every run, has no factor and is served NULL amounts rather than the truth.';

COMMIT;

-- Separate transaction so a failing assertion does not undo the work above.

BEGIN;

DO $verify$
DECLARE
  v_role  text;
  v_bad   integer;
  v_owner text;
  v_acl   text;
BEGIN
  -- (a) The showcase RPC is closed to the public roles and still exists.
  IF to_regprocedure('public.get_guild_showcase(text)') IS NULL THEN
    RAISE EXCEPTION 'PS-291 verify (a): get_guild_showcase was dropped; this migration only moves its grants';
  END IF;

  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF has_function_privilege(v_role, 'public.get_guild_showcase(text)', 'EXECUTE') THEN
      RAISE EXCEPTION
        'PS-291 verify (a): % still holds EXECUTE on get_guild_showcase, which serves the true total_damage of obfuscating guilds', v_role;
    END IF;
  END LOOP;

  IF NOT has_function_privilege('service_role', 'public.get_guild_showcase(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'PS-291 verify (a): service_role lost EXECUTE on get_guild_showcase; only the public roles were meant to move';
  END IF;

  -- (b) The raw leaderboard view is closed to the public roles and still
  --     reachable by the backend.
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF has_table_privilege(v_role, 'public.global_leaderboard', 'SELECT') THEN
      RAISE EXCEPTION
        'PS-291 verify (b): % still reads public.global_leaderboard, which serves raw per-player totals with no privacy branch', v_role;
    END IF;
  END LOOP;

  IF NOT has_table_privilege('service_role', 'public.global_leaderboard', 'SELECT') THEN
    RAISE EXCEPTION 'PS-291 verify (b): service_role lost SELECT on public.global_leaderboard; its one repository reader goes through that role';
  END IF;

  -- (c) The public leaderboard RPC kept its identity: same owner, same ACL,
  --     still SECURITY DEFINER, still reachable by the roles that call it.
  SELECT pg_get_userbyid(proowner), coalesce(proacl::text, '')
    INTO v_owner, v_acl
    FROM pg_catalog.pg_proc
   WHERE oid = to_regprocedure('public.get_public_global_leaderboard(integer)');

  IF v_owner <> 'postgres' THEN
    RAISE EXCEPTION 'PS-291 verify (c): get_public_global_leaderboard is now owned by %, not postgres; the helper EXECUTE was granted to the explore view owner', v_owner;
  END IF;

  IF NOT (SELECT prosecdef FROM pg_catalog.pg_proc
           WHERE oid = to_regprocedure('public.get_public_global_leaderboard(integer)')) THEN
    RAISE EXCEPTION 'PS-291 verify (c): get_public_global_leaderboard is no longer SECURITY DEFINER and cannot reach the helper';
  END IF;

  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF NOT has_function_privilege(v_role, 'public.get_public_global_leaderboard(integer)', 'EXECUTE') THEN
      RAISE EXCEPTION
        'PS-291 verify (c): % lost EXECUTE on get_public_global_leaderboard; CREATE OR REPLACE was supposed to preserve the ACL (%)', v_role, v_acl;
    END IF;
  END LOOP;

  -- (d) The helper is still not reachable by anyone but the owner, and the
  --     salt is still not readable. Replacing a carrier must not have opened
  --     the corridor PS-254 closed.
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF has_function_privilege(v_role,
         'internal.explore_obfuscate_amount(numeric, integer, text)', 'EXECUTE') THEN
      RAISE EXCEPTION 'PS-291 verify (d): % can execute internal.explore_obfuscate_amount, which is the inversion oracle', v_role;
    END IF;
    IF has_table_privilege(v_role, 'internal.cron_secrets', 'SELECT') THEN
      RAISE EXCEPTION 'PS-291 verify (d): % can read internal.cron_secrets, where the salt lives', v_role;
    END IF;
  END LOOP;

  -- (e) The factor this function draws is the factor the view serves. This is
  --     the whole point: not "both are obfuscated" but "both are obfuscated
  --     by the same number". Compared as an exact numeric ratio against the
  --     view's own served total over the base total.
  SELECT count(*) INTO v_bad
    FROM public.public_guild_snapshots b
    JOIN public.public_guild_snapshots_explore x
      ON x.guild_code = b.guild_code AND x.season = b.season
    CROSS JOIN LATERAL (
      SELECT least(30, greatest(1,
        round(COALESCE(b.explore_obfuscation_percent, 10)::numeric)::int)) AS pct
    ) m
   WHERE (CASE
            WHEN jsonb_typeof(b.explore_privacy_mode) = 'array' THEN b.explore_privacy_mode
            WHEN jsonb_typeof(b.explore_privacy_mode) = 'string'
              THEN jsonb_build_array(b.explore_privacy_mode)
            ELSE '["public"]'::jsonb
          END) @> '["obfuscate_values"]'::jsonb
     AND COALESCE(b.total_damage, 0) > 0
     AND internal.explore_obfuscate_amount(
           b.total_damage::numeric, m.pct,
           b.guild_code || '|' || b.season::text || '|row')::numeric
         IS DISTINCT FROM x.total_damage::numeric;

  IF v_bad > 0 THEN
    RAISE EXCEPTION
      'PS-291 verify (e): % obfuscating row(s) draw a factor here that differs from the one public_guild_snapshots_explore serves; two factors on one guild leak their ratio', v_bad;
  END IF;

  -- (f) No obfuscating guild is served its true total by the replaced
  --     function, and every served figure sits inside PS-254's band. Read
  --     back through the function itself, as anon reads it.
  SELECT count(*) INTO v_bad
    FROM (
      SELECT b.guild_code, b.total_damage AS truth, m.pct,
             GREATEST(round(b.total_damage::numeric * f.factor), 0::numeric) AS served
        FROM public.public_guild_snapshots b
        CROSS JOIN LATERAL (
          SELECT least(30, greatest(1,
            round(COALESCE(b.explore_obfuscation_percent, 10)::numeric)::int)) AS pct
        ) m
        CROSS JOIN LATERAL (
          SELECT internal.explore_obfuscate_amount(
                   b.total_damage::numeric, m.pct,
                   b.guild_code || '|' || b.season::text || '|row')::numeric
                 / b.total_damage::numeric AS factor
        ) f
       WHERE (CASE
                WHEN jsonb_typeof(b.explore_privacy_mode) = 'array' THEN b.explore_privacy_mode
                WHEN jsonb_typeof(b.explore_privacy_mode) = 'string'
                  THEN jsonb_build_array(b.explore_privacy_mode)
                ELSE '["public"]'::jsonb
              END) @> '["obfuscate_values"]'::jsonb
         AND COALESCE(b.total_damage, 0) > 0
    ) q
   WHERE q.served = q.truth
      OR abs(q.served - q.truth) < floor(q.truth::numeric * q.pct / 200::numeric)
      OR abs(q.served - q.truth) > ceil(q.truth::numeric * q.pct / 100::numeric);

  IF v_bad > 0 THEN
    RAISE EXCEPTION
      'PS-291 verify (f): % obfuscating guild(s) are served their true total, or a value outside the requested band, by the factor this function applies', v_bad;
  END IF;
END;
$verify$;

COMMIT;

-- A stale PostgREST cache would keep serving get_guild_showcase to anon.

NOTIFY pgrst, 'reload schema';
