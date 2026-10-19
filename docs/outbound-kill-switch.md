# Operator outbound stop

One switch halts provider dispatch without a redeploy. It is the
`feature_releases` row with `feature_key = 'upstream_outbound'`.

| `release_stage` | Provider dispatch |
| --------------- | ----------------- |
| `public`        | open              |
| anything else   | halted            |

Use `coming_soon` to halt: it is the non-public stage the stage RPC and the table
constraint both accept. A halted dispatch is refused before anything is sent,
with the same `ProviderAdmissionError` local admission refusals use, and is not
counted as a provider call.

## Who can change it

Only an app admin or the service role. `admin_update_feature_stage` (the admin
features screen) checks app admin itself. Direct table writes are guarded by
three RESTRICTIVE policies on this one key, so the permissive
`feature_releases_manage_admins` policy, which admits any guild leader, cannot
be used to halt provider traffic for every guild. Other features are unchanged.

The migration seeds the row at `public` and never overwrites an existing row,
so an operator's setting survives a replay. The row is hidden from the public
roadmap and from `/api/features/stages`.

## Read semantics

The flag is read by the edge runtime and the app provider runtime through the
shared `outbound-kill-switch-core.ts`:

- Cached for 30 seconds per runtime instance, so a halt takes effect within
  that window.
- At most one read is in flight per instance; callers that arrive during a
  refresh share it instead of each querying the database.
- A read is cancelled after 2 seconds and counts as unreadable, so a stalled
  database delays a dispatch by at most that long, once per window.
- **Fails open when nothing was ever read.** A missing row, an unreadable flag
  or a timeout on a cold instance means open, with a logged warning. A broken
  switch must never take the product down.
- **A halt that was read stays in force.** If a later refresh fails, the last
  value read is kept, so database trouble cannot lift a stop an operator set.
  A restarted instance that cannot reach the database starts open.

## Coverage

Edge provider dispatch through the shared adapter and the app provider runtime.
Not covered: Next routes that fetch a game host directly, the credential broker
and operator scripts. This is a partial stop, not a global one.

## Release order

Apply the migration first. Until it is applied the row is absent and dispatch
stays open, so deploying the code first is safe but the stop cannot be engaged.
Rollback is in the migration header.
