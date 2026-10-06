# Private Linux preview packaging

The preview creates an installation-local account and synthetic sample workspace
through a graphical first-run form. A personal workspace opens API setup: Player
access is required, while Guild and Guild Raid access unlock guild content.
A sample workspace opens synthetic player performance. Full feature parity and
release approval remain outstanding.

Local workspaces open automatically under the logged-in OS account, including
existing workspaces created with a user password. Electron main obtains a signed,
expiring owner session through a separate per-launch capability. This capability
never enters renderer requests or cookies; local Auth still verifies ownership
before credential access or imports. There is no user-facing app password,
password-change, recovery-code or logout flow. Expired browser sessions reopen
automatically. Interrupted first-run setup preserves the installation account.

API setup and file import reuse that session. Linux explicitly selects Secret
Service via Electron's `gnome-libsecret` backend. Game keys require secure OS
storage; locked or unavailable storage refuses saving and never uses plaintext.
Keys enter native dialogs and stay encrypted in the device vault. File → API
access and updates opens scoped setup and the updater. Creating or reopening a
workspace does not require game access; personal content requires Player access,
and guild content requires matched Guild and Guild Raid access. Cached data
remains readable offline.

The native File menu offers backup and restore. Backup closes the application,
stops its services and acquires the workspace kernel lease before exporting a
stopped PostgreSQL checkpoint into a new private directory. Restore verifies its
file inventory and creates a separate workspace; it never replaces the current
database. A pending restore blocks startup, and a corrupt or incomplete backup
is rejected. After the restored database opens successfully with the pinned
services, normal launches select that copy. Explicit `--state` still selects a
specific workspace. Restore recovers the account and data from the time of the backup; the native
app then opens that local account automatically. Keep backups private. Browser cache,
diagnostic logs and game-credential vault storage are outside this backup.
The launcher also accepts `--backup /new/backup-directory` or
`--restore /saved/backup-directory --state /new/workspace-directory` without a GUI.
These are same-installation physical database transfers, not PostgreSQL major
version conversion or fresh-install signing-key rotation.
The repository's proprietary license is unchanged.

`stage-linux.mjs` accepts a private JSON configuration with absolute paths for
`output`, `application`, `postgres`, `node`, `electron`, `auth`, `postgrest`
and `runtimeGuard`, plus `nodeLicense`, `authLicense` and `postgrestLicense`.
Supply the complete Node distribution LICENSE and the pinned upstream Auth and
PostgREST LICENSE files. Staging also requires PostgreSQL COPYRIGHT and Electron's
LICENSE and LICENSES.chromium.html, and includes them all under `notices/` in the
hashed file inventory. Application dependency and game-asset redistribution review
remains separate. Standalone staging preserves application dependency notices in
`application/third-party-notices` and records their hashes in
`application/application-notices.json`. Source notices must match the traced
package name and version. Versionless vendored packages additionally require the
same package manifest, relative location and pinned containing package release.
Staging reports missing notices as `review-required`; this inventory does not
establish redistribution approval or cover all native runtime dependencies.
Build the guard on the target Linux toolchain with
`node apps/desktop/package/build-runtime-guard.mjs /absolute/private/runtime-guard`.
`Dockerfile.runtime-guard` builds it with the same pinned Ubuntu 22.04 base as
PostgreSQL; use `apps/desktop/package` as its build context and export the package
stage. The consumer needs no compiler. The guard owns an inherited kernel file lock and
sets parent-death signals before starting each managed process. A managed stale
lock can be recovered only after acquiring that same exclusive kernel lease;
unknown legacy locks remain fail-closed. Recovery has been exercised after an
abrupt disposable-VM power cut with committed and uncommitted synthetic writes;
physical storage failure and every supported operating system remain unproven.
`application` is the staged desktop standalone build, `postgres` is a relocatable
PostgreSQL installation, `node` and `postgrest` are executable files, and the
remaining runtime inputs are directories. Output must be new. The resulting
`launch` executable uses only bundled application code and runtimes. No checkout,
Node installation, package manager or environment file is required at launch.

For the PostgreSQL candidate, download the official 18.6 source archive and verify
its upstream SHA-256, then build `Dockerfile.postgres` using that archive as the
build context. Docker is a developer build tool, not a consumer dependency. The
pinned Ubuntu 22.04 builder targets glibc 2.35 and omits optional ICU, readline and
compression libraries. This build covers the current local read journey; it does
not claim support for every hosted extension or database feature.

The GUI still requires ordinary operating-system display libraries. Package and
test those dependencies per supported distribution before claiming portability.
The Linux x64 launcher selects Wayland when a Wayland display and runtime
directory are present, otherwise X11 when DISPLAY is present. Without either,
it refuses startup before creating or opening the workspace. X11 forwards the
session XAUTHORITY file to Electron; both paths retain the normal sandbox. `build-deb.mjs`
accepts the absolute staged-bundle path and a new private output-directory path;
it builds a Debian preview package with a graphical application entry and declared
OS dependencies. The private Debian package has been installed and exercised offline in a clean
Ubuntu 22.04 disposable VM. That evidence covers this distribution and selected
synthetic analytics journeys; other distributions and complete feature parity
remain unproven. The preview must remain private
until target-system installation and bundled-component notices are reviewed.
Verification mode uses a private `--verify` JSON file containing a throwaway
password, screenshot path and evidence path; it drives the same first-run form
and real application login route. It is not a separate mock backend.

The private verification configuration can also set
`userSessionLifetimeSeconds: 20` and `wake: { expected: <synthetic API result> }`
to pause renderer JavaScript through real token expiry and verify renewed cookies,
canonical API calculations and guild RLS after resume. This uses the same staged
launcher and browser profile; normal launch retains a one-hour user session.
This is a debugger pause/resume control, not actual machine suspend testing.
An optional `wake.pauseEvidence` absolute private path records the acknowledged
pause without credentials so an external disposable-VM controller can perform
guest OS suspend. That controller must separately capture actual OS/QEMU suspend
and wake events; the marker alone does not establish machine suspend.
