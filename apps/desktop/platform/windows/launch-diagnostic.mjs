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
