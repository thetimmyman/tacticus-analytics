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

Run `node --test tests/desktop/macos/*.test.mjs`. On macOS, compile the native
sources with `clang` and `swiftc`, then supply `MAC_GUARD` and `MAC_VAULT` absolute
paths to run the native tests. These are developer build instructions; a promoted
consumer package must bundle every runtime and require no developer tools.

`build-inputs.mjs` pins and verifies source/archive bytes for the target native
Node, PostgreSQL, Auth, PostgREST and Electron versions. Intel Auth builds from
the pinned source using its required Go toolchain. `stage.mjs` produces an app
bundle, checks architecture and external Mach-O dependencies, rejects mutable
state and escaping links, and inventories package bytes. `qualification.mjs`
mounts a generated DMG, copies the app into a path with spaces and Unicode, and
runs the installed binaries under a loopback-only network sandbox. It exercises
the selected synthetic renderer calculation, persisted writes, whole database
dump/restore into a disposable database, and failed migration rollback.
The developer workspace setup retains the baseline synthetic analytics journey;
full personal projection into every existing application route is unfinished.
The mandatory Player guard and separate-key native menu adapter are included;
real access remains blocked without the required helper provisioning.

Ordinary setup creates a local Auth account in a Player-required holding state.
After one workspace unlock, the native menu obtains the current owner-session
cookie and passes it through an inherited privileged IPC pipe. Auth verifies its
signature, expiry and local owner; native HMAC/expiry checks also run before
credential access and final state commits. Passwords and session tokens are not
written to native action logs or cached in a workspace file. Renderer content
has no native command bridge. Missing or expired sessions return to one unlock.
The personal view can inspect the complete allowed official Player snapshot,
including inventory, equipment and progress, with bounded lazy pagination.
Legacy hosted pages containing API-key forms and their key handlers return a
holding response before rendering. Their features remain in the required inventory;
they require native adapters before desktop availability can be advertised.
Historical native data remains distinct from API ownership verification.
Interrupted setup records only opaque pending references; after authorized
unlock, recovery removes unused native items and retains committed references.

Native menus provide separate scope connection/revocation and cached personal
export/import through graphical file choosers. Import accepts only this candidate's
complete Player export in an empty personal workspace. It rejects credentials,
unsafe files and inconsistent projections, rechecks unlock after reading, leaves
the source untouched and grants no verified live capabilities. Imported data is
labeled historical and reconnect-required. It does not migrate arbitrary legacy
database formats or restore the complete analytics database.
Closing the window cancels pending native input and official requests. Full workspace recovery controls,
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
