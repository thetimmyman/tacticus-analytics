# Platform fixture and evidence contract v1

The shared types live in `apps/platform-lab/contracts/v1.d.ts`. Fixtures and evidence are plain JSON with the exact `schemaVersion` strings below. Platform adapters implement real application operations; the lab supplies isolation, fixtures, scenarios and evidence collection. Unknown fields and versions are rejected by the lab validator.

`platform-fixture/v1` contains `fixtureId`, `synthetic: true`, a numeric `seed`, `clock` (`now`, `tokenExpiresAt`), `network` (`mode`, `allowedOrigins`), `upstream.responses`, a synthetic `profile` and synthetic-secret `canaries`. Response entries specify `capability`, `method`, `path`, `status` and `body`. Capabilities are `player`, `guild` and `guild-raid`. A fixture response exercises an adapter; it does not establish what a live upstream API exposes.

`platform-evidence/v1` contains `evidenceKind`, `runId`, `build` (`sha`, nullable `artifact` with `sha256` and `format`), `environment` (`os`, `osVersion`, `arch`, `classification`, `runtimeVersions`, `installation`), `fixture` (`id`, `sha256`), `scenario` (`id`, `expected`), `startedAt`, `completedAt`, `outcome` (`status`, `actual`, `blockers`), `assertions` and `attachments`. Each assertion has `id`, `status`, `expected` and `actual`. Each attachment has a portable `name`, `sha256`, `mediaType` and `redacted: true`; private attachment paths and device identities never enter the public record.

Build SHA is a full 40-character hexadecimal commit. Digests are SHA-256 lowercase hexadecimal. Timestamps are UTC ISO 8601. OS values are `linux`, `macos`, `windows`, `android` and `ios`; classification is `physical`, `vm`, `emulator` or `simulator`. Runtime versions are string values. Scenario IDs are enumerated by `ScenarioId` in the shared types. Result is `pass`, `fail` or `blocked`.

Passing product acceptance requires an artifact digest, an installed artifact, at least one passing assertion and no failed or blocked assertion. Missing artifacts, adapters or environments produce blocked evidence. A harness self-test never qualifies a product. Emulator or simulator results never satisfy physical mobile release acceptance. Platform owners establish OS minimums using packaged-artifact evidence; no generic matrix entry promises support.

Adapters use `platform-adapter/v1` and export `supportedScenarios` and `run(context)`. The context contains the scenario, full synthetic fixture, disposable workspace, artifact path and optional loopback fixture origin. The result contains status, actual observations, assertions, blockers and textual captures. Captures are checked for literal and encoded canaries before being written. Network policy requires enforcement by the platform adapter and independent observations; the fixture's mode alone is not proof that external traffic was blocked.

```ts
import type {
  EvidenceV1,
  FixtureV1,
  PlatformAdapterV1
} from '../../apps/platform-lab/contracts/v1'

const fixture: FixtureV1 = {
  schemaVersion: 'platform-fixture/v1',
  fixtureId: 'synthetic-player-only',
  synthetic: true,
  seed: 7,
  clock: {
    now: '2026-01-01T00:00:00.000Z',
    tokenExpiresAt: '2026-01-01T01:00:00.000Z'
  },
  network: { mode: 'fixture', allowedOrigins: [] },
  upstream: {
    responses: [
      {
        capability: 'player',
        method: 'GET',
        path: '/fixture/player',
        status: 200,
        body: { synthetic: true, displayName: 'Example Player' }
      }
    ]
  },
  profile: { displayName: 'Example Player', roster: [] },
  canaries: []
}

// An adapter must supply observed product assertions for supported scenarios.
const unsupported: PlatformAdapterV1 = {
  schemaVersion: 'platform-adapter/v1',
  supportedScenarios: [],
  async run() {
    return {
      status: 'blocked',
      actual: 'A packaged application adapter is required.',
      assertions: [],
      blockers: ['Installed-product adapter unavailable.'],
      captures: []
    }
  }
}

// Consumers filter both provenance and environment before qualification.
function isPhysicalMobilePass(record: EvidenceV1) {
  return (
    record.evidenceKind === 'product-acceptance' &&
    ['android', 'ios'].includes(record.environment.os) &&
    record.environment.classification === 'physical' &&
    record.outcome.status === 'pass'
  )
}
```

Version 1 adds no live credentials, account enrollment or production services. Keep real inventory and execution plans outside the public repository. Adapters must never return secrets, identifiers, host names or private paths in observations.
