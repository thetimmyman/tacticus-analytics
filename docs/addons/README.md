# Local add-on components

This implementation provides a signed first-party data-package host, native command facade, graphical manager, bounded local war reports and deterministic placeholder replay playback. It is a review candidate, not a qualified native release.

The Linux desktop File menu opens the graphical manager in a separate sandboxed
window. Its preload exposes only the nine fixed module commands. Main verifies
the calling window and top frame, revalidates the current signed workspace owner
before each operation, and closes retained views if authentication or guild
binding changes. The manager cannot make network requests, choose filesystem
paths, access game credentials, or invoke the broker. An invalid module policy
leaves the core application and recovery menu usable.

Linux staging bundles the manager and host with their dependencies. The default
`addon-policy.json` has no trusted keys or approved source/rights receipts and
therefore refuses package installation. A distributor may supply a separately
reviewed policy with the staging configuration's absolute `addonPolicy` path.
This does not approve a canonical decoder, source transfer, assets or live game
protocol. Synthetic qualification uses separate ephemeral test trust material.

Stopped workspace exports include retained module data and packages in the v2
checkpoint format. The v1 core-only format remains readable. Trust configuration
and the game vault are outside both formats; restored modules must still pass the
installed application's current trust policy. An interrupted module transaction
refuses export until it is recovered.

## Build and verify

Use the repository's locked dependencies and Node 22.23.x. Choose an absolute output directory outside the checkout:

```sh
node --import tsx --test tests/addons/*.node-test.ts tests/addons/*.node-test.tsx
npx tsc -p packages/addon-host/tsconfig.json
npx eslint packages/addon-host/src apps/addons
node apps/addons/build.mjs /absolute/output/addons
node tests/addons/packaged-smoke.mjs /absolute/output/addons
npm run security:clean-repo
```

The build produces `addon-host.mjs`, `commands.mjs`, `manager.mjs` and a component manifest with source SHA, dirty-source indicator, runtime and exact component hashes. The smoke test runs those built files, signs synthetic fixture packages with transient test keys, verifies component digests, installs both modules and exercises offline processing, failed updates, rollback, disable/enable, restart and uninstall retention/isolation. It reports `nativeInstalledArtifact: false`. Ephemeral test keys are never release trust identities.

## Native integration

The native application owns one `AddonHost` instance in an app-private add-on directory. Supply the actual core version, platform, architecture, independently provisioned trusted public keys, key revocation list and approved review/rights receipt digests. Empty trust/approval sets reject installation. Source, rights and receipt review are release decisions; no approved release signing identity or consumer package is created by these scripts.

Call `setBinding` with native-owned opaque local account/guild handles after workspace onboarding. `null` disconnects. Player/Guild/Guild Raid API keys stay in the separate native onboarding/vault adapter. They never appear in these commands. A Guild War session requires a current guild binding; that binding does not make an imported report verified.

Mount `AddonManager` with `createAddonCommands(host)` behind authenticated fixed native IPC. The bridge must enforce calling-window identity and reject unlisted commands; it must not expose a public loopback HTTP endpoint. Pass a new `bindingRevision` on account/guild changes so the UI drops retained views and pending results. The host also invalidates sessions and cancels jobs. The manager includes package permission review, enable/disable, update/restore, explicit retain/delete uninstall, local import, war totals, replay play/pause and seek.

The current implementation executes only built-in reviewed TypeScript modules. Signed package files are limited to `module.json` and optional `notice.txt`, verified on stage and again at activation/read. No downloaded scripts, migrations, models, shaders, archives or network requests run. Module schema version is 1; unsupported schema changes fail before activation. Future module-owned migrations require a separately reviewed transactional adapter and data-preserving rollback plan.

## Data and recovery

Each immutable package is addressed by its signed-envelope/file digest. A registry rename atomically selects active/previous versions and preserves module data. A failed precommit update keeps the previous version; explicit rollback does not discard imported data or broaden permissions. Core storage is outside this host and never written. Disable and uninstall revoke sessions/jobs. Uninstall changes only the selected module's installation entry and, when explicitly requested, that module's bound data.

Account/guild bindings partition imports. Returning to the same local binding reopens historical data without credentials or network. Exports contain only normalized module input; diagnostics contain counts. Schema failures and device operation errors use fixed messages without reflecting hostile payloads. A corrupted/symlinked registry or an interrupted exclusive transaction lock is an explicit recoverable state. Native recovery must confirm exclusive ownership and preserve a backup before clearing an interrupted lock; the host never guesses that another process is dead.

The filesystem implementation assumes a trusted native process and app-private directory. Same-user processes and administrator access remain outside an OS-isolation claim. Atomic rename/fsync behavior and native process/job termination require qualification on the packaged target. There is no claim that JavaScript validation supplies an OS sandbox.

## Explicit normalized JSON export

Each enabled module with `offline.read` offers an explicit JSON export of its
current bound import. The native main process owns the save dialog, destination
and generated bytes; renderer IPC accepts only the module ID and returns no file
path or contents. Cancelling the dialog writes nothing. No imported data, missing
read permission, revoked trust or a disabled module refuses export.

The trusted save adapter retains the original host session across the dialog.
After the dialog, main revalidates the signed workspace binding and calling
frame, then reads through that session again immediately before its synchronous
write. Binding or session invalidation, including a disable/enable roundtrip,
refuses the pending export. The callback is a main-only argument to runtime
dispatch, never part of a renderer request; integrations using
`createAddonCommands` must provide this trusted save adapter to support export.

Exports roundtrip only the existing `ta-war-summary-v1` or
`ta-replay-timeline-v1` normalized input. They omit other modules, core storage,
package/trust configuration, credentials and contribution receipts. Export does
not verify imported data, publish/upload it, enable capture, or establish
canonical decoder, asset or installed-platform acceptance.

## Format and release limits

`ta-war-summary-v1` is an explicitly local normalized report with numbered player slots/zones, bounded numeric scores and outcomes. It supports aggregation, not live game acquisition or canonical Guild War module parity. `ta-replay-timeline-v1` is a normalized sequence of bounded spawn/move/damage/remove events using numbered entities and placeholder markers. It supports deterministic offline seek, not authoritative game replay decoding or a 3D game viewer. Unknown formats, archives, active fields, unexpected identities, excessive resources and inconsistent events fail closed.

Both formats carry `locally-supplied-unverified` provenance when viewed. Official API credentials and contribution receipts never upgrade that label. No replay upload or publication command exists here.

Remaining release gates are reviewed canonical regenerated Guild War release lineage, authoritative replay decoder compatibility/fixtures, asset redistribution receipts, approved device-local game protocol/sourcing, native IPC/vault/isolation adapters, store/channel approval, and installed-artifact tests on actual platforms. Five platform-policy lifecycle tests run on the test host and are not native-device evidence. Consumer signing and ordinary native installation remain unavailable until those gates pass.
