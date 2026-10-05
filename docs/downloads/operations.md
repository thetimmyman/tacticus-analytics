# Downloads operation and withdrawal

The downloads routes are implemented with all flags off by default. No release manifest, trust key or qualified artifact is bundled for publication. Synthetic fixtures test decisions; they do not establish release availability, installed operation or staging approval.

## Server configuration

Configure these only in the server environment. Do not use `NEXT_PUBLIC_` variables for this policy.

| Variable                        | Default and behavior                                                                                                                                                                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DOWNLOADS_ENABLED`             | Off; only literal `true` enables public stable discovery.                                                                                                                                                                            |
| `DOWNLOADS_PREVIEW_ENABLED`     | Off; separate reviewer preview policy.                                                                                                                                                                                               |
| `DOWNLOADS_PREVIEW_TOKEN`       | Absent; preview requires an operator-provided bearer token of at least 32 bytes. A controlled review proxy injects `x-downloads-preview-token` on page, manifest and handoff requests. Do not put it in a URL or browser JavaScript. |
| `DOWNLOADS_READY_PLATFORMS`     | Empty; reviewed `platform:channel` pairs, comma separated, e.g. `linux:stable,macos:preview`. Unknown pairs disable discovery.                                                                                                       |
| `DOWNLOADS_MANIFEST_PATH`       | Absent; local read-only signed JSON manifest, replaced atomically. Maximum size 1 MiB.                                                                                                                                               |
| `DOWNLOADS_TRUSTED_KEYS_JSON`   | Empty map; key IDs mapped to reviewed Ed25519 public PEM keys. Private signing keys never belong in the application.                                                                                                                 |
| `DOWNLOADS_REVOKED_RELEASE_IDS` | Empty; immediate local withdrawal list, comma separated. Invalid entries fail closed.                                                                                                                                                |
| `DOWNLOADS_MIN_GENERATED_AT`    | Unset; ISO UTC floor that rejects previously signed older manifests after withdrawal or rollback.                                                                                                                                    |

The public loader verifies the canonical envelope signature, rejects fixture envelopes, limits validity to seven days, and requires approved immutable URL destinations, platform distribution/signing metadata, exact source/digest qualification and rights/security/publication evidence. Missing configuration or invalid files show an honest unavailable state. Every entry remains unavailable until its platform/channel readiness pair is enabled. A stable manifest with no eligible entries shows an empty support matrix.

`GET /api/downloads/manifest` provides the already verified, eligible discovery view. It is not a replacement for the original signed envelope and must not be used as an updater trust input. Update consumers verify the publisher's v1 signed envelope and their own runtime/core/module/workspace compatibility before activation. The JSON Schema for tooling is `apps/releases/release-manifest.schema.v1.json`; the strict runtime definition remains `app/lib/downloads/schema.ts`.

`/downloads` renders dynamically without the Next server cache. Manifest and installer handoff responses use private/no-store headers, including CDN no-store. A download button uses a local handoff route that rereads flags, manifest freshness and revocations before redirecting. A restored browser snapshot refreshes discovery and withdraws links if the current server gate closes; an expired snapshot drops links. Artifact storage is public: flags withdraw discovery and handoff, not access to a previously copied artifact URL. Providers must enforce immutable storage independently; naming an asset with a digest alone cannot prevent replacement.

## Candidate review and promotion checklist

1. Build the actual packaged artifacts from the recorded public source commit. Calculate SHA-256 and byte size over the final signed/notarized/provisioned bytes. Publish only to the reviewed HTTPS destinations with digest-bearing filenames and replacement disabled.
2. Install, launch, use offline, restart, recover and uninstall on each declared real platform/architecture/minimum OS. Record `platform-evidence/v1` evidence bound to the exact `sourceCommit` and artifact digest. Publish sanitized evidence without private identity, topology, keys or captures.
3. Verify platform signature and macOS notarization or iOS provisioning. iOS uses approved App Store stable or TestFlight preview destinations. Android store destinations identify only the reviewed application ID. Never ask users to bypass OS protection.
4. Review rights, binary license/notices, security, qualification, support matrix, local-client limitations, release notes, install/update/uninstall guidance and publication approval. Stable prerelease versions, pending/failed/revoked checks and unsupported platform combinations cannot be promoted.
5. Have the authorized signing service produce the v1 canonical envelope. Configure only its separately reviewed public key. Inspect the signed file offline before mounting it; keep the prior approved manifest and configuration for rollback.
6. In staging, verify flag-off direct page/menu/API/handoff, public stable access without accounts, separate reviewer preview access, keyboard and mobile selection, checksums/byte sizes, real artifact downloads, store handoff, stale browser/CDN caches, withdrawals and existing hosted/login functionality. Check both the deployed framework and reverse proxy honor no-store. A local fixture run cannot satisfy this staging review.
7. Submit the exact candidate, evidence and configuration for owner approval. Production deployment, flag enablement and public promotion are explicit owner decisions. This implementation does not perform them.

## Rollback, revocation and key changes

For immediate withdrawal, disable the relevant readiness pair or the public flag; add revoked IDs and raise the generation floor. Replace the signed manifest atomically, then check both API routes, restored browser pages and navigation. Keep no-store headers in place and purge any existing shared cache entries as part of the reviewed deployment. Previously public artifact URLs may still resolve and need the provider's separately approved withdrawal procedure.

Rollback discovery only to an approved signed manifest whose generation timestamp satisfies the withdrawal floor and whose artifacts remain qualified. Do not reactivate a revoked digest. Installer update rollback and workspace-schema recovery are separate platform responsibilities; this page never migrates or deletes user data.

Remove a compromised or retired key from the trusted map and verify old envelopes are rejected. A new public key requires independent review and publisher signing-service coordination. Do not create or rotate signing identities from the downloads application. Preserve the prior configuration and receipt for a reviewed rollback when appropriate.

## Reproduce consumer checks

Use the repository's declared Node version and dependencies:

```sh
npm exec vitest run tests/downloads
npm exec eslint app/lib/downloads app/downloads app/api/downloads app/components/NavigationServer.tsx
npm run typecheck
npm run security:clean-repo
```

These tests use runtime-generated synthetic keys and metadata. They cover signature tampering, trust, freshness, URL policy, revocation, incomplete qualification/approval, unsupported platforms, store distribution, default flags, direct routes, restored snapshots and manual selection. Actual artifact checksum/download/install and staging results must be supplied by release qualification; these tests do not assert them.
