BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO extensions, public, pg_catalog;
SET LOCAL timezone TO 'UTC';

SELECT plan(3);

SELECT is(
  (SELECT count(*)::int FROM unnest(ARRAY[
    'add_guild_to_cluster(text,text,text,text)',
    'add_guild_to_cluster_safe(text,text,text,text)',
    'analyze_player_progression(text,text)',
    'calculate_votlw_if_scheduled()',
    'get_boss_leaderboard(text,text,text,integer)',
    'get_homepage_statistics()',
    'get_mythic_boss_hp()',
    'hash_password(text)',
    'register_user(text,text,text)',
    'upsert_subscription_from_stripe(text,text,text,text,timestamp with time zone,timestamp with time zone,boolean,timestamp with time zone)',
    'verify_password(text,text)'
  ]) AS sig
  WHERE to_regprocedure('public.' || sig) IS NOT NULL),
  0,
  '1. a representative sample of the retired signatures stays absent'
);

-- The name overlaps a retired 4-arg signature; only that exact overload was retired,
-- so the pre-existing 3-arg overload must still be live.
SELECT ok(to_regprocedure('public.add_guild_to_cluster(text,text,text)') IS NOT NULL,
  '2. a surviving sibling overload of a partially retired name is untouched');

SELECT ok(to_regprocedure('public.get_all_boss_hp(text)') IS NOT NULL,
  '3. get_all_boss_hp is not part of this retirement');

ROLLBACK;
