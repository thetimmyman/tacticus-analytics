export const CONTRACT_VERSION = 1
export const DATASETS = Object.freeze(['raid', 'war', 'replay'])
export const PURPOSES = Object.freeze(['meta', 'portal'])
export const RAID_FIELDS = Object.freeze([
  'userId',
  'tier',
  'set',
  'encounterIndex',
  'damageDealt',
  'damageType',
  'startedOn',
  'completedOn',
  'unitId'
])

export function reject() {
  throw new Error('Invalid contribution contract')
}
export function exact(value, keys) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    reject()
}
export function uuid(value) {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value
    )
  )
    reject()
  return value
}
export function integer(value, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) reject()
  return value
}
export function timestamp(value) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    reject()
  return value
}
export function consent(value) {
  exact(value, [
    'version',
    'revision',
    'accountRef',
    'guildId',
    'purpose',
    'datasets',
    'enabled',
    'paused',
    'from',
    'until'
  ])
  if (
    value.version !== CONTRACT_VERSION ||
    !PURPOSES.includes(value.purpose) ||
    typeof value.enabled !== 'boolean' ||
    typeof value.paused !== 'boolean'
  )
    reject()
  integer(value.revision)
  uuid(value.accountRef)
  uuid(value.guildId)
  exact(value.datasets, DATASETS)
  if (DATASETS.some((dataset) => typeof value.datasets[dataset] !== 'boolean'))
    reject()
  timestamp(value.from)
  if (value.until !== null) {
    timestamp(value.until)
    if (value.until < value.from) reject()
  }
  return structuredClone(value)
}
export function defaultConsent({
  accountRef,
  guildId,
  purpose = 'meta',
  now = new Date().toISOString()
}) {
  return consent({
    version: 1,
    revision: 0,
    accountRef,
    guildId,
    purpose,
    datasets: { raid: false, war: false, replay: false },
    enabled: false,
    paused: false,
    from: now,
    until: null
  })
}
export function raidRow(value) {
  exact(value, RAID_FIELDS)
  uuid(value.userId)
  for (const key of ['tier', 'set', 'encounterIndex', 'damageDealt'])
    integer(value[key], 2147483647)
  if (!['Battle', 'Bomb'].includes(value.damageType)) reject()
  for (const key of ['startedOn', 'completedOn']) {
    if (typeof value[key] !== 'string' || !/^\d{1,12}$/.test(value[key]))
      reject()
  }
  if (Number(value.completedOn) < Number(value.startedOn)) reject()
  if (
    typeof value.unitId !== 'string' ||
    !/^[A-Za-z][A-Za-z0-9]{0,95}$/.test(value.unitId)
  )
    reject()
  return Object.fromEntries(RAID_FIELDS.map((key) => [key, value[key]]))
}
export function envelope(value) {
  exact(value, [
    'version',
    'requestId',
    'bindingId',
    'consentRevision',
    'purpose',
    'dataset',
    'guildId',
    'season',
    'observedAt',
    'rows'
  ])
  if (
    value.version !== 1 ||
    !PURPOSES.includes(value.purpose) ||
    !DATASETS.includes(value.dataset)
  )
    reject()
  uuid(value.requestId)
  uuid(value.bindingId)
  uuid(value.guildId)
  integer(value.consentRevision)
  integer(value.season, 2147483647)
  timestamp(value.observedAt)
  if (
    !Array.isArray(value.rows) ||
    value.rows.length < 1 ||
    value.rows.length > 100
  )
    reject()
  const rows = value.rows.map((row) => {
    if (value.dataset === 'raid') return raidRow(row)
    exact(row, ['formatVersion', 'outcome'])
    if (
      row.formatVersion !== 1 ||
      !['win', 'loss', 'unknown'].includes(row.outcome)
    )
      reject()
    return structuredClone(row)
  })
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 65536)
    reject()
  return { ...structuredClone(value), rows }
}
export function allowed(policy, upload) {
  return (
    policy.enabled &&
    !policy.paused &&
    policy.purpose === upload.purpose &&
    policy.guildId === upload.guildId &&
    policy.revision === upload.consentRevision &&
    policy.datasets[upload.dataset] &&
    upload.observedAt >= policy.from &&
    (policy.until === null || upload.observedAt <= policy.until)
  )
}
export function receipt(value) {
  exact(value, [
    'version',
    'requestId',
    'consentRevision',
    'checkedAt',
    'source',
    'results'
  ])
  if (value.version !== 1 || value.source !== 'official-guild-raid') reject()
  uuid(value.requestId)
  integer(value.consentRevision)
  timestamp(value.checkedAt)
  if (!Array.isArray(value.results) || value.results.length > 100) reject()
  value.results.forEach((result) => {
    exact(result, ['index', 'status', 'authorityDigest'])
    integer(result.index, 99)
    if (
      ![
        'verified',
        'mismatch',
        'pending',
        'expired',
        'unverifiable',
        'duplicate'
      ].includes(result.status)
    )
      reject()
    if (
      result.authorityDigest !== null &&
      !/^[a-f0-9]{64}$/.test(result.authorityDigest)
    )
      reject()
    if (result.status === 'verified' && result.authorityDigest === null)
      reject()
  })
  return structuredClone(value)
}
