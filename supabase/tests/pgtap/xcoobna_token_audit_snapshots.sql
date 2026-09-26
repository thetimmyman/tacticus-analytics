BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;
SET LOCAL timezone TO 'UTC';

SELECT plan(10);

-- Service-role only: it holds per-player live-API readings.

SELECT ok(
  to_regclass('public.token_audit_snapshots') IS NOT NULL,
  'token_audit_snapshots table exists'
);

SELECT ok(
  (SELECT relrowsecurity FROM pg_class
   WHERE oid = 'public.token_audit_snapshots'::regclass),
  'row level security is enabled'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polrelid = 'public.token_audit_snapshots'::regclass
  ),
  'no RLS policies exist (service_role bypasses RLS; everyone else is locked out)'
);

SELECT ok(
  NOT has_table_privilege('anon', 'public.token_audit_snapshots', 'SELECT'),
  'anon cannot SELECT'
);

SELECT ok(
  NOT has_table_privilege('authenticated', 'public.token_audit_snapshots', 'SELECT'),
  'authenticated cannot SELECT'
);

SELECT ok(
  NOT has_table_privilege('anon', 'public.token_audit_snapshots', 'INSERT'),
  'anon cannot INSERT'
);

SELECT ok(
  has_table_privilege('service_role', 'public.token_audit_snapshots', 'INSERT')
  AND has_table_privilege('service_role', 'public.token_audit_snapshots', 'SELECT'),
  'service_role can INSERT and SELECT'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.token_audit_snapshots'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%mode%'
  ),
  'mode CHECK constraint present (daily|rollover)'
);

-- The IDENTITY sequence has its own ACL; the table REVOKE does not cover it.
SELECT ok(
  NOT has_sequence_privilege('anon', 'public.token_audit_snapshots_id_seq', 'USAGE')
  AND NOT has_sequence_privilege('authenticated', 'public.token_audit_snapshots_id_seq', 'USAGE'),
  'client roles cannot use the identity sequence'
);

SELECT ok(
  has_sequence_privilege('service_role', 'public.token_audit_snapshots_id_seq', 'USAGE'),
  'service_role can use the identity sequence (defaulted inserts)'
);

SELECT finish();
ROLLBACK;
