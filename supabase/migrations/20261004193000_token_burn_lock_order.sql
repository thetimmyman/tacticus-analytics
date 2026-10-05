-- Keep concurrent token-burn state writes in a stable player order.
-- Refuse to replace an unknown function body or altered execution contract.
-- target-db: general
DO $migration$
DECLARE
  v_function_oid oid;
  v_definition text;
  v_source text;
  v_replacement text;
  v_source_sha256 text;
  v_replacement_sha256 text;
  v_owner oid;
  v_security_definer boolean;
  v_config text[];
  v_acl aclitem[];
  v_comment text;
  v_result text;
  v_before_fragment constant text := E'      where player_id is not null\n    ) ts\n';
  v_after_fragment constant text := E'      where player_id is not null\n      order by player_id\n    ) ts\n';
  v_post_anchor_before constant text := E'    if v_season is null then\n      continue;\n    end if;\n\n';
  v_post_anchor_after constant text := E'    perform 1\n    from (\n';
  v_fragment_position integer;
  v_before_anchor_position integer;
  v_after_anchor_position integer;
  v_block text;
  v_prefix text;
  v_suffix text;
  v_normalized_source text;
  v_occurrences integer;
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'token-burn migration requires the General database';
  END IF;

  v_function_oid := to_regprocedure(
    'public.queue_token_burn_notifications(text,text,timestamp with time zone)'
  );
  IF v_function_oid IS NULL THEN
    RAISE EXCEPTION 'expected token-burn function signature is missing';
  END IF;

  SELECT p.proowner, p.prosecdef, p.proconfig, p.proacl,
         obj_description(p.oid, 'pg_proc'), pg_get_function_result(p.oid),
         p.prosrc, pg_get_functiondef(p.oid)
    INTO v_owner, v_security_definer, v_config, v_acl, v_comment, v_result,
         v_source, v_definition
  FROM pg_proc AS p
  WHERE p.oid = v_function_oid;

  v_source_sha256 := encode(
    extensions.digest(convert_to(v_source, 'UTF8'), 'sha256'), 'hex'
  );

  IF v_owner <> 'postgres'::regrole
     OR v_security_definer IS DISTINCT FROM true
     OR v_config IS DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[]
     OR v_result IS DISTINCT FROM 'TABLE(guild_code text, season text, queued_discord integer, queued_in_app integer, queued_total integer)'
     OR NOT EXISTS (
       SELECT 1 FROM pg_proc AS p JOIN pg_language AS l ON l.oid = p.prolang
       WHERE p.oid = v_function_oid AND l.lanname = 'plpgsql'
         AND p.provolatile = 'v' AND p.proparallel = 'u'
         AND NOT p.proisstrict AND NOT p.proleakproof
         AND pg_get_function_arguments(p.oid) =
           'p_guild_code text DEFAULT NULL::text, p_season text DEFAULT NULL::text, p_now timestamp with time zone DEFAULT now()'
     )
     OR NOT (
       SELECT (
         count(*) = 2 AND bool_and(
           x.grantor = 'postgres'::regrole
           AND x.grantee IN ('postgres'::regrole, 'service_role'::regrole)
           AND x.privilege_type = 'EXECUTE' AND NOT x.is_grantable
         )
       ) OR (
         v_source_sha256 IN (
           '0d49cffafd7dcdcda8482f20cdf0908ba6c56743d46d6e20d1c34ba78bd01336',
           'ce3810bb1a3dfc62b88e1920d3f11058f93b93db53031009749d043fe93c1766'
         ) AND count(*) = 3 AND bool_and(
           x.grantor = 'postgres'::regrole
           AND x.grantee IN ('postgres'::regrole, 'authenticated'::regrole, 'service_role'::regrole)
           AND x.privilege_type = 'EXECUTE' AND NOT x.is_grantable
         )
       ) FROM aclexplode(COALESCE(v_acl, acldefault('f', v_owner))) AS x
     ) THEN
    RAISE EXCEPTION 'token-burn function metadata differs from the reviewed contract';
  END IF;

  IF v_source_sha256 = '0d49cffafd7dcdcda8482f20cdf0908ba6c56743d46d6e20d1c34ba78bd01336' THEN
    v_occurrences := (length(v_source) - length(replace(v_source, v_before_fragment, '')))
      / length(v_before_fragment);
    IF v_occurrences <> 1 THEN
      RAISE EXCEPTION 'token-burn function does not contain exactly one reviewed order fragment';
    END IF;

    v_replacement := replace(v_source, v_before_fragment, v_after_fragment);
    v_replacement_sha256 := encode(
      extensions.digest(convert_to(v_replacement, 'UTF8'), 'sha256'), 'hex'
    );
    IF v_replacement_sha256 <> 'ce3810bb1a3dfc62b88e1920d3f11058f93b93db53031009749d043fe93c1766' THEN
      RAISE EXCEPTION 'token-burn function replacement does not match the reviewed definition';
    END IF;

    v_definition := replace(v_definition, v_before_fragment, v_after_fragment);
    EXECUTE v_definition;
  ELSIF v_source_sha256 <> 'ce3810bb1a3dfc62b88e1920d3f11058f93b93db53031009749d043fe93c1766' THEN
    v_before_anchor_position := strpos(v_source, v_post_anchor_before);
    v_after_anchor_position := strpos(v_source, v_post_anchor_after);
    IF v_before_anchor_position = 0 OR v_after_anchor_position = 0
       OR strpos(substr(v_source, v_before_anchor_position + 1), v_post_anchor_before) <> 0
       OR strpos(substr(v_source, v_after_anchor_position + 1), v_post_anchor_after) <> 0
       OR v_after_anchor_position <= v_before_anchor_position + length(v_post_anchor_before) - 1 THEN
      RAISE EXCEPTION 'token-burn function is neither the reviewed baseline nor fixed version';
    END IF;

    v_fragment_position := v_before_anchor_position + length(v_post_anchor_before);
    v_block := substr(v_source, v_fragment_position,
      v_after_anchor_position - v_fragment_position);
    IF octet_length(v_block) > 4096
       OR length(v_block) - length(replace(v_block, E'\n', '')) > 16
       OR right(v_block, 1) <> E'\n'
       OR strpos(v_block, E'\r') <> 0
       OR EXISTS (
         SELECT 1
         FROM regexp_split_to_table(v_block, E'\n') AS lines(value)
         WHERE value !~ E'^[ \\t]*(--.*)?$'
       ) THEN
      RAISE EXCEPTION 'token-burn fixed-version comment block exceeds the reviewed tolerance';
    END IF;

    v_prefix := substr(v_source, 1, v_fragment_position - 1);
    v_suffix := substr(v_source, v_after_anchor_position);
    v_normalized_source := v_prefix || v_suffix;
    IF encode(extensions.digest(convert_to(v_prefix, 'UTF8'), 'sha256'), 'hex')
         <> '46642907fa80c037f975d4b4db985cea9b77feeac91814bd82783d84cfdc84e7'
       OR encode(extensions.digest(convert_to(v_suffix, 'UTF8'), 'sha256'), 'hex')
         <> 'e5522065d5854db4d25ef0260fd4cb305c58a65f250b33276be9bd80bd78e3d7'
       OR encode(extensions.digest(convert_to(v_normalized_source, 'UTF8'), 'sha256'), 'hex')
         <> '14f7a8ee655d4d4300439b362545c6f63b84566406fab9dcf3d43dcd21b3a464' THEN
      RAISE EXCEPTION 'token-burn function differs outside the reviewed comment block';
    END IF;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc AS p
    WHERE p.oid = v_function_oid
      AND p.proowner = v_owner
      AND p.prosecdef IS NOT DISTINCT FROM v_security_definer
      AND p.proconfig IS NOT DISTINCT FROM v_config
      AND p.proacl IS NOT DISTINCT FROM v_acl
      AND obj_description(p.oid, 'pg_proc') IS NOT DISTINCT FROM v_comment
      AND pg_get_function_result(p.oid) IS NOT DISTINCT FROM v_result
      AND (
        (v_source_sha256 = '0d49cffafd7dcdcda8482f20cdf0908ba6c56743d46d6e20d1c34ba78bd01336'
          AND encode(extensions.digest(convert_to(p.prosrc, 'UTF8'), 'sha256'), 'hex')
            = 'ce3810bb1a3dfc62b88e1920d3f11058f93b93db53031009749d043fe93c1766')
        OR (v_source_sha256 <> '0d49cffafd7dcdcda8482f20cdf0908ba6c56743d46d6e20d1c34ba78bd01336'
          AND p.prosrc IS NOT DISTINCT FROM v_source)
      )
  ) THEN
    RAISE EXCEPTION 'token-burn function changed outside the reviewed definition or metadata contract';
  END IF;
END;
$migration$;
