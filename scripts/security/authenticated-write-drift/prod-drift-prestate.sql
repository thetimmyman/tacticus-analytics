-- Two swept tables where neither `authenticated` nor service_role can write, as measured on production.
-- Loaded as live pre-state before later migrations; nothing here is captured from production.
REVOKE INSERT, UPDATE, DELETE ON public.player_invite_codes FROM authenticated, service_role;
REVOKE INSERT, UPDATE, DELETE ON public.guild_war_visibility_audit FROM authenticated, service_role;
