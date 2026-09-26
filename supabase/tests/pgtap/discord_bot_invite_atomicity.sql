BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;

SELECT plan(8);

SELECT ok(
  NOT has_function_privilege(
    'anon',
    'public.consume_discord_bot_invite(text,text,text)',
    'EXECUTE'
  ),
  'anon cannot consume Discord bot invites directly'
);

SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.consume_discord_bot_invite(text,text,text)',
    'EXECUTE'
  ),
  'authenticated cannot consume Discord bot invites directly'
);

SELECT ok(
  has_function_privilege(
    'service_role',
    'public.consume_discord_bot_invite(text,text,text)',
    'EXECUTE'
  ),
  'service_role can invoke the atomic bot-invite operation'
);

INSERT INTO public.guild_config (guild_code, display_name)
VALUES ('PUBSEC', 'Synthetic Security Guild');

INSERT INTO public.discord_invite_codes (
  guild_code,
  invite_code,
  expires_at,
  is_active,
  max_uses,
  current_uses
) VALUES (
  'PUBSEC',
  'PUBSEC_INVITE_TEST',
  now() + interval '1 hour',
  true,
  1,
  0
);

SELECT is(
  public.consume_discord_bot_invite(
    'PUBSEC_INVITE_TEST',
    '100000000000000001',
    '100000000000000002'
  )->>'status',
  'linked',
  'the first caller atomically creates the link'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.discord_server_guilds
    WHERE invited_with_code = 'PUBSEC_INVITE_TEST'
  ),
  1,
  'one server mapping is created for the invite'
);

SELECT is(
  (
    SELECT current_uses
    FROM public.discord_invite_codes
    WHERE invite_code = 'PUBSEC_INVITE_TEST'
  ),
  1,
  'the invite usage is incremented once'
);

SELECT is(
  (
    SELECT is_active
    FROM public.discord_invite_codes
    WHERE invite_code = 'PUBSEC_INVITE_TEST'
  ),
  false,
  'the consumed invite is deactivated in the same transaction'
);

SELECT is(
  public.consume_discord_bot_invite(
    'PUBSEC_INVITE_TEST',
    '100000000000000003',
    '100000000000000004'
  )->>'status',
  'invalid',
  'a second caller cannot reuse the consumed invite'
);

SELECT * FROM finish();
ROLLBACK;
