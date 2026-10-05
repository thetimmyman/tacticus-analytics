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

`SecretVault.swift` uses native secure input and device-local Keychain items.
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

Release gates remain: full local feature inventory, native onboarding integration,
real package install/restart/recovery, dependency notices and redistribution
review, compatible verified updates, supported OS matrix, actual Mac testing,
owner-provided signing and notarization. Never disable Gatekeeper or OS protection
to qualify this candidate. Removing an app bundle must retain workspace data and
Keychain references unless the owner explicitly requests deletion.
