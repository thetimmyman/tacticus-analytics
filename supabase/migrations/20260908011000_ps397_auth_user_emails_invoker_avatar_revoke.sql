-- Close two identifier leaks: auth_user_emails ran as owner (analytics_ro read every
-- login email), and SELECT(avatar_url) exposed peers' Discord snowflakes.

BEGIN;

ALTER VIEW public.auth_user_emails SET (security_invoker = on);

COMMENT ON VIEW public.auth_user_emails IS
  'PS-397: security_invoker = on. auth.users has RLS enabled with zero policies, so this view returns rows only to a role with rolbypassrls (service_role, postgres). Do NOT reset security_invoker to restore a reader: that re-lends the owner postgres rights to whoever holds the grant and defeats the empty policy set on auth.users.';

-- analytics_ro exists only in production; an unguarded REVOKE aborts a clean replay.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'analytics_ro') THEN
    REVOKE SELECT ON TABLE public.auth_user_emails FROM analytics_ro;
  END IF;
END
$$;

-- Users still read their own avatar via current_user_player_mapping.
REVOKE SELECT (avatar_url) ON TABLE public.player_mapping FROM authenticated;

-- Probes run in-migration so a partial apply cannot deploy silently.
DO $probe$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'auth_user_emails'
      AND c.reloptions @> ARRAY['security_invoker=on']
  ) THEN
    RAISE EXCEPTION
      'PS-397: public.auth_user_emails did not take security_invoker = on';
  END IF;

  IF has_table_privilege('service_role', 'public.auth_user_emails', 'SELECT') IS NOT TRUE THEN
    RAISE EXCEPTION
      'PS-397: service_role lost SELECT on public.auth_user_emails; invariant 1 is broken';
  END IF;

  IF has_column_privilege('authenticated', 'public.player_mapping', 'avatar_url', 'SELECT') THEN
    RAISE EXCEPTION
      'PS-397: authenticated still holds column SELECT on player_mapping.avatar_url';
  END IF;

  IF NOT has_column_privilege('authenticated', 'public.player_mapping', 'display_name', 'SELECT') THEN
    RAISE EXCEPTION
      'PS-397: the avatar_url revoke took other columns with it; display_name is gone';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'analytics_ro')
     AND has_table_privilege('analytics_ro', 'public.auth_user_emails', 'SELECT') THEN
    RAISE EXCEPTION
      'PS-397: analytics_ro still holds SELECT on public.auth_user_emails';
  END IF;
END
$probe$;

COMMIT;
