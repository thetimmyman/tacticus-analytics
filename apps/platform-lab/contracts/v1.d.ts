export type Platform = 'linux' | 'macos' | 'windows' | 'android' | 'ios'
export type EvidenceClass = 'physical' | 'vm' | 'emulator' | 'simulator'
export type Result = 'pass' | 'fail' | 'blocked'
export type ScenarioId =
  | 'clean-install'
  | 'onboarding'
  | 'offline-core'
  | 'restart-persistence'
  | 'token-expiry'
  | 'shutdown-recovery'
  | 'backup-restore'
  | 'bad-update'
  | 'opt-in-egress'
  | 'suspend-resume'
  | 'disk-pressure'
  | 'upgrade-rollback'
  | 'uninstall'
export interface FixtureV1 {
  schemaVersion: 'platform-fixture/v1'
  fixtureId: string
  synthetic: true
  seed: number
  clock: { now: string; tokenExpiresAt: string }
  network: { mode: 'deny' | 'fixture' | 'allow-list'; allowedOrigins: string[] }
  upstream: {
    responses: {
      capability: 'player' | 'guild' | 'guild-raid'
      method: 'GET' | 'POST'
      path: string
      status: number
      body: Record<string, unknown>
    }[]
  }
  profile: { displayName: string; roster: { unit: string; level: number }[] }
  canaries: { id: string; value: string }[]
}
export interface EvidenceV1 {
  schemaVersion: 'platform-evidence/v1'
  evidenceKind: 'harness-self-test' | 'product-acceptance'
  runId: string
  build: {
    sha: string
    artifact: null | { sha256: string; format: string }
  }
  environment: {
    os: Platform
    osVersion: string
    arch: string
    classification: EvidenceClass
    runtimeVersions: Record<string, string>
    installation: 'clean-install' | 'existing-install' | 'source' | 'none'
  }
  fixture: { id: string; sha256: string }
  scenario: { id: ScenarioId; expected: string }
  startedAt: string
  completedAt: string
  outcome: { status: Result; actual: string; blockers: string[] }
  assertions: { id: string; status: Result; expected: string; actual: string }[]
  attachments: {
    name: string
    sha256: string
    mediaType: string
    redacted: true
  }[]
}

/** An explicit platform adapter implements real installed-product operations. */
export interface PlatformAdapterV1 {
  schemaVersion: 'platform-adapter/v1'
  supportedScenarios: ScenarioId[]
  run(context: {
    scenario: ScenarioId
    fixture: FixtureV1
    workspace: string
    artifactPath: string
    fixtureOrigin: string | null
  }): Promise<{
    status: Result
    actual: string
    assertions: EvidenceV1['assertions']
    blockers: string[]
    captures: { name: string; mediaType: string; text: string }[]
  }>
}
