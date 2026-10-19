-- target-db: general
-- Provision the operator outbound stop: the feature_releases row
-- 'upstream_outbound' that edge and app provider dispatch read. A non-public
-- stage halts dispatch. The row is seeded at 'public' (open) so a migrated
-- deployment can engage the stop through the existing app-admin stage update.
-- It is also restricted to app admins: feature_releases_manage_admins admits
-- any current leader to write, which would let one guild leader halt provider
-- traffic for every guild. Writes to this one key now need an app admin;
-- service_role bypasses row security, and admin_update_feature_stage is a
-- SECURITY DEFINER function that checks app admin itself.
-- Rollback: DROP POLICY feature_releases_upstream_outbound_insert_operator,
-- feature_releases_upstream_outbound_update_operator and
-- feature_releases_upstream_outbound_delete_operator ON public.feature_releases;
-- then DELETE FROM public.feature_releases WHERE feature_key = 'upstream_outbound'
-- (a missing row reads as open).
BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- An existing row keeps whatever stage an operator already set.
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
  'Operator stop. Any stage other than public halts outbound provider requests from the edge runtime and the app provider runtime.',
  'public',
  9999,
  now()
)
ON CONFLICT (feature_key) DO NOTHING;

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

COMMIT;
