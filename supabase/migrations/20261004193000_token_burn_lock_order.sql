-- Fix an advisory-lock deadlock in queue_token_burn_notifications(): the
-- per-player subquery feeding its per-player pg_advisory_xact_lock loop had
-- no ORDER BY, so two overlapping sweeps could lock the same two players in
-- opposite order. Add a stable ORDER BY so concurrent runs serialize instead
-- of deadlocking. Does not touch get_player_token_state()'s auth boundary --
-- only sorts its already-returned rows at the call site.
-- target-db: general

BEGIN;

DO $guard$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'this migration targets the General (postgres) database, got %', current_database();
  END IF;
END
$guard$;

-- Preflight: accept either the pre-fix shape or this migration's own body
-- (an out-of-band hotfix of the same code, so re-applying is a no-op). The
-- body is compared as md5 of prosrc with `--` comments stripped and
-- whitespace collapsed, so comment wording may differ but code may not.
-- Anything else is drift and fails loudly instead of being overwritten.
DO $preflight$
DECLARE
  -- Normalized md5 of the $function$ body below; update it with the body.
  c_fixed_body_md5 constant text := 'ec251326dc2eb2217fc27339d0b249a4';
  v_src text;
  v_body_md5 text;
BEGIN
  IF to_regprocedure('public.queue_token_burn_notifications(text,text,timestamptz)') IS NULL THEN
    RAISE EXCEPTION 'preflight: public.queue_token_burn_notifications(text,text,timestamptz) does not exist';
  END IF;

  SELECT pg_get_functiondef(p.oid),
         md5(btrim(regexp_replace(regexp_replace(p.prosrc, '--[^\n]*', '', 'g'), '\s+', ' ', 'g')))
    INTO v_src, v_body_md5
    FROM pg_proc p
   WHERE p.oid = 'public.queue_token_burn_notifications(text,text,timestamptz)'::regprocedure;

  IF v_body_md5 = c_fixed_body_md5 THEN
    RAISE NOTICE 'preflight: queue_token_burn_notifications() already carries this fix; re-applying it is a no-op';
  ELSIF v_src NOT LIKE '%cross join lateral public.record_token_burn_state(%'
     OR v_src LIKE '%order by player_id%' THEN
    RAISE EXCEPTION 'preflight: queue_token_burn_notifications() source is neither the expected pre-fix shape nor this fix (drifted) -- read it before re-applying';
  END IF;
END
$preflight$;

CREATE OR REPLACE FUNCTION public.queue_token_burn_notifications(p_guild_code text DEFAULT NULL::text, p_season text DEFAULT NULL::text, p_now timestamp with time zone DEFAULT now())
 RETURNS TABLE(guild_code text, season text, queued_discord integer, queued_in_app integer, queued_total integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_guild_code text;
  v_season text;
begin
  for v_guild_code in
    select gc.guild_code
    from public.guild_config gc
    where (p_guild_code is null or gc.guild_code = p_guild_code)
      and exists (
        select 1
        from public.player_mapping pm
        where pm.guild_code = gc.guild_code
          and pm.is_current = true
      )
    order by gc.guild_code
  loop
    if p_season is null then
      select e."Season"
      into v_season
      from public."EOT_GR_data" e
      where e."Guild" = v_guild_code
      order by e."timestamp" desc nulls last, e."startedOn" desc nulls last
      limit 1;
    else
      v_season := p_season;
    end if;

    if v_season is null then
      continue;
    end if;

    -- WI-3990: this function now ONLY maintains public.token_burn_state via
    -- record_token_burn_state (burn stats feed /player-performance and
    -- get_player_token_state.burned_tokens). The token_notification_events
    -- inserts were removed with the WI-079 Discord dispatcher retirement
    -- (dead since 2026-06-16); the per-user DM lane replaces that delivery.
    --
    -- ORDER BY player_id pins a deterministic lock-acquisition order for
    -- record_token_burn_state()'s per-player pg_advisory_xact_lock, so two
    -- concurrent sweeps can never request the same two locks in opposite
    -- order.
    perform 1
    from (
      select *
      from public.get_player_token_state(v_guild_code, v_season, null, null)
      where player_id is not null
      order by player_id
    ) ts
    cross join lateral public.record_token_burn_state(
      p_guild_code := v_guild_code,
      p_season := v_season,
      p_player_id := ts.player_id,
      p_display_name := ts.display_name,
      p_tokens_available := ts.tokens_available,
      p_token_next_in_seconds := ts.token_next_in_seconds,
      p_now := p_now
    ) bs;

    guild_code := v_guild_code;
    season := v_season;
    queued_discord := 0;
    queued_in_app := 0;
    queued_total := 0;

    return next;
  end loop;
end;
$function$;

COMMENT ON FUNCTION public.queue_token_burn_notifications(text, text, timestamptz) IS
  'Queues burn_warning and burn_occurred events using token_burn_state + per-channel preferences. Per-player processing order is pinned (order by player_id) to prevent an advisory-lock deadlock between overlapping concurrent runs.';

-- Verify: the fix landed and the signature/grants are unchanged.
DO $verify$
DECLARE
  v_src text;
BEGIN
  SELECT pg_get_functiondef('public.queue_token_burn_notifications(text,text,timestamptz)'::regprocedure)
    INTO v_src;

  IF v_src NOT LIKE '%order by player_id%' THEN
    RAISE EXCEPTION 'verify: queue_token_burn_notifications() does not contain the expected ORDER BY after CREATE OR REPLACE';
  END IF;

  -- Keeps the preflight's pinned hash honest: it must describe this body.
  IF (SELECT md5(btrim(regexp_replace(regexp_replace(p.prosrc, '--[^\n]*', '', 'g'), '\s+', ' ', 'g')))
        FROM pg_proc p
       WHERE p.oid = 'public.queue_token_burn_notifications(text,text,timestamptz)'::regprocedure)
     <> 'ec251326dc2eb2217fc27339d0b249a4' THEN
    RAISE EXCEPTION 'verify: the installed body does not match the preflight''s pinned normalized md5 -- update c_fixed_body_md5';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'queue_token_burn_notifications'
      AND p.prosecdef
      AND pg_get_userbyid(p.proowner) = 'postgres'
  ) THEN
    RAISE EXCEPTION 'verify: queue_token_burn_notifications() is no longer SECURITY DEFINER owned by postgres';
  END IF;
END
$verify$;

COMMIT;

NOTIFY pgrst, 'reload schema';
