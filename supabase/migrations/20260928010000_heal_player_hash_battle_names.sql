-- Battles can be stored under a Player#XXXXXX alias before the roster knows the member's name.
-- target-db: general
-- Once player_mapping holds a real name, alias battle rows take it, on either write order.

BEGIN;

DO $guard$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'heal_player_hash_battle_names (20260928010000) is general-database-only. Refusing to apply to %', current_database();
  END IF;
END
$guard$;

-- player_mapping and EOT_GR_data are hot; fail fast rather than queue writers behind a long reader.
SET LOCAL lock_timeout = '5s';

-- Mirrors the app resolver: aliases, create-config placeholders, raw UUIDs and tombstones are not names.
CREATE OR REPLACE FUNCTION public.is_placeholder_player_name(p_name text)
    RETURNS boolean
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    SET search_path TO 'pg_catalog'
AS $$
    SELECT p_name IS NULL
        OR btrim(p_name) = ''
        OR p_name ~* '^Player#[0-9a-f]{1,12}$'
        OR p_name ~* '^Player-[0-9a-f-]{1,12}$'
        OR p_name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        OR starts_with(p_name, '[DELETED_USER_');
$$;

ALTER FUNCTION public.is_placeholder_player_name(text) OWNER TO postgres;

-- Erasure-pending members keep their alias; erased members carry a tombstone name and never heal.
CREATE OR REPLACE FUNCTION public.player_name_heal_blocked(p_user_id uuid)
    RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
AS $$
    SELECT p_user_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM gdpr_deletion_requests r
        WHERE r.user_id = p_user_id AND r.status <> 'cancelled'
    );
$$;

ALTER FUNCTION public.player_name_heal_blocked(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.player_name_heal_blocked(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.heal_player_hash_battle_names()
    RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
AS $$
BEGIN
    IF player_name_heal_blocked(NEW.user_id) THEN
        RETURN NULL;
    END IF;

    -- Case and whitespace variants of the id are listed, not computed, so the userId index still applies.
    UPDATE "EOT_GR_data"
       SET "displayName" = NEW.display_name
     WHERE "userId" IN (NEW.player_id, btrim(NEW.player_id),
                        lower(btrim(NEW.player_id)), upper(btrim(NEW.player_id)))
       AND is_placeholder_player_name("displayName")
       AND NOT starts_with("displayName", '[DELETED_USER_');

    RETURN NULL;
END;
$$;

ALTER FUNCTION public.heal_player_hash_battle_names() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.heal_player_hash_battle_names() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE TRIGGER trg_player_mapping_heal_battle_names_ins
    AFTER INSERT ON public.player_mapping
    FOR EACH ROW
    WHEN (NEW.player_id IS NOT NULL AND NOT public.is_placeholder_player_name(NEW.display_name))
    EXECUTE FUNCTION public.heal_player_hash_battle_names();

-- Only a changed name fires on update, so roster upserts that rewrite the same name stay cheap.
CREATE OR REPLACE TRIGGER trg_player_mapping_heal_battle_names_upd
    AFTER UPDATE OF display_name ON public.player_mapping
    FOR EACH ROW
    WHEN (OLD.display_name IS DISTINCT FROM NEW.display_name
          AND NEW.player_id IS NOT NULL
          AND NOT public.is_placeholder_player_name(NEW.display_name))
    EXECUTE FUNCTION public.heal_player_hash_battle_names();

-- A battle written under an alias after the name is already known takes the mapped name.
CREATE OR REPLACE FUNCTION public.eot_gr_data_resolve_alias_on_insert()
    RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
    v_name text;
    v_user uuid;
BEGIN
    SELECT pm.display_name, pm.user_id INTO v_name, v_user
      FROM player_mapping pm
     WHERE pm.player_id = NEW."userId";

    IF v_name IS NOT NULL
       AND NOT is_placeholder_player_name(v_name)
       AND NOT player_name_heal_blocked(v_user) THEN
        NEW."displayName" := v_name;
    END IF;

    RETURN NEW;
END;
$$;

ALTER FUNCTION public.eot_gr_data_resolve_alias_on_insert() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.eot_gr_data_resolve_alias_on_insert() FROM PUBLIC, anon, authenticated;

-- Named to sort before the retombstone trigger, which still has the last word for erased members.
CREATE OR REPLACE TRIGGER trg_eot_gr_data_heal_alias_insert
    BEFORE INSERT ON public."EOT_GR_data"
    FOR EACH ROW
    WHEN (NEW."userId" IS NOT NULL
          AND NEW."displayName" ~* '^(Player#[0-9a-f]{1,12}|Player-[0-9a-f-]{1,12})$')
    EXECUTE FUNCTION public.eot_gr_data_resolve_alias_on_insert();

COMMIT;
