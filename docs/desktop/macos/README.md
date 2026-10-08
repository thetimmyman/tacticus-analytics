# macOS developer candidate

The desktop composition remains Electron, the local Next.js server, PostgreSQL,
Supabase Auth and PostgREST. Native ownership and secret input live outside the
renderer. This candidate is under development; it does not establish consumer
installation, feature parity, physical Mac acceptance or signed release readiness.

`owner-guard.c` holds a private kernel file lock and starts a foreground service
session behind a watchdog. The watchdog registers owner and service exits with
`kqueue` before releasing the execution barrier. Owner death terminates the
owned session; watcher failure is detected by the owner. These services must not
daemonize or escape their owned session. Simultaneous termination of both
supervision processes requires recovery qualification.

`SecretVault.swift` uses native secure input and the data protection Keychain.
Consumer access requires the owner's signed, provisioned helper; the unsigned
candidate refuses access when these entitlements are unavailable. The isolated
test alone uses an explicitly selected disposable file-based Keychain. This is
an adapter test, not proof of the signed consumer vault boundary.
Reads refuse interaction when the vault is unavailable; no plaintext fallback
exists. The native supervisor receives secrets only through a bounded private
pipe. Renderer-facing adapters receive opaque handles and projected status.
Cancellation, missing items, locked Keychain and revocation are distinct failures
that preserve cached offline data. JavaScript string erasure is best effort;
normal crash-dump collection must remain disabled until canary qualification.

The workflow compiles and tests native adapters on macOS 15 arm64 and Intel
virtual machines. Its results are adapter evidence, not physical-device or
installed-product acceptance. The isolated synthetic test Keychain is disposable
and creates no signing identity. Native prompt accessibility, user refusal,
sleep/wake and locked-session behavior require interactive Mac qualification.

Install the locked test dependencies with `npm ci --ignore-scripts`, then run
`node --test tests/desktop/macos/*.test.mjs`. On macOS, compile the native
sources with `clang` and `swiftc`, then supply `MAC_GUARD` and `MAC_VAULT` absolute
paths to run the native tests. These are developer build instructions; a promoted
consumer package must bundle every runtime and require no developer tools.

`build-inputs.mjs` pins and verifies source/archive bytes for the target native
Node, PostgreSQL, Auth, PostgREST and Electron versions. Intel Auth builds from
the pinned source using its required Go toolchain. `stage.mjs` produces an app
bundle, checks architecture and external Mach-O dependencies, rejects mutable
state and escaping links, and inventories package bytes. `qualification.mjs`
mounts a generated DMG, copies the app into a path with spaces and Unicode, and
runs the installed binaries under a network sandbox allowing loopback and local
Unix IPC. Before launch, the installed Node must exchange a synthetic Unix
socket message and receive an OS permission refusal for direct external TCP.
The receipt records only fixed results; a timeout never counts as denial.
Storage and restart launches run the whole installed tree under that policy.
The graphical launch confines the PostgreSQL, Auth, PostgREST and Next.js
server child processes with it. The runtime supervisor, which hosts the loopback
gateway, and Electron run outside it, because Chromium cannot initialize its own
sandbox inside another Seatbelt profile. Electron's sandbox stays enabled; instead the journey requires
Electron to refuse a public host name and a public address, and the desktop
window never resolves host names. This qualification policy does
not establish the consumer's full opt-in network boundary. It exercises
the selected synthetic renderer calculation, persisted writes, whole database
dump/restore into a disposable database, and failed migration rollback.
The developer workspace setup retains the baseline synthetic analytics journey;
full personal projection into every existing application route is unfinished.
The mandatory Player guard and separate-key native menu adapter are included;
real access remains blocked without the required helper provisioning.
Before Electron launch, the installed qualification verifies password-free
holding setup and former-password owner migration against the bundled Auth
service. It compares all synthetic raid, mapping, guild and attestation rows plus
cached personal state, and refuses renderer-only and forged-session access.
This receipt is bound to the source commit and DMG digest. The packaged
journey then covers actual Electron bootstrap and signed-out recovery on virtual
machines. Its two later launches restart storage only and do not reopen the
graphical application. Preserved consumer Keychain bindings remain a separate
qualification requirement.
If the graphical journey still records a native sandbox initialization
failure, a separate compatibility probe runs the same installed payload in one
fresh synthetic workspace across two ordinary launches. Electron's own sandbox
remains enabled. The probe checks actual renderer bootstrap refusal, native
owner sessions, signed-out recovery and unchanged synthetic data. Its fixed
receipt declares network isolation unestablished; it never emits platform
acceptance and the mandatory isolated journey remains failed.
Renderer diagnostics use fixed endpoint/resource/request-start-phase labels and bounded numeric
statuses. JSON receipts contain calculation flags rather than document text or
request paths. A failed run keeps its screenshot, which shows only the
synthetic workspace, so a calculation or rendering mismatch can be diagnosed.
Intentional refusals stay separate from unexpected renderer failures: the
gateway tags its credential holding response, and authorization failures are
accepted only from the deliberate sign-out until the recovery reload completes.
The analytics view loaded after recovery must have none.

Ordinary setup creates a local Auth account in a Player-required holding state.
The workspace opens automatically under the current OS account, without an app
password, password change, recovery-code or logout flow. An ephemeral main-only
capability opens only the fixed local session endpoint. It preserves the ledger
owner and existing data, rotates a transient in-memory Auth credential and
installs a signed, expiring Auth session. The bootstrap capability never enters
renderer requests or cookies. The native menu obtains the current owner-session
cookie and passes it through an inherited privileged IPC pipe. Auth verifies its
signature, expiry and local owner; native HMAC/expiry checks also run before
credential access and final state commits. Passwords and session tokens are not
written to native action logs or cached in a workspace file. Renderer content
has no native command bridge. Missing or expired sessions trigger one automatic
main-process recovery; persistent failure preserves data and asks to reopen.
The personal view can inspect the complete allowed official Player snapshot,
including inventory, equipment and progress, with bounded lazy pagination.
It also offers cached roster search, alliance filters, rank/XP/progression sorting,
unit abilities and equipped items, inventory filtering and campaign summaries.
Feature lists render 25 entries per page. Quantity totals use exact integer sums;
token timers remain labeled snapshot values while offline. These owner-only views
perform no official fetches or browser storage writes and retain the complete
snapshot inspector. They do not implement legacy member/development routes or
the full accepted feature matrix. Synthetic DOM and cache-reopen tests are
separate from installed Electron qualification.
Legacy hosted pages containing API-key forms and their key handlers return a
holding response before rendering. Their features remain in the required inventory;
they require native adapters before desktop availability can be advertised.
Historical native data remains distinct from API ownership verification.
Interrupted setup records only opaque pending references; after authorized
session recovery, proved-unused native items are removed and committed references retained.
Damaged or uncertain personal state pauses this cleanup.

Native menus provide separate scope connection/revocation and cached personal
export/import through graphical file choosers. Import accepts only this candidate's
complete Player export in an empty personal workspace. It rejects credentials,
unsafe files and inconsistent projections, rechecks the owner session after reading, leaves
the source untouched and grants no verified live capabilities. Imported data is
labeled historical and reconnect-required. It does not migrate arbitrary legacy
database formats or restore the complete analytics database.

Safely opened, owner-private personal JSON with malformed data or an unsupported
projection opens a recovery holding view under the existing local Auth owner.
Unsafe links, modes, ownership, devices, oversized files and damaged private
recovery metadata refuse activation. Recovery creates no replacement owner and
does not replace valid personal data. The Workspace menu can restore a validated
private checkpoint or selected personal export. The native supervisor rechecks
owner authorization and file generation, durably retains the damaged original,
and replaces only the personal projection. Incident retention is bounded to
three files and 12 MiB; quota refusal preserves the original.
Restored data has no live vault references and all scopes require reconnecting.
Known prior handles stay in private retention metadata; unknown references keep
automatic credential cleanup paused across restart. Neither this metadata nor
retained originals appear in the renderer or public export. A disconnect still
removes the live capability while saved credentials remain protected.
Normal personal writes use a protected commit journal and matching checkpoint.
After a visible rename, durability or checkpoint failure preserves the new
snapshot and reports an uncertain commit. A fresh authorized action reconciles
the actual primary and checkpoint before allowing cleanup; it never treats an
unreadable cache as an empty set of key references. Disposable-file interruption,
restart and native-controller tests are implementation evidence, not consumer
Keychain or full installed recovery qualification.

Closing the window cancels pending native input and official requests. Full workspace recovery,
compatible verified updates and the accepted feature matrix remain unfinished.

Release gates remain: full local feature inventory, native onboarding projection
and application integration, successful package install/restart/recovery,
dependency notices and redistribution review, compatible verified updates,
supported OS matrix, actual Mac testing, owner-provided signing and notarization.
Never disable Gatekeeper or OS protection
to qualify this candidate. Removing an app bundle must retain workspace data and
Keychain references unless the owner explicitly requests deletion.

Relocated developer Mach-O files receive a local ad-hoc loader seal. This creates
no signing identity and supplies no trusted consumer signature or notarization.
Qualification emits all thirteen `platform-evidence/v1` scenarios, leaving
unmeasured consumer acceptance blocked even when selected database checks pass.
