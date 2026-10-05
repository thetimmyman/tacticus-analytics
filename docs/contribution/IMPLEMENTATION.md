# Opt-in contribution candidate

This candidate supplies an installed-runtime controls component, durable queue,
protected read-credential store, fixed official API adapter and independent
verification/aggregation service library. It adds no public enrollment route,
production service, background collector or automatic sharing. The native
runtime must supply `ContributionControlAdapter`, authenticated transport and
secure input. These adapters have not been qualified on packaged platforms.

Run the synthetic integration checks with Node 22:

```sh
node --test tests/contribution/*.test.mjs
npx vitest run --config tests/contribution/vitest.config.mts
npx eslint packages/contribution
```

The integration fixture enrolls only synthetic official-read material, compares
uploads against independently supplied upstream responses, retries an outage,
checks wrong guild/member and changed membership, deduplicates multiple
collectors, handles corrected rows, revokes keys and deletes/recomputes sources.
These are fixture checks, not live-account or installed-artifact evidence.

Each local consent belongs to an account/guild/purpose and increases its revision
on change. Queue files contain sanitized records, policy versions and bounded
receipts. Unknown fields are rejected before persistence. Revocation clears
unsent work and aborts active transport; bytes already delivered are recorded as
such. No purpose-off policy triggers a background request. Partial receipts retry
only unresolved rows with a fresh request identity. The service rejects portal
records, client signatures and mismatched request identities. Native connection,
private portal, contribution, diagnostics and update consent remain separate.

The service independently fetches Guild and Guild Raid from fixed HTTPS paths,
uses current membership and compares each allowlisted field. An observation and
server fetch must be within five minutes of the current service clock. Missing,
ambiguous, malformed or unavailable official data cannot verify a row. The API
has no stable raid-event ID; the candidate derives identity from member,
timestamps and encounter coordinates. Identity/revision behavior needs live
protocol qualification before release. Player display names do not establish
account ownership. War/replay records always remain unverifiable.

Official-read enrollment is an explicit separate operation. Its native callback
provides a buffer to the protected service adapter, never renderer bridge data.
Guild and Guild Raid access must both succeed before enrollment. AES-256-GCM
protects material at rest using a caller-supplied service key; this key must come
from a reviewed protected service identity, not source, environment diagnostics
or normal backups. JavaScript strings cannot promise complete memory erasure.
The adapter clears temporary buffers; runtime/process isolation remains needed.
No game-session credential type is accepted. Existing public secret-intake guards
remain unchanged.

The supervisor owns one writer per state file. Queue/service libraries serialize
their asynchronous sends and commit with temporary file, fsync and atomic rename.
Process supervision, OS vault/enrollment transport, cross-process locks, crash
recovery qualification and platform-specific filesystem durability are native
adapter gates. These libraries must not be advertised as qualified distributed
storage or a deployed multi-worker service.

Credential retention is at most 24 hours, request deduplication lasts one day,
pending queue work expires after seven days and contributed sources expire after
30 days. Run service `purgeRetention()` and vault `purgeExpired()` from the reviewed
supervisor even when ingestion is idle. The service also purges during normal
verification/aggregation. Only pseudonymous authoritative raid sources enter
aggregates, with a default minimum of five distinct guilds. Deletion removes the
requester's attribution and recomputes derived results; another collector's
independent authorized attribution may retain the same event. Pseudonymous is
not anonymous; retention/authority/member notices require owner review.

Release requires protected service custody/enrollment review, publisher terms,
live authorized protocol evidence, authenticated transport, native adapters,
packaged offline/restart/recovery and egress tests. No production key collection
or deployment is enabled by this candidate.
