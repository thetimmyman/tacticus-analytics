const errorKinds = new Map([
  ['AssertionError', 'launch-assertion-failed'],
  ['TypeError', 'launch-type-error'],
  ['RangeError', 'launch-range-error'],
  ['SyntaxError', 'launch-syntax-error'],
  ['ReferenceError', 'launch-reference-error'],
  ['AbortError', 'launch-aborted'],
  ['TimeoutError', 'launch-timeout']
])

export const nodeLaunchFailureCategories = Object.freeze([
  'none',
  'launch-configuration-invalid',
  'schema-recovery-failed',
  'recovery-journey-failed',
  'service-startup-failed',
  'application-stopped-during-startup',
  'application-health-timeout',
  'window-verification-failed',
  ...errorKinds.values(),
  'node-launch-unclassified'
])

// This publication boundary deliberately excludes parameterized PostgreSQL
// status and encoding labels. Only exact, finite values can enter CI evidence.
export const serviceFailureCodes = Object.freeze([
  'administrative-token-refused',
  'loopback-bind-refused',
  'password-file-read-refused',
  'data-directory-access-refused',
  'data-directory-create-refused',
  'data-directory-permissions-refused',
  'bootstrap-input-read-refused',
  'bootstrap-input-access-refused',
  'postgres-executable-unavailable',
  'postgres-executable-unavailable-access-denied',
  'own-executable-unavailable',
  'own-executable-unavailable-access-denied',
  'process-token-refused',
  'permission-refused',
  'locale-unavailable',
  'required-file-unavailable',
  'child-launch-failed',
  'postgres-executable-mismatch',
  'dynamic-library-unavailable',
  'restricted-token-unavailable',
  'shared-memory-unavailable',
  'system-memory-unavailable',
  'random-source-unavailable',
  'bootstrap-syntax-error',
  'bootstrap-encoding-invalid',
  'database-authority-refused',
  'database-schema-unavailable',
  'database-function-unavailable',
  'database-object-conflict',
  'database-authentication-refused',
  'postgres-child-exit-1',
  'postgres-bootstrap-failed',
  'unclassified-service-failure'
])

export const serviceBootstrapPhases = Object.freeze([
  'post-bootstrap',
  'bootstrap-script',
  'configuration',
  'time-zone',
  'shared-buffers',
  'max-connections',
  'shared-memory',
  'subdirectories',
  'data-directory',
  'preflight',
  'bootstrap-phase-unavailable',
  'not-applicable'
])

export const serviceExecutables = Object.freeze([
  'initdb.exe',
  'psql.exe',
  'auth.exe',
  'pg_ctl.exe',
  'owned-service'
])

const serviceFailureCodeSet = new Set(serviceFailureCodes)
const serviceBootstrapPhaseSet = new Set(serviceBootstrapPhases)
const serviceExecutableSet = new Set(serviceExecutables)
const uint32 = (value) =>
  Number.isInteger(value) && value >= 0 && value <= 0xffffffff ? value : null

export function nodeLaunchFailureCategory(error, argumentsList = []) {
  const message = String(error?.message ?? '').slice(0, 4096)
  if (argumentsList.includes('--schema-recovery'))
    return 'schema-recovery-failed'
  if (argumentsList.includes('--recovery')) return 'recovery-journey-failed'
  if (
    message.includes('Native workspace owner must supply') ||
    message.includes('Native owner must supply')
  )
    return 'launch-configuration-invalid'
  if (
    (typeof error?.serviceFailureCode === 'string' &&
      !errorKinds.has(error?.name)) ||
    message.includes('Proof-owned service failed') ||
    /(?:initdb\.exe|psql\.exe|auth\.exe|pg_ctl\.exe|postgrest\.exe) exited/.test(
      message
    )
  )
    return 'service-startup-failed'
  if (message.includes('The local application stopped during startup'))
    return 'application-stopped-during-startup'
  if (message.includes('Local application health did not become ready'))
    return 'application-health-timeout'
  if (message.includes('Desktop window verification failed'))
    return 'window-verification-failed'
  return errorKinds.get(error?.name) ?? 'node-launch-unclassified'
}

export function nodeLaunchDiagnostic(error, argumentsList = []) {
  if (error === undefined)
    return {
      nodeLaunchFailureCategory: 'none',
      serviceFailureCode: 'not-applicable',
      serviceBootstrapPhase: 'not-applicable',
      serviceExecutable: 'not-applicable',
      serviceExitCode: null,
      postgresChildStatus: null
    }
  const category = nodeLaunchFailureCategory(error, argumentsList)
  if (category !== 'service-startup-failed')
    return {
      nodeLaunchFailureCategory: category,
      serviceFailureCode: 'not-applicable',
      serviceBootstrapPhase: 'not-applicable',
      serviceExecutable: 'not-applicable',
      serviceExitCode: null,
      postgresChildStatus: null
    }
  return {
    nodeLaunchFailureCategory: category,
    serviceFailureCode: serviceFailureCodeSet.has(error?.serviceFailureCode)
      ? error.serviceFailureCode
      : 'unavailable',
    serviceBootstrapPhase: serviceBootstrapPhaseSet.has(
      error?.serviceBootstrapPhase
    )
      ? error.serviceBootstrapPhase
      : 'unavailable',
    serviceExecutable: serviceExecutableSet.has(error?.serviceExecutable)
      ? error.serviceExecutable
      : 'unavailable',
    serviceExitCode: uint32(error?.serviceExitCode),
    postgresChildStatus: uint32(error?.postgresChildStatus)
  }
}
