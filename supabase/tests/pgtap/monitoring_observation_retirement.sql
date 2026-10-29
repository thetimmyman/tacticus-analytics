-- Synthetic monitoring-observation retirement lifecycle.
--
-- Every alert key, producer, scope, inventory and row below is invented for
-- this transaction and rolled back. No production identifiers, captured data
-- or operational keys appear here.

-- The function under test is created by the matching migration. This suite
-- proves the visible contract: a cleared, exactly matched, absent observation
-- is archived complete and deleted; refusals leave both tables untouched.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;
SET LOCAL timezone TO 'UTC';

SELECT plan(110);

-- Session-local helpers. They vanish at ROLLBACK and never enter the schema.
CREATE FUNCTION pg_temp.tp_retire_ev() RETURNS jsonb
LANGUAGE sql STABLE AS $ev$
  SELECT jsonb_build_object(
    'version', 1,
    'producer', 'synthetic-monitor',
    'observed_at', now(),
    'target', jsonb_build_object(
      'kind', 'synthetic-kind',
      'id', 'retired-target',
      'aliases', jsonb_build_array('retired-alias'),
      'checked', true,
      'present', false
    ),
    'inventory', jsonb_build_object(
      'scope', 'synthetic-scope',
      'complete', true,
      'members', jsonb_build_array(
        jsonb_build_object(
          'id', 'current-target',
          'aliases', jsonb_build_array('current-alias')
        )
      )
    )
  )
$ev$;

CREATE FUNCTION pg_temp.tp_retire_set(p_path text[], p_value jsonb) RETURNS jsonb
LANGUAGE sql STABLE AS $set$
  SELECT jsonb_set(pg_temp.tp_retire_ev(), p_path, p_value)
$set$;

CREATE FUNCTION pg_temp.tp_retire_patch(p_path text[], p_patch jsonb) RETURNS jsonb
LANGUAGE sql STABLE AS $patch$
  SELECT jsonb_set(
    pg_temp.tp_retire_ev(),
    p_path,
    (pg_temp.tp_retire_ev() #> p_path) || p_patch
  )
$patch$;

CREATE FUNCTION pg_temp.tp_retire_drop(p_key text) RETURNS jsonb
LANGUAGE sql STABLE AS $drop$
  SELECT pg_temp.tp_retire_ev() - p_key
$drop$;

CREATE FUNCTION pg_temp.tp_retire_drop_in(p_path text[], p_key text) RETURNS jsonb
LANGUAGE sql STABLE AS $dropin$
  SELECT jsonb_set(
    pg_temp.tp_retire_ev(),
    p_path,
    (pg_temp.tp_retire_ev() #> p_path) - p_key
  )
$dropin$;

CREATE FUNCTION pg_temp.tp_retire_add(
  p_key text,
  p_status text DEFAULT 'cleared',
  p_seen text DEFAULT '8 days'
) RETURNS jsonb
LANGUAGE plpgsql AS $add$
BEGIN
  INSERT INTO monitoring.alert_state (
    alert_key, status, since, last_seen_at, last_title, last_body
  ) VALUES (
    p_key,
    p_status,
    now() - p_seen::interval - interval '1 day',
    now() - p_seen::interval,
    'Synthetic observation',
    'Synthetic detail'
  );
  RETURN (
    SELECT to_jsonb(observation)
    FROM monitoring.alert_state AS observation
    WHERE observation.alert_key = p_key
  );
END;
$add$;

-- Digest of every monitoring table this API must not touch. alert_state is
-- excluded because the test intentionally retires rows from it; the two owned
-- objects are excluded because alert_retirement intentionally grows. On a
-- minimal database with no other monitoring tables this control is vacuous,
-- and the assertion below still proves it stayed that way.
CREATE FUNCTION pg_temp.tp_retire_other_digest() RETURNS text
LANGUAGE plpgsql AS $digest$
DECLARE
  relation_row record;
  accumulator text := '';
  rows_text text;
BEGIN
  FOR relation_row IN
    SELECT c.oid::regclass::text AS relation_name
    FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'monitoring'
      AND c.relkind = 'r'
      AND c.relname NOT IN ('alert_state', 'alert_retirement')
    ORDER BY c.relname
  LOOP
    EXECUTE pg_catalog.format(
      'SELECT coalesce(pg_catalog.string_agg(pg_catalog.to_jsonb(t)::text, %L ORDER BY pg_catalog.to_jsonb(t)::text), %L) FROM %s AS t',
      '|', '', relation_row.relation_name
    ) INTO rows_text;
    accumulator := accumulator || relation_row.relation_name || '=' || pg_catalog.md5(rows_text) || ';';
  END LOOP;
  RETURN accumulator;
END;
$digest$;

CREATE TABLE monitoring.synthetic_retirement_guard (id integer PRIMARY KEY, body text);
INSERT INTO monitoring.synthetic_retirement_guard VALUES (1, 'Preserve synthetic audit history');

CREATE TEMP TABLE tp_retire_expected (name text PRIMARY KEY, row jsonb);
CREATE TEMP TABLE tp_retire_monitoring AS
  SELECT pg_temp.tp_retire_other_digest() AS digest;

INSERT INTO tp_retire_expected VALUES
  ('positive',  pg_temp.tp_retire_add('synthetic.retire.positive')),
  ('bystander', pg_temp.tp_retire_add('synthetic.retire.bystander'));

-- Contract ---------------------------------------------------------------
SELECT is(
  current_database()::text,
  'postgres',
  '1. this suite runs against the postgres database'
);

SELECT has_function(
  'monitoring', 'retire_absent_observation',
  ARRAY['text', 'jsonb', 'jsonb', 'text'],
  '2. the retirement API has one four-argument signature'
);

SELECT is(
  (SELECT pg_get_function_result(p.oid)
   FROM pg_proc p
   WHERE p.oid = 'monitoring.retire_absent_observation(text,jsonb,jsonb,text)'::regprocedure),
  'uuid',
  '3. retirement returns the audit identity'
);

SELECT is(
  (SELECT concat_ws('|', p.prosecdef::text, p.provolatile, l.lanname, array_to_string(p.proconfig, ';'))
   FROM pg_proc p
   JOIN pg_language l ON l.oid = p.prolang
   WHERE p.oid = 'monitoring.retire_absent_observation(text,jsonb,jsonb,text)'::regprocedure),
  'false|v|plpgsql|search_path=pg_catalog',
  '4. retirement is SECURITY INVOKER, volatile, plpgsql and pinned to pg_catalog'
);

SELECT has_table(
  'monitoring', 'alert_retirement',
  '5. the complete old observation has a durable retirement archive'
);

SELECT is(
  (SELECT array_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) ORDER BY a.attnum)
   FROM pg_attribute a
   WHERE a.attrelid = 'monitoring.alert_retirement'::regclass
     AND a.attnum > 0
     AND NOT a.attisdropped),
  ARRAY[
    'id:uuid',
    'alert_key:text',
    'original_row:jsonb',
    'absence_evidence:jsonb',
    'reason:text',
    'actor:text',
    'retired_at:timestamp with time zone'
  ],
  '6. the archive stores the audit identity, key, complete row, evidence, reason, actor and retired time'
);

SELECT ok(
  (SELECT pg_get_expr(d.adbin, d.adrelid) ~ 'gen_random_uuid\(\)$'
   FROM pg_attrdef d
   JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
   WHERE d.adrelid = 'monitoring.alert_retirement'::regclass
     AND a.attname = 'id'),
  '7. the audit identity is generated by pg_catalog.gen_random_uuid()'
);

SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'monitoring.alert_retirement'::regclass),
  true,
  '8. row level security is enabled on the archive'
);

SELECT is(
  (SELECT count(*)::integer
   FROM pg_proc p,
        aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) AS acl
   WHERE p.oid = 'monitoring.retire_absent_observation(text,jsonb,jsonb,text)'::regprocedure
     AND acl.grantee = 0
     AND acl.privilege_type = 'EXECUTE'),
  0,
  '9. PUBLIC holds no EXECUTE on retirement'
);

SELECT is(
  has_function_privilege(
    'anon',
    'monitoring.retire_absent_observation(text,jsonb,jsonb,text)',
    'EXECUTE'
  ),
  false,
  '10. anon cannot execute retirement'
);

SELECT is(
  has_function_privilege(
    'authenticated',
    'monitoring.retire_absent_observation(text,jsonb,jsonb,text)',
    'EXECUTE'
  )
    OR has_function_privilege(
      'service_role',
      'monitoring.retire_absent_observation(text,jsonb,jsonb,text)',
      'EXECUTE'
    ),
  false,
  '11. authenticated and service_role cannot execute retirement'
);

SELECT is(
  has_table_privilege('anon', 'monitoring.alert_retirement', 'SELECT')
    OR has_table_privilege('authenticated', 'monitoring.alert_retirement', 'SELECT')
    OR has_table_privilege('service_role', 'monitoring.alert_retirement', 'SELECT')
    OR has_table_privilege('anon', 'monitoring.alert_retirement', 'INSERT')
    OR has_table_privilege('authenticated', 'monitoring.alert_retirement', 'UPDATE')
    OR has_table_privilege('authenticated', 'monitoring.alert_retirement', 'DELETE'),
  false,
  '12. client roles hold no archive privilege'
);

SELECT is(
  (SELECT count(*)::integer
   FROM pg_policy
   WHERE polrelid = 'monitoring.alert_retirement'::regclass),
  0,
  '13. the archive adds no permissive client policy'
);

SELECT is(
  has_function_privilege(
    'postgres',
    'monitoring.retire_absent_observation(text,jsonb,jsonb,text)',
    'EXECUTE'
  ),
  true,
  '14. the owner keeps the only positive execution control'
);

-- Positive retirement -----------------------------------------------------
SELECT lives_ok($call$
  SELECT monitoring.retire_absent_observation(
    'synthetic.retire.positive',
    (SELECT row FROM tp_retire_expected WHERE name = 'positive'),
    pg_temp.tp_retire_ev(),
    'The complete synthetic inventory no longer contains this checked target')
$call$, '15. a verified absent cleared target can retire');

SELECT is(
  (SELECT count(*)::integer
   FROM monitoring.alert_retirement
   WHERE alert_key = 'synthetic.retire.positive'),
  1,
  '16. retirement writes exactly one audit row'
);

SELECT is(
  (SELECT original_row
   FROM monitoring.alert_retirement
   WHERE alert_key = 'synthetic.retire.positive'),
  (SELECT row FROM tp_retire_expected WHERE name = 'positive'),
  '17. the archive preserves the complete original row, every field included'
);

SELECT is(
  (SELECT absence_evidence
   FROM monitoring.alert_retirement
   WHERE alert_key = 'synthetic.retire.positive'),
  pg_temp.tp_retire_ev(),
  '18. the archive preserves the structured absence evidence'
);

SELECT is(
  (SELECT reason
   FROM monitoring.alert_retirement
   WHERE alert_key = 'synthetic.retire.positive'),
  'The complete synthetic inventory no longer contains this checked target',
  '19. the archive keeps the supplied reason'
);

SELECT is(
  (SELECT actor
   FROM monitoring.alert_retirement
   WHERE alert_key = 'synthetic.retire.positive'),
  current_user::text,
  '20. the archive records the acting role'
);

SELECT ok(
  (SELECT retired_at BETWEEN now() - interval '1 minute' AND now() + interval '1 minute'
   FROM monitoring.alert_retirement
   WHERE alert_key = 'synthetic.retire.positive'),
  '21. the archive records the current retirement timestamp'
);

SELECT is(
  (SELECT count(*)::integer
   FROM monitoring.alert_state
   WHERE alert_key = 'synthetic.retire.positive'),
  0,
  '22. retirement removes only the obsolete active observation'
);

SELECT is(
  (SELECT to_jsonb(observation)
   FROM monitoring.alert_state AS observation
   WHERE observation.alert_key = 'synthetic.retire.bystander'),
  (SELECT row FROM tp_retire_expected WHERE name = 'bystander'),
  '23. an unrelated active observation keeps its last_seen_at and every other field'
);

SELECT is(
  pg_temp.tp_retire_other_digest(),
  (SELECT digest FROM tp_retire_monitoring),
  '24. no other monitoring table changed during retirement'
);

-- Idempotent replay -------------------------------------------------------
SELECT is(
  monitoring.retire_absent_observation(
    'synthetic.retire.positive',
    (SELECT row FROM tp_retire_expected WHERE name = 'positive'),
    pg_temp.tp_retire_ev(),
    'A retry after a lost response'),
  (SELECT id FROM monitoring.alert_retirement
   WHERE alert_key = 'synthetic.retire.positive'),
  '25. an exact replay returns the existing audit identity'
);

SELECT is(
  (SELECT count(*)::integer
   FROM monitoring.alert_retirement
   WHERE alert_key = 'synthetic.retire.positive'),
  1,
  '26. an exact replay writes no duplicate audit row'
);

SELECT is(
  (SELECT reason
   FROM monitoring.alert_retirement
   WHERE alert_key = 'synthetic.retire.positive'),
  'The complete synthetic inventory no longer contains this checked target',
  '27. an exact replay does not rewrite the archived reason'
);

SELECT throws_ok($call$
  SELECT monitoring.retire_absent_observation(
    'synthetic.retire.positive',
    jsonb_set(
      (SELECT row FROM tp_retire_expected WHERE name = 'positive'),
      '{last_title}', '"Different synthetic title"'::jsonb),
    pg_temp.tp_retire_ev(),
    'A retry with different expectations')
$call$, '55000', NULL,
  '28. a replay with a changed expected row is refused');

SELECT is(
  (SELECT count(*)::integer
   FROM monitoring.alert_retirement
   WHERE alert_key = 'synthetic.retire.positive'),
  1,
  '29. a refused replay leaves the single audit row intact'
);

-- Missing and status refusals --------------------------------------------
SELECT throws_ok($call$
  SELECT monitoring.retire_absent_observation(
    'synthetic.retire.missing',
    '{"alert_key":"synthetic.retire.missing"}'::jsonb,
    pg_temp.tp_retire_ev(),
    'No active row was supplied for this synthetic key')
$call$, '55000', NULL,
  '30. a missing active row with no matching archive is refused, not assumed retired');

SELECT is(
  (SELECT count(*)::integer
   FROM monitoring.alert_retirement
   WHERE alert_key = 'synthetic.retire.missing'),
  0,
  '31. the missing-row refusal writes no audit row'
);

INSERT INTO tp_retire_expected VALUES
  ('firing', pg_temp.tp_retire_add('synthetic.retire.firing', 'firing'));

SELECT throws_ok($call$
  SELECT monitoring.retire_absent_observation(
    'synthetic.retire.firing',
    (SELECT row FROM tp_retire_expected WHERE name = 'firing'),
    pg_temp.tp_retire_ev(),
    'A firing observation is not absent')
$call$, '55000', NULL,
  '32. a firing observation is refused');

SELECT is(
  (SELECT to_jsonb(observation)
   FROM monitoring.alert_state AS observation
   WHERE observation.alert_key = 'synthetic.retire.firing'),
  (SELECT row FROM tp_retire_expected WHERE name = 'firing'),
  '33. the firing refusal preserves the active row unchanged'
);

SELECT is(
  (SELECT count(*)::integer
   FROM monitoring.alert_retirement
   WHERE alert_key = 'synthetic.retire.firing'),
  0,
  '34. the firing refusal writes no audit row'
);

INSERT INTO tp_retire_expected VALUES
  ('cas', pg_temp.tp_retire_add('synthetic.retire.cas'));

SELECT throws_ok($call$
  SELECT monitoring.retire_absent_observation(
    'synthetic.retire.cas',
    jsonb_set(
      (SELECT row FROM tp_retire_expected WHERE name = 'cas'),
      '{last_title}', '"Changed after the read"'::jsonb),
    pg_temp.tp_retire_ev(),
    'The caller saw a different row than the locked one')
$call$, '55000', NULL,
  '35. a changed expected row fails the compare-and-swap');

SELECT is(
  (SELECT to_jsonb(observation)
   FROM monitoring.alert_state AS observation
   WHERE observation.alert_key = 'synthetic.retire.cas'),
  (SELECT row FROM tp_retire_expected WHERE name = 'cas'),
  '36. the changed-row refusal preserves the active row'
);

SELECT is(
  (SELECT count(*)::integer
   FROM monitoring.alert_retirement
   WHERE alert_key = 'synthetic.retire.cas'),
  0,
  '37. the changed-row refusal writes no audit row'
);

SELECT throws_ok($call$
  SELECT monitoring.retire_absent_observation(
    'synthetic.retire.cas',
    (SELECT row FROM tp_retire_expected WHERE name = 'cas') - 'last_body',
    pg_temp.tp_retire_ev(),
    'The caller omitted a field from the full row')
$call$, '55000', NULL,
  '38. an expected row missing one field fails the compare-and-swap');

SELECT is(
  (SELECT to_jsonb(observation)
   FROM monitoring.alert_state AS observation
   WHERE observation.alert_key = 'synthetic.retire.cas'),
  (SELECT row FROM tp_retire_expected WHERE name = 'cas'),
  '39. the partial-row refusal preserves the active row'
);

INSERT INTO tp_retire_expected VALUES
  ('invalid', pg_temp.tp_retire_add('synthetic.retire.invalid'));

SELECT throws_ok($call$
  SELECT monitoring.retire_absent_observation(
    'synthetic.retire.invalid',
    (SELECT row FROM tp_retire_expected WHERE name = 'invalid'),
    pg_temp.tp_retire_ev(),
    '   ')
$call$, '22023', NULL,
  '40. a blank reason is refused');

-- Evidence shape refusals ------------------------------------------------
SELECT throws_ok($call$
  SELECT monitoring.retire_absent_observation(
    'synthetic.retire.invalid',
    (SELECT row FROM tp_retire_expected WHERE name = 'invalid'),
    '[]'::jsonb,
    'Evidence must be a complete object')
$call$, '22023', NULL,
  '41. non-object evidence is refused');

SELECT throws_ok($call$
  SELECT monitoring.retire_absent_observation(
    'synthetic.retire.invalid',
    (SELECT row FROM tp_retire_expected WHERE name = 'invalid'),
    pg_temp.tp_retire_drop('inventory'),
    'Evidence must carry an inventory')
$call$, '22023', NULL,
  '42. evidence missing a top-level field is refused');

SELECT throws_ok($call$
  SELECT monitoring.retire_absent_observation(
    'synthetic.retire.invalid',
    (SELECT row FROM tp_retire_expected WHERE name = 'invalid'),
    pg_temp.tp_retire_ev() || '{"extra":true}'::jsonb,
    'Evidence must not carry unknown fields')
$call$, '22023', NULL,
  '43. evidence with an unknown top-level field is refused');

SELECT throws_ok($call$
  SELECT monitoring.retire_absent_observation(
    'synthetic.retire.invalid',
    (SELECT row FROM tp_retire_expected WHERE name = 'invalid'),
    pg_temp.tp_retire_set('{version}', '2'::jsonb),
    'Only version 1 is supported')
$call$, '22023', NULL,
  '44. an unsupported evidence version is refused');

SELECT throws_ok($call$
  SELECT monitoring.retire_absent_observation(
    'synthetic.retire.invalid',
    (SELECT row FROM tp_retire_expected WHERE name = 'invalid'),
    pg_temp.tp_retire_set('{version}', '"1"'::jsonb),
    'The version must be a number')
$call$, '22023', NULL,
  '45. a string evidence version is refused');

SELECT throws_ok($call$
  SELECT monitoring.retire_absent_observation(
    'synthetic.retire.invalid',
    (SELECT row FROM tp_retire_expected WHERE name = 'invalid'),
    pg_temp.tp_retire_set('{producer}', to_jsonb('Synthetic Monitor'::text)),
    'The producer must be a slug')
$call$, '22023', NULL,
  '46. a malformed producer slug is refused');

SELECT throws_ok($call$
  SELECT monitoring.retire_absent_observation(
    'synthetic.retire.invalid',
    (SELECT row FROM tp_retire_expected WHERE name = 'invalid'),
    pg_temp.tp_retire_set('{observed_at}', '17'::jsonb),
    'The observation time must be a string')
$call$, '22007', NULL,
  '47. a non-string observed_at is refused');

SELECT throws_ok($call$
  SELECT monitoring.retire_absent_observation(
    'synthetic.retire.invalid',
    (SELECT row FROM tp_retire_expected WHERE name = 'invalid'),
    pg_temp.tp_retire_set('{observed_at}', to_jsonb('not-a-timestamp'::text)),
    'The observation time must parse')
$call$, '22007', NULL,
  '48. an unparseable observed_at is refused');

SELECT throws_ok($call$
  SELECT monitoring.retire_absent_observation(
    'synthetic.retire.invalid',
    (SELECT row FROM tp_retire_expected WHERE name = 'invalid'),
    pg_temp.tp_retire_set('{observed_at}', to_jsonb(now() + interval '2 minutes')),
    'The observation cannot be from the future')
$call$, '22023', NULL,
  '49. an observed_at beyond the 30 second future skew is refused');

SELECT throws_ok($call$
  SELECT monitoring.retire_absent_observation(
    'synthetic.retire.invalid',
    (SELECT row FROM tp_retire_expected WHERE name = 'invalid'),
    pg_temp.tp_retire_set('{observed_at}', to_jsonb(now() - interval '16 minutes')),
    'The observation cannot be stale')
$call$, '22023', NULL,
  '50. an observed_at older than 15 minutes is refused');

SELECT throws_ok($call$
  SELECT monitoring.retire_absent_observation(
    'synthetic.retire.invalid',
    (SELECT row FROM tp_retire_expected WHERE name = 'invalid'),
    pg_temp.tp_retire_drop('target'),
    'Evidence must carry a target')
$call$, '22023', NULL,
  '51. evidence missing the target is refused');

SELECT throws_ok($call$
  SELECT monitoring.retire_absent_observation(
    'synthetic.retire.invalid',
    (SELECT row FROM tp_retire_expected WHERE name = 'invalid'),
    pg_temp.tp_retire_patch('{target}', '{"extra":1}'::jsonb),
    'The target must not carry unknown fields')
$call$, '22023', NULL,
  '52. a target with an unknown field is refused');

SELECT throws_ok($call$
  SELECT monitoring.retire_absent_observation(
    'synthetic.retire.invalid',
    (SELECT row FROM tp_retire_expected WHERE name = 'invalid'),
    pg_temp.tp_retire_set('{target,kind}', to_jsonb('Synthetic Kind'::text)),
    'The target kind must be a slug')
$call$, '22023', NULL,
  '53. a malformed target kind is refused');

SELECT throws_ok($call$
  SELECT monitoring.retire_absent_observation(
    'synthetic.retire.invalid',
    (SELECT row FROM tp_retire_expected WHERE name = 'invalid'),
    pg_temp.tp_retire_set('{target,id}', to_jsonb(''::text)),
    'The target id must be nonempty')
$call$, '22023', NULL,
  '54. an empty target id is refused');

SELECT throws_ok($call$
  SELECT monitoring.retire_absent_observation(
    'synthetic.retire.invalid',
    (SELECT row FROM tp_retire_expected WHERE name = 'invalid'),
    pg_temp.tp_retire_set('{target,id}', to_jsonb(repeat('a', 201))),
    'The target id must be bounded')
$call$, '22023', NULL,
  '55. an oversized target id is refused');

SELECT throws_ok($call$
  SELECT monitoring.retire_absent_observation(
    'synthetic.retire.invalid',
    (SELECT row FROM tp_retire_expected WHERE name = 'invalid'),
    pg_temp.tp_retire_set('{target,aliases}', '[]'::jsonb),
    'The target aliases must be nonempty')
$call$, '22023', NULL,
  '56. an empty target alias array is refused');

SELECT throws_ok($call$
  SELECT monitoring.retire_absent_observation(
    'synthetic.retire.invalid',
    (SELECT row FROM tp_retire_expected WHERE name = 'invalid'),
    pg_temp.tp_retire_set('{target,aliases}', '[7]'::jsonb),
    'The target aliases must be strings')
$call$, '22023', NULL,
  '57. a non-string target alias is refused');

SELECT throws_ok($call$
  SELECT monitoring.retire_absent_observation(
    'synthetic.retire.invalid',
    (SELECT row FROM tp_retire_expected WHERE name = 'invalid'),
    pg_temp.tp_retire_set('{target,checked}', 'false'::jsonb),
    'The target must have been checked')
$call$, '22023', NULL,
  '58. an unchecked target is refused');

SELECT throws_ok($call$
  SELECT monitoring.retire_absent_observation(
    'synthetic.retire.invalid',
    (SELECT row FROM tp_retire_expected WHERE name = 'invalid'),
    pg_temp.tp_retire_set('{target,present}', 'true'::jsonb),
    'The target must be absent')
$call$, '22023', NULL,
  '59. a present target is refused');

SELECT throws_ok($call$
  SELECT monitoring.retire_absent_observation(
    'synthetic.retire.invalid',
    (SELECT row FROM tp_retire_expected WHERE name = 'invalid'),
    pg_temp.tp_retire_set('{inventory}', 'null'::jsonb),
    'Evidence must carry an inventory object')
$call$, '22023', NULL,
  '60. a null inventory is refused');

SELECT throws_ok($call$
  SELECT monitoring.retire_absent_observation(
    'synthetic.retire.invalid',
    (SELECT row FROM tp_retire_expected WHERE name = 'invalid'),
    pg_temp.tp_retire_set('{inventory,complete}', 'false'::jsonb),
    'The inventory must be complete')
$call$, '22023', NULL,
  '61. an incomplete inventory is refused');

SELECT throws_ok($call$
  SELECT monitoring.retire_absent_observation(
    'synthetic.retire.invalid',
    (SELECT row FROM tp_retire_expected WHERE name = 'invalid'),
    pg_temp.tp_retire_drop_in('{inventory}', 'scope'),
    'The inventory must name its scope')
$call$, '22023', NULL,
  '62. an inventory missing its scope is refused');

SELECT throws_ok($call$
  SELECT monitoring.retire_absent_observation(
    'synthetic.retire.invalid',
    (SELECT row FROM tp_retire_expected WHERE name = 'invalid'),
    pg_temp.tp_retire_set('{inventory,members}', '[]'::jsonb),
    'The inventory must list members')
$call$, '22023', NULL,
  '63. an empty inventory is refused');

SELECT throws_ok($call$
  SELECT monitoring.retire_absent_observation(
    'synthetic.retire.invalid',
    (SELECT row FROM tp_retire_expected WHERE name = 'invalid'),
    pg_temp.tp_retire_set('{inventory,members}', '[7]'::jsonb),
    'Every inventory member must be an object')
$call$, '22023', NULL,
  '64. a non-object inventory member is refused');

SELECT throws_ok($call$
  SELECT monitoring.retire_absent_observation(
    'synthetic.retire.invalid',
    (SELECT row FROM tp_retire_expected WHERE name = 'invalid'),
    pg_temp.tp_retire_patch('{inventory,members,0}', '{"extra":1}'::jsonb),
    'A member must not carry unknown fields')
$call$, '22023', NULL,
  '65. an inventory member with an unknown field is refused');

SELECT throws_ok($call$
  SELECT monitoring.retire_absent_observation(
    'synthetic.retire.invalid',
    (SELECT row FROM tp_retire_expected WHERE name = 'invalid'),
    pg_temp.tp_retire_set('{inventory,members,0,id}', to_jsonb(''::text)),
    'A member id must be nonempty')
$call$, '22023', NULL,
  '66. an empty inventory member id is refused');

SELECT throws_ok($call$
  SELECT monitoring.retire_absent_observation(
    'synthetic.retire.invalid',
    (SELECT row FROM tp_retire_expected WHERE name = 'invalid'),
    pg_temp.tp_retire_set('{inventory,members,0,aliases}', '[]'::jsonb),
    'A member alias list must be nonempty')
$call$, '22023', NULL,
  '67. an empty member alias array is refused');

SELECT throws_ok($call$
  SELECT monitoring.retire_absent_observation(
    'synthetic.retire.invalid',
    (SELECT row FROM tp_retire_expected WHERE name = 'invalid'),
    pg_temp.tp_retire_set('{inventory,members,0,aliases}', '[7]'::jsonb),
    'Member aliases must be strings')
$call$, '22023', NULL,
  '68. a non-string member alias is refused');

SELECT throws_ok($call$
  SELECT monitoring.retire_absent_observation(
    'synthetic.retire.invalid',
    (SELECT row FROM tp_retire_expected WHERE name = 'invalid'),
    pg_temp.tp_retire_set('{inventory,members}', '[{"id":"alpha"}]'::jsonb),
    'A member must carry aliases')
$call$, '22023', NULL,
  '69. an inventory member missing aliases is refused');

SELECT is(
  (SELECT to_jsonb(observation)
   FROM monitoring.alert_state AS observation
   WHERE observation.alert_key = 'synthetic.retire.invalid'),
  (SELECT row FROM tp_retire_expected WHERE name = 'invalid'),
  '70. every malformed evidence refusal preserved the active row'
);

SELECT is(
  (SELECT count(*)::integer
   FROM monitoring.alert_retirement
   WHERE alert_key = 'synthetic.retire.invalid'),
  0,
  '71. every malformed evidence refusal wrote no audit row'
);

-- Alias and inventory identity controls ----------------------------------
SELECT throws_ok($call$
  SELECT monitoring.retire_absent_observation(
    'synthetic.retire.invalid',
    (SELECT row FROM tp_retire_expected WHERE name = 'invalid'),
    pg_temp.tp_retire_set('{target,id}', to_jsonb('CURRENT-ALIAS'::text)),
    'A target matching a member alias is present')
$call$, '22023', NULL,
  '72. a target id matching an inventory alias case-insensitively is refused');

SELECT throws_ok($call$
  SELECT monitoring.retire_absent_observation(
    'synthetic.retire.invalid',
    (SELECT row FROM tp_retire_expected WHERE name = 'invalid'),
    pg_temp.tp_retire_set('{target,aliases}', '["CURRENT-TARGET"]'::jsonb),
    'A target alias matching a member id is present')
$call$, '22023', NULL,
  '73. a target alias matching an inventory id case-insensitively is refused');

SELECT throws_ok($call$
  SELECT monitoring.retire_absent_observation(
    'synthetic.retire.invalid',
    (SELECT row FROM tp_retire_expected WHERE name = 'invalid'),
    pg_temp.tp_retire_set(
      '{inventory,members}',
      '[{"id":"alpha","aliases":["one"]},{"id":"ALPHA","aliases":["two"]}]'::jsonb),
    'Two members share one identity')
$call$, '22023', NULL,
  '74. duplicate inventory member identities are refused case-insensitively');

SELECT throws_ok($call$
  SELECT monitoring.retire_absent_observation(
    'synthetic.retire.invalid',
    (SELECT row FROM tp_retire_expected WHERE name = 'invalid'),
    pg_temp.tp_retire_set(
      '{inventory,members}',
      '[{"id":"alpha","aliases":["shared"]},{"id":"beta","aliases":["SHARED"]}]'::jsonb),
    'Two members share one alias')
$call$, '22023', NULL,
  '75. an alias shared across inventory members is refused case-insensitively');

INSERT INTO tp_retire_expected VALUES
  ('selfalias', pg_temp.tp_retire_add('synthetic.retire.selfalias'));

SELECT lives_ok($call$
  SELECT monitoring.retire_absent_observation(
    'synthetic.retire.selfalias',
    (SELECT row FROM tp_retire_expected WHERE name = 'selfalias'),
    pg_temp.tp_retire_set(
      '{inventory,members}',
      '[{"id":"alpha","aliases":["ALPHA","beta"]}]'::jsonb),
    'A member repeating its own id as an alias is one identity')
$call$, '76. a same-member self alias normalizes instead of becoming ambiguous');

SELECT is(
  (SELECT count(*)::integer
   FROM monitoring.alert_retirement
   WHERE alert_key = 'synthetic.retire.selfalias'),
  1,
  '77. the normalized self-alias inventory retires exactly one audit row'
);

INSERT INTO tp_retire_expected VALUES
  ('selfalias_blocked', pg_temp.tp_retire_add('synthetic.retire.selfalias-blocked'));

SELECT throws_ok($call$
  SELECT monitoring.retire_absent_observation(
    'synthetic.retire.selfalias-blocked',
    (SELECT row FROM tp_retire_expected WHERE name = 'selfalias_blocked'),
    pg_temp.tp_retire_set(
      '{inventory,members}',
      '[{"id":"alpha","aliases":["ALPHA","beta"]}]'::jsonb)
    || '{"target":{"kind":"synthetic-kind","id":"retired-target","aliases":["BETA"],"checked":true,"present":false}}'::jsonb,
    'A target alias matching the self-alias member is present')
$call$, '22023', NULL,
  '78. a target matching a self-aliased member is still refused');

SELECT throws_ok($call$
  SELECT monitoring.retire_absent_observation(
    'synthetic.retire.selfalias-blocked',
    (SELECT row FROM tp_retire_expected WHERE name = 'selfalias_blocked'),
    pg_temp.tp_retire_set(
      '{inventory,members}',
      '[{"id":"alpha","aliases":["ALPHA","beta"]}]'::jsonb)
    || '{"target":{"kind":"synthetic-kind","id":"ALPHA","aliases":["retired-alias"],"checked":true,"present":false}}'::jsonb,
    'A target id matching the self-alias member is present')
$call$, '22023', NULL,
  '79. a target id matching a self-aliased member id is refused');

-- Unsupported alert_state dependencies -----------------------------------
INSERT INTO tp_retire_expected VALUES
  ('fk', pg_temp.tp_retire_add('synthetic.retire.fk'));

CREATE TABLE public.tp_retire_fk_target (
  alert_key text REFERENCES monitoring.alert_state (alert_key)
);

SELECT throws_ok($call$
  SELECT monitoring.retire_absent_observation(
    'synthetic.retire.fk',
    (SELECT row FROM tp_retire_expected WHERE name = 'fk'),
    pg_temp.tp_retire_ev(),
    'A foreign key makes this retirement unsupported')
$call$, '55000', NULL,
  '80. an unsupported foreign key on alert_state is refused');

SELECT is(
  (SELECT to_jsonb(observation)
   FROM monitoring.alert_state AS observation
   WHERE observation.alert_key = 'synthetic.retire.fk'),
  (SELECT row FROM tp_retire_expected WHERE name = 'fk'),
  '81. the foreign-key refusal preserves the active row'
);

DROP TABLE public.tp_retire_fk_target;

CREATE FUNCTION public.tp_retire_keep_new() RETURNS trigger
LANGUAGE plpgsql AS $keep$
BEGIN
  RETURN NEW;
END;
$keep$;

CREATE TRIGGER tp_retire_alert_state_guard
  BEFORE UPDATE ON monitoring.alert_state
  FOR EACH ROW EXECUTE FUNCTION public.tp_retire_keep_new();

INSERT INTO tp_retire_expected VALUES
  ('trigger', pg_temp.tp_retire_add('synthetic.retire.trigger'));

SELECT throws_ok($call$
  SELECT monitoring.retire_absent_observation(
    'synthetic.retire.trigger',
    (SELECT row FROM tp_retire_expected WHERE name = 'trigger'),
    pg_temp.tp_retire_ev(),
    'A user trigger makes this retirement unsupported')
$call$, '55000', NULL,
  '82. a user trigger on alert_state is refused');

SELECT is(
  (SELECT to_jsonb(observation)
   FROM monitoring.alert_state AS observation
   WHERE observation.alert_key = 'synthetic.retire.trigger'),
  (SELECT row FROM tp_retire_expected WHERE name = 'trigger'),
  '83. the user-trigger refusal preserves the active row'
);

DROP TRIGGER tp_retire_alert_state_guard ON monitoring.alert_state;

CREATE TABLE public.tp_retire_unrelated (id integer);
CREATE TRIGGER tp_retire_unrelated_guard
  BEFORE INSERT ON public.tp_retire_unrelated
  FOR EACH ROW EXECUTE FUNCTION public.tp_retire_keep_new();

INSERT INTO tp_retire_expected VALUES
  ('unrelated', pg_temp.tp_retire_add('synthetic.retire.unrelated'));

SELECT lives_ok($call$
  SELECT monitoring.retire_absent_observation(
    'synthetic.retire.unrelated',
    (SELECT row FROM tp_retire_expected WHERE name = 'unrelated'),
    pg_temp.tp_retire_ev(),
    'An unrelated trigger is not a reason to refuse')
$call$, '84. an unrelated schema trigger does not block retirement');

SELECT is(
  (SELECT count(*)::integer
   FROM monitoring.alert_retirement
   WHERE alert_key = 'synthetic.retire.unrelated'),
  1,
  '85. the unrelated-trigger control reaches a real retirement'
);

DROP TABLE public.tp_retire_unrelated;
DROP FUNCTION public.tp_retire_keep_new();

-- Injected write failures -------------------------------------------------
CREATE FUNCTION public.tp_retire_archive_fail() RETURNS trigger
LANGUAGE plpgsql AS $fail$
BEGIN
  IF NEW.absence_evidence->>'producer' = 'synthetic-archive-fail' THEN
    RAISE EXCEPTION 'synthetic archive insert failure';
  END IF;
  RETURN NEW;
END;
$fail$;

CREATE TRIGGER tp_retire_archive_fail
  BEFORE INSERT ON monitoring.alert_retirement
  FOR EACH ROW EXECUTE FUNCTION public.tp_retire_archive_fail();

INSERT INTO tp_retire_expected VALUES
  ('insertfail', pg_temp.tp_retire_add('synthetic.retire.insertfail'));

SELECT throws_ok($call$
  SELECT monitoring.retire_absent_observation(
    'synthetic.retire.insertfail',
    (SELECT row FROM tp_retire_expected WHERE name = 'insertfail'),
    pg_temp.tp_retire_set('{producer}', to_jsonb('synthetic-archive-fail'::text)),
    'The archive insert fails after validation')
$call$, 'P0001', NULL,
  '86. an injected archive insert failure aborts the retirement');

SELECT is(
  (SELECT to_jsonb(observation)
   FROM monitoring.alert_state AS observation
   WHERE observation.alert_key = 'synthetic.retire.insertfail'),
  (SELECT row FROM tp_retire_expected WHERE name = 'insertfail'),
  '87. the failed archive insert leaves the active row untouched'
);

SELECT is(
  (SELECT count(*)::integer
   FROM monitoring.alert_retirement
   WHERE alert_key = 'synthetic.retire.insertfail'),
  0,
  '88. the failed archive insert persists no audit row'
);

DROP TRIGGER tp_retire_archive_fail ON monitoring.alert_retirement;
DROP FUNCTION public.tp_retire_archive_fail();

CREATE RULE tp_retire_delete_skip AS
  ON DELETE TO monitoring.alert_state
  WHERE OLD.alert_key = 'synthetic.retire.deletefail'
  DO INSTEAD NOTHING;

INSERT INTO tp_retire_expected VALUES
  ('deletefail', pg_temp.tp_retire_add('synthetic.retire.deletefail'));

SELECT throws_ok($call$
  SELECT monitoring.retire_absent_observation(
    'synthetic.retire.deletefail',
    (SELECT row FROM tp_retire_expected WHERE name = 'deletefail'),
    pg_temp.tp_retire_ev(),
    'The delete removes no row and must roll back')
$call$, '55000', NULL,
  '89. a delete that does not remove exactly one row aborts the retirement');

SELECT is(
  (SELECT to_jsonb(observation)
   FROM monitoring.alert_state AS observation
   WHERE observation.alert_key = 'synthetic.retire.deletefail'),
  (SELECT row FROM tp_retire_expected WHERE name = 'deletefail'),
  '90. the failed delete leaves the active row untouched'
);

SELECT is(
  (SELECT count(*)::integer
   FROM monitoring.alert_retirement
   WHERE alert_key = 'synthetic.retire.deletefail'),
  0,
  '91. the failed delete rolls back its archive insert'
);

DROP RULE tp_retire_delete_skip ON monitoring.alert_state;

-- Client boundary, live ---------------------------------------------------
SET LOCAL ROLE anon;
SELECT throws_ok($call$
  SELECT monitoring.retire_absent_observation(
    'synthetic.retire.positive',
    '{}'::jsonb, '{}'::jsonb, 'anon must not retire')
$call$, '42501', NULL,
  '92. anon is refused at the retirement call boundary');
SELECT throws_ok(
  'SELECT count(*) FROM monitoring.alert_retirement',
  '42501', NULL,
  '93. anon cannot read the retirement archive');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT throws_ok(
  'SELECT count(*) FROM monitoring.alert_retirement',
  '42501', NULL,
  '94. authenticated cannot read the retirement archive');
RESET ROLE;

SELECT is(
  pg_temp.tp_retire_other_digest(),
  (SELECT digest FROM tp_retire_monitoring),
  '95. no other monitoring table changed across every scenario'
);

SELECT is(
  (SELECT count(DISTINCT id)::integer FROM monitoring.alert_retirement)
    - (SELECT count(*)::integer FROM monitoring.alert_retirement),
  0,
  '96. every audit identity is distinct'
);

-- A retained audit never bypasses a recreated live observation.
INSERT INTO monitoring.alert_state
SELECT restored.* FROM tp_retire_expected e
CROSS JOIN LATERAL jsonb_populate_record(NULL::monitoring.alert_state, e.row) restored
WHERE e.name = 'positive';
UPDATE monitoring.alert_state SET status = 'firing' WHERE alert_key = 'synthetic.retire.positive';
SELECT throws_ok($call$
 SELECT monitoring.retire_absent_observation('synthetic.retire.positive',
  (SELECT row FROM tp_retire_expected WHERE name='positive'), pg_temp.tp_retire_ev(), 'Retry with recreated firing row')
$call$, '55000', NULL, 'an old archive cannot bypass a recreated firing observation');
SELECT is((SELECT status FROM monitoring.alert_state WHERE alert_key='synthetic.retire.positive'),
 'firing', 'recreated firing observation remains visible');
UPDATE monitoring.alert_state SET status='cleared', last_title='Recreated changed observation'
WHERE alert_key='synthetic.retire.positive';
SELECT throws_ok($call$
 SELECT monitoring.retire_absent_observation('synthetic.retire.positive',
  (SELECT row FROM tp_retire_expected WHERE name='positive'), pg_temp.tp_retire_ev(), 'Retry with recreated changed row')
$call$, '55000', NULL, 'an old archive cannot bypass changed live row CAS');
SELECT is((SELECT last_title FROM monitoring.alert_state WHERE alert_key='synthetic.retire.positive'),
 'Recreated changed observation', 'changed recreated row remains untouched');
DELETE FROM monitoring.alert_state WHERE alert_key='synthetic.retire.positive';
INSERT INTO monitoring.alert_state
SELECT restored.* FROM tp_retire_expected e
CROSS JOIN LATERAL jsonb_populate_record(NULL::monitoring.alert_state, e.row) restored
WHERE e.name = 'positive';
SELECT lives_ok($call$
 SELECT monitoring.retire_absent_observation('synthetic.retire.positive',
  (SELECT row FROM tp_retire_expected WHERE name='positive'), pg_temp.tp_retire_ev(), 'Retire the actually restored exact row')
$call$, 'a restored exact row is actually retired again');
SELECT is((SELECT count(*)::integer FROM monitoring.alert_retirement WHERE alert_key='synthetic.retire.positive'),
 2, 'restored-row retirement adds a new audit rather than returning the old id');
SELECT is((SELECT count(*)::integer FROM monitoring.alert_state WHERE alert_key='synthetic.retire.positive'),
 0, 'restored-row retirement removes the current active row');

SELECT throws_ok($call$
 SELECT monitoring.retire_absent_observation('synthetic.retire.bystander',
  (SELECT row FROM tp_retire_expected WHERE name='bystander'),
  pg_temp.tp_retire_set('{observed_at}', to_jsonb('now'::text)), 'Relative dates are not evidence')
$call$, '22007', NULL, 'relative timestamp strings fail closed');
SELECT throws_ok($call$
 SELECT monitoring.retire_absent_observation('synthetic.retire.bystander',
  (SELECT row FROM tp_retire_expected WHERE name='bystander'),
  pg_temp.tp_retire_set('{target,aliases}', (SELECT jsonb_agg('alias-'||i) FROM generate_series(1,33) i)),
  'Bounded inventory aliases')
$call$, '22023', NULL, 'oversized alias collection fails closed');

SELECT ok(NOT has_function_privilege('service_role',
 'monitoring.retire_absent_observation(text,jsonb,jsonb,text)', 'EXECUTE'),
 'service_role has no new retirement execution right');
SELECT ok(NOT has_table_privilege('service_role','monitoring.alert_retirement','SELECT'),
 'service_role has no archive read right');
SELECT is((SELECT count(*)::integer FROM pg_class c,
 LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
 WHERE c.oid='monitoring.alert_retirement'::regclass AND a.grantee<>c.relowner),
 0, 'no named default grantee retains archive rights');
SELECT is((SELECT count(*)::integer FROM pg_proc p,
 LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
 WHERE p.oid='monitoring.retire_absent_observation(text,jsonb,jsonb,text)'::regprocedure
 AND a.grantee<>p.proowner), 0, 'no named default grantee retains retirement execution');

-- Small clock separation proves retirement time is independent of BEGIN.
SELECT pg_sleep(0.02);
SELECT monitoring.retire_absent_observation('synthetic.retire.bystander',
 (SELECT row FROM tp_retire_expected WHERE name='bystander'), pg_temp.tp_retire_ev(), 'Current invocation time');
SELECT ok((SELECT retired_at > transaction_timestamp() + interval '0.01 second'
 FROM monitoring.alert_retirement WHERE alert_key='synthetic.retire.bystander')
 AND (SELECT prosrc LIKE '%v_clock timestamp with time zone := pg_catalog.clock_timestamp()%'
 AND prosrc LIKE '%v_observed_at > v_clock%' AND prosrc LIKE '%v_observed_at < v_clock%'
 FROM pg_proc WHERE oid='monitoring.retire_absent_observation(text,jsonb,jsonb,text)'::regprocedure),
 'freshness uses a captured invocation clock and audit records actual retirement time');

SELECT * FROM finish();
ROLLBACK;
