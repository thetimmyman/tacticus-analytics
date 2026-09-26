-- target-db: general
-- auth.identities joins the ban lock protocol: a stale mapping can disagree with
-- GoTrue's Discord identity. The apply runner supplies the transaction.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $precondition$
DECLARE
  v_insert_hash text;
  v_admin_hash text;
BEGIN
  SELECT encode(
           extensions.digest(
             convert_to(pg_get_functiondef(function.oid), 'UTF8'),
             'sha256'
           ),
           'hex'
         )
  INTO STRICT v_insert_hash
  FROM pg_proc AS function
  WHERE function.oid = 'public.serialize_user_ban_subject()'::regprocedure;

  SELECT encode(
           extensions.digest(
             convert_to(pg_get_functiondef(function.oid), 'UTF8'),
             'sha256'
           ),
           'hex'
         )
  INTO STRICT v_admin_hash
  FROM pg_proc AS function
  WHERE function.oid =
    'public.set_player_app_admin_bulk(uuid[],boolean)'::regprocedure;

  IF v_insert_hash IS DISTINCT FROM
       'ca7826385d05074be56d98648e1f3956022e545a9162f216c4fab2630e7b1a2b'
     OR v_admin_hash IS DISTINCT FROM
       '31217e7d4dd9d4a4e4a43c523c1a32d51e8ade1e936341fdd74c5e62a985b894'
  THEN
    RAISE EXCEPTION
      'provider ban serialization: predecessor definition drifted';
  END IF;
END;
$precondition$;

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
     AND (
       EXISTS (
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
       )
       OR (
         NEW.subject_type = 'discord_user_id'
         AND EXISTS (
           SELECT 1
           FROM auth.identities AS identity
           JOIN public.player_mapping AS identity_owner
             ON identity_owner.user_id = identity.user_id
            AND identity_owner.is_current IS TRUE
            AND identity_owner.is_app_admin IS TRUE
           WHERE identity.provider = 'discord'
             AND lower(btrim(coalesce(
               nullif(identity.provider_id, ''),
               identity.identity_data ->> 'provider_id',
               identity.identity_data ->> 'sub',
               identity.identity_data ->> 'id'
             ))) = NEW.subject_value
         )
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

CREATE OR REPLACE FUNCTION public.prevent_active_ban_auth_identity_binding()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_discord_user_id text;
BEGIN
  IF NEW.user_id IS NULL OR lower(NEW.provider) <> 'discord' THEN
    RETURN NEW;
  END IF;

  v_discord_user_id := lower(btrim(coalesce(
    nullif(NEW.provider_id, ''),
    NEW.identity_data ->> 'provider_id',
    NEW.identity_data ->> 'sub',
    NEW.identity_data ->> 'id',
    ''
  )));
  IF v_discord_user_id = '' THEN
    RETURN NEW;
  END IF;

  PERFORM public.acquire_user_ban_subject_lock(
    'discord_user_id', v_discord_user_id
  );
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
        OR (ban.subject_type = 'discord_user_id'
          AND ban.subject_value = v_discord_user_id)
      )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Account suspended';
  END IF;

  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.prevent_active_ban_auth_identity_binding()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.prevent_active_ban_auth_identity_binding()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS prevent_active_ban_auth_identity_binding
  ON auth.identities;
CREATE TRIGGER prevent_active_ban_auth_identity_binding
  BEFORE INSERT OR UPDATE OF user_id, provider, provider_id, identity_data
  ON auth.identities
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_active_ban_auth_identity_binding();

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
        'discord_user_id',
        lower(btrim(coalesce(
          nullif(identity.provider_id, ''),
          identity.identity_data ->> 'provider_id',
          identity.identity_data ->> 'sub',
          identity.identity_data ->> 'id'
        ))),
        0
      FROM auth.identities AS identity
      WHERE identity.user_id = ANY(v_user_ids)
        AND identity.provider = 'discord'
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

  IF p_is_app_admin AND (
    EXISTS (
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
    )
    OR EXISTS (
      SELECT 1
      FROM auth.identities AS identity
      JOIN public.user_bans AS ban
        ON ban.subject_type = 'discord_user_id'
       AND ban.subject_value = lower(btrim(coalesce(
         nullif(identity.provider_id, ''),
         identity.identity_data ->> 'provider_id',
         identity.identity_data ->> 'sub',
         identity.identity_data ->> 'id'
       )))
      WHERE identity.user_id = ANY(v_user_ids)
        AND identity.provider = 'discord'
        AND ban.lifted_at IS NULL
        AND (ban.expires_at IS NULL OR ban.expires_at > now())
    )
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
BEGIN
  IF pg_get_functiondef(
       'public.serialize_user_ban_subject()'::regprocedure
     ) !~ 'auth.identities'
     OR pg_get_functiondef(
       'public.set_player_app_admin_bulk(uuid[],boolean)'::regprocedure
     ) !~ 'auth.identities'
     OR pg_get_functiondef(
       'public.prevent_active_ban_auth_identity_binding()'::regprocedure
     ) !~ 'acquire_user_ban_subject_lock'
     OR NOT EXISTS (
       SELECT 1
       FROM pg_trigger AS trigger
       WHERE trigger.tgrelid = 'auth.identities'::regclass
         AND trigger.tgname = 'prevent_active_ban_auth_identity_binding'
         AND NOT trigger.tgisinternal
         AND trigger.tgenabled = 'O'
     )
  THEN
    RAISE EXCEPTION 'provider ban serialization: postcondition failed';
  END IF;
END;
$postcondition$;

NOTIFY pgrst, 'reload schema';
