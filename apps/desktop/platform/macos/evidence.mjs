import {
  scenarios,
  validateEvidence
} from '../../../platform-lab/contracts/validate.mjs'

const pending = {
  'clean-install':
    'Consumer signing, notarization and ordinary Gatekeeper installation are pending.',
  onboarding:
    'Owner-provisioned data protection Keychain helper and real official scope qualification are pending.',
  'offline-core':
    'The complete accepted feature matrix and personal-data route integration remain unqualified.',
  'token-expiry':
    'Installed native access expiry and refusal need the owner-provisioned helper.',
  'shutdown-recovery':
    'Simultaneous supervisor termination and interrupted full workspace recovery remain unqualified.',
  'bad-update':
    'Installed verified update refusal and graphical recovery remain unqualified.',
  'opt-in-egress':
    'Real approved contribution-service integration remains gated.',
  'suspend-resume':
    'Sleep, wake and locked-session behavior require an interactive supported Mac.',
  'disk-pressure':
    'Installed full workspace disk-pressure recovery remains unqualified.',
  'upgrade-rollback':
    'Compatible signed update and rollback remain unqualified.',
  uninstall:
    'Ordinary signed installation and removal with retained workspace data remain unqualified.'
}

// Selected installed measurements remain separate from the acceptance gates.
export function records(context) {
  const observed = {
    'clean-install':
      'Copied the developer app from a mounted read-only DMG into a fresh Unicode path.',
    'offline-core':
      'Selected real renderer calculations ran under a loopback-only process sandbox.',
    'restart-persistence':
      'Two cold installed launches retained eight fixture rows and incremented the stored counter from one to two.',
    'backup-restore':
      'Bundled pg_dump and pg_restore restored eight fixture rows and one synthetic account into a disposable database.',
    'bad-update':
      'A failing SQL migration rolled back without leaving its newly created table.'
  }
  return scenarios.map((scenario) => {
    const blocked = pending[scenario]
    return validateEvidence({
      schemaVersion: 'platform-evidence/v1',
      evidenceKind: 'product-acceptance',
      runId: `macos-${context.arch}-${context.sha.slice(0, 12)}-${scenario}`,
      build: {
        sha: context.sha,
        artifact: { sha256: context.artifactSha256, format: 'dmg' }
      },
      environment: {
        os: 'macos',
        osVersion: context.osVersion,
        arch: context.arch,
        classification: 'vm',
        runtimeVersions: context.runtimeVersions,
        installation: 'clean-install'
      },
      fixture: {
        id: 'desktop-synthetic-raid-v1',
        sha256: context.fixtureSha256
      },
      scenario: {
        id: scenario,
        expected:
          scenario === 'restart-persistence'
            ? 'The selected installed fixture writes survive cold restarts.'
            : scenario === 'backup-restore'
              ? 'Bundled recovery tools reproduce the selected database fixture.'
              : 'Complete the platform scenario with the real installed product and approved acceptance scope.'
      },
      startedAt: context.startedAt,
      completedAt: context.completedAt,
      outcome: {
        status: blocked ? 'blocked' : 'pass',
        actual:
          observed[scenario] ??
          'No qualifying installed measurement is available.',
        blockers: blocked ? [blocked] : []
      },
      assertions: [
        ...(observed[scenario]
          ? [
              {
                id: 'selected-installed-measurement',
                status: 'pass',
                expected: observed[scenario],
                actual: observed[scenario]
              }
            ]
          : []),
        ...(blocked
          ? [
              {
                id: 'remaining-acceptance',
                status: 'blocked',
                expected: 'Complete scenario acceptance.',
                actual: blocked
              }
            ]
          : [])
      ],
      attachments: context.attachments
    })
  })
}
