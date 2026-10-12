# Desktop update and download key rotation

A runbook for signing-key rotation, revocation and rollback for the two
release-discovery systems that feed desktop clients:

- **Downloads discovery manifest** — the public, multi-platform v1 manifest
  served from the website (`app/lib/downloads/`).
- **Desktop update feed** — the Linux-preview in-application update check
  (`apps/desktop/launcher/updates.mjs` and `apps/desktop/package/updates.json`).

These are independent systems with different trust models. Every procedure
below is documented only where the code implements it.

## Trust models at a glance

| Concern                | Downloads discovery manifest                            | Desktop update feed                                                |
| ---------------------- | ------------------------------------------------------- | ------------------------------------------------------------------ |
| Envelope               | `{ schemaVersion, purpose, keyId, payload, signature }` | `{ payload, signature }`                                           |
| Key storage            | `DOWNLOADS_TRUSTED_KEYS_JSON`: `Record<keyId, PEM>`     | `apps/desktop/package/updates.json`: `publicKey` (base64 DER SPKI) |
| Keyed by               | `keyId` on the envelope                                 | implicit — single key in config                                    |
| Rotation overlap       | supported (map holds multiple keys)                     | not supported (one key at a time)                                  |
| Monotonic guard        | `DOWNLOADS_MIN_GENERATED_AT` (ISO UTC floor)            | `sequence > config.sequence`                                       |
| Per-release revocation | `DOWNLOADS_REVOKED_RELEASE_IDS` + `state: revoked`      | not supported                                                      |
| Local manifest store   | yes — `DOWNLOADS_MANIFEST_PATH`                         | no — fetched from `manifestURL` each check                         |

The default desktop config (`apps/desktop/package/updates.json`) ships with
`manifestURL: null` and `publicKey: null`, so the preview has no feed until an
operator sets both.

## Signing contracts

### Downloads discovery manifest (v1)

Schema: `app/lib/downloads/schema.ts`; validation: `app/lib/downloads/manifest.ts`.

The signed document is `canonicalJson(unsignedEnvelope(manifest))` where:

- `canonicalJson` (line 11) recursively sorts object keys and preserves array
  order.
- `unsignedEnvelope` (line 23) returns `{ schemaVersion, purpose, keyId, payload }`.

To sign:

1. Assemble the manifest with `purpose: 'release'`, a `keyId`, and a `payload`
   containing `generatedAt`, `expiresAt` and `releases`.
2. Compute `sign(null, Buffer.from(canonicalJson(unsignedEnvelope(manifest))), privateKey)`.
3. Set `signature` to the base64 Ed25519 result. The schema requires
   `/^[A-Za-z0-9+/]{86}==$/` (exactly 64 bytes).

Validity enforced in `validateManifest` (line 32):

- `generatedAt <= now`
- `expiresAt > now`
- `expiresAt > generatedAt`
- `expiresAt - generatedAt <= 7 * 24 * 60 * 60 * 1000` (`MAX_MANIFEST_AGE_MS`, line 9)

### Desktop update feed (ta-update-v1)

Envelope: `{ payload, signature }`, both base64. The decoded payload JSON must
contain exactly the 14 fields checked in `verifiedUpdate` (line 102): `format`
(`'ta-update-v1'`), `channel`, `platform`, `packageName`, `packageFormat`,
`sequence`, `version`, `url`, `sha256`, `bytes`, `expiresAt`, `notes`.

To sign:

1. `payload = Buffer.from(JSON.stringify(updateObject))`.
2. `signature = sign(null, payload, privateKey)`.
3. Set the envelope fields to `payload.toString('base64')` and
   `signature.toString('base64')`.

Validity enforced in `verifiedUpdate` (line 81):

- `expiresAt > clock()`
- `expiresAt <= clock() + 7 * 86400000` (7-day maximum, line 138)
- `sequence > config.sequence` — otherwise the result is `null` (no update).

## Trusted-key map semantics

### Downloads: keyId -> PEM

`getDownloadsState` (`app/lib/downloads/server.ts:69`) parses
`DOWNLOADS_TRUSTED_KEYS_JSON` into a `Record<string, string>`. It rejects
non-object, array, or non-string-valued maps and returns `unavailable`.

`validateManifest` (line 50) requires:

```ts
Object.hasOwn(trustedKeys, manifest.keyId)
```

If the envelope's `keyId` is absent from the map, the function throws
`'Untrusted manifest key'` before signature verification runs, and
`resolveDownloads` returns `unavailable`.

The map value is a PEM-encoded Ed25519 public key (the test fixtures export
`publicKey.export({ format: 'pem', type: 'spki' })`). `createPublicKey`
(`manifest.ts:54`) accepts PEM and the code checks
`key.asymmetricKeyType === 'ed25519'`.

### Desktop updates: single DER SPKI key

`updateConfiguration` (`apps/desktop/launcher/updates.mjs:73`) stores
`publicKey` as base64-encoded DER subjectPublicKeyInfo. Validation:

```ts
const key = createPublicKey({
  key: base64(value.publicKey),
  format: 'der',
  type: 'spki'
})
if (key.asymmetricKeyType !== 'ed25519') throw invalid()
```

`base64` (line 14) requires canonical base64 (re-encoding must round-trip). The
envelope has no `keyId`; the config carries one trusted key.

## Procedures

### Add a new signing key

#### Downloads

1. Generate an Ed25519 key pair.
2. Add an entry to `DOWNLOADS_TRUSTED_KEYS_JSON`:
   ```json
   {
     "old-key-id": "-----BEGIN PUBLIC KEY-----...",
     "new-key-id": "-----BEGIN PUBLIC KEY-----..."
   }
   ```
3. Re-sign the manifest with the new private key and the new `keyId`.

Multiple keys can coexist in the map. Each manifest envelope carries a single
`keyId`, so a given manifest is signed by one key even while multiple keys are
trusted. This overlap is the recommended rotation window.

#### Desktop updates

1. Generate an Ed25519 key pair and DER-encode the public key as base64 SPKI.
2. Replace `publicKey` in `apps/desktop/package/updates.json`.
3. Ship the new config with the next application build.

No overlap is possible: the config holds one key, and the envelope has no
`keyId`. A dual-key transition window must be implemented out-of-band.

### Retire a compromised key (old envelopes rejected)

#### Downloads

1. Remove the compromised `keyId` from `DOWNLOADS_TRUSTED_KEYS_JSON`.
2. Verify `validateManifest` rejects envelopes signed with the removed `keyId` —
   the `Object.hasOwn` check fails immediately ('Untrusted manifest key').
3. If the removed key signed the currently published manifest, re-sign and
   atomically replace the manifest with a new one using a trusted key.

Removing a key from the map invalidates every envelope referencing that `keyId`,
regardless of the 7-day validity window. No timing window lets an old-key
envelope through once the key is gone from the map.

#### Desktop updates

1. Replace `publicKey` in `apps/desktop/package/updates.json` with a new key.
2. Verify `verifiedUpdate` rejects old envelopes — the Ed25519 `verify` call
   (line 94) against the new key fails ('The update could not be verified').
3. Ship the new config with the next application build.

The config is bundled with the package; key replacement requires an
application release or a package-config rebuild.

Bootstrap limitation: an installed client keeps verifying against the key it
shipped with, so it rejects a release envelope signed only by the new key.
Shipping the new key in a bridge release signed with the old key lets a
compromised old key publish that update too. After a real compromise, installed
clients must therefore be moved to the new key through a channel outside the
update feed (for example a fresh install from the downloads page or the OS
package manager), and the old key must be treated as untrusted until they have
moved. This runbook does not describe an automated recovery path because the
code has none. The default `updates.json`
ships with `manifestURL: null` and `publicKey: null`.

### Revoked release ids

Supported by the downloads system only.

`DOWNLOADS_REVOKED_RELEASE_IDS` (comma-separated) is parsed in
`downloadsPolicy` (`app/lib/downloads/policy.ts:28`). `resolveDownloads`
(`state.ts:28`) filters releases with `!policy.revoked.includes(release.id)`.
Each ID must match `/^[a-z0-9][a-z0-9.-]{0,79}$/` — invalid entries fail closed
and disable the entire policy.

A release can also carry `state: 'revoked'` (schema `state` enum at
`schema.ts:36`): `releaseBlockers` (`manifest.ts:170`) flags any non-`published`
state as a blocker ('Release has not been published').

Revocation is immediate and persists across manifest replacement: as long as an
ID remains in the list, that release is excluded from every discovery response.

The desktop update feed has no release IDs, no `state` field and no revocation
list. Its only forward-only guard is the monotonic `sequence` floor.

### Minimum generation floor

#### Downloads

`DOWNLOADS_MIN_GENERATED_AT` is an ISO UTC timestamp parsed in
`downloadsPolicy` (`policy.ts:31`). `resolveDownloads` (`state.ts:22`):

```ts
if (Date.parse(manifest.payload.generatedAt) < policy.minimumGeneratedAt)
  throw new Error('Manifest predates withdrawal floor')
```

The floor is part of the enabled check: `downloadsPolicy` requires
`Number.isFinite(minimumGeneratedAt)`. An unset or empty value means no floor
(it is treated as 0 and the policy stays enabled), while a non-empty value that
does not parse as a date is not finite and disables the whole policy.

The floor only blocks replay of manifests generated before it. It does not
neutralise a compromised key that is still in the trusted map: its holder can
sign a new envelope with a `generatedAt` after the floor, and that envelope is
accepted. Compromise response is always to remove the key from the trusted map
(see "Retire a compromised key"); use the floor to withdraw already-issued
manifests, not as a substitute for key removal.

#### Desktop updates

No timestamp-based floor exists. The config's `sequence` value
(`updates.json`) is the monotonic floor: `verifiedUpdate` returns `null` for
`value.sequence <= config.sequence` (`updates.mjs:155`). Bumping
`config.sequence` in a shipped config rejects all older envelopes regardless of
signing key.

### Roll back the discovery manifest

#### Downloads

Rollback means atomically replacing `DOWNLOADS_MANIFEST_PATH` with an older
approved manifest that satisfies every gate:

- Signed by a currently-trusted key (`keyId` present in the trusted map).
- `generatedAt >= DOWNLOADS_MIN_GENERATED_AT` (must pass the withdrawal floor).
- Within the 7-day validity window.
- Every included release passes `releaseBlockers` (published state, approved
  immutable URLs, qualified, approved, compatible coreVersion/workspaceSchema/moduleApi).

`getDownloadsState` rereads the file, env and policy on every request
(`server.ts:46`), so a replaced manifest file is picked up without a redeploy. Environment
variables (trusted keys, flags, revocation list, floor) are read from the
process environment, so changing them requires the operator to restart or
redeploy the process with the new values.
Keep the prior manifest and key configuration for a reviewed rollback.

#### Desktop updates

No rollback mechanism. The client fetches from `manifestURL` on each check and
verifies against the bundled `publicKey`. There is no local manifest store to
fall back to. Publishing an older envelope at the URL is rejected unless its
`sequence` exceeds the config floor. Application-level rollback is the
responsibility of the OS package manager.

## What the client verifies before activation

### Downloads

Server-side — `getDownloadsState` -> `resolveDownloads` ->
`validateManifest` + `releaseBlockers`:

- Policy enabled: flags on, readiness pairs valid, revocation IDs valid,
  generation floor valid.
- Envelope signature over `canonicalJson(unsignedEnvelope(manifest))` against
  the trusted key for `manifest.keyId`.
- Freshness: `generatedAt <= now`, `expiresAt > now`, 7-day window.
- `purpose === 'release'` (fixture rejected).
- No duplicate release IDs; no release dated after `generatedAt`.
- Per release: channel eligible, `platform:channel` readiness pair enabled, ID
  not revoked, `state === 'published'`, immutable digest-addressed HTTPS URL on
  an approved host, approved distribution method, version/channel compatibility,
  platform/arch/format match, signature/notarization/provisioning verified with
  public evidence, qualification complete (sourceCommit + sha256 binding, tested
  OS, install/offline/restart/recovery/uninstall), rights/security/publication
  approvals approved.

Consumer-side (per `docs/downloads/release-manifest-v1.md` line 22): an updater
must not trust the `GET /api/downloads/manifest` discovery view. It verifies the
original signed envelope itself and checks `coreVersion`, `workspaceSchema`
bounds, and `moduleApi` against the installed runtime before activation.

### Desktop updates

`verifiedUpdate` (`updates.mjs:81`) before returning an update object:

- Config passes `updateConfiguration` (format, sequence >= 1, channel
  `private-preview`, platform `linux-x64`, packageFormat `arch`/`deb`, valid
  HTTPS manifestURL, valid Ed25519 DER SPKI publicKey).
- Envelope has exactly `{ payload, signature }`.
- Payload and signature are valid canonical base64; signature decodes to 64 bytes.
- Ed25519 signature over the raw payload bytes verifies against
  `config.publicKey`.
- Payload has exactly the 14 expected fields; `format === 'ta-update-v1'`;
  channel/platform/packageName/packageFormat match config.
- `sequence` is a safe integer >= 1 and `> config.sequence` (otherwise `null`).
- `expiresAt` not expired and within 7 days of `clock()`.
- URL is HTTPS (or HTTP `127.0.0.1` loopback only when
  `privateLoopbackPreview` is true); no credentials, port, hash or query.
- URL origin matches the manifest URI origin; pathname starts with
  `/packages/`; ends with `.pkg.tar.zst` (arch) or `.deb` (deb).

`downloadUpdate` (`updates.mjs:224`) before writing the file:

- The update object was produced by `verifiedUpdate` (WeakMap membership,
  line 240).
- Not expired at download time.
- URL origin matches the manifest origin.
- SHA-256, byte count, and `content-length` all match the signed manifest.
- The running process owns the target directory (`uid === process.getuid()`);
  the directory is not group/world-writable (`mode & 0o022`); no existing file or
  symlink occupies the target path (`lstat` + throw on line 261).

The menu (`update-menu.cjs:60`) then asks for explicit consent before
downloading. Installation is never automatic — the user installs the package with
the OS package manager after closing the app.

## Offline behaviour

### Downloads

`getDownloadsState` reads the manifest from a local read-only file
(`DOWNLOADS_MANIFEST_PATH`) and makes no outbound network calls during
discovery. Three states:

- **disabled**: flags off or policy invalid — the page
  (`app/downloads/page.tsx:28`) shows 'Downloads are currently unavailable.'
- **unavailable**: manifest missing, malformed, oversized, untrusted signature,
  expired, or generated before the withdrawal floor — same unavailable message.
- **ready**: the signed, fresh, floor-compliant manifest validated. Individual
  releases are then filtered by readiness, revocation and release blockers, so
  `ready` can contain zero eligible releases; the page then shows its empty
  state and offers no links.

The page uses `dynamic = 'force-dynamic'` and `revalidate = 0`
(`page.tsx:5-6`), and responses use `private, no-store` headers
(`server.ts:11`). Restored browser snapshots re-fetch discovery, so a withdrawn
release disappears on return. Previously public artifact URLs may still resolve;
storage immutability is the provider's responsibility, not the page's.

### Desktop updates

`checkForUpdate` (`updates.mjs:179`) requires network access to fetch
`manifestURL`:

- If `manifestURL` is null (the default preview config), `update-menu.cjs:37`
  shows 'An update feed is not configured for this preview.' No network access.
- If the fetch fails (network down), `checkForUpdate` throws `invalid()` and the
  menu shows 'The update could not be downloaded and verified. Your installed
  app and workspace were preserved.'

The updater makes no attempt to cache manifests offline. Downloads are
online-only and use `cache: 'no-store'`. The manifest request times out after 15
seconds (`updates.mjs:196`); the package download allows 5 minutes
(`updates.mjs:284`).

## Gap: consent preservation and permission expansion

The desktop update path —
`apps/desktop/launcher/update-menu.cjs` -> `apps/desktop/launcher/updates.mjs` —
has **no function that persists consent choices** across an update and **no
mechanism for permission expansion requiring fresh approval**. Each
`checkForUpdate` cycle prompts the user with a fresh dialog
(`update-menu.cjs:60`, buttons: Cancel / Download update), and the response is
not written to disk, preferences or any persisted state.

The consent patterns that exist for other flows are unrelated to the update path:

- `apps/desktop/launcher/credential-vault.mjs` — `#consent` callback gates OS-vault
  credential storage for official API keys, not application updates.
- `apps/desktop/launcher/official-raid-broker.mjs` — `#consent` gates official-API
  scope and guild binding.

There is no testable function for consent persistence or permission expansion in
the shipped updater. If update consent should persist (e.g. auto-download after a
single approval, or prompt once per channel) or if a future update may expand
permissions, a persistence layer and a fresh-approval gate must be implemented and
tested. This runbook does not cover a workflow the code does not support.

## Verification checklist

Run from the repository root with the declared Node version.

### Downloads key-trust, revocation and floor controls

```sh
npx --no-install prettier --check docs/desktop/update-key-rotation.md
npm exec vitest run tests/downloads/validation.test.ts
npm exec vitest run tests/downloads/server.test.ts
npm exec vitest run tests/downloads/routes.test.tsx
npm run typecheck
```

Tests that cover key rotation behaviour:

- 'rejects untrusted, tampered, unknown-field and visibly fixture envelopes'
  (`tests/downloads/validation.test.ts`) — a `keyId` absent from the trusted
  map is rejected before signature verification.
- 'accepts trusted signed versioned test doubles without proving a real
  release' (`tests/downloads/validation.test.ts`) — a trusted Ed25519 key
  accepts a validly signed manifest.
- 'fails closed for flag off/missing manifest/readiness and applies immediate
  revocation/freshness floors' (`tests/downloads/validation.test.ts`) —
  `DOWNLOADS_REVOKED_RELEASE_IDS` filtering and `minimumGeneratedAt` rejection
  both behave as fail-closed.
- 'rereads atomic replacement and flag/withdrawal changes on every request'
  (`tests/downloads/server.test.ts`) — the server state is recomputed on every request
  rather than cached in memory. The test changes the environment inside the
  running test process; a deployed process still needs a restart or redeploy to
  see changed environment values.
- 'rejects revoked, wrong platform, digest mismatch and incomplete
  qualification' (`tests/downloads/validation.test.ts`) — `state: revoked`
  appears as a release blocker.
- 'rejects stale and future envelopes, duplicate identities and future
  releases' (`tests/downloads/validation.test.ts`) — the 7-day validity window
  and future-date rejection.

### Desktop update key-trust and sequence controls

```sh
node --test apps/desktop/proof/updates.test.mjs
```

Tests that cover the desktop updater:

- 'signed channel/platform manifest accepts only a newer immutable package'
  (`apps/desktop/proof/updates.test.mjs`) — signature acceptance, sequence
  monotonicity (`sequence <= config.sequence` returns `null`), and rejection of
  tampered, unknown-field, mismatched-channel/platform and expired envelopes.
- 'unconfigured feeds produce no network access and plaintext public feeds
  refuse' (`apps/desktop/proof/updates.test.mjs`) — the default null config
  produces no network access; plaintext (non-loopback) URLs are rejected.
- 'manual check verifies the response and never sends cookies or credentials'
  (`apps/desktop/proof/updates.test.mjs`) — credentials omitted, redirects
  rejected, content-type strictly `application/json`.
- 'download publishes exact signed bytes, refuses forged calls, preserves
  existing files and removes failed partials' (`apps/desktop/proof/updates.test.mjs`)
  — SHA-256 and byte-count enforcement, WeakMap gating against forged calls,
  symlink/target-file refusal, and partial-file cleanup.
