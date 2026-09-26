-- Alerts matching a monitoring.alert_tracking pattern stop posting to Discord;
-- state and liveness are still recorded. The notify() patch raises if an anchor
-- is missing, so it never half-applies.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS monitoring.alert_tracking (
  pattern     text PRIMARY KEY,           -- LIKE pattern, e.g. 'roster.write.%' or an exact key
  plane_key   text NOT NULL,              -- tracking work-item key
  tracked_at  timestamptz NOT NULL DEFAULT now(),
  note        text
);
-- A bare-wildcard pattern would silence the whole notifier.
DO $c$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'alert_tracking_pattern_not_catch_all'
                   AND conrelid = 'monitoring.alert_tracking'::regclass) THEN
    ALTER TABLE monitoring.alert_tracking ADD CONSTRAINT alert_tracking_pattern_not_catch_all
      CHECK (pattern !~ '^[%_.]*$' AND length(replace(replace(pattern, '%', ''), '_', '')) >= 3);
  END IF;
END
$c$;
COMMENT ON TABLE monitoring.alert_tracking IS
  'Alerts tracked as Plane work items by ops-autopilot, which writes and removes rows as the table owner (no other role is granted). Tracked keys are recorded but never posted to Discord. LIKE semantics: _ matches any one character, so an exact key containing _ can over-match; bare wildcards are rejected by a CHECK. Rows do not expire on their own: ops-autopilot removes a row when its Plane item closes (signal clear for an hour).';
REVOKE ALL ON TABLE monitoring.alert_tracking FROM PUBLIC;

CREATE OR REPLACE FUNCTION monitoring.is_tracked(p_alert_key text)
RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'pg_catalog' AS $f$
  SELECT EXISTS (SELECT 1 FROM monitoring.alert_tracking t WHERE p_alert_key LIKE t.pattern);
$f$;
REVOKE ALL ON FUNCTION monitoring.is_tracked(text) FROM PUBLIC;

DO $patch$
DECLARE
  fn       regprocedure := 'monitoring.notify(text,text,text,text,boolean)'::regprocedure;
  def      text := pg_get_functiondef(fn);
  new      text;
  before   record;
  after    record;
  anchor   text := E'    RAISE EXCEPTION ''monitoring.notify: status must be firing|cleared, got %'', p_status;\n  END IF;\n';
  hook_v1  text := E'\n  -- ops-autopilot: tracked in Plane -> record state, never post, never remind.\n  IF monitoring.is_tracked(p_alert_key) THEN\n    p_quiet := true;\n  END IF;\n';
  hook     text := E'\n  -- ops-autopilot: tracked in Plane -> record state, never post, never remind, report not-delivered.\n  IF monitoring.is_tracked(p_alert_key) THEN\n    p_quiet := true;\n    v_tracked := true;\n  END IF;\n';
  decl_old text := E'AS $function$\nDECLARE\n';
  decl_new text := E'AS $function$\nDECLARE\n  v_tracked boolean := false;  -- ops-autopilot: set when the key is tracked in Plane\n';
  ret_old  text := E'\n  RETURN true;\nEXCEPTION';            -- the transition path's final return (any notify() version)
  ret_new  text := E'\n  RETURN NOT v_tracked;  -- true = delivered; a tracked transition is recorded, not posted\nEXCEPTION';
BEGIN
  IF position(hook in def) > 0 AND position(ret_new in def) > 0 AND position(decl_new in def) > 0 THEN
    RETURN;                                                   -- already current (full hook present)
  END IF;
  IF (length(def) - length(replace(def, ret_old, ''))) / length(ret_old) <> 1 OR position(decl_old in def) = 0 THEN
    RAISE EXCEPTION 'monitoring.notify: return/DECLARE anchor not found; tracking NOT applied';
  END IF;
  IF position(hook_v1 in def) > 0 THEN
    new := replace(def, hook_v1, hook);                       -- upgrade the first version of the hook
  ELSIF position(anchor in def) > 0 THEN
    new := replace(def, anchor, anchor || hook);
  ELSE
    RAISE EXCEPTION 'monitoring.notify: status-validation anchor not found; tracking NOT applied';
  END IF;
  new := replace(new, decl_old, decl_new);                    -- only the function's own top-level DECLARE
  new := replace(new, ret_old, ret_new);
  IF (length(new) - length(replace(new, 'v_tracked := true', ''))) / length('v_tracked := true') <> 1
     OR (length(new) - length(replace(new, 'RETURN NOT v_tracked', ''))) / length('RETURN NOT v_tracked') <> 1 THEN
    RAISE EXCEPTION 'monitoring.notify: tracking hook would apply other than exactly once; NOT applied';
  END IF;
  SELECT proowner, proacl::text AS acl, prosecdef, proconfig::text AS cfg INTO before FROM pg_proc WHERE oid = fn;
  EXECUTE new;
  SELECT proowner, proacl::text AS acl, prosecdef, proconfig::text AS cfg INTO after FROM pg_proc WHERE oid = fn;
  IF before IS DISTINCT FROM after THEN
    RAISE EXCEPTION 'monitoring.notify: owner/ACL/SECURITY DEFINER/config changed by the tracking patch (% -> %)', before, after;
  END IF;
  RAISE NOTICE 'monitoring.notify: tracked alerts are recorded, never posted, and report not-delivered';
END
$patch$;

COMMIT;
