-- target-db: general
-- Identity binding and ban insertion share an advisory lock so a ban cannot commit
-- after the binding's check. The apply runner supplies the transaction.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $precondition$
DECLARE
  v_definition_hash text;
  v_admin_function_hash text;
BEGIN
  IF pg_catalog.to_regprocedure(
       'public.prevent_active_ban_identity_binding()'
     ) IS NULL THEN
    RAISE EXCEPTION
      'ban binding serialization: identity-binding guard is absent';
  END IF;

  SELECT pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.pg_get_functiondef(function.oid),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  )
  INTO STRICT v_definition_hash
  FROM pg_catalog.pg_proc AS function
  WHERE function.oid =
    'public.prevent_active_ban_identity_binding()'::regprocedure;

  IF pg_catalog.to_regprocedure(
       'public.set_player_app_admin_bulk(uuid[],boolean)'
     ) IS NULL THEN
    RAISE EXCEPTION
      'ban binding serialization: app-admin transition function is absent';
  END IF;

  SELECT pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.pg_get_functiondef(function.oid),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  )
  INTO STRICT v_admin_function_hash
  FROM pg_catalog.pg_proc AS function
  WHERE function.oid =
    'public.set_player_app_admin_bulk(uuid[],boolean)'::regprocedure;

  IF v_definition_hash IS DISTINCT FROM
       '5f65c5d87c5f6d9c396c611025343bbcd7c6fde9e0d15ee66684b9dceb69ad27'
     OR v_admin_function_hash IS DISTINCT FROM
       '5c03c91effdd813d7e8c0fca15289451859a6fe05d63c5ba6823b7b86c501c30'
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_trigger AS existing_trigger
       WHERE existing_trigger.tgrelid = 'public.player_mapping'::regclass
         AND existing_trigger.tgname =
           'prevent_active_ban_identity_binding'
         AND NOT existing_trigger.tgisinternal
         AND existing_trigger.tgenabled = 'O'
     ) THEN
    RAISE EXCEPTION
      'ban binding serialization: unexpected pre-migration posture (binding_hash=%, admin_hash=%)',
      v_definition_hash,
      v_admin_function_hash;
  END IF;
END;
$precondition$;

CREATE OR REPLACE FUNCTION public.acquire_user_ban_subject_lock(
  p_subject_type text,
  p_subject_value text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_subject_type text := lower(btrim(p_subject_type));
  v_subject_value text := lower(btrim(p_subject_value));
BEGIN
  IF v_subject_type NOT IN (
       'user_id', 'email', 'discord_user_id', 'player_id'
     )
     OR v_subject_value = '' THEN
    RAISE EXCEPTION
      'Invalid user-ban subject lock'
      USING ERRCODE = '22023';
  END IF;

  -- Namespace 6210 is dedicated to normalized durable-ban subjects. The
  -- two-int advisory-lock form keeps it separate from the 6208 identity
  -- lifecycle locks and from one-bigint application locks.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    6210,
    pg_catalog.hashtext(v_subject_type || ':' || v_subject_value)
  );
END;
$function$;

ALTER FUNCTION public.acquire_user_ban_subject_lock(text, text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.acquire_user_ban_subject_lock(text, text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.serialize_user_ban_subject()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  PERFORM public.acquire_user_ban_subject_lock(
    NEW.subject_type,
    NEW.subject_value
  );

  IF NEW.lifted_at IS NULL
     AND (NEW.expires_at IS NULL OR NEW.expires_at > pg_catalog.now())
     AND EXISTS (
       SELECT 1
       FROM public.player_mapping AS mapping
       WHERE mapping.is_current IS TRUE
         AND mapping.is_app_admin IS TRUE
         AND (
           (NEW.subject_type = 'user_id'
             AND lower(mapping.user_id::text) = NEW.subject_value)
           OR (NEW.subject_type = 'player_id'
             AND lower(btrim(mapping.player_id)) = NEW.subject_value)
           OR (NEW.subject_type = 'discord_user_id'
             AND lower(btrim(mapping.discord_user_id)) = NEW.subject_value)
         )
     ) THEN
    RAISE EXCEPTION
      'Remove the app admin role from every matched identity owner before banning'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.serialize_user_ban_subject() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.serialize_user_ban_subject()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS serialize_user_ban_subject ON public.user_bans;
CREATE TRIGGER serialize_user_ban_subject
  BEFORE INSERT ON public.user_bans
  FOR EACH ROW
  EXECUTE FUNCTION public.serialize_user_ban_subject();

CREATE OR REPLACE FUNCTION public.prevent_active_ban_identity_binding()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT'
     OR OLD.user_id IS DISTINCT FROM NEW.user_id
     OR OLD.player_id IS DISTINCT FROM NEW.player_id
     OR OLD.discord_user_id IS DISTINCT FROM NEW.discord_user_id THEN
    -- Match the ban route's subject ordering so multi-identifier operations
    -- cannot acquire the same lock set in opposing orders.
    IF NEW.discord_user_id IS NOT NULL THEN
      PERFORM public.acquire_user_ban_subject_lock(
        'discord_user_id', NEW.discord_user_id
      );
    END IF;
    IF NEW.player_id IS NOT NULL THEN
      PERFORM public.acquire_user_ban_subject_lock('player_id', NEW.player_id);
    END IF;
    PERFORM public.acquire_user_ban_subject_lock(
      'user_id', NEW.user_id::text
    );

    IF EXISTS (
      SELECT 1
      FROM public.user_bans AS ban
      WHERE ban.lifted_at IS NULL
        AND (ban.expires_at IS NULL OR ban.expires_at > pg_catalog.now())
        AND (
          (ban.subject_type = 'user_id'
            AND ban.subject_value = lower(NEW.user_id::text))
          OR (NEW.player_id IS NOT NULL
            AND ban.subject_type = 'player_id'
            AND ban.subject_value = lower(btrim(NEW.player_id)))
          OR (NEW.discord_user_id IS NOT NULL
            AND ban.subject_type = 'discord_user_id'
            AND ban.subject_value = lower(btrim(NEW.discord_user_id)))
        )
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '42501',
        MESSAGE = 'Account suspended';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.prevent_active_ban_identity_binding() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.prevent_active_ban_identity_binding()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_player_app_admin_bulk(
  p_user_ids uuid[],
  p_is_app_admin boolean
) RETURNS TABLE(user_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_request_role text := coalesce(
    nullif(nullif(current_setting('role', true), ''), 'none'),
    session_user
  );
  v_user_ids uuid[];
  v_locked_user_ids uuid[];
  v_lock_user_id uuid;
  v_subject record;
BEGIN
  IF v_request_role NOT IN ('service_role', 'postgres') THEN
    RAISE EXCEPTION 'Bulk app-admin update requires service authority'
      USING ERRCODE = '42501';
  END IF;
  IF p_user_ids IS NULL OR cardinality(p_user_ids) < 1
    OR cardinality(p_user_ids) > 500 OR p_is_app_admin IS NULL
    OR array_position(p_user_ids, NULL) IS NOT NULL
  THEN
    RAISE EXCEPTION 'Bulk app-admin update requires 1-500 exact users'
      USING ERRCODE = '22023';
  END IF;
  v_user_ids := ARRAY(
    SELECT DISTINCT supplied.user_id
    FROM unnest(p_user_ids) AS supplied(user_id)
    ORDER BY supplied.user_id
  );
  IF cardinality(v_user_ids) <> cardinality(p_user_ids) THEN
    RAISE EXCEPTION 'Bulk app-admin targets must be unique'
      USING ERRCODE = '22023';
  END IF;

  FOREACH v_lock_user_id IN ARRAY v_user_ids
  LOOP
    PERFORM pg_advisory_xact_lock(6208, hashtext(v_lock_user_id::text));
  END LOOP;

  SELECT coalesce(
           array_agg(DISTINCT locked.user_id ORDER BY locked.user_id),
           ARRAY[]::uuid[]
         )
  INTO v_locked_user_ids
  FROM (
    SELECT mapping.id, mapping.user_id
    FROM public.player_mapping AS mapping
    WHERE mapping.user_id = ANY(v_user_ids)
      AND mapping.is_current IS TRUE
    ORDER BY mapping.id
    FOR UPDATE
  ) AS locked;
  IF v_locked_user_ids IS DISTINCT FROM v_user_ids THEN
    RAISE EXCEPTION 'Bulk app-admin target set is absent or stale'
      USING ERRCODE = '22023';
  END IF;

  -- Serialize the authority transition with every durable identity that can
  -- cover these users. This closes the three-way bind/grant/ban interleaving,
  -- not just the direct grant-versus-ban race checked by the application.
  FOR v_subject IN
    SELECT subjects.subject_type, subjects.subject_value
    FROM (
      SELECT
        'discord_user_id'::text AS subject_type,
        lower(btrim(mapping.discord_user_id)) AS subject_value,
        0 AS lock_order
      FROM public.player_mapping AS mapping
      WHERE mapping.user_id = ANY(v_user_ids)
        AND mapping.is_current IS TRUE
      UNION ALL
      SELECT
        'player_id',
        lower(btrim(mapping.player_id)),
        1
      FROM public.player_mapping AS mapping
      WHERE mapping.user_id = ANY(v_user_ids)
        AND mapping.is_current IS TRUE
      UNION ALL
      SELECT
        'user_id',
        lower(mapping.user_id::text),
        2
      FROM public.player_mapping AS mapping
      WHERE mapping.user_id = ANY(v_user_ids)
        AND mapping.is_current IS TRUE
    ) AS subjects
    WHERE subjects.subject_value IS NOT NULL
      AND subjects.subject_value <> ''
    GROUP BY subjects.subject_type, subjects.subject_value
    ORDER BY min(subjects.lock_order), subjects.subject_value
  LOOP
    PERFORM public.acquire_user_ban_subject_lock(
      v_subject.subject_type,
      v_subject.subject_value
    );
  END LOOP;

  IF p_is_app_admin AND EXISTS (
    SELECT 1
    FROM public.player_mapping AS mapping
    JOIN public.user_bans AS ban
      ON (
        (ban.subject_type = 'user_id'
          AND ban.subject_value = lower(mapping.user_id::text))
        OR (ban.subject_type = 'player_id'
          AND ban.subject_value = lower(btrim(mapping.player_id)))
        OR (ban.subject_type = 'discord_user_id'
          AND ban.subject_value = lower(btrim(mapping.discord_user_id)))
      )
    WHERE mapping.user_id = ANY(v_user_ids)
      AND mapping.is_current IS TRUE
      AND ban.lifted_at IS NULL
      AND (ban.expires_at IS NULL OR ban.expires_at > now())
  ) THEN
    RAISE EXCEPTION 'Cannot grant app admin access to an actively banned user'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH updated AS (
    UPDATE public.player_mapping AS mapping
    SET is_app_admin = p_is_app_admin,
        updated_at = clock_timestamp()
    WHERE mapping.user_id = ANY(v_user_ids)
      AND mapping.is_current IS TRUE
    RETURNING mapping.user_id
  )
  SELECT DISTINCT updated.user_id
  FROM updated
  ORDER BY updated.user_id;
END;
$function$;

ALTER FUNCTION public.set_player_app_admin_bulk(uuid[], boolean)
  OWNER TO postgres;

DO $postcondition$
DECLARE
  v_lock_config text[];
  v_insert_config text[];
  v_binding_config text[];
  v_admin_config text[];
BEGIN
  SELECT function.proconfig
  INTO STRICT v_lock_config
  FROM pg_catalog.pg_proc AS function
  WHERE function.oid =
    'public.acquire_user_ban_subject_lock(text,text)'::regprocedure;

  SELECT function.proconfig
  INTO STRICT v_insert_config
  FROM pg_catalog.pg_proc AS function
  WHERE function.oid =
    'public.serialize_user_ban_subject()'::regprocedure;

  SELECT function.proconfig
  INTO STRICT v_binding_config
  FROM pg_catalog.pg_proc AS function
  WHERE function.oid =
    'public.prevent_active_ban_identity_binding()'::regprocedure;

  SELECT function.proconfig
  INTO STRICT v_admin_config
  FROM pg_catalog.pg_proc AS function
  WHERE function.oid =
    'public.set_player_app_admin_bulk(uuid[],boolean)'::regprocedure;

  IF v_lock_config IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
     OR v_insert_config IS DISTINCT FROM
       ARRAY['search_path=pg_catalog, public']::text[]
     OR v_binding_config IS DISTINCT FROM
       ARRAY['search_path=pg_catalog, public']::text[]
     OR v_admin_config IS DISTINCT FROM
       ARRAY['search_path=pg_catalog, public']::text[]
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_trigger AS existing_trigger
       WHERE existing_trigger.tgrelid = 'public.user_bans'::regclass
         AND existing_trigger.tgname = 'serialize_user_ban_subject'
         AND NOT existing_trigger.tgisinternal
         AND existing_trigger.tgenabled = 'O'
     )
     OR pg_catalog.has_function_privilege(
       'authenticated',
       'public.acquire_user_ban_subject_lock(text,text)',
       'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'service_role',
       'public.serialize_user_ban_subject()',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION
      'ban binding serialization: postcondition failed';
  END IF;
END;
$postcondition$;

NOTIFY pgrst, 'reload schema';
