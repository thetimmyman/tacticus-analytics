-- Local development seed (npm run supabase:reset). Synthetic only: no production
-- values, real player identifiers or API keys.

BEGIN;

-- Production canary: encrypted API keys exist only in a real deployment.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.guild_config
    WHERE api_key_encrypted IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'seed.sql aborted: guild_config holds live credentials, so this is not a local dev database';
  END IF;
END $$;

-- Features fail closed by default; without this the local app is an empty shell.
UPDATE public.feature_releases
SET release_stage = 'public',
    released_at   = COALESCE(released_at, now()),
    updated_at    = now()
WHERE release_stage <> 'public';

INSERT INTO public.clusters (
  cluster_code, display_name, short_name, description,
  is_active, is_public, max_guilds, primary_language
)
SELECT 'DEVC', 'Dev Cluster', 'DEV',
       'Synthetic cluster for local development. Not a real guild group.',
       true, true, 10, 'en'
WHERE NOT EXISTS (SELECT 1 FROM public.clusters WHERE cluster_code = 'DEVC');

INSERT INTO public.guild_config (
  guild_code, display_name, cluster_code, cluster_id, cluster_role,
  enabled, auto_sync_enabled, "GR_Ranking", description
)
SELECT g.guild_code, g.display_name, 'DEVC', c.id, g.cluster_role,
       true, false, g.rank,
       'Synthetic guild for local development.'
FROM (VALUES
  ('DEV001', 'Dev Guild Alpha', 'leader', 1),
  ('DEV002', 'Dev Guild Beta',  'member', 2),
  ('DEV003', 'Dev Guild Gamma', 'member', 3)
) AS g(guild_code, display_name, cluster_role, rank)
CROSS JOIN (SELECT id FROM public.clusters WHERE cluster_code = 'DEVC') AS c
WHERE NOT EXISTS (
  SELECT 1 FROM public.guild_config gc WHERE gc.guild_code = g.guild_code
);

-- Two seasons x three guilds x 24 players x four bosses x three encounters. Keep
-- kill and partial rows: flat data hides metrics that wrongly filter on remainingHp > 0.
WITH bosses AS (
  SELECT * FROM (VALUES
    ('Ghazghkull',     0, 'Ghazghkull',       'Boss',     1),
    ('Ghazghkull',     1, 'Big Mek',          'SideBoss', 1),
    ('Ghazghkull',     2, 'Ork Nob',          'SideBoss', 1),
    ('AvatarOfKhaine', 0, 'Avatar of Khaine', 'Boss',     2),
    ('AvatarOfKhaine', 1, 'Autarch',          'SideBoss', 2),
    ('AvatarOfKhaine', 2, 'Farseer',          'SideBoss', 2),
    ('Magnus',         1, 'Sorcerer',         'SideBoss', 3),
    ('Magnus',         2, 'Infernal Master',  'SideBoss', 3),
    ('Lion',           0, 'Lion El''Jonson',  'Boss',     4),
    ('Lion',           1, 'Baraqiel',         'SideBoss', 4),
    ('Lion',           2, 'Forcas',           'SideBoss', 4)
  ) AS b(boss_type, encounter_index, boss_name, encounter_type, boss_ord)
),
seasons AS (
  -- "Season" must be a bare digit string, or the GENERATED season_num is NULL.
  SELECT * FROM (VALUES
    (109, '109', TIMESTAMPTZ '2026-06-01 00:00:00+00'),
    (110, '110', TIMESTAMPTZ '2026-07-01 00:00:00+00')
  ) AS s(season_num, season_label, season_start)
),
guilds AS (
  SELECT guild_code, cluster_code, cluster_id,
         ROW_NUMBER() OVER (ORDER BY guild_code) AS guild_ord
  FROM public.guild_config
  WHERE guild_code IN ('DEV001', 'DEV002', 'DEV003')
),
players AS (
  SELECT g.guild_code, g.cluster_code, g.cluster_id, g.guild_ord,
         p AS player_ord,
         format('DevPlayer%s-%s', g.guild_ord, lpad(p::text, 2, '0')) AS display_name,
         md5(format('dev-user-%s-%s', g.guild_code, p))              AS user_id
  FROM guilds g
  CROSS JOIN generate_series(1, 24) AS p
),
raw AS (
  SELECT
    pl.guild_code, pl.cluster_code, pl.cluster_id,
    pl.display_name, pl.user_id,
    s.season_num, s.season_label, s.season_start,
    b.boss_type, b.boss_name, b.encounter_index, b.encounter_type, b.boss_ord,
    loop.idx AS loop_index,
    -- Deterministic jitter: the same seed regenerates the same database.
    (('x' || substr(md5(format('%s|%s|%s|%s|%s',
        pl.user_id, s.season_num, b.boss_type, b.encounter_index, loop.idx
     )), 1, 8))::bit(32)::bigint) AS h
  FROM players pl
  CROSS JOIN seasons s
  CROSS JOIN bosses b
  CROSS JOIN generate_series(0, 2) AS loop(idx)
  -- Running this file twice by hand must not double the rows.
  WHERE NOT EXISTS (
    SELECT 1 FROM public."EOT_GR_data" e WHERE e."Guild" IN ('DEV001','DEV002','DEV003')
  )
),
thinned AS (
  SELECT *,
         (h % 100)                              AS pct,
         3 + (h % 2)::int                       AS tier,
         (h % 5)::int                           AS set_index,
         CASE WHEN h % 100 < 8 THEN 'Bomb' ELSE 'Battle' END AS damage_type,
         CASE (h / 7) % 3 WHEN 0 THEN 'Legendary' WHEN 1 THEN 'Mythic' ELSE 'Epic' END AS rarity,
         ((4000000 + (h % 9000000)) * CASE WHEN encounter_index = 0 THEN 2 ELSE 1 END)::bigint AS damage_dealt
  FROM raw
  WHERE (h % 100) < 55
),
scored AS (
  SELECT *,
         -- About a fifth of rows are kills; keep both classes non-empty if retuned.
         (CASE WHEN encounter_index = 0 THEN 220000000 ELSE 90000000 END)::bigint AS max_hp,
         SUM(damage_dealt) OVER (
           PARTITION BY guild_code, season_num, boss_type, encounter_index, loop_index
           ORDER BY user_id
           ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
         ) AS cumulative_damage,
         ROW_NUMBER() OVER (
           PARTITION BY guild_code, season_num, boss_type, encounter_index, loop_index
           ORDER BY user_id
         ) AS hit_ord
  FROM thinned
)
INSERT INTO public."EOT_GR_data" (
  -- season_num is omitted deliberately: it is GENERATED ALWAYS from "Season".
  "Guild", "Season", "displayName", "userId", "Name",
  "damageType", "damageDealt", "loopIndex", tier, "set",
  "startedOn", "completedOn", "timestamp",
  "encounterId", "encounterIndex", "encounterType", "type",
  rarity, "maxHp", "remainingHp", cluster_code, cluster_id
)
SELECT
  guild_code,
  season_label,
  display_name,
  user_id,
  boss_name,
  damage_type,
  damage_dealt,
  loop_index,
  tier,
  set_index,
  season_start + (hit_ord * INTERVAL '37 minutes') + (loop_index * INTERVAL '4 days'),
  season_start + (hit_ord * INTERVAL '37 minutes') + (loop_index * INTERVAL '4 days') + INTERVAL '3 minutes',
  season_start + (hit_ord * INTERVAL '37 minutes') + (loop_index * INTERVAL '4 days') + INTERVAL '3 minutes',
  season_num * 1000 + boss_ord * 10 + encounter_index,
  encounter_index,
  encounter_type,
  boss_type,
  rarity,
  max_hp,
  GREATEST(0, max_hp - cumulative_damage),
  cluster_code,
  cluster_id
FROM scored;

COMMIT;

DO $$
DECLARE
  v_rows bigint;
  v_kills bigint;
  v_features bigint;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE "remainingHp" = 0)
    INTO v_rows, v_kills FROM public."EOT_GR_data";
  SELECT count(*) INTO v_features
    FROM public.feature_releases WHERE release_stage = 'public';
  RAISE NOTICE 'seed: % battle rows (% kill rows), % features public, 3 guilds in cluster DEVC',
    v_rows, v_kills, v_features;
END $$;
