# Add-on and device broker contract v1

`packages/addon-host/src/contract.ts` is the strict runtime validator and TypeScript interface. Unknown fields fail closed. Both add-ons use the same host API version, independently owned schema version and bounded package format.

A signed envelope contains `manifest` and `signature`. The manifest binds the add-on ID, exact semantic version, first-party publisher, reviewed public source commit, review and rights-receipt digests, core version range, platform/architecture list, capabilities, exact file inventory and pinned dependencies. The host trusts configured Ed25519 public keys, checks revocation, and verifies the signature over UTF-8 `canonicalJson(manifest)` before staging. The signature does not establish source ownership or distribution rights; receipts must also appear in the host's approved digest set.

The current runtime is `builtin-vetted-v1`: downloaded packages contain JSON data and plain-text notices, with no executable code, scripts, shaders, game binaries or game assets. The application ships reviewed offline module implementations. This format can support restricted mobile channels without promising downloadable executable plugins. Native store/channel qualification is still required.

Files have `path`, `sha256`, `bytes` and `kind` (`data` or `notice`). Paths are relative lowercase names ending in `.json` or `.txt`; traversal, symlinks and archives are not package inputs. There are at most 64 files, 4 MiB per file and 8 MiB total. Compatibility covers `hostApiVersion`, `coreMinVersion`, `coreMaxVersion`, `platforms`, `architectures`, `dataSchemaVersion`. Dependency entries have `addonId`, `version`, `packageSha256`.

Capabilities are `offline.import`, `offline.read`, `broker.guild-war.read`, and `broker.replay.capture`. Each broker permission belongs to its matching add-on. Installation grants no account connection or publication consent. Permission expansion requires fresh approval before activation; update contact and contribution consent remain independent.

Broker request example:

```json
{
  "schemaVersion": 1,
  "addonId": "guild-war",
  "sessionHandle": "synthetic-session",
  "leaseHandle": "synthetic-lease",
  "operation": "guild-war.snapshot",
  "requestId": "synthetic-request"
}
```

The trusted host supplies account and guild binding, epoch and expiry. Requests cannot supply account IDs, URLs, credentials, arbitrary payloads, headers or signing material. Handle validity requires the current module session, manifest permissions, current binding, active module, fresh consent, supported protocol and unlocked native vault. Refusal, lock/unavailability, renewal, account or guild change, revoke, disable and uninstall cancel outstanding work and invalidate leases.

No approved game-client sourcing or protocol implementation is currently configured. Every platform returns a typed `unavailable` result with a local import alternative. No search, extraction, root/jailbreak or cross-app access is attempted. Official Player/Guild/Guild Raid API keys belong to the independent workspace onboarding adapter; game-client access does not grant official API scope or cloud verification. War/replay imports are locally supplied and unverified.

Native adapters must enforce process isolation, fixed destinations and secret confinement before connected operations can ship. Neither strict JSON validation nor a JavaScript worker is an OS sandbox. A supported operation will require an explicit versioned result projection, resource limits, cancellation and platform tests; raw upstream responses never cross this interface.
