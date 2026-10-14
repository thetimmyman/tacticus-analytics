const stages = new Set([
  'queue',
  'owner-read',
  'native-session',
  'auth-verification',
  'operation',
  'pending-recovery',
  'local-status'
])

// Verification-only evidence: no URL, cookie, subject, response or exception text.
export function workspaceDiagnostics(now = performance.now.bind(performance)) {
  const records = []
  return {
    begin(kind) {
      if (
        !['access-status', 'official-state', 'protected-change'].includes(kind)
      )
        return
      const record = {
        kind,
        stage: 'queue',
        outcome: 'pending',
        started: now()
      }
      records.push(record)
      if (records.length > 32) records.shift()
      return {
        stage(value) {
          if (stages.has(value)) record.stage = value
        },
        finish(status) {
          record.outcome =
            status >= 200 && status < 400 ? 'complete' : 'refused'
          record.elapsedMs = Math.max(0, Math.round(now() - record.started))
          record.status =
            Number.isInteger(status) && status >= 100 && status <= 599
              ? status
              : null
        }
      }
    },
    snapshot() {
      return records.map(({ started, elapsedMs, ...record }) => ({
        ...record,
        elapsedMs: Math.min(
          3600000,
          elapsedMs ?? Math.max(0, Math.round(now() - started))
        )
      }))
    }
  }
}
