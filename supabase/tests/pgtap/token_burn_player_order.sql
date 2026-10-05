BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;

SELECT plan(6);

SELECT ok(
  to_regprocedure('public.queue_token_burn_notifications(text,text,timestamp with time zone)') IS NOT NULL,
  'the token-burn notification function keeps its expected signature'
);

SELECT is(
  (
    SELECT (length(p.prosrc) - length(replace(
      p.prosrc,
      E'      where player_id is not null\n      order by player_id\n    ) ts\n',
      ''
    )))
    FROM pg_proc AS p
    WHERE p.oid = 'public.queue_token_burn_notifications(text,text,timestamp with time zone)'::regprocedure
  ),
  length(E'      where player_id is not null\n      order by player_id\n    ) ts\n'),
  'the exact ordered subquery appears once'
);

SELECT ok(
  (
    SELECT strpos(p.prosrc, E'      where player_id is not null\n      order by player_id\n') > 0
      AND strpos(p.prosrc, E'      where player_id is not null\n      order by player_id\n')
        < strpos(p.prosrc, 'cross join lateral public.record_token_burn_state')
    FROM pg_proc AS p
    WHERE p.oid = 'public.queue_token_burn_notifications(text,text,timestamp with time zone)'::regprocedure
  ),
  'player state is visited in ascending player-id order before writes'
);

SELECT is(
  (
    SELECT pg_get_userbyid(p.proowner)
    FROM pg_proc AS p
    WHERE p.oid = 'public.queue_token_burn_notifications(text,text,timestamp with time zone)'::regprocedure
  ),
  'postgres',
  'the function owner is unchanged'
);

SELECT ok(
  (
    SELECT p.prosecdef
      AND p.proconfig = ARRAY['search_path=public, pg_temp']::text[]
    FROM pg_proc AS p
    WHERE p.oid = 'public.queue_token_burn_notifications(text,text,timestamp with time zone)'::regprocedure
  ),
  'the function remains security definer with its fixed search path'
);

SELECT is(
  (
    SELECT pg_get_function_result(p.oid)
    FROM pg_proc AS p
    WHERE p.oid = 'public.queue_token_burn_notifications(text,text,timestamp with time zone)'::regprocedure
  ),
  'TABLE(guild_code text, season text, queued_discord integer, queued_in_app integer, queued_total integer)',
  'the function return contract is unchanged'
);

SELECT * FROM finish();
ROLLBACK;
