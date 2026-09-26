-- Revoke analytics_ro's column SELECT on 55 player_mapping columns: latent under
-- forced RLS, but the first policy for it would publish them.
-- target-db: general
-- A table-level REVOKE also clears column grants, which a table-ACL probe misses.

BEGIN;

-- analytics_ro exists only in production; an unguarded REVOKE aborts a clean replay.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'analytics_ro') THEN
    REVOKE SELECT ON TABLE public.player_mapping FROM analytics_ro;
  END IF;
END
$$;

-- Vacuous where the role is absent; the pgTAP suite seeds it.
DO $probe$
DECLARE
  v_leaked text;
  v_remaining integer;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'analytics_ro') THEN

    SELECT string_agg(c.column_name, ', ')
      INTO v_leaked
      FROM (VALUES ('discord_user_id'), ('discord_username'), ('avatar_url'),
                   ('patreon_user_id'), ('user_id'), ('username'),
                   ('officer_notes'), ('player_notes'),
                   ('tacticus_share_url')) AS c(column_name)
     WHERE has_column_privilege('analytics_ro', 'public.player_mapping',
                                c.column_name, 'SELECT');

    IF v_leaked IS NOT NULL THEN
      RAISE EXCEPTION
        'PS-472: analytics_ro still holds column SELECT on player_mapping identifiers: %',
        v_leaked;
    END IF;

    -- The REVOKE is table-level and the pre-state was column-level. Assert the
    -- column grants actually went rather than assuming the semantics.
    SELECT count(*)
      INTO v_remaining
      FROM pg_attribute a
     WHERE a.attrelid = 'public.player_mapping'::regclass
       AND a.attnum > 0
       AND NOT a.attisdropped
       AND has_column_privilege('analytics_ro', 'public.player_mapping',
                                a.attname, 'SELECT');

    IF v_remaining <> 0 THEN
      RAISE EXCEPTION
        'PS-472: analytics_ro still holds SELECT on % column(s) of player_mapping',
        v_remaining;
    END IF;

  END IF;

  -- INVARIANT 1. Positive control: the revoke did not reach service_role.
  IF has_table_privilege('service_role', 'public.player_mapping', 'SELECT') IS NOT TRUE THEN
    RAISE EXCEPTION
      'PS-472: service_role lost table SELECT on public.player_mapping; invariant 1 is broken';
  END IF;

  -- INVARIANT 2. Positive control: the revoke did not reach authenticated's
  -- column allow-list.
  IF NOT has_column_privilege('authenticated', 'public.player_mapping', 'display_name', 'SELECT') THEN
    RAISE EXCEPTION
      'PS-472: authenticated lost column SELECT on player_mapping.display_name; invariant 2 is broken';
  END IF;
END
$probe$;

COMMIT;
