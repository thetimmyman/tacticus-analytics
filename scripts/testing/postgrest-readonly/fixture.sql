-- Only synthetic data. The source migrations install the actual reader and hook.
CREATE ROLE authenticator LOGIN NOINHERIT;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
GRANT anon,authenticated,service_role TO authenticator;
CREATE SCHEMA supabase_migrations;
CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]);
CREATE TABLE public.fixture_public(id integer PRIMARY KEY,value text);
INSERT INTO public.fixture_public VALUES(1,'original');
CREATE TABLE public.guild_config(guild_code text PRIMARY KEY,user_id text,client_secret text,internal_token text);
INSERT INTO public.guild_config VALUES('FIXTURE','fixture-user','synthetic-secret','synthetic-internal'),('NULLS',NULL,NULL,NULL);
CREATE VIEW public.fixture_secret_view AS SELECT client_secret FROM public.guild_config WHERE guild_code='FIXTURE';
CREATE SEQUENCE public.fixture_seq;
GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;
GRANT SELECT ON public.fixture_public TO anon,authenticated,service_role;
GRANT INSERT,UPDATE,DELETE ON public.fixture_public TO authenticated,service_role;
GRANT SELECT ON public.guild_config,public.fixture_secret_view TO service_role;
ALTER TABLE public.guild_config ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.fixture_seq TO authenticated,service_role;
CREATE FUNCTION public.fixture_backend() RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT jsonb_build_object('pid',pg_backend_pid(),'readonly',current_setting('transaction_read_only'),'role',current_user,'recovery',pg_is_in_recovery())
$$;
CREATE FUNCTION public.fixture_secret() RETURNS text LANGUAGE sql STABLE SECURITY INVOKER AS $$
 SELECT client_secret FROM public.guild_config WHERE guild_code='FIXTURE'
$$;
CREATE FUNCTION public.fixture_definer_secret() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT client_secret FROM public.guild_config WHERE guild_code='FIXTURE'
$$;
REVOKE ALL ON FUNCTION public.fixture_secret(),public.fixture_definer_secret() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fixture_secret(),public.fixture_definer_secret() TO service_role;
CREATE FUNCTION public.fixture_write() RETURNS void LANGUAGE sql VOLATILE AS $$ INSERT INTO public.fixture_public VALUES(5,'write') $$;
CREATE FUNCTION public.fixture_read_volatile() RETURNS integer LANGUAGE sql VOLATILE AS $$ SELECT 1 $$;
CREATE FUNCTION public.fixture_escape() RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 BEGIN PERFORM set_config('transaction_read_only','off',true); EXCEPTION WHEN SQLSTATE '25001' THEN NULL; END;
 INSERT INTO public.fixture_public VALUES(6,'escape');
END $$;
CREATE FUNCTION public.fixture_escape_nested() RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN PERFORM public.fixture_escape(); END $$;
CREATE FUNCTION public.fixture_next_sequence() RETURNS bigint LANGUAGE sql VOLATILE SECURITY DEFINER AS $$ SELECT nextval('public.fixture_seq') $$;

-- Minimal synthetic auth relations needed by the actual source ban function.
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);
CREATE TABLE auth.identities(user_id uuid,provider text,identity_data jsonb);
CREATE TABLE public.user_bans(auth_user_id uuid,subject_type text,subject_value text,lifted_at timestamptz,expires_at timestamptz);
CREATE TABLE public.player_mapping(user_id uuid,is_current boolean,player_id text,discord_user_id text);
INSERT INTO auth.users VALUES('00000000-0000-4000-8000-000000000001','fixture@example.invalid');
INSERT INTO public.user_bans(auth_user_id) VALUES('00000000-0000-4000-8000-000000000001');
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT nullif(current_setting('request.jwt.claims',true)::jsonb->>'sub','')::uuid
$$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
 SELECT current_setting('request.jwt.claims',true)::jsonb->>'role'
$$;
