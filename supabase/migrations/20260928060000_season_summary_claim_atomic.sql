-- Atomic claim for season_summary_tracking: a plain INSERT then a separate
-- check-before-send lets two overlapping detect-season-end runs both decide
-- to send before either row lands. This does the decision and the claim in
-- one statement, using UNIQUE(cluster_code, season) as the single source of
-- truth a second caller's INSERT collides against. An unsent claim past
-- p_stale_after is reclaimable, so a crashed run doesn't block that season forever.
BEGIN;

CREATE FUNCTION public.claim_season_summary(
  p_cluster_code character varying,
  p_season character varying,
  p_stale_after interval DEFAULT interval '10 minutes'
) RETURNS boolean
    LANGUAGE sql
    SET search_path TO 'public', 'pg_temp'
    AS $$
  INSERT INTO public.season_summary_tracking (cluster_code, season, sent_at)
  VALUES (p_cluster_code, p_season, NULL)
  ON CONFLICT (cluster_code, season) DO UPDATE
    SET sent_at = NULL, created_at = now()
    WHERE season_summary_tracking.sent_at IS NULL
      AND season_summary_tracking.created_at < now() - p_stale_after
  RETURNING true;
$$;

ALTER FUNCTION public.claim_season_summary(character varying, character varying, interval) OWNER TO postgres;

-- Internal to detect-season-end's service-role client only.
REVOKE ALL ON FUNCTION public.claim_season_summary(character varying, character varying, interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_season_summary(character varying, character varying, interval) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
