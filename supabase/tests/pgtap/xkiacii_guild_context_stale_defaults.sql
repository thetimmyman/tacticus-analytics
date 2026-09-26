BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;

SELECT plan(6);

-- BRAVO is linked to D2, so a stale D1 default naming BRAVO must never resolve.
INSERT INTO public.guild_config (id, guild_code, display_name, created_at, enabled)
VALUES
  (925401, 'xkiaciiA', 'xkiacii Alpha', now(), true),
  (925402, 'xkiaciiB', 'xkiacii Bravo', now(), true),
  (925403, 'xkiaciiC', 'xkiacii Gamma', now(), true);

INSERT INTO public.discord_server_guilds (discord_guild_id, game_guild_code, is_active, linked_at)
VALUES
  ('d1-2554', 'xkiaciiA', true,  now() - interval '2 days'),
  ('d2-2554', 'xkiaciiB', true,  now() - interval '2 days'),
  ('d1-2554', 'xkiaciiB', false, now() - interval '9 days'); -- unlinked from D1

INSERT INTO public.discord_user_guild_defaults (discord_guild_id, discord_user_id, game_guild_code)
VALUES
  ('d1-2554', 'u-stale-2554', 'xkiaciiB'),  -- stale: BRAVO no longer active on D1
  ('d1-2554', 'u-valid-2554', 'xkiaciiA');  -- valid

INSERT INTO public.discord_channel_guilds (discord_guild_id, discord_channel_id, game_guild_code, default_for_tokens)
VALUES
  ('d1-2554', 'c-stale-2554', 'xkiaciiB', true); -- stale channel default

SELECT results_eq(
  $$ SELECT guild_code, source FROM public.resolve_discord_guild_context('d1-2554', 'u-stale-2554', NULL, 'tokens', NULL) $$,
  $$ VALUES ('xkiaciiA'::text, 'default'::text) $$,
  'stale user default (unlinked guild) falls through to the single linked guild'
);

SELECT results_eq(
  $$ SELECT guild_code, source FROM public.resolve_discord_guild_context('d1-2554', 'u-valid-2554', NULL, 'tokens', NULL) $$,
  $$ VALUES ('xkiaciiA'::text, 'user'::text) $$,
  'valid user default resolves with source=user'
);

SELECT results_eq(
  $$ SELECT guild_code, source FROM public.resolve_discord_guild_context('d1-2554', NULL, 'c-stale-2554', 'tokens', NULL) $$,
  $$ VALUES ('xkiaciiA'::text, 'default'::text) $$,
  'stale channel default (unlinked guild) falls through to the single linked guild'
);

INSERT INTO public.discord_server_guilds (discord_guild_id, game_guild_code, is_active, linked_at)
VALUES ('d1-2554', 'xkiaciiC', true, now() - interval '1 day');

SELECT results_eq(
  $$ SELECT source FROM public.resolve_discord_guild_context('d1-2554', 'u-stale-2554', NULL, 'tokens', NULL) $$,
  $$ VALUES ('ambiguous'::text) $$,
  'stale user default on a multi-guild server yields ambiguous, never the unlinked guild'
);

SELECT is_empty(
  $$ SELECT 1 FROM public.resolve_discord_guild_context('d1-2554', 'u-stale-2554', 'c-stale-2554', 'tokens', NULL)
     WHERE guild_code = 'xkiaciiB' $$,
  'unlinked guild BRAVO is never resolved on server D1'
);

-- BRAVO still resolves on its own server (guards against over-filtering).
SELECT results_eq(
  $$ SELECT guild_code, source FROM public.resolve_discord_guild_context('d2-2554', NULL, NULL, 'tokens', NULL) $$,
  $$ VALUES ('xkiaciiB'::text, 'default'::text) $$,
  'actively linked guild still resolves on its own server'
);

SELECT * FROM finish();

ROLLBACK;
