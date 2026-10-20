-- target-db: general
-- Provision the outbound stop: feature_releases row 'upstream_outbound', seeded
-- open ('public'), writable only by an app admin or the service role. The
-- permissive leader policy would let any guild leader halt every guild.
-- Rollback: DROP the three feature_releases_upstream_outbound_*_operator
-- policies, then DELETE the row (a missing row reads as open).
BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- RESTRICTIVE: ANDed with feature_releases_manage_admins, so a leader who
-- passes that policy is still refused on this key unless also an app admin.
CREATE POLICY feature_releases_upstream_outbound_insert_operator
  ON public.feature_releases
  AS RESTRICTIVE
  FOR INSERT
  WITH CHECK (
    feature_key <> 'upstream_outbound' OR public._pm_caller_is_app_admin()
  );

-- USING guards the stored row, WITH CHECK guards the new one, so a row cannot
-- be renamed onto or away from the key either.
CREATE POLICY feature_releases_upstream_outbound_update_operator
  ON public.feature_releases
  AS RESTRICTIVE
  FOR UPDATE
  USING (
    feature_key <> 'upstream_outbound' OR public._pm_caller_is_app_admin()
  )
  WITH CHECK (
    feature_key <> 'upstream_outbound' OR public._pm_caller_is_app_admin()
  );

CREATE POLICY feature_releases_upstream_outbound_delete_operator
  ON public.feature_releases
  AS RESTRICTIVE
  FOR DELETE
  USING (
    feature_key <> 'upstream_outbound' OR public._pm_caller_is_app_admin()
  );

-- Policies first, so no leader can plant the row while the seed runs.
-- No operator path wrote this key before this migration, so a row already
-- here was planted (a guild leader could insert it) and is reset to open.
INSERT INTO public.feature_releases (
  feature_key,
  display_name,
  description,
  release_stage,
  sort_order,
  released_at
)
VALUES (
  'upstream_outbound',
  'Upstream provider traffic',
  'Operator stop. Any stage other than public halts outbound provider requests where the stop is enforced.',
  'public',
  9999,
  now()
)
ON CONFLICT (feature_key) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  release_stage = EXCLUDED.release_stage,
  icon = NULL,
  route = NULL,
  value_proposition = NULL,
  sort_order = EXCLUDED.sort_order,
  released_at = EXCLUDED.released_at;

COMMIT;
