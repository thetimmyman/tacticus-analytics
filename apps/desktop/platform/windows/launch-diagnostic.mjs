import { types as utilTypes } from 'node:util'

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
  'schema-admission-failed',
  'schema-recovery-failed',
  'recovery-journey-failed',
  'service-startup-failed',
  'application-stopped-during-startup',
  'application-health-timeout',
  'window-verification-failed',
  'native-helper-vault-unavailable',
  'native-helper-dll-init-failed',
  'native-helper-runtime-load-refused',
  'native-helper-os-operation-failed',
  'native-helper-operation-refused',
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
  if (argumentsList.includes('--schema-recovery'))
    return 'schema-recovery-failed'
  if (argumentsList.includes('--recovery')) return 'recovery-journey-failed'
  const message = String(error?.message ?? '').slice(0, 4096)
  if (error?.code === 'ESCHEMA') return 'schema-admission-failed'
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
  if (error?.code === 'EVAULTLOCKED') return 'native-helper-vault-unavailable'
  if (error?.code === 'ENATIVE') {
    if (message.includes('native-dll-initialization-failed-0xc0000142'))
      return 'native-helper-dll-init-failed'
    if (message.includes('native-runtime-load-refused'))
      return 'native-helper-runtime-load-refused'
    if (/native-os-status-\d{1,10}\b/.test(message))
      return 'native-helper-os-operation-failed'
    return 'native-helper-operation-refused'
  }
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

// Trusted startup tracing only. This WeakMap preserves frozen error identities;
// no serialized configuration or renderer value supplies a diagnostic record.
const nativeServicesFailures = new WeakMap()
const nativeServicesStages = new Set([
  'configuration',
  'platform-admission',
  'state-directory',
  'schema-preparation',
  'interrupt-handlers',
  'service-material',
  'credentials-check',
  'port-allocation',
  'postgres-version-check',
  'initdb-password-write',
  'initdb-run',
  'initdb-password-retire',
  'postgres-launch',
  'postgres-readiness',
  'schema-inspect',
  'role-inspection',
  'role-bootstrap',
  'auth-role-maintenance',
  'auth-migrate',
  'auth-launch',
  'auth-readiness',
  'schema-completion',
  'postgrest-launch',
  'postgrest-readiness',
  'services-result'
])
const nativeErrorNames = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'SyntaxError',
  'ReferenceError',
  'AssertionError',
  'AbortError',
  'TimeoutError',
  'AggregateError'
])
const nativeErrorCodes = new Set([
  'EACCES',
  'EPERM',
  'ENOENT',
  'EEXIST',
  'ENOTDIR',
  'EISDIR',
  'ELOOP',
  'EBUSY',
  'ENOSPC',
  'EMFILE',
  'ENFILE',
  'EADDRINUSE',
  'EADDRNOTAVAIL',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'ERR_STREAM_DESTROYED',
  'ERR_INVALID_ARG_TYPE',
  'ERR_OUT_OF_RANGE',
  'ERR_SOCKET_BAD_PORT',
  'ENATIVE',
  'EVAULTLOCKED',
  'EUPSTREAM',
  'ESESSION',
  'ESCHEMA'
])
const nativeSourceFailures = new Map([
  ['Windows native owner required', 'windows-owner-required'],
  ['Corrupt local credentials; refusing activation', 'credentials-corrupt'],
  [
    'Local schema state is incompatible; activation refused',
    'schema-state-refused'
  ],
  ['Invalid schema proof callback', 'schema-callback-refused'],
  ['Invalid schema proof client', 'schema-client-refused'],
  ['Unsupported native operation', 'native-operation-unsupported'],
  ['Unlock your local workspace to continue.', 'native-session-locked'],
  ['Windows secure input or vault is unavailable.', 'native-vault-unavailable'],
  [
    'Official access is invalid, expired or unavailable.',
    'native-upstream-refused'
  ],
  ['PostgreSQL readiness timed out', 'postgres-readiness-timeout'],
  ['Auth readiness timed out', 'auth-readiness-timeout'],
  ['PostgREST readiness timed out', 'postgrest-readiness-timeout']
])
function diagnosticProperty(error, name) {
  // Read data descriptors only; an unknown accessor must never run merely to
  // classify a refusal. Proxy/descriptor failures also stay closed.
  try {
    for (let current = error, depth = 0; current && depth < 4; depth++) {
      const descriptor = Object.getOwnPropertyDescriptor(current, name)
      if (descriptor)
        return 'value' in descriptor ? descriptor.value : undefined
      current = Object.getPrototypeOf(current)
    }
  } catch {}
}
function nativeErrorDiagnostic(error) {
  const name = diagnosticProperty(error, 'name')
  const code = diagnosticProperty(error, 'code')
  return {
    exceptionClass: nativeErrorNames.has(name) ? name : 'unavailable',
    errorCode:
      code === undefined
        ? 'none'
        : nativeErrorCodes.has(code)
          ? code
          : 'unavailable'
  }
}
function nativeSourceFailure(error) {
  const message = diagnosticProperty(error, 'message')
  if (typeof message !== 'string' || message.length > 4096) return 'unavailable'
  const fixed = nativeSourceFailures.get(message)
  if (fixed) return fixed
  for (const [prefix, category] of [
    [
      'PostgreSQL exited before readiness; ',
      'postgres-exited-before-readiness'
    ],
    ['Auth exited before readiness; ', 'auth-exited-before-readiness'],
    ['PostgREST exited before readiness; ', 'postgrest-exited-before-readiness']
  ])
    if (message.startsWith(prefix)) return category
  return 'unavailable'
}
export function nativeServicesProbeDiagnostic(error) {
  const code = diagnosticProperty(error, 'serviceFailureCode')
  return Object.freeze({
    ...nativeErrorDiagnostic(error),
    serviceFailureCode: serviceFailureCodeSet.has(code) ? code : 'unavailable'
  })
}
// Only source-owned daemon records can cross this publication boundary.
// Inspect own data descriptors; neither accessors nor Proxy traps may execute.
function nativeDaemonDiagnostic(record) {
  try {
    const values = (object, keys) => {
      if (!object || typeof object !== 'object' || utilTypes.isProxy(object))
        return
      const names = Reflect.ownKeys(object)
      if (
        names.length !== keys.length ||
        names.some((key) => !keys.includes(key))
      )
        return
      const result = {}
      for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(object, key)
        if (!descriptor || !('value' in descriptor)) return
        result[key] = descriptor.value
      }
      return result
    }
    const owned = values(record, ['role', 'details'])
    if (!owned || !['postgres', 'auth', 'postgrest'].includes(owned.role))
      return
    const details = values(owned.details, [
      'serviceFailureCode',
      'exitCode',
      'signal',
      'postgrestCode',
      'postgresCode',
      'streamComplete',
      'capturedBytes',
      'truncated'
    ])
    if (
      !details ||
      !(
        serviceFailureCodeSet.has(details.serviceFailureCode) ||
        details.serviceFailureCode === 'unavailable'
      ) ||
      !(
        details.exitCode === null ||
        (Number.isInteger(details.exitCode) &&
          details.exitCode >= -0x80000000 &&
          details.exitCode <= 0xffffffff)
      ) ||
      ![
        'none',
        'unavailable',
        'SIGTERM',
        'SIGKILL',
        'SIGINT',
        'SIGABRT',
        'SIGSEGV',
        'SIGILL',
        'SIGFPE',
        'SIGBREAK',
        'SIGHUP'
      ].includes(details.signal) ||
      !['unavailable', 'PGRST000', 'PGRST001', 'PGRST002', 'PGRST003'].includes(
        details.postgrestCode
      ) ||
      ![
        'unavailable',
        '08000',
        '08001',
        '08006',
        '28P01',
        '3D000',
        '42501',
        '42710',
        '42883',
        '42P01',
        '57P03'
      ].includes(details.postgresCode) ||
      typeof details.streamComplete !== 'boolean' ||
      typeof details.truncated !== 'boolean' ||
      !Number.isInteger(details.capturedBytes) ||
      details.capturedBytes < 0 ||
      details.capturedBytes > 8192
    )
      return
    return Object.freeze({ role: owned.role, ...details })
  } catch {}
}
export function captureNativeServicesFailure(error, trace) {
  // Evidence must not change the original failure, even for a frozen error or
  // an exotic thrown value. The service cleanup and thrown object stay intact.
  try {
    if (
      (typeof error !== 'object' || error === null) &&
      typeof error !== 'function'
    )
      return
    const first = trace.failure ?? {
      error,
      stage: trace.stage,
      probe: trace.probe
    }
    const primary = nativeErrorDiagnostic(first.error)
    const cleanup = first.error === error ? null : nativeErrorDiagnostic(error)
    const probe = first.probe
    const firstExit = nativeDaemonDiagnostic(
      diagnosticProperty(trace, 'firstExit')
    )
    const readinessChild = nativeDaemonDiagnostic(
      diagnosticProperty(trace, 'readinessChild')
    )
    const probeName = diagnosticProperty(probe, 'exceptionClass')
    const probeCode = diagnosticProperty(probe, 'errorCode')
    const probeServiceCode = diagnosticProperty(probe, 'serviceFailureCode')
    nativeServicesFailures.set(
      error,
      Object.freeze({
        stage: nativeServicesStages.has(first.stage)
          ? first.stage
          : 'stage-unavailable',
        ...primary,
        sourceFailureCode: nativeSourceFailure(first.error),
        probeExceptionClass:
          probe === undefined
            ? 'not-applicable'
            : nativeErrorNames.has(probeName)
              ? probeName
              : 'unavailable',
        probeErrorCode:
          probe === undefined
            ? 'not-applicable'
            : probeCode === 'none' || nativeErrorCodes.has(probeCode)
              ? probeCode
              : 'unavailable',
        probeServiceFailureCode:
          probe === undefined
            ? 'not-applicable'
            : serviceFailureCodeSet.has(probeServiceCode)
              ? probeServiceCode
              : 'unavailable',
        cleanupExceptionClass: cleanup?.exceptionClass ?? 'not-applicable',
        cleanupErrorCode: cleanup?.errorCode ?? 'not-applicable',
        ...(firstExit ? { firstUnexpectedExit: firstExit } : {}),
        ...(readinessChild ? { readinessChild } : {})
      })
    )
  } catch {}
}

// Trusted recovery tracing only. Errors retain their identity and cleanup keeps
// its original behavior; only these closed labels can enter failed evidence.
const recoveryFailures = new WeakMap()
const recoverySteps = new Set([
  'initial-snapshot',
  'initial-row-count',
  'initial-row-identity',
  'rollback-transaction-rejection',
  'rollback-table-absent',
  'auth-exit-wait',
  'services-stop-after-auth',
  'auth-fault-present',
  'restart-after-auth',
  'rows-after-auth',
  'services-stop-before-schema',
  'schema-marker-read',
  'schema-marker-write-incompatible',
  'incompatible-schema-refusal',
  'schema-marker-restore',
  'schema-marker-remove',
  'restart-after-marker-loss',
  'rows-after-marker-loss',
  'services-stop-after-marker-loss',
  'schema-marker-restored',
  'checkpoint-directory',
  'checkpoint-copy',
  'checkpoint-remove-live',
  'checkpoint-restore',
  'restart-after-checkpoint',
  'rows-after-checkpoint',
  'evidence-write',
  'services-stop-final'
])
function recoveryProperty(value, key) {
  // A proxy or an accessor is not evidence. Do not invoke either, including
  // proxies in an otherwise ordinary error's prototype chain.
  try {
    for (let current = value, depth = 0; current && depth < 4; depth++) {
      if (utilTypes.isProxy(current)) return undefined
      const descriptor = Object.getOwnPropertyDescriptor(current, key)
      if (descriptor)
        return 'value' in descriptor ? descriptor.value : undefined
      current = Object.getPrototypeOf(current)
    }
  } catch {}
}
function recoveryException(error) {
  const name = recoveryProperty(error, 'name')
  const code = recoveryProperty(error, 'code')
  return {
    exceptionClass: nativeErrorNames.has(name) ? name : 'unavailable',
    errorCode:
      code === undefined
        ? 'none'
        : code === 'ERR_ASSERTION' || nativeErrorCodes.has(code)
          ? code
          : 'unavailable'
  }
}
export function captureRecoveryFailure(error, trace) {
  try {
    if (
      (typeof error !== 'object' || error === null) &&
      typeof error !== 'function'
    )
      return
    if (recoveryFailures.has(error)) return
    const first = recoveryProperty(trace, 'failure')
    const primaryError = first ? recoveryProperty(first, 'error') : error
    const step = recoveryProperty(first || trace, 'step')
    const cleanup =
      first && primaryError !== error ? recoveryException(error) : null
    recoveryFailures.set(
      error,
      Object.freeze({
        step: recoverySteps.has(step) ? step : 'step-unavailable',
        ...recoveryException(primaryError),
        cleanupExceptionClass: cleanup?.exceptionClass ?? 'not-applicable',
        cleanupErrorCode: cleanup?.errorCode ?? 'not-applicable',
        ...(nativeServicesFailures.has(primaryError)
          ? {
              nativeServicesDiagnostic: nativeServicesFailures.get(primaryError)
            }
          : {})
      })
    )
  } catch {}
}

// Failure-only coordinator evidence. Unknown values never enter the receipt.
const coordinatorStages = new Set([
  'configuration',
  'schema-recovery',
  'services-start',
  'recovery-journey',
  'gateway-start',
  'app-port-allocation',
  'application-launch',
  'application-health',
  'verification-input',
  'former-password-fixture',
  'verification-route-controls',
  'owner-before-window',
  'window-launch',
  'window-exit',
  'post-window-conservation',
  'window-result',
  'gateway-stop',
  'services-stop'
])
const fixtureFailures = new Map([
  [
    'Migration fixture requires a new empty test workspace',
    'workspace-occupied'
  ],
  ['Migration fixture local account failed', 'account-response-refused'],
  ['Invalid fixture owner', 'owner-shape-refused'],
  ['Invalid synthetic Auth subject', 'subject-shape-refused'],
  ['Invalid synthetic fixture envelope', 'envelope-refused'],
  ['Unexpected synthetic fields', 'fields-refused'],
  ['Invalid synthetic row', 'row-refused'],
  ['Invalid synthetic cluster', 'cluster-refused'],
  ['Invalid fixture identity', 'identity-refused']
])

export function launchCoordinatorDiagnostic(error, stage) {
  return {
    stage: coordinatorStages.has(stage) ? stage : 'stage-unavailable',
    fixtureFailureCode:
      stage === 'former-password-fixture'
        ? (fixtureFailures.get(error?.message) ?? 'unavailable')
        : 'not-applicable',
    ...(stage === 'services-start' && nativeServicesFailures.has(error)
      ? { nativeServicesDiagnostic: nativeServicesFailures.get(error) }
      : {}),
    ...(stage === 'recovery-journey' && recoveryFailures.has(error)
      ? { recoveryDiagnostic: recoveryFailures.get(error) }
      : {})
  }
}
