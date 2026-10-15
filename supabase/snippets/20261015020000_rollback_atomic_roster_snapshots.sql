-- target-db: general
-- Revoke the new hosted snapshot operations; preserve snapshots and observation
-- state. Restore the previous application image before returning to direct writes.
BEGIN;
DO $guard$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'Roster snapshot rollback requires the General database';
  END IF;
END;
$guard$;
REVOKE ALL ON FUNCTION public.begin_player_roster_refresh(integer,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.persist_player_roster_snapshot(integer,uuid,uuid,jsonb,bigint,boolean) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.get_player_roster_refresh_candidates(integer[],integer,integer,boolean) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.try_begin_player_roster_refresh(integer,uuid,integer,integer,boolean) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.get_player_roster_verification_summary(integer[],integer) FROM PUBLIC,anon,authenticated,service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
