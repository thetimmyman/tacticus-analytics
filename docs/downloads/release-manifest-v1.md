# Release manifest v1

The contract is `app/lib/downloads/schema.ts`; every object rejects unknown fields. This contract describes release candidates. It does not establish that any artifact is available or qualified. The public loader must independently verify the manifest signature against an operator-provided trusted Ed25519 public key and then enforce every promotion gate.

The envelope has `schemaVersion: 1`, `purpose` (`release` or `fixture`), `keyId`, `payload` and a base64 Ed25519 `signature`. Sign the UTF-8 canonical JSON of `{schemaVersion, purpose, keyId, payload}` with recursively sorted object keys and preserved array order. `payload` contains `generatedAt`, `expiresAt` and `releases`. Expired, future-dated, unsupported-version and fixture envelopes must never publish download links. Trust keys are configured separately; a key embedded in an envelope is not trusted.

Each release supplies:

- Identity: `id`, `component` (`core`, `guild-war`, `replays`), `platform`, `architecture`, `minimumOS`, `channel`, `version`, `releasedAt`, `sourceCommit` and `state`.
- Artifact: immutable digest-addressed `url`, SHA-256 `sha256`, byte `size`, `format`, plus signature scheme/status/evidence, notarization status/evidence and provisioning status/evidence.
- Distribution: `method` and optional store `url`. iOS uses App Store or TestFlight, never a direct IPA link. Store destinations refer to the approved version/build described by the manifest; a store URL alone is not immutable artifact proof.
- Compatibility: exact `coreVersion`, supported inclusive workspace schema bounds and `moduleApi`. Update consumers must check all three against their installed runtime; a downloads page does not authorize activation or migration.
- Qualification: `evidenceSchema: platform-evidence/v1`, exact `sourceCommit` and digest binding, public sanitized evidence reference, tested OS and installed/offline/restart/recovery/uninstall results. Synthetic results never qualify real packages.
- Approvals: explicit rights, security and publication status/evidence. All must be approved before offering a link.
- Guidance: install/update/uninstall text, release notes, known gaps and accurate local-client compatibility text. No secrets, private paths or unreviewed support claims belong here.

Supported architecture/format/signature combinations are checked by the consumer. Stable versions cannot contain prerelease suffixes. Core releases must match their compatibility core version. Preview distribution remains separate from stable; TestFlight is preview only. Unknown fields, URLs outside reviewed destinations, credential-bearing URLs, revoked entries and missing gate evidence fail closed.

An artifact URL must be HTTPS and include its SHA-256 in its final filename. Release storage must reject replacement at that URL; the digest remains mandatory for independently verifying the bytes. Evidence URLs must reference reviewed public HTTPS documentation. Public route readiness is independently controlled per platform/channel, and artifact storage remains public regardless of page flags.

Consumer example:

```ts
import { releaseManifestSchema } from '@/app/lib/downloads/schema'

const envelope = releaseManifestSchema.parse(untrustedJson)
// Verify canonical envelope signature using a separately trusted public key.
// Reject purpose=fixture and stale envelopes, then apply all promotion gates.
// An updater also checks coreVersion, workspaceSchema and moduleApi locally.
```

`apps/releases/example.manifest.v1.json` is deliberately synthetic, has no releases and has a non-valid signature. It must never be used as publication evidence or installed-artifact proof. Publishers populate candidates using the exact artifact digest and approved sanitized evidence. No signing identity or release is created by this interface.
