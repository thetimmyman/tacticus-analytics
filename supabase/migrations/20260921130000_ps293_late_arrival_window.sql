-- Narrow leg (c)'s late-arrival test to battles played before the audit row but
-- stored after; the whole-history form excluded anyone who battled again.
-- target-db: general
-- Byte-identical to the sibling database's body; tests/security/ps200-monitor-body-pin.test.ts pins it.
--   sha256 = 01caa2e66dd0a0b8921f68cab9718e10c5d47db74b5672bef1c5407d2824a403

BEGIN;

DO $guard$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION
      'PS-293 (20260921130000) is the General half; the other database''s half is the companion migration in the sibling repository. Refusing to apply to %',
      current_database();
  END IF;
END
$guard$;

-- Everything outside the leg (c) predicate is byte-for-byte 20260904080000's body.
CREATE OR REPLACE FUNCTION public.run_token_invariant_monitor()
RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_temp
SET statement_timeout = '10min'
AS $fn$
DECLARE
  v_db          text := current_database();
  v_role        text;
  v_blind       text := '';
  v_ctx         text := '';
  v_have_audit  boolean := to_regclass('public.token_audit_snapshots') IS NOT NULL;
  -- PS-200: the battle table leg (c)'s freshness guard reads. Absent => the
  -- guard is INACTIVE and leg (c) rates the whole window, as it did before.
  v_have_battles boolean := to_regclass('public."EOT_GR_data"') IS NOT NULL;

  -- The workflow's WINDOW and RATE_WINDOW, verbatim. GREATEST() clamps the rate
  -- window to the WI-2640 Phase-2 cutover (app deploy 94f18d3c) so rows made by
  -- the RETIRED pre-anchor estimator cannot fail the floor while they age out;
  -- it went inert on 2026-07-17 ~20:25Z and needs no cleanup. The deadness leg
  -- intentionally keeps the plain window.
  c_window      timestamptz := now() - interval '26 hours';
  c_rate_window timestamptz := GREATEST(now() - interval '26 hours',
                                        timestamptz '2026-07-16 18:25+00');

  v_viol_n      bigint;
  v_viol_rows   text;
  v_drift_n     bigint;
  v_drift_rows  text;
  v_n           bigint;      -- RATED rows (PS-200: excludes late-arrival)
  v_n_seen      bigint;      -- PS-200: rows in the window before the guard
  v_late_n      bigint := 0; -- PS-200: rows excluded as late-arrival
  v_guard       text;        -- PS-200: 'active' | why it is not
  v_fresh       text := '';  -- PS-200: the informational line
  v_rep_exact   bigint;
  v_rpc_exact   bigint;
  v_rep_gross   bigint;
  v_rpc_gross   bigint;
  v_breaches    text[];
  v_total       bigint;
  v_rpc_nulls   bigint;
  v_cpta_nulls  bigint;
  v_dark        text := '';
BEGIN
  -- Security hardening (2026-08-20 review): the function is SECURITY INVOKER
  -- and its body enters the service role, so an EXECUTE grant to any role the
  -- PostgREST `authenticator` can reach would become a privilege ladder. The
  -- ACL is postgres-only and pgTAP pins it, but ACLs drift; this guard makes
  -- the ladder unreachable regardless. pg_cron always calls as postgres.
  IF NOT pg_has_role(session_user, 'postgres', 'MEMBER') THEN
    RAISE EXCEPTION 'run_token_invariant_monitor is pg_cron/postgres-only (called as %)', session_user;
  END IF;

  -- -------------------------------------------------------------------------
  -- C1: resolve the FORKED service role at runtime.
  -- -------------------------------------------------------------------------
  -- get_player_token_state (WI-3139) binds authorization to the EFFECTIVE
  -- DATABASE ROLE; without it the invariant wrapper returns nothing and this
  -- monitor reports a triumphant, meaningless all-clear. The two databases have
  -- DIFFERENT service roles — measured 2026-08-20:
  --   General DB  get_player_token_state proacl {postgres=X/postgres, service_role=X/postgres}
  --   the other DB  get_player_token_state proacl {postgres=X/postgres, eot_service_role=X/postgres}
  -- Both roles EXIST cluster-wide (roles are global), so existence cannot tell
  -- the forks apart, and has_database_privilege(..., 'CONNECT') is the wrong
  -- probe: PostgREST enters these roles via SET ROLE from `authenticator`, so
  -- neither carries CONNECT on either database (measured, both false). The
  -- EXECUTE grant on the function whose trust decision we need IS the
  -- discriminator, so that is what we test.
  -- Wrapped so a dropped/re-signatured get_player_token_state degrades to
  -- v_role NULL — which every leg turns into the blind alert — instead of
  -- aborting the whole monitor into total silence (robustness note, 2026-08-20
  -- security review; the C3 watcher would catch an abort, but only after 26h).
  BEGIN
    SELECT r.rolname INTO v_role
    FROM pg_roles r
    WHERE r.rolname IN ('service_role', 'eot_service_role', 'eot_web_service')
      AND has_function_privilege(
            r.rolname,
            'public.get_player_token_state(text,text,text,text)',
            'EXECUTE')
      AND pg_has_role(session_user, r.oid, 'MEMBER')
    -- Tie-break only: the WHERE clause above already restricts the set to
    -- roles that hold the EXECUTE grant AND that session_user can enter, so
    -- this merely states the preferred name per fork. Phrased as "is this the
    -- General database?" rather than naming the other one, so the body carries
    -- no hard-coded name for a database it does not belong to.
    ORDER BY (r.rolname = CASE WHEN v_db = 'postgres'
                               THEN 'service_role' ELSE 'eot_service_role' END) DESC,
             r.rolname
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_role := NULL;
  END;

  v_ctx := format('database=%s, service role=%s, audit table=%s',
                  v_db, coalesce(v_role, 'UNRESOLVED'),
                  CASE WHEN v_have_audit THEN 'present' ELSE 'ABSENT (legs b-e skipped)' END);

  -- -------------------------------------------------------------------------
  -- Leg (a) — the accrual invariant. ALWAYS runs (C5): it does not depend on
  -- token_audit_snapshots.
  -- -------------------------------------------------------------------------
  BEGIN
    IF v_role IS NULL THEN
      RAISE EXCEPTION
        'no assumable service role in %: neither service_role nor eot_service_role holds EXECUTE on public.get_player_token_state', v_db;
    END IF;
    EXECUTE format('SET LOCAL ROLE %I', v_role);

    -- count over the WHOLE set, sample text over the first 40. A plain
    -- `LIMIT 40` subquery would cap the count as well and silently understate
    -- a large violation set.
    SELECT count(*),
           string_agg(
             format('%s | season %s | %s (%s) used=%s available=%s max=%s excess=%s',
                    v.guild_code, v.season, v.display_name, v.player_id,
                    v.tokens_used, v.tokens_available, v.max_accruable, v.excess),
             E'\n') FILTER (WHERE v.rn <= 40)
      INTO v_viol_n, v_viol_rows
      FROM (SELECT f.*, row_number() OVER () AS rn
              FROM public.find_token_accrual_violations() f) v;

    -- Back to the definer role: monitoring.notify is postgres-owned and the
    -- service roles hold no EXECUTE on it (measured 2026-08-20, both DBs).
    RESET ROLE;

    IF v_viol_n > 0 THEN
      PERFORM monitoring.notify(
        'tokens.accrual', 'firing',
        format('Token accrual invariant VIOLATED on %s', v_db),
        format(E'%s row(s) where tokens_used + tokens_available exceeds the accruable bound. This is a data/logic defect, not player behavior.\n\n%s\n\n-- context --\n%s',
               v_viol_n, v_viol_rows, v_ctx));
    ELSE
      PERFORM monitoring.notify(
        'tokens.accrual', 'cleared',
        format('Token accrual invariant holds on %s', v_db),
        format(E'No violations.\n\n-- context --\n%s', v_ctx));
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- C4: the leg's OWN key is left untouched — a check that could not run must
    -- never render as a clean result. Deliberately NOT the blanket
    -- `WHEN OTHERS THEN RAISE WARNING` that check_pgnet_freshness uses: that
    -- swallows the failure into a log line nobody reads.
    v_blind := v_blind || format(E'\n- leg (a) accrual invariant: %s', SQLERRM);
  END;

  -- -------------------------------------------------------------------------
  -- Legs (b)-(e) — the token_audit_snapshots thresholds.
  -- C5: when the table is absent these legs SKIP. Their keys are left as they
  -- were; they are never cleared, because nothing was measured.
  -- -------------------------------------------------------------------------
  IF v_have_audit THEN
    -- (b) constants drift: the game's own Token.max / regenDelayInSeconds no
    --     longer match token-calculation.ts. Page-everything severity.
    BEGIN
      IF v_role IS NULL THEN
        RAISE EXCEPTION 'no assumable service role in %', v_db;
      END IF;
      EXECUTE format('SET LOCAL ROLE %I', v_role);
      SELECT count(*),
             string_agg(format('%s | %s | max=%s regen=%ss | %s',
                               d.guild_code, d.display_name, d.live_tokens_max,
                               d.live_regen_delay_seconds, d.created_at),
                        E'\n') FILTER (WHERE d.rn <= 40)
        INTO v_drift_n, v_drift_rows
        FROM (SELECT t.*, row_number() OVER (ORDER BY t.created_at DESC) AS rn
                FROM public.token_audit_snapshots t
               WHERE t.created_at > c_window AND NOT t.constants_ok) d;
      RESET ROLE;

      IF v_drift_n > 0 THEN
        PERFORM monitoring.notify(
          'tokens.constants', 'firing',
          format('TOKEN ECONOMY CONSTANTS DRIFT on %s', v_db),
          format(E'Live API max/regen disagrees with token-calculation.ts — Snowprint changed the economy or the API contract.\n\n%s\n\n-- context --\n%s',
                 v_drift_rows, v_ctx));
      ELSE
        PERFORM monitoring.notify(
          'tokens.constants', 'cleared',
          format('Token economy constants agree on %s', v_db),
          format(E'No constants drift in the last 26h.\n\n-- context --\n%s', v_ctx));
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_blind := v_blind || format(E'\n- leg (b) constants drift: %s', SQLERRM);
    END;

    -- (c) estimator rate thresholds, with the PS-200 late-arrival freshness
    --     guard. cpta is EXCLUDED from this hard gate; its NULL-darkness check
    --     is leg (e).
    BEGIN
      IF v_role IS NULL THEN
        RAISE EXCEPTION 'no assumable service role in %', v_db;
      END IF;
      EXECUTE format('SET LOCAL ROLE %I', v_role);

      IF v_have_battles THEN
        BEGIN
          WITH win AS (
            SELECT t.replay_tokens_delta,
                   t.rpc_tokens_delta,
                   -- PS-293: a row is late only when a battle that had
                   -- ALREADY HAPPENED at audit time landed afterwards. Two
                   -- independent witnesses, OR-ed; see the header.
                   (
                     -- (1) arrival clock after the audit, battle clock before
                     --     it: the replay was rated without this spend.
                     EXISTS (
                       SELECT 1
                         FROM public."EOT_GR_data" g
                        WHERE g."Guild"  = t.guild_code
                          AND g."userId" = t.player_id
                          AND g."Season" = t.season
                          AND g."timestamp" IS NOT NULL
                          AND g."timestamp" > t.created_at
                          AND g."startedOn" IS NOT NULL
                          AND g."startedOn" <= t.created_at
                     )
                     OR
                     -- (2) insert-order inversion: a row whose arrival clock
                     --     is at/ before the audit carries a HIGHER id than a
                     --     row whose arrival clock is after it, so it was
                     --     inserted later still. Catches a late row whose
                     --     `"timestamp"` an importer carried from the source.
                     (
                       SELECT coalesce(max(g.id), 0)
                         FROM public."EOT_GR_data" g
                        WHERE g."Guild"  = t.guild_code
                          AND g."userId" = t.player_id
                          AND g."Season" = t.season
                          AND g."timestamp" IS NOT NULL
                          AND g."timestamp" <= t.created_at
                     ) > (
                       SELECT coalesce(min(g.id), 9223372036854775807)
                         FROM public."EOT_GR_data" g
                        WHERE g."Guild"  = t.guild_code
                          AND g."userId" = t.player_id
                          AND g."Season" = t.season
                          AND g."timestamp" IS NOT NULL
                          AND g."timestamp" > t.created_at
                     )
                   ) AS late_arrival
              FROM public.token_audit_snapshots t
             WHERE t.created_at > c_rate_window
          )
          SELECT count(*),
                 count(*) FILTER (WHERE NOT late_arrival),
                 count(*) FILTER (WHERE late_arrival),
                 count(*) FILTER (WHERE NOT late_arrival AND replay_tokens_delta = 0),
                 count(*) FILTER (WHERE NOT late_arrival AND rpc_tokens_delta = 0),
                 count(*) FILTER (WHERE NOT late_arrival AND abs(coalesce(replay_tokens_delta, 0)) >= 2),
                 count(*) FILTER (WHERE NOT late_arrival AND abs(coalesce(rpc_tokens_delta, 0)) >= 2)
            INTO v_n_seen, v_n, v_late_n,
                 v_rep_exact, v_rpc_exact, v_rep_gross, v_rpc_gross
            FROM win;
          v_guard := 'active';
        EXCEPTION WHEN OTHERS THEN
          -- The guard may only ever SUBTRACT rows. If it cannot look, it
          -- subtracts none and names the reason; it must never blind leg (c).
          v_guard := format('UNAVAILABLE (%s)', SQLERRM);
        END;
      ELSE
        v_guard := 'INACTIVE (public."EOT_GR_data" is absent)';
      END IF;

      IF v_guard IS DISTINCT FROM 'active' THEN
        -- Pre-PS-200 counts, verbatim.
        SELECT count(*),
               count(*) FILTER (WHERE replay_tokens_delta = 0),
               count(*) FILTER (WHERE rpc_tokens_delta = 0),
               count(*) FILTER (WHERE abs(coalesce(replay_tokens_delta, 0)) >= 2),
               count(*) FILTER (WHERE abs(coalesce(rpc_tokens_delta, 0)) >= 2)
          INTO v_n_seen, v_rep_exact, v_rpc_exact, v_rep_gross, v_rpc_gross
          FROM public.token_audit_snapshots
         WHERE created_at > c_rate_window;
        v_n := v_n_seen;
        v_late_n := 0;
      END IF;
      RESET ROLE;

      -- The informational line. NEVER a breach: it is not appended to
      -- v_breaches, so no exclusion can fire tokens.estimator by itself.
      IF v_guard = 'active' THEN
        v_fresh := format(
          'freshness guard (PS-200): %s of %s in-window audit row(s) excluded as late-arrival (%s%% of the window), %s rated. Excluded rows are players whose EOT_GR_data battle rows were ingested AFTER their audit row was written, so the replay had incomplete input; this line is informational and is never itself a breach.',
          v_late_n, v_n_seen,
          CASE WHEN v_n_seen > 0
               THEN round((v_late_n * 100.0) / v_n_seen, 1)::text
               ELSE 'n/a' END,
          v_n);
      ELSE
        v_fresh := format(
          'freshness guard (PS-200): %s — 0 rows excluded, all %s in-window row(s) rated exactly as before the guard.',
          v_guard, v_n_seen);
      END IF;
      v_ctx := v_ctx || E'\n' || v_fresh;

      v_breaches := public.token_estimator_rate_breaches('replay', v_n, v_rep_exact, v_rep_gross)
                 || public.token_estimator_rate_breaches('rpc',    v_n, v_rpc_exact, v_rpc_gross);

      IF v_n = 0 THEN
        -- Not a pass. Nothing rateable, so the key keeps whatever it held —
        -- including when the guard excluded every row in the window.
        RAISE NOTICE '[run_token_invariant_monitor] leg (c): 0 RATED rows in the clamped rate window on % (% seen, % excluded as late-arrival) — key left untouched', v_db, v_n_seen, v_late_n;
        v_ctx := v_ctx || format(E'\nleg (c): 0 RATED rows in the clamped rate window (%s seen, %s excluded as late-arrival) — not rated, key untouched',
                                 v_n_seen, v_late_n);
      ELSIF coalesce(array_length(v_breaches, 1), 0) > 0 THEN
        PERFORM monitoring.notify(
          'tokens.estimator', 'firing',
          format('Token estimator regression on %s', v_db),
          format(E'%s\n\nWindow from %s (clamped to the WI-2640 Phase-2 cutover), n=%s rated of %s seen. Counts over the RATED rows: replay exact %s, gross %s; rpc exact %s, gross %s. cpta is excluded from this gate (WI-2640 S4 retirement candidate).\n\n%s\n\n-- context --\n%s',
                 array_to_string(v_breaches, E'\n'), c_rate_window, v_n, v_n_seen,
                 v_rep_exact, v_rep_gross, v_rpc_exact, v_rpc_gross, v_fresh, v_ctx));
      ELSE
        PERFORM monitoring.notify(
          'tokens.estimator', 'cleared',
          format('Token estimator rates within thresholds on %s', v_db),
          format(E'n=%s rated of %s seen since %s. replay exact %s, gross %s; rpc exact %s, gross %s. Floor 70%% exact, ceiling 8%% |delta|>=2.\n\n%s\n\n-- context --\n%s',
                 v_n, v_n_seen, c_rate_window, v_rep_exact, v_rep_gross,
                 v_rpc_exact, v_rpc_gross, v_fresh, v_ctx));
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_blind := v_blind || format(E'\n- leg (c) estimator rates: %s', SQLERRM);
    END;

    -- (d) deadness: the table exists but nothing wrote in the window. Green-
    --     while-blind is exactly the failure mode this monitor exists to kill.
    --     Deliberately UNGUARDED by PS-200: "did anything write at all" must
    --     never be narrowed by a freshness filter.
    BEGIN
      IF v_role IS NULL THEN
        RAISE EXCEPTION 'no assumable service role in %', v_db;
      END IF;
      EXECUTE format('SET LOCAL ROLE %I', v_role);
      SELECT count(*),
             count(*) FILTER (WHERE rpc_tokens_delta IS NULL),
             count(*) FILTER (WHERE cpta_tokens_delta IS NULL)
        INTO v_total, v_rpc_nulls, v_cpta_nulls
        FROM public.token_audit_snapshots
       WHERE created_at > c_window;
      RESET ROLE;

      IF v_total = 0 THEN
        PERFORM monitoring.notify(
          'tokens.audit.deadness', 'firing',
          format('token_audit_snapshots is DEAD on %s', v_db),
          format(E'The table is deployed but has ZERO rows in the last 26h — token-audit-hourly / /api/cron/token-audit stopped writing. No live-vs-estimator evidence is being collected.\n\n-- context --\n%s', v_ctx));
      ELSE
        PERFORM monitoring.notify(
          'tokens.audit.deadness', 'cleared',
          format('token_audit_snapshots is writing on %s', v_db),
          format(E'%s rows in the last 26h.\n\n-- context --\n%s', v_total, v_ctx));
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_blind := v_blind || format(E'\n- leg (d) audit deadness: %s', SQLERRM);
      v_total := NULL;
    END;

    -- (e) NULL estimator darkness: the live reading landed but an estimator
    --     produced nothing to compare. NULL must not read as "matched".
    --     Skipped when the window is empty — leg (d) owns that case, and
    --     0 = 0 would otherwise fire a false all-NULL alarm. Also deliberately
    --     UNGUARDED: an estimator producing only NULLs is an outage whatever
    --     the freshness of its inputs.
    IF v_total IS NOT NULL AND v_total > 0 THEN
      BEGIN
        IF v_rpc_nulls = v_total THEN
          v_dark := v_dark || format(E'\n- all %s rows have NULL rpc_tokens_delta — get_player_token_state produced nothing to compare against live. Estimator outage, not a pass.', v_total);
        END IF;
        IF v_cpta_nulls = v_total THEN
          v_dark := v_dark || format(E'\n- all %s rows have NULL cpta_tokens_delta — compute_player_tokens_available (via get_token_usage_for_guild) produced nothing to compare against live.', v_total);
        END IF;

        IF v_dark <> '' THEN
          PERFORM monitoring.notify(
            'tokens.estimator.dark', 'firing',
            format('Token estimator is DARK on %s', v_db),
            format(E'%s\n\n-- context --\n%s', v_dark, v_ctx));
        ELSE
          PERFORM monitoring.notify(
            'tokens.estimator.dark', 'cleared',
            format('Token estimators are reporting on %s', v_db),
            format(E'Of %s rows in the last 26h: %s NULL rpc_tokens_delta, %s NULL cpta_tokens_delta (partial NULLs are uncompared, not passing).\n\n-- context --\n%s',
                   v_total, v_rpc_nulls, v_cpta_nulls, v_ctx));
        END IF;
      EXCEPTION WHEN OTHERS THEN
        v_blind := v_blind || format(E'\n- leg (e) estimator darkness: %s', SQLERRM);
      END;
    END IF;
  END IF;

  -- -------------------------------------------------------------------------
  -- C4: could-not-look, on its own key. A firing blind key does NOT say the
  -- invariant is broken — it says nothing was measured.
  -- -------------------------------------------------------------------------
  IF v_blind <> '' THEN
    PERFORM monitoring.notify(
      'tokens.monitor.blind', 'firing',
      format('Token invariant monitor could not look on %s', v_db),
      format(E'One or more legs raised. Their own alert keys were LEFT UNTOUCHED, so nothing here says the invariant is clean OR dirty — only that it was not measured.%s\n\n-- context --\n%s',
             v_blind, v_ctx));
  ELSE
    PERFORM monitoring.notify(
      'tokens.monitor.blind', 'cleared',
      format('Token invariant monitor is looking again on %s', v_db),
      format(E'Every scheduled leg completed.\n\n-- context --\n%s', v_ctx));
  END IF;

  -- -------------------------------------------------------------------------
  -- Heartbeat. monitoring.notify() refreshes last_seen_at on every call, even
  -- when the status is unchanged, so
  --   SELECT last_seen_at FROM monitoring.alert_state
  --    WHERE alert_key = 'tokens.monitor.heartbeat'
  -- is a durable "when did this monitor last complete", queryable from outside
  -- the database. The C3 watcher reads exactly that.
  -- -------------------------------------------------------------------------
  PERFORM monitoring.notify(
    'tokens.monitor.heartbeat', 'cleared',
    format('Token invariant monitor ran on %s', v_db),
    format(E'Completed at %s.\n\n-- context --\n%s', now(), v_ctx));
END;
$fn$;

-- CREATE OR REPLACE rewrites proconfig; re-assert the 10-minute bound.
ALTER FUNCTION public.run_token_invariant_monitor()
  SET statement_timeout = '10min';

COMMENT ON FUNCTION public.run_token_invariant_monitor() IS
'WI-7370. Daily 09:23 UTC (pg_cron `token-invariant-monitor` on the General
database, `eot-token-invariant-monitor` via schedule_in_database on the second
database in this estate). Ports
every leg of the retired .github/workflows/token-invariant-monitor.yml into the
database so the check needs no kube verb, no ServiceAccount and no CI
credential (WI-6760 closed that path). Enters the database''s OWN service role
(service_role / eot_service_role, resolved at runtime by EXECUTE on
get_player_token_state) because WI-3139 binds get_player_token_state''s trust to
the effective role — which is also why this is SECURITY INVOKER: Postgres
forbids SET ROLE inside a definer context, and the only caller is pg_cron
running as the postgres owner, so the definer bit would add no privilege and
only enlarge the surface. Each leg owns an alert key; a leg that RAISES fires
tokens.monitor.blind and leaves its own key untouched, so "could not look" is
never mistaken for a result. Legs b-e skip entirely when token_audit_snapshots
is absent. Bounded at 10 minutes (20260821020000): proconfig declares it, and
the pg_cron job command arms it as its own statement before the call, because a
timeout applied at function entry cannot re-arm the already-running statement.
PS-200 (20260904110000) adds a LATE-ARRIVAL FRESHNESS GUARD to leg (c) only:
an audit row is excluded from the 70%%/8%% verdict when its player''s
EOT_GR_data battle rows were ingested after that audit row''s created_at.
PS-293 (20260921130000) narrows that test to rows that are GENUINELY late: the
PS-200 form compared the player''s whole-history max(id) against the max(id)
seen at audit time, which is true for any player who simply battled again
afterwards, and so excluded 94-100%% of the window and left leg (c) unable to
rate anything. A row is late now only when the player has a battle whose
`"startedOn"` is at/ before the audit row''s created_at while its arrival
`"timestamp"` is after it, or when insert order (`id`) shows a row that claims
to pre-date the audit was inserted after one that post-dates it. The excluded count and share are
reported as their own informational line and are NEVER a breach; if
EOT_GR_data is absent or unreadable the guard excludes nothing, rates the whole
window exactly as before, and says so. Thresholds, windows, the cpta exclusion
and legs (a)/(b)/(d)/(e) are unchanged.';

-- Re-asserts the existing ACL so the verify block is meaningful.
REVOKE ALL ON FUNCTION public.run_token_invariant_monitor() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.run_token_invariant_monitor() TO postgres;

-- REVOKE of an absent privilege writes no ACL entry, so naming both databases' roles is safe.
DO $acl$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role',
                           'eot_anon', 'eot_authenticated', 'eot_service_role']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION public.run_token_invariant_monitor() FROM %I', r);
    END IF;
  END LOOP;
END
$acl$;

-- A missing object raises rather than counting zero.
DO $verify$
DECLARE
  v_oid        oid;
  v_secdef     boolean;
  v_owner      text;
  v_config     text[];
  v_src        text;
  v_acl        text;
  v_breach_oid oid;
  v_breach_src text;
BEGIN
  v_oid := to_regprocedure('public.run_token_invariant_monitor()');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'PS-293 verify: public.run_token_invariant_monitor() is absent';
  END IF;
  v_breach_oid := to_regprocedure('public.token_estimator_rate_breaches(text,bigint,bigint,bigint)');
  IF v_breach_oid IS NULL THEN
    RAISE EXCEPTION 'PS-293 verify: public.token_estimator_rate_breaches(text,bigint,bigint,bigint) is absent';
  END IF;

  SELECT p.prosecdef, pg_get_userbyid(p.proowner), p.proconfig, p.prosrc
    INTO v_secdef, v_owner, v_config, v_src
    FROM pg_proc p WHERE p.oid = v_oid;

  -- SECURITY: still INVOKER. A definer cannot SET ROLE, which C1 requires.
  IF v_secdef THEN
    RAISE EXCEPTION 'PS-293 verify: the monitor became SECURITY DEFINER — C1 (SET LOCAL ROLE) cannot work';
  END IF;

  -- OWNER: unchanged, and the same owner the verdict helper carries.
  IF v_owner <> pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid = v_breach_oid)) THEN
    RAISE EXCEPTION 'PS-293 verify: owner drift — monitor owned by %, token_estimator_rate_breaches by %',
      v_owner, pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid = v_breach_oid));
  END IF;
  IF v_owner <> 'postgres' THEN
    RAISE EXCEPTION 'PS-293 verify: monitor owner is %, expected postgres', v_owner;
  END IF;

  -- proconfig: the search_path from 20260820230000 AND the 10-minute
  -- statement_timeout from 20260821020000 both survived the replace.
  IF v_config IS NULL OR NOT (v_config @> ARRAY['statement_timeout=10min']) THEN
    RAISE EXCEPTION 'PS-293 verify: statement_timeout=10min missing from proconfig — got %',
      coalesce(array_to_string(v_config, ', '), 'NULL');
  END IF;
  IF NOT (v_config @> ARRAY['search_path=public, pg_temp']) THEN
    RAISE EXCEPTION 'PS-293 verify: search_path=public, pg_temp missing from proconfig — got %',
      coalesce(array_to_string(v_config, ', '), 'NULL');
  END IF;

  -- The guard is actually in the body, and leg (c) is the only leg that got it.
  IF v_src NOT LIKE '%late_arrival%' THEN
    RAISE EXCEPTION 'PS-293 verify: the body carries no late_arrival guard';
  END IF;
  IF v_src NOT LIKE '%EOT_GR_data%' THEN
    RAISE EXCEPTION 'PS-293 verify: the body never reads EOT_GR_data';
  END IF;
  -- PS-293: the narrowed test reads the BATTLE clock, not only the arrival
  -- clock. Without "startedOn" the body is still the over-excluding PS-200
  -- form, whatever else it carries.
  IF v_src NOT LIKE '%startedOn%' THEN
    RAISE EXCEPTION 'PS-293 verify: leg (c) does not read "startedOn" — the late-arrival test is still the PS-200 whole-history form';
  END IF;
  -- Thresholds were NOT moved into the monitor.
  IF v_src LIKE '%70 * %' OR v_src LIKE '%8 * %' THEN
    RAISE EXCEPTION 'PS-293 verify: a threshold literal leaked into the monitor body';
  END IF;

  -- ACL: postgres only. grantee 0 is PUBLIC.
  SELECT coalesce(string_agg(format('%s:%s',
           CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
           a.privilege_type), ', ' ORDER BY 1), '(default/null acl)')
    INTO v_acl
    FROM pg_proc p LEFT JOIN LATERAL aclexplode(p.proacl) a ON true
   WHERE p.oid = v_oid AND a.grantee IS NOT NULL;

  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
              WHERE p.oid = v_oid AND a.grantee = 0) THEN
    RAISE EXCEPTION 'PS-293 verify: EXECUTE is granted to PUBLIC — acl %', v_acl;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
     WHERE p.oid = v_oid
       AND pg_get_userbyid(a.grantee) IN ('anon', 'authenticated', 'service_role',
                                          'eot_anon', 'eot_authenticated', 'eot_service_role')
  ) THEN
    RAISE EXCEPTION 'PS-293 verify: a client role holds EXECUTE on the monitor — acl %', v_acl;
  END IF;

  -- token_estimator_rate_breaches is untouched: the calibration still lives
  -- there, unrounded, and this migration did not redefine it.
  SELECT p.prosrc INTO v_breach_src FROM pg_proc p WHERE p.oid = v_breach_oid;
  IF v_breach_src NOT LIKE '%70 * p_n%' OR v_breach_src NOT LIKE '%8 * p_n%' THEN
    RAISE EXCEPTION 'PS-293 verify: token_estimator_rate_breaches no longer carries the unrounded 70/8 comparisons';
  END IF;

  RAISE NOTICE 'PS-293 verify OK: SECURITY INVOKER, owner=%, proconfig=[%], acl=[%], narrowed late_arrival guard present, token_estimator_rate_breaches unchanged',
    v_owner, array_to_string(v_config, ', '), v_acl;
END
$verify$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260921130000', 'ps293_late_arrival_window')
ON CONFLICT (version) DO NOTHING;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- Rollback is re-applying 20260904080000. Never put a second definition of the
-- monitor in this file, even in a comment: the pin test's extractor refuses it.
