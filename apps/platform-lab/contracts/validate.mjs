export const scenarios = Object.freeze([
  'clean-install',
  'onboarding',
  'offline-core',
  'restart-persistence',
  'token-expiry',
  'shutdown-recovery',
  'backup-restore',
  'bad-update',
  'opt-in-egress',
  'suspend-resume',
  'disk-pressure',
  'upgrade-rollback',
  'uninstall'
])
const results = ['pass', 'fail', 'blocked']
function object(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Expected an object')
  if (
    Object.keys(value).some((key) => !fields.includes(key)) ||
    fields.some((key) => !Object.hasOwn(value, key))
  )
    throw new Error('Unexpected or missing contract field')
}
function string(value, max = 4096) {
  if (typeof value !== 'string' || !value.length || value.length > max)
    throw new Error('Expected a bounded nonempty string')
}
function choice(value, values) {
  if (!values.includes(value)) throw new Error('Invalid contract enum')
}
function array(value, check, max = 100) {
  if (!Array.isArray(value) || value.length > max)
    throw new Error('Invalid array')
  value.forEach(check)
}
function digest(value, length) {
  if (
    typeof value !== 'string' ||
    !new RegExp(`^[a-f0-9]{${length}}$`).test(value)
  )
    throw new Error('Invalid digest')
}
function timestamp(value) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    throw new Error('Invalid UTC timestamp')
}
export function portableName(value) {
  if (
    typeof value !== 'string' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(value) ||
    value.includes('..')
  )
    throw new Error('Invalid portable name')
  return value
}
export function validateFixture(value) {
  object(value, [
    'schemaVersion',
    'fixtureId',
    'synthetic',
    'seed',
    'clock',
    'network',
    'upstream',
    'profile',
    'canaries'
  ])
  choice(value.schemaVersion, ['platform-fixture/v1'])
  portableName(value.fixtureId)
  if (
    value.synthetic !== true ||
    !Number.isSafeInteger(value.seed) ||
    value.seed < 0
  )
    throw new Error('Only seeded synthetic fixtures are supported')
  object(value.clock, ['now', 'tokenExpiresAt'])
  timestamp(value.clock.now)
  timestamp(value.clock.tokenExpiresAt)
  object(value.network, ['mode', 'allowedOrigins'])
  choice(value.network.mode, ['deny', 'fixture', 'allow-list'])
  array(
    value.network.allowedOrigins,
    (origin) => {
      const url = new URL(origin)
      if (
        !['https:', 'http:'].includes(url.protocol) ||
        url.origin !== origin ||
        url.username ||
        url.password
      )
        throw new Error('Invalid allowed origin')
    },
    20
  )
  if (
    value.network.mode !== 'allow-list' &&
    value.network.allowedOrigins.length
  )
    throw new Error('Only allow-list mode may declare external origins')
  object(value.upstream, ['responses'])
  const routes = new Set()
  array(value.upstream.responses, (response) => {
    object(response, ['capability', 'method', 'path', 'status', 'body'])
    choice(response.capability, ['player', 'guild', 'guild-raid'])
    choice(response.method, ['GET', 'POST'])
    if (
      !/^\/fixture\/[a-z0-9/-]{1,100}$/.test(response.path) ||
      !Number.isInteger(response.status) ||
      response.status < 200 ||
      response.status > 599
    )
      throw new Error('Invalid fixture response')
    const key = `${response.method} ${response.path}`
    if (routes.has(key)) throw new Error('Duplicate fixture route')
    routes.add(key)
    if (
      !response.body ||
      typeof response.body !== 'object' ||
      Array.isArray(response.body) ||
      JSON.stringify(response.body).length > 65536
    )
      throw new Error('Invalid fixture body')
  })
  object(value.profile, ['displayName', 'roster'])
  string(value.profile.displayName, 100)
  array(value.profile.roster, (unit) => {
    object(unit, ['unit', 'level'])
    portableName(unit.unit)
    if (!Number.isInteger(unit.level) || unit.level < 1 || unit.level > 100)
      throw new Error('Invalid synthetic unit level')
  })
  array(
    value.canaries,
    (canary) => {
      object(canary, ['id', 'value'])
      portableName(canary.id)
      string(canary.value, 200)
      if (!canary.value.startsWith('SYNTHETIC-CANARY-'))
        throw new Error('Canary must be synthetic')
    },
    20
  )
  return value
}
export function validateEvidence(value) {
  object(value, [
    'schemaVersion',
    'evidenceKind',
    'runId',
    'build',
    'environment',
    'fixture',
    'scenario',
    'startedAt',
    'completedAt',
    'outcome',
    'assertions',
    'attachments'
  ])
  choice(value.schemaVersion, ['platform-evidence/v1'])
  choice(value.evidenceKind, ['harness-self-test', 'product-acceptance'])
  portableName(value.runId)
  object(value.build, ['sha', 'artifact'])
  digest(value.build.sha, 40)
  if (value.build.artifact !== null) {
    object(value.build.artifact, ['sha256', 'format'])
    digest(value.build.artifact.sha256, 64)
    portableName(value.build.artifact.format)
  }
  object(value.environment, [
    'os',
    'osVersion',
    'arch',
    'classification',
    'runtimeVersions',
    'installation'
  ])
  choice(value.environment.os, ['linux', 'macos', 'windows', 'android', 'ios'])
  string(value.environment.osVersion, 100)
  portableName(value.environment.arch)
  choice(value.environment.classification, [
    'physical',
    'vm',
    'emulator',
    'simulator'
  ])
  choice(value.environment.installation, [
    'clean-install',
    'existing-install',
    'source',
    'none'
  ])
  const versions = value.environment.runtimeVersions
  if (
    !versions ||
    typeof versions !== 'object' ||
    Array.isArray(versions) ||
    Object.keys(versions).length > 20
  )
    throw new Error('Invalid runtime versions')
  for (const [key, version] of Object.entries(versions)) {
    portableName(key)
    string(version, 100)
  }
  object(value.fixture, ['id', 'sha256'])
  portableName(value.fixture.id)
  digest(value.fixture.sha256, 64)
  object(value.scenario, ['id', 'expected'])
  choice(value.scenario.id, scenarios)
  string(value.scenario.expected)
  timestamp(value.startedAt)
  timestamp(value.completedAt)
  if (Date.parse(value.completedAt) < Date.parse(value.startedAt))
    throw new Error('Reversed timestamps')
  object(value.outcome, ['status', 'actual', 'blockers'])
  choice(value.outcome.status, results)
  string(value.outcome.actual)
  array(value.outcome.blockers, (entry) => string(entry), 30)
  array(value.assertions, (assertion) => {
    object(assertion, ['id', 'status', 'expected', 'actual'])
    portableName(assertion.id)
    choice(assertion.status, results)
    string(assertion.expected)
    string(assertion.actual)
  })
  array(value.attachments, (attachment) => {
    object(attachment, ['name', 'sha256', 'mediaType', 'redacted'])
    portableName(attachment.name)
    digest(attachment.sha256, 64)
    string(attachment.mediaType, 100)
    if (attachment.redacted !== true)
      throw new Error('Unredacted capture refused')
  })
  if (value.outcome.status === 'blocked' && !value.outcome.blockers.length)
    throw new Error('Blocked evidence requires a concrete blocker')
  if (
    value.outcome.status === 'pass' &&
    (value.outcome.blockers.length ||
      !value.assertions.length ||
      value.assertions.some((a) => a.status !== 'pass'))
  )
    throw new Error(
      'Pass requires observed passing assertions without blockers'
    )
  if (
    value.evidenceKind === 'product-acceptance' &&
    value.outcome.status === 'pass' &&
    (!value.build.artifact ||
      !['clean-install', 'existing-install'].includes(
        value.environment.installation
      ))
  )
    throw new Error('Product acceptance requires an installed artifact')
  return value
}
export function qualifiesPhysicalMobile(record) {
  validateEvidence(record)
  return (
    record.evidenceKind === 'product-acceptance' &&
    record.outcome.status === 'pass' &&
    ['android', 'ios'].includes(record.environment.os) &&
    record.environment.classification === 'physical'
  )
}
