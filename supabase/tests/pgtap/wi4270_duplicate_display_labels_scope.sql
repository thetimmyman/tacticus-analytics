BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;

GRANT USAGE ON SCHEMA extensions TO authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA extensions TO authenticated, service_role;

SELECT plan(11);

SELECT ok(
  EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version = '20260730130000'
  ),
  'WI-4270 caller-scope hotfix migration is recorded'
);

SELECT is(
  (SELECT prosecdef FROM pg_proc
   WHERE oid = 'public.get_duplicate_display_labels(text)'::regprocedure),
  true,
  'duplicate label resolver remains SECURITY DEFINER'
);

SELECT is(
  (SELECT proconfig FROM pg_proc
   WHERE oid = 'public.get_duplicate_display_labels(text)'::regprocedure),
  ARRAY['search_path=pg_catalog, public, auth']::text[],
  'duplicate label resolver pins a safe search path'
);

SELECT ok(
  NOT has_function_privilege(
    'anon', 'public.get_duplicate_display_labels(text)', 'EXECUTE'
  ),
  'anon cannot execute duplicate label resolver'
);

SELECT ok(
  has_function_privilege(
    'authenticated', 'public.get_duplicate_display_labels(text)', 'EXECUTE'
  ),
  'authenticated callers retain scoped execution'
);

SELECT ok(
  has_function_privilege(
    'service_role', 'public.get_duplicate_display_labels(text)', 'EXECUTE'
  ),
  'service role retains trusted global execution'
);

ALTER TABLE auth.users DISABLE TRIGGER USER;
INSERT INTO auth.users (id)
VALUES
  ('42700000-0000-4000-8000-000000000001'),
  ('42700000-0000-4000-8000-000000000002');

INSERT INTO public.player_mapping (
  id, player_id, display_name, original_display_name, has_duplicate_name,
  guild_code, user_id, role, is_current, is_active, created_at, updated_at
)
VALUES
  (427001, 'wi4270-player-a', 'Tribute (WI4270A_01)', 'Tribute', true,
   'WI4270A', '42700000-0000-4000-8000-000000000001',
   'member'::public.app_role, true, true, now(), now()),
  (427002, 'wi4270-player-b', 'Tribute (WI4270B_01)', 'Tribute', true,
   'WI4270B', '42700000-0000-4000-8000-000000000002',
   'member'::public.app_role, true, true, now(), now());

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub', '42700000-0000-4000-8000-000000000001', true
);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

SELECT is(
  (SELECT count(*) FROM public.get_duplicate_display_labels()),
  1::bigint,
  'authenticated default call returns only the caller guild labels'
);

SELECT is(
  (SELECT display_name FROM public.get_duplicate_display_labels()),
  'Tribute (WI4270A_01)',
  'authenticated default call returns the caller guild row'
);

SELECT is(
  (SELECT count(*) FROM public.get_duplicate_display_labels('WI4270B')),
  0::bigint,
  'authenticated caller cannot request a foreign guild explicitly'
);
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', 'service_role', true);

SELECT is(
  (SELECT count(*) FROM public.get_duplicate_display_labels()),
  2::bigint,
  'service role may load the trusted global label map'
);

SELECT is(
  (SELECT count(*) FROM public.get_duplicate_display_labels('WI4270B')),
  1::bigint,
  'service role may explicitly scope the trusted label map'
);
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', '', true);
SELECT finish();
ROLLBACK;
