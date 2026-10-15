# Hosted roster snapshots

A complete player response can satisfy character-roster, power and token needs in
one authorized operation. The token-sync route captures an observation before its
existing player read, then projects that same response after returning token data.
Its auxiliary observation has a 500 ms deadline. Storage failure leaves token
synchronization working and does not add a provider read.

## Evidence and writes

`begin_player_roster_refresh` records database time and a random observation ID
before a player read. The current mapping owner must match exactly. A newer
observation supersedes an older result, including during an account claim.

`persist_player_roster_snapshot` validates the normalized payload, updates power
and imported roster columns atomically, and retains a receipt. It updates only
changed values; unchanged rows retain their `synced_at` and row version. Manual
columns outside the imported projection are preserved. Replaying a receipt makes
no further writes and cannot extend verification time.

Verification is dated from the observation, so a delayed save cannot make an old
read look new. Complete mapping and equipment classification are required. Partial
or empty evidence preserves existing roster rows, can update trusted power, and
cannot claim complete verification. Missing catalog entries remain eligible for
a later attempt. The content hash records canonical mapped content and power;
subsequent responses still compare actual stored columns before updating them.

`player_roster_sync_state` is private to the database functions. Application roles
have no direct table access. The officer freshness endpoint selects the caller's
own current guild cohort and returns aggregate counts and the oldest complete
check. Raw account identities and hashes are never returned. The guild view shows
provider verification separately from the last imported value change. Verification
describes the last complete provider projection; saved manual edits can be newer.

## Background eligibility

The existing work queues and schedules remain in charge. Selection uses roster
verification, independent of token and raid clocks. Enabled background guilds are
required. Never-attempted members come first, followed by oldest attempts with a
stable mapping-ID tie break. Failed attempts rotate behind the rest of the cohort
and have a five-minute cooldown.

Background selection and observation are rechecked under one mapping lock. Two
backfills selecting the same stale member can create only one current background
observation during the cooldown. Global provider permission and holds remain with
the transport's request controls.

The official half-hour backfill uses a 20-minute verification window, leaving ten
minutes for a partial pass, its six-minute soft deadline and final batch. An
explicit positive `staleHours` overrides that window. Loki keeps its 24-hour
window; officer team backfill keeps its six-hour window and existing action limit.
Explicit own-player reads remain available. Loki orders guilds by their oldest
eligible member and avoids shared-session refresh when the entire cohort is fresh.

Job results distinguish `notDue`, completed projections, unchanged projections,
failures and skipped work. `notDue` includes freshness, cooldown and disabled
background eligibility; it is not a cache-hit count. Unchanged projections save
row writes after a player read. Provider reads are saved when a full response is
reused or eligibility prevents a read. Measure those reductions separately.

Auxiliary leaderboard references load only after an enabled guild or cluster
webhook and battle data are present. Successful and failed reference loads are
shared within the invocation to avoid repeated attempts for each cluster.

## Release and recovery

Apply `supabase/migrations/20261015020000_atomic_roster_snapshots.sql` before the
hosted application release, with a backup or the retained rollback path. It refuses
a different target database and records its ledger row in the same transaction.
Check the function grants, current-owner verification coverage, background results,
key health and queue deadlines after release. Use matched cohorts and time windows
for provider counts, internal row writes and freshness. Source tests alone do not
establish production savings.

Restore the previous application before applying
`supabase/snippets/20261015020000_rollback_atomic_roster_snapshots.sql`. The rollback
revokes the new RPCs while retaining roster data, observations and receipts.
Reapplication preserves that state. Desktop imports keep their existing local
normalization and schema; the hosted migration is classified as production-only.

`npm run test:roster-snapshots:db` uses synthetic PostgreSQL data and a private
internal Docker network with no provider access. It exercises concurrent SQL and
real PostgREST/SDK calls, role refusals, atomic rollback, unchanged rows, ownership,
partial evidence, fair cooldown, guarded rollback/reapply and wrong-target refusal.
