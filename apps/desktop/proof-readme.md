# Native runtime proof

This is a disposable synthetic compatibility experiment, not an installer or a
complete desktop implementation. The read slice uses the canonical historical
performance orchestrator and source SQL bodies. Each installation owns separate
PostgreSQL data, Auth subjects and JWT keys. Hosted migrations are not replayed.

`local-schema/manifest.json` pins every selected canonical statement and source
file by hash. `authority.sql` describes deliberate local constraints and grants.
The cluster aggregate uses an invoker view so a normal caller cannot read another
workspace through an unscoped materialized view. Aggregate definers have a
non-login, non-bypass owner, not the database superuser. Player authority remains
behind the canonical attestation resolver; no game-account claims are created.

Native binaries and generated passwords stay outside source control. The first
Linux exercise uses verified upstream Auth/PostgREST releases and an extracted
signed PostgreSQL package. Its shared libraries still need portability packaging.
No platform or redistribution approval follows from a successful local run.

## Checked-in proof scripts

`npm run desktop:proof` (`apps/desktop/proof/run-all.mjs`) runs the checked-in,
reproducible proof for each PR gate and reports pass/fail/skipped per gate:

- Gate (a) loopback gateway Origin/transport/bind enforcement —
  `apps/desktop/proof/loopback-gateway.test.mjs`. Needs no native binaries;
  always runs.
- Gate (b) offline `/player-performance` journey —
  `apps/desktop/proof/offline-journey.mjs`, which runs `native-journey.mts`
  inside `unshare -rn` (a loopback-only Linux network namespace). Needs the
  real native binaries and a staged standalone build (`DESKTOP_PROOF_CONFIG`
  env var); otherwise reports skipped with the reason.
- Gate (c) restart/checkpoint recovery —
  `apps/desktop/proof/checkpoint-journey.mjs` and
  `apps/desktop/proof/setup-recovery.mjs`. Same binary/config requirement as
  gate (b). Runtime lifecycle and native user-session renewal also require
  those binaries and run through `lifecycle-journey.mjs` and `session-journey.mjs`.
- Gate (d) bundled-component manifest —
  `apps/desktop/package/component-manifest.mjs` (generator/verifier) with
  `apps/desktop/package/component-manifest.test.mjs` as a binary-free
  self-test of the generator/verifier logic, plus
  `apps/desktop/package/expected-component-manifest.json` as the committed
  pin to verify a real staged bundle against.

## Run the experiment

Use the desktop build entry point in a checkout without automatic environment
files. It supplies the desktop profile, standalone output, disposable loopback
URL and `desktop-public` placeholder, and excludes inherited hosted secrets.
Never copy a hosted env file into the proof. Staging requires a matching completed
build record and refuses a missing or stale record before creating output:

```sh
node apps/desktop/proof/build-application.mjs
node apps/desktop/proof/stage-standalone.mjs /absolute/private/staged-application
node --conditions=react-server --import tsx apps/desktop/proof/native-journey.mts /absolute/private/config.json
node apps/desktop/proof/checkpoint-journey.mjs /absolute/private/config.json
```

The configuration supplies absolute paths for `state`, `schemaDirectory`,
`evidence`, and `binaries` (`initdb`, `postgres`, `psql`, `auth`, `authCwd`,
`postgrest`). Optional `application` supplies `node`, `directory`, `electron`,
`shell`, `screenshot`, and `rendererEvidence`. All paths belong to private,
disposable storage. The renderer exercise currently requires a Linux Wayland
session. Run it inside a loopback-only network namespace to establish the offline
claim; the harness alone does not remove the host's external networking.

The test harness uses checkout dependencies and `tsx`. The staged application
itself runs with the supplied Node binary, native services and local assets.
This separation leaves an end-user launcher and installation test outstanding.

## Observed scope

The offline wrapper brings loopback up before entering a nested, non-root user
namespace. PostgreSQL fast shutdown cancels active clients and checkpoints rather
than waiting for smart shutdown until the kill timeout. Signal handlers remain
installed during cleanup so a second termination request cannot interrupt it.
`lifecycle-journey.mjs` uses real native Auth/PostgREST with one-second coordinator
JWTs: expired JWTs are rejected, guarded requests receive freshly signed tokens,
and anonymous callers cannot obtain service authority. It also checks active-SQL
shutdown and repeated coordinator termination followed by persisted restart.

The server receives a per-process private credential that the guarded gateway
exchanges for a current service JWT. Neither that credential nor the signing key
is exposed to the renderer. `session-journey.mjs` uses three-second native user
JWTs and the application SSR cookie client: it waits beyond PostgREST's
[30-second clock-skew allowance](https://docs.postgrest.org/en/stable/references/auth.html),
checks rejection of the expired token, renews the cookie session, and repeats
renewal after a native service restart without entering the password again.
Renewed sessions retain guild RLS and cannot call service-only authority RPCs.
This proves the native refresh path, not renderer sleep/wake or password recovery.

The coordinator now delegates native process ownership to `service-owner.mjs`
through a private Node IPC pipe. The owner retains the workspace lock and direct
child handles. If the coordinator dies, IPC disconnect triggers cleanup before
releasing the lock; a concurrent launch is refused during that cleanup.
`hard-kill-journey.mjs` kills the coordinator with SIGKILL during an open SQL
transaction, checks that native endpoints close, then restarts and verifies
committed data survives while uncommitted data rolls back. Unknown or legacy
locks remain untouched. With the optional Linux `runtimeGuard` binary supplied,
the owner holds a kernel file lock inherited by its native services. The guard
sets SIGKILL parent-death signals before exec, rechecking the parent to close
the setup race. `owner-death-journey.mjs` kills both supervisor and coordinator,
checks the services inherited the lease, then restarts without deleting the
managed journal. PostgreSQL crash recovery preserves committed rows and rolls
back interrupted SQL. The journal is reconciled only after acquiring the same
exclusive kernel lease. Unknown legacy locks and actual host power loss remain
separate acceptance cases. Without `runtimeGuard`, this gate reports skipped.
The additional owner uses the bundled Node executable; packaging includes both
owner and client modules.

The real historical-performance API and hydrated player-performance page use
native Auth/PostgREST/PostgreSQL and a persisted eight-row synthetic fixture.
Expected scores are +58.33% versus guild and +26.67% versus cluster, with four
tokens, guild rank 1 and cluster rank 2. The renderer shows both synthetic players
(+58% and -50%), exposes no Node globals, and has no unexpected failed requests
or console errors. A member's officer-only token request remains forbidden.
Local health executes actual database and calculation RPCs and Auth health;
hosted sync controls and telemetry do not mount in the desktop profile.

Negative controls cover missing transport authorization, foreign Origin,
anonymous reads, foreign-guild reads (raw and definer), privileged authority RPC
access, absent RPC, missing player, malformed fixture, import rollback, duplicate
instance, service crash, incompatible schema, restart and stopped-state restore.
Recovery retains the same installation identity; rekeying into a new installation
is unproven. Only this selected page and API closure is exercised.

The staged runtime inputs occupy approximately 836 MB uncompressed before
portable PostgreSQL libraries and installer overhead. This includes upstream
ancillary files and is not an optimized installation-size claim. Whole-stack
idle memory, cold/warm timing, additional platforms and equivalent-service Tauri
measurements remain experimental. `runtime-inputs.json` records the verified
binary inputs and remaining packaging gates.

A warm native-services launch measured about 1.1 seconds. One post-render sample
recorded approximately 603 MiB summed RSS for the native services and Next.js,
plus 658 MiB summed Electron working sets. These are a single development-machine
observation, include shared pages more than once, and exclude the verification
harness; they are not idle memory or cross-platform benchmark results.

## Renderer pause and session expiry

Set `rendererWake: true` and `userSessionLifetimeSeconds: 20` in a private
proof configuration with an Electron application. The browser receives a current
login and a separate profile under its private state directory.
`renderer-wake.cjs` uses the Chromium debugger's acknowledged pause/resume to stop
JavaScript while real time advances beyond native JWT expiry and PostgREST's
clock-skew allowance. A timer probe confirms the pause. The expired token must
return 401; after resume the same page must call the canonical authenticated API
without another sign-in, match its expected calculations, renew its cookie
session and retain guild RLS. No fake clock or mocked Auth backend is used.

Native Auth explicitly enables refresh-token rotation with the
[recommended ten-second reuse interval](https://supabase.com/docs/guides/auth/sessions),
so simultaneous browser/server refreshes do not invalidate the session. The
proof-only `refreshTokenReuseIntervalSeconds` accepts 0–10 seconds for a bounded
negative control; the normal launcher uses 10. JavaScript pause/resume is not
actual OS suspend/resume, and remains scoped to this selected analytics page.

The schema lifecycle holds the native workspace lease before inspecting versions.
Owned shutdown waits for child descriptor closure before returning. The native
`shutdown-close-journey.mjs` control deliberately lets a synthetic descendant
retain output pipes and the kernel lease after its parent exits, then requires
immediate restart to preserve the eight synthetic raid rows.

The selected profile schema includes canonical meta-team membership rows and
timestamp handling. Synthetic native transactions exercise self declarations,
same-guild leader overrides, foreign-guild read isolation, and refusal of forged
setters, anonymous access and automated-source writes.
A known, pinned upgrade first creates a private checkpoint of the stopped database,
credentials and version marker. A pending marker prevents an older application
from opening the workspace, including the interval between database commit and
filesystem marker replacement. Migration SQL and its owner-only receipt commit in
one transaction. On retry, the target receipt completes the marker without applying
SQL twice. Unknown source versions, different database majors, changed migration
pins and damaged checkpoints refuse activation.

The supported upgrade gives the canonical feature-access RPC owner read
access to the public feature catalogue and adds the selected local snapshot queue.
It also adds selected Dashboard, Guild Trends, Boss Performance and Player Stats
RPCs and read-only catalogue tables. The original bootstrap, feature-catalogue
version and snapshot-job version have pinned upgrade
paths. The migration preserves the existing local
identity and data; it does not replace the database or import hosted state.
Checkpoints stay in the private workspace `backups` directory. Restoration must use
a separate workspace so it cannot discard writes made after an upgrade. The native workspace menu exports a stopped workspace and restores it into a new
private directory. Restoring never overwrites an existing workspace. Automatic
checkpoint pruning is not implemented.

`schema-interruption-journey.mjs` uses the synthetic native fixture to cancel a
migration before commit and deny the final marker write after commit. Both retry
paths preserve the fixture and commit the migration row exactly once. These controls
require real native binaries; unit controls alone do not establish native recovery.
Physical disk corruption and database-WAL disk exhaustion remain separate tests.

The low-space native control uses `schema-space-journey.mjs <config.json>
<private-tmpfs-directory>`. Run it inside an isolated user/mount/network namespace
with a private tmpfs of at most 256 MiB. It refuses any other filesystem, reserves
space until only 8 MiB remains, verifies checkpoint refusal before mutations, frees
the reservation, and reopens the original eight-row synthetic fixture. Supply a
stopped synthetic source workspace; do not use personal data for proof commands.

The launcher runs local snapshot maintenance once after startup and every sixty
seconds while open. Only `refresh-explore-snapshots` jobs are admitted to the local
queue. Its canonical handler and queue RPCs run through the protected local API;
the per-launch scheduler credential is never sent to the renderer. Overlapping
ticks are prevented, and shutdown cancels and drains the current tick. The worker
reaps claims older than six hundred seconds before retrying. Other hosted job types
are not enabled by this proof.

`jobs-journey.mjs` requires the compiled desktop application and real native
services. It holds a database lock during the canonical snapshot handler, kills
the managed application, restarts the stack and verifies the durable claim. It
advances only that synthetic claim's timestamp to exercise the actual expiry
policy, then checks a successful second attempt, the expected snapshots and normal
caller permissions. This does not establish physical ten-minute suspend recovery
or parity for every background job. `optional-worker-journey.mjs` separately checks
that a failed optional managed worker leaves the local database available, while a
failed mandatory Auth service shuts down the stack.

Set `corePages: true` in the private native proof configuration to exercise six
additional pages in the real sandboxed renderer. The synthetic checks assert
Dashboard damage 625, guild trend damage 400 and cluster rank 1/2, Player Stats
damage 525 with four tokens, and Boss Performance average damage 100. Normal
member access still denies officer-only Token Usage; Roster retains its empty
state without a configured integration. RPC checks reject unrelated guilds,
anonymous execution and catalogue writes. Comprehensive player statistics stay
service-only behind the existing application authorization checks.

Desktop initials use an embedded image and allow stored avatar assets only under
the local `/images/` path. The renderer does not need an external initials service.
Forwarded host, port and protocol come from the protected gateway, so valid local
Server Actions retain their browser-facing origin. These journeys cover the
selected eight-row fixture. Reference catalogues remain empty, raid-team tabs and
other feature interactions are not covered, and this is not complete feature parity.

The credential vault is a trusted Electron-main primitive, with no renderer IPC,
HTTP endpoint, client discovery or game requests. The native official-raid broker
supplies explicit account-scoped consent and fixed operations with bounded results.
The primitive checks consent before querying OS storage and again around credential
use. It rejects unavailable encryption and Linux `basic_text`, and admits only
recognized GNOME or KDE secure providers. Only GNOME libsecret has native proof;
KDE backend names are admitted but their native behavior is not yet validated.
The descriptor-based filesystem adapter currently supports Linux only; Windows
and macOS refuse use until their own adapters are tested.

Records have opaque random handles and private directory/file permissions.
Permission withdrawal denies use; deletion does not require decryption or renewed
consent. A locked provider retains the encrypted record for a later retry. This
adapter does not erase JavaScript strings from memory or isolate credentials from
other software running as the same OS user. Keep its directory outside workspace
exports; the workspace transfer format includes only database, workspace signing
credentials and the schema marker.

`credential-vault.test.mjs` uses synthetic AES-GCM fixtures to check consent,
insecure-provider refusal, tampering, permissions, bounded reads, withdrawal,
redacted errors and cleanup. Separate native proof used pinned Electron 44.5.1,
GNOME Keyring and libsecret inside an offline Linux VM with an isolated synthetic
keyring. The basic provider created no record; libsecret encrypted a synthetic
credential, decrypted it after a fresh Electron process and keyring session, denied
use after withdrawal, and removed the record. This does not establish game-broker
integration, OS lock-screen behavior, KDE support or other platform support.

## Manual official API connection

For a local-file workspace, File → Game connection can connect the user's own
official API key after a native permission dialog and current workspace password.
The masked native entry sends the key only to trusted Electron main. Secure OS
storage must be available before key entry. Refusal leaves offline analytics usable.
Coordinator requests use an ephemeral main-only Electron network partition. It
admits only the three fixed loopback operations and injects per-launch transport
capabilities there; it shares no renderer cookies. Hosted key-management, profile
proof-key and shared key-input forms show native-menu guidance in desktop mode.
Hosted credential endpoints refuse desktop requests before reading their bodies,
and hosted onboarding redirects to the local connection guide. Hosted behavior
remains unchanged. Roster synchronization is still pending in this preview.
Normal close retains ciphertext; restart requires renewed consent and password
confirmation before reading the saved key. Disconnect removes the key without
decrypting it. Connection metadata and ciphertext are excluded from workspace exports.

The broker uses only HTTPS GET `/api/v1/player`, `/api/v1/guild` and
`/api/v1/guildRaid` on `api.tacticusgame.com`, with `X-API-KEY` authentication.
It follows the [official API contract](https://api.tacticusgame.com/swagger-ui/index.html)
and [official API documentation](https://github.com/SnowprintStudios/tacticus-api).
Redirects, foreign destinations, non-JSON responses, excessive bodies and credential
echoes are refused. Expiry and the selected guild ID are rechecked before manual
sync. It exposes no arbitrary URL, signing operation or root-key renderer bridge.
The Player response does not verify ownership of the local player ID. Unmapped
raid players get stable pseudonymous labels; existing local mappings retain their
explicit local-claim provenance. Manual sync uses the transactional raid importer.

| Capability                                                                               | Current evidence                                                                                                   |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Fixed operations, expiry, guild switching, cancellation and result bounds                | Synthetic broker and native-menu behavior tests                                                                    |
| HTTPS certificate verification, encrypted storage and secret refusal                     | Actual Electron and GNOME Keyring with an isolated synthetic TLS counterpart; an untrusted certificate is rejected |
| Consent, key entry, sync, normal restart, saved-key resume, deduplication and disconnect | Normal Linux GUI prototype with synthetic TLS and GNOME Keyring; no renderer verification hooks                    |
| Live official account, automatic game-client acquisition, historical season requests     | Not validated or implemented by this preview                                                                       |
| OS lock-screen, KDE native provider, Windows and macOS adapters                          | Outstanding                                                                                                        |

The GUI prototype's private fixture supplies a test certificate trust root inside
an offline network namespace. That fixture is not packaged or enabled by production
code. These checks establish synthetic integration, not live-account acceptance or
complete desktop feature parity. Linux secret entry requires Zenity and libsecret.

## Local raid-file import

First-run setup can create an empty local workspace instead of synthetic sample
data. Its guild and player labels have explicit `desktop_local_claim` provenance;
they establish authority only inside that installation. Automatic game sync is
disabled for this mode. They do not establish ownership of an upstream account.

The native File menu opens a versioned `ta-raid-file-v1` JSON importer. It accepts
at most 8 MiB and 10,000 entries for the workspace's guild. The shared validator
checks the entire file before the renderer submits it or the coordinator forwards
it to the fixed internal normalization endpoint. Unknown fields, missing event
times, invalid dates, unsafe numeric values and unsupported nested equipment or
ability metadata are refused. The importer does not acquire game credentials,
discover clients, accept arbitrary destinations or connect to upstream services.

After confirming the current workspace password, the coordinator derives identity,
guild, cluster and name mappings from its local database. The protected application
endpoint runs the canonical raid transformer. A separate non-login, non-bypass
database role validates all normalized rows and commits records together with an
owner-scoped import receipt. Whole-second event keys prevent duplicate records
across retries and differently encoded files. Import never updates existing records.
The import role can read only the conflict-key columns of the raid table; anonymous,
authenticated and service roles cannot inspect receipts or call the import function.

`import-journey.mjs` uses actual native services and a compiled standalone application
to check empty setup, rejected passwords/origins/guilds, atomic refusal of a bad
later record, unrelated-subject refusal, duplicate retries and persisted restart.
It runs when `desktop:proof` receives a compiled application configuration. Its
backend evidence is separate from OS file selection and renderer acceptance. All
fixtures are synthetic. Supported file import does not establish automatic game
integration, compatibility with other export formats or complete feature parity.

## Manual own-roster sync and offline cache

After connecting an official key, File → Game connection → Sync my roster asks
for explicit permission and the current workspace password. The main-process
broker reads only its fixed official player/guild endpoints and projects the
published roster fields. Inventory, progress, upstream user identifiers, arbitrary
metadata and root credentials do not enter the local cache. Validation checks the
complete roster before canonical normalization or database writes.

The scoped transaction updates the user's canonical `player_roster`, current
player power and owner-readable `desktop_roster_snapshots` together. Repeating a
sync retains mapped row IDs; replacement removes obsolete mapped units. Units
without a catalogue mapping remain visible in the raw allowlisted cache. The
Roster screen reads that cache locally, including after restart or key removal.
Missing optional display metadata uses an explicit unknown label. The cache
retains the unverified local identity provenance: official API player data does
not establish ownership of the workspace's claimed player ID.

`roster-journey.mjs` exercises the compiled normalizer, native Auth/PostgREST and
PostgreSQL transaction. It checks native capability/password/guild refusal,
malformed later rows, forged mappings, foreign subjects, write denial for renderer
and service roles, scoped reads, stable IDs, replacement and persisted restart.
It also checks the authenticated cache API with no hosted key. These synthetic
backend checks remain separate from installed GUI, OS-vault, live-account and
cross-platform acceptance. Sync is manual; this preview does not discover a game
client, automatically retrieve credentials or claim complete feature parity.

The native launcher initializes `hero_mappings` from the package's static hero
reference definitions before serving the application. Canonical API unit IDs and
engine aliases get deterministic local database IDs. A refresh validates all
files first, commits in one transaction, preserves existing reference IDs and
never deletes reference rows. Invalid optional reference files leave the existing
catalogue intact and do not prevent reading an existing workspace. The roster
read path can fill omitted display labels from packaged definitions; unknown
units still use explicit fallback labels. This is local reference metadata, not
captured player data or a complete reference/schema parity claim.

## Local planner links

The Roster form saves a bounded HTTP(S) planner link through the canonical
`current_user_player_mapping` owner projection. Authenticated callers can update
only that link and the existing activity timestamp. Identity, role and credential
fields stay protected. A local trigger validates link writes without making
unrelated updates fail for a legacy link; clearing a legacy value repairs it.
Credentialed authorities, controls, unsafe protocols and oversized links are
refused. `planner-link-journey.mjs` checks actual native Auth/PostgREST writes,
foreign-user filters, protected columns, invalid values, clearing and restart.
It does not establish external-browser navigation or complete profile parity.
