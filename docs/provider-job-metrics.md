# Provider request measurements for Node sync jobs

`processJob` gives each sync-queue invocation its own measurement context.
Within a measured context, the official API and shared sync HTTP clients, default Loki transport and
bounded roster transport record calls at their actual fetch boundary.
Retries add a call and a retry; non-success responses, transport failures and
response-consumption failures add at most one error to that attempt.
Internal service calls and requests cancelled before dispatch add no provider
charge. Provider redirects are refused because following them would create
additional requests outside the observation.

Successful jobs supply the three counters to `complete_job`; failed jobs retain
them in `fail_job` progress. The migration stores both outcomes in the existing
`sync_metrics` table. Terminal transitions lock the owned processing row so
replayed or concurrent callbacks cannot insert duplicate measurements. The
application requires a positive completion receipt before reporting success.
Detailed application errors stay in the existing job record; failed metric rows
use a generic label.

The migration requires the reviewed predecessor function hashes and captures
the old definitions in its migration receipt. Its companion rollback refuses
later function drift, restores those captured definitions and retains recorded
metrics. Apply with the application update, verify a bounded owned job and its
metrics, and retain the receipt for rollback. The hosted job schema is deliberately
excluded from the desktop local-planning schema.

Run `node scripts/dev/pgtap-controls/provider-job-metrics.mjs` for disposable,
network-isolated PostgreSQL outcomes. `--expect-new-on-baseline` demonstrates the
old zero-counter behavior by failing the new measurement assertion. The normal
control is included in `npm run test:pgtap:controls`.

This scope is Node sync-job counters. Other invocation contexts, Deno, operator
scripts, native adapters and WebSocket traffic still need enrollment and
observation. Account labels, response-byte measurements, cache/coalescing outcomes
and matched physical-dispatch UTC windows are not represented by these job totals.
They do not certify distributed admission or an estate-wide shutdown procedure.
