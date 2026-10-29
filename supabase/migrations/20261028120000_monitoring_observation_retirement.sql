-- target-db: general
-- Generic retirement of one cleared monitoring observation that a complete,
-- freshly observed inventory proves absent. monitoring.alert_state stays
-- authoritative; nothing here creates it or writes a probe, notification,
-- expectation, policy or tracking row.

-- Validation completes before mutation. The active row is locked FOR UPDATE,
-- re-checked as a full-row compare-and-swap, archived complete, then deleted
-- only when exactly that unchanged row was removed. An exact replay returns
-- the existing audit identity; anything else refuses without writing.
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
SET LOCAL statement_timeout = '30s';

-- monitoring.alert_state is authoritative and already exists. Creating it here
-- would fork the source of truth, so its absence is a hard refusal.
DO $pre$
BEGIN
  IF to_regclass('monitoring.alert_state') IS NULL THEN
    RAISE EXCEPTION
      'monitoring.alert_state is required; this migration never creates it';
  END IF;
  IF (
    SELECT count(*)
    FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = 'monitoring.alert_state'::regclass
      AND NOT a.attisdropped
      AND a.attname = ANY (ARRAY[
        'alert_key', 'status', 'since', 'last_seen_at', 'last_title', 'last_body'
      ])
  ) <> 6 THEN
    RAISE EXCEPTION
      'monitoring.alert_state is missing a baseline observation column; inspect before applying';
  END IF;
END;
$pre$;

CREATE TABLE monitoring.alert_retirement (
  id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  alert_key text NOT NULL,
  original_row jsonb NOT NULL,
  absence_evidence jsonb NOT NULL,
  reason text NOT NULL,
  actor text NOT NULL,
  retired_at timestamp with time zone NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT alert_retirement_pkey PRIMARY KEY (id),
  CONSTRAINT alert_retirement_reason_check CHECK (btrim(reason) <> ''),
  CONSTRAINT alert_retirement_original_row_check CHECK (jsonb_typeof(original_row) = 'object'),
  CONSTRAINT alert_retirement_absence_evidence_check CHECK (jsonb_typeof(absence_evidence) = 'object')
);

CREATE INDEX alert_retirement_alert_key_idx
  ON monitoring.alert_retirement (alert_key);

ALTER TABLE monitoring.alert_retirement ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE monitoring.alert_retirement FROM PUBLIC;
REVOKE ALL ON TABLE monitoring.alert_retirement FROM anon;
REVOKE ALL ON TABLE monitoring.alert_retirement FROM authenticated;
REVOKE ALL ON TABLE monitoring.alert_retirement FROM service_role;

CREATE FUNCTION monitoring.retire_absent_observation(
  p_alert_key text,
  p_expected_row jsonb,
  p_evidence jsonb,
  p_reason text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
VOLATILE
SET search_path TO pg_catalog
AS $function$
DECLARE
  v_clock timestamp with time zone := pg_catalog.clock_timestamp();
  v_row jsonb;
  v_audit_id uuid;
  v_archived integer;
  v_deleted integer;
  v_observed_at timestamp with time zone;
  v_target jsonb;
  v_inventory jsonb;
  v_member jsonb;
  v_member_id text;
  v_identity text;
  v_target_identities text[];
  v_member_identities text[] := ARRAY[]::text[];
BEGIN
  -- Runtime twin of the migration guard: this API never runs outside General.
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION
      'Monitoring observation retirement requires database postgres'
      USING ERRCODE = '55000';
  END IF;

  IF p_alert_key IS NULL
     OR length(p_alert_key) NOT BETWEEN 1 AND 200
     OR p_alert_key IS DISTINCT FROM btrim(p_alert_key)
     OR p_alert_key ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'alert key must be a bounded nonempty identifier'
      USING ERRCODE = '22023';
  END IF;

  IF p_reason IS NULL OR btrim(p_reason) = '' OR length(p_reason) > 1000 THEN
    RAISE EXCEPTION 'reason must be a nonempty bounded string'
      USING ERRCODE = '22023';
  END IF;

  IF p_expected_row IS NULL OR jsonb_typeof(p_expected_row) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'exact expected row must be the complete observation object'
      USING ERRCODE = '22023';
  END IF;

  -- Evidence is validated in full before the row is read, locked or written.
  IF p_evidence IS NULL OR jsonb_typeof(p_evidence) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'absence evidence must be an object'
      USING ERRCODE = '22023';
  END IF;

  IF (SELECT count(*) FROM jsonb_object_keys(p_evidence)) <> 5
     OR NOT (p_evidence ?& ARRAY['version', 'producer', 'observed_at', 'target', 'inventory']) THEN
    RAISE EXCEPTION
      'absence evidence must contain exactly version, producer, observed_at, target and inventory'
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(p_evidence->'version') IS DISTINCT FROM 'number'
     OR (p_evidence->'version') IS DISTINCT FROM '1'::jsonb THEN
    RAISE EXCEPTION 'absence evidence version must be exactly 1'
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(p_evidence->'producer') IS DISTINCT FROM 'string'
     OR (p_evidence->>'producer') !~ '^[a-z0-9][a-z0-9._-]{0,62}$' THEN
    RAISE EXCEPTION 'evidence producer must be a bounded lowercase slug'
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(p_evidence->'observed_at') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'evidence observed_at must be a timestamp string'
      USING ERRCODE = '22007';
  END IF;
  IF length(p_evidence->>'observed_at') > 40
     OR (p_evidence->>'observed_at') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$' THEN
    RAISE EXCEPTION 'evidence observed_at must be an explicit ISO timestamp'
      USING ERRCODE = '22007';
  END IF;
  BEGIN
    v_observed_at := (p_evidence->>'observed_at')::timestamp with time zone;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'evidence observed_at must be a valid timestamp'
      USING ERRCODE = '22007';
  END;
  IF v_observed_at > v_clock + interval '30 seconds' THEN
    RAISE EXCEPTION 'evidence observed_at is too far in the future'
      USING ERRCODE = '22023';
  END IF;
  IF v_observed_at < v_clock - interval '15 minutes' THEN
    RAISE EXCEPTION 'evidence observed_at is too old'
      USING ERRCODE = '22023';
  END IF;

  IF pg_catalog.pg_column_size(p_evidence) > 131072 THEN
    RAISE EXCEPTION 'absence evidence is too large' USING ERRCODE = '22023';
  END IF;

  v_target := p_evidence->'target';
  IF jsonb_typeof(v_target) IS DISTINCT FROM 'object'
     OR (SELECT count(*) FROM jsonb_object_keys(v_target)) <> 5
     OR NOT (v_target ?& ARRAY['kind', 'id', 'aliases', 'checked', 'present']) THEN
    RAISE EXCEPTION
      'evidence target must contain exactly kind, id, aliases, checked and present'
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(v_target->'kind') IS DISTINCT FROM 'string'
     OR (v_target->>'kind') !~ '^[a-z0-9][a-z0-9._-]{0,62}$' THEN
    RAISE EXCEPTION 'evidence target kind must be a bounded lowercase slug'
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(v_target->'id') IS DISTINCT FROM 'string'
     OR length(v_target->>'id') IS NULL
     OR length(v_target->>'id') NOT BETWEEN 1 AND 200
     OR (v_target->>'id') IS DISTINCT FROM btrim(v_target->>'id')
     OR (v_target->>'id') ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'evidence target id must be a bounded nonempty identifier'
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(v_target->'aliases') IS DISTINCT FROM 'array'
     OR jsonb_array_length(v_target->'aliases') NOT BETWEEN 1 AND 32 THEN
    RAISE EXCEPTION 'evidence target aliases must be a nonempty string array'
      USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_target->'aliases') AS alias
    WHERE jsonb_typeof(alias) IS DISTINCT FROM 'string'
       OR length(alias #>> '{}') IS NULL
       OR length(alias #>> '{}') NOT BETWEEN 1 AND 200
       OR (alias #>> '{}') IS DISTINCT FROM btrim(alias #>> '{}')
       OR (alias #>> '{}') ~ '[[:cntrl:]]'
  ) THEN
    RAISE EXCEPTION 'evidence target aliases must be bounded nonempty identifiers'
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(v_target->'checked') IS DISTINCT FROM 'boolean'
     OR (v_target->'checked') IS DISTINCT FROM 'true'::jsonb THEN
    RAISE EXCEPTION 'evidence target checked must be true'
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(v_target->'present') IS DISTINCT FROM 'boolean'
     OR (v_target->'present') IS DISTINCT FROM 'false'::jsonb THEN
    RAISE EXCEPTION 'evidence target present must be false'
      USING ERRCODE = '22023';
  END IF;

  SELECT ARRAY(
    SELECT DISTINCT lower(identity)
    FROM (
      SELECT v_target->>'id' AS identity
      UNION ALL
      SELECT jsonb_array_elements_text(v_target->'aliases')
    ) AS target_identity
  ) INTO v_target_identities;

  v_inventory := p_evidence->'inventory';
  IF jsonb_typeof(v_inventory) IS DISTINCT FROM 'object'
     OR (SELECT count(*) FROM jsonb_object_keys(v_inventory)) <> 3
     OR NOT (v_inventory ?& ARRAY['scope', 'complete', 'members']) THEN
    RAISE EXCEPTION
      'evidence inventory must contain exactly scope, complete and members'
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(v_inventory->'scope') IS DISTINCT FROM 'string'
     OR length(v_inventory->>'scope') IS NULL
     OR length(v_inventory->>'scope') NOT BETWEEN 1 AND 200
     OR (v_inventory->>'scope') IS DISTINCT FROM btrim(v_inventory->>'scope')
     OR (v_inventory->>'scope') ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'evidence inventory scope must be a bounded nonempty identifier'
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(v_inventory->'complete') IS DISTINCT FROM 'boolean'
     OR (v_inventory->'complete') IS DISTINCT FROM 'true'::jsonb THEN
    RAISE EXCEPTION 'evidence inventory complete must be true'
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(v_inventory->'members') IS DISTINCT FROM 'array'
     OR jsonb_array_length(v_inventory->'members') NOT BETWEEN 1 AND 256 THEN
    RAISE EXCEPTION 'evidence inventory members must be a nonempty array'
      USING ERRCODE = '22023';
  END IF;

  FOR v_member IN
    SELECT member
    FROM jsonb_array_elements(v_inventory->'members') AS member
  LOOP
    IF jsonb_typeof(v_member) IS DISTINCT FROM 'object'
       OR (SELECT count(*) FROM jsonb_object_keys(v_member)) <> 2
       OR NOT (v_member ?& ARRAY['id', 'aliases']) THEN
      RAISE EXCEPTION 'inventory member must contain exactly id and aliases'
        USING ERRCODE = '22023';
    END IF;

    v_member_id := v_member->>'id';
    IF jsonb_typeof(v_member->'id') IS DISTINCT FROM 'string'
       OR length(v_member_id) IS NULL
       OR length(v_member_id) NOT BETWEEN 1 AND 200
       OR v_member_id IS DISTINCT FROM btrim(v_member_id)
       OR v_member_id ~ '[[:cntrl:]]' THEN
      RAISE EXCEPTION 'inventory member id must be a bounded nonempty identifier'
        USING ERRCODE = '22023';
    END IF;

    IF jsonb_typeof(v_member->'aliases') IS DISTINCT FROM 'array'
       OR jsonb_array_length(v_member->'aliases') NOT BETWEEN 1 AND 32 THEN
      RAISE EXCEPTION 'inventory member aliases must be a nonempty string array'
        USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(v_member->'aliases') AS alias
      WHERE jsonb_typeof(alias) IS DISTINCT FROM 'string'
         OR length(alias #>> '{}') IS NULL
         OR length(alias #>> '{}') NOT BETWEEN 1 AND 200
         OR (alias #>> '{}') IS DISTINCT FROM btrim(alias #>> '{}')
         OR (alias #>> '{}') ~ '[[:cntrl:]]'
    ) THEN
      RAISE EXCEPTION 'inventory member aliases must be bounded nonempty identifiers'
        USING ERRCODE = '22023';
    END IF;

    -- A member may repeat its own id as an alias; that is the same identity.
    -- Distinct members may never share an id or alias, case-insensitively.
    FOR v_identity IN
      SELECT DISTINCT lower(identity)
      FROM (
        SELECT v_member_id AS identity
        UNION ALL
        SELECT jsonb_array_elements_text(v_member->'aliases')
      ) AS member_identity
    LOOP
      IF v_identity = ANY (v_member_identities) THEN
        RAISE EXCEPTION 'inventory identities are duplicate or ambiguous'
          USING ERRCODE = '22023';
      END IF;
      v_member_identities := array_append(v_member_identities, v_identity);
    END LOOP;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM unnest(v_target_identities) AS target_identity
    JOIN unnest(v_member_identities) AS member_identity
      ON member_identity = target_identity
  ) THEN
    RAISE EXCEPTION 'target identity is present in the complete inventory'
      USING ERRCODE = '22023';
  END IF;

  -- Block concurrent dependency DDL without blocking normal row writers.
  LOCK TABLE monitoring.alert_state IN ROW EXCLUSIVE MODE;

  -- Only this table's own dependencies are unsupported. Triggers elsewhere in
  -- the schema are none of this API's business.
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger AS trigger
    WHERE trigger.tgrelid = 'monitoring.alert_state'::regclass
      AND NOT trigger.tgisinternal
  ) THEN
    RAISE EXCEPTION 'monitoring.alert_state has a user trigger; retirement is refused'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.contype = 'f'
      AND (constraint_row.conrelid = 'monitoring.alert_state'::regclass
           OR constraint_row.confrelid = 'monitoring.alert_state'::regclass)
  ) THEN
    RAISE EXCEPTION 'monitoring.alert_state participates in a foreign key; retirement is refused'
      USING ERRCODE = '55000';
  END IF;

  SELECT to_jsonb(observation) INTO v_row
  FROM monitoring.alert_state AS observation
  WHERE observation.alert_key = p_alert_key
  FOR UPDATE;

  IF NOT FOUND THEN
    -- A missing active row is not success. Only an exact, already archived
    -- retirement for this key and this same full row is an idempotent replay.
    SELECT count(*), (array_agg(retirement.id))[1]
      INTO v_archived, v_audit_id
    FROM monitoring.alert_retirement AS retirement
    WHERE retirement.alert_key = p_alert_key
      AND retirement.original_row = p_expected_row;

    IF v_archived = 0 THEN
      RAISE EXCEPTION
        'no active observation and no matching archived retirement for this exact row'
        USING ERRCODE = '55000';
    ELSIF v_archived > 1 THEN
      RAISE EXCEPTION
        'multiple archived retirements match this key and row; refusing to choose'
        USING ERRCODE = '55000';
    END IF;

    RETURN v_audit_id;
  END IF;

  IF v_row->>'status' IS DISTINCT FROM 'cleared' THEN
    RAISE EXCEPTION 'only a cleared observation can be retired'
      USING ERRCODE = '55000';
  END IF;

  IF v_row IS DISTINCT FROM p_expected_row THEN
    RAISE EXCEPTION 'expected row does not match the locked observation'
      USING ERRCODE = '55000';
  END IF;

  INSERT INTO monitoring.alert_retirement (
    alert_key, original_row, absence_evidence, reason, actor, retired_at
  ) VALUES (
    p_alert_key, v_row, p_evidence, p_reason, current_user, pg_catalog.clock_timestamp()
  )
  RETURNING id INTO v_audit_id;

  DELETE FROM monitoring.alert_state AS observation
  WHERE observation.alert_key = p_alert_key
    AND pg_catalog.to_jsonb(observation) IS NOT DISTINCT FROM v_row;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  IF v_deleted <> 1 THEN
    RAISE EXCEPTION 'locked observation changed during retirement'
      USING ERRCODE = '55000';
  END IF;

  RETURN v_audit_id;
END;
$function$;

REVOKE ALL ON FUNCTION monitoring.retire_absent_observation(text, jsonb, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION monitoring.retire_absent_observation(text, jsonb, jsonb, text) FROM anon;
REVOKE ALL ON FUNCTION monitoring.retire_absent_observation(text, jsonb, jsonb, text) FROM authenticated;
REVOKE ALL ON FUNCTION monitoring.retire_absent_observation(text, jsonb, jsonb, text) FROM service_role;

-- Default privileges may name roles directly. Remove those grants only from
-- these new objects, preserving all existing schema and observation rights.
DO $acl$
DECLARE
  recipient record;
  role_sql text;
BEGIN
  FOR recipient IN
    SELECT DISTINCT a.grantee
    FROM pg_catalog.pg_class c,
         LATERAL pg_catalog.aclexplode(coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))) a
    WHERE c.oid = 'monitoring.alert_retirement'::regclass AND a.grantee <> c.relowner
  LOOP
    role_sql := CASE WHEN recipient.grantee = 0 THEN 'PUBLIC'
      ELSE pg_catalog.quote_ident(pg_catalog.pg_get_userbyid(recipient.grantee)) END;
    EXECUTE 'REVOKE ALL ON TABLE monitoring.alert_retirement FROM ' || role_sql;
  END LOOP;
  FOR recipient IN
    SELECT DISTINCT a.grantee
    FROM pg_catalog.pg_proc p,
         LATERAL pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
    WHERE p.oid = 'monitoring.retire_absent_observation(text,jsonb,jsonb,text)'::regprocedure
      AND a.grantee <> p.proowner
  LOOP
    role_sql := CASE WHEN recipient.grantee = 0 THEN 'PUBLIC'
      ELSE pg_catalog.quote_ident(pg_catalog.pg_get_userbyid(recipient.grantee)) END;
    EXECUTE 'REVOKE ALL ON FUNCTION monitoring.retire_absent_observation(text,jsonb,jsonb,text) FROM ' || role_sql;
  END LOOP;
END;
$acl$;

COMMENT ON TABLE monitoring.alert_retirement IS
  'Durable audit of one cleared monitoring observation retired after a complete inventory proved it absent. The original_row is the exact locked row deleted from monitoring.alert_state.';
COMMENT ON FUNCTION monitoring.retire_absent_observation(text, jsonb, jsonb, text) IS
  'Retires one cleared monitoring observation whose exact row matches the caller-supplied row and whose complete inventory evidence proves it absent. Returns the retirement audit id; an exact replay returns the existing id without writing.';

COMMIT;
