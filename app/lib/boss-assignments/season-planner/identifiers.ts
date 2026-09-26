export type EncounterId = 0 | 1 | 2

export type TargetUid = string & { readonly __brand: 'TargetUid' }

export interface TargetUidParts {
  seasonId: string
  loopIndex: number
  stageCode: string
  encounterId: EncounterId
}

export function makeTargetLabel(
  stageCode: string,
  encounterId: EncounterId
): string {
  if (encounterId === 0) {
    return stageCode
  }

  return `${stageCode}_Sub${encounterId}`
}

export function makeTargetUid(parts: TargetUidParts): TargetUid {
  return `${parts.seasonId}:${parts.loopIndex}:${parts.stageCode}:${parts.encounterId}` as TargetUid
}

function parseNonNegativeInt(value: string): number | null {
  if (!/^\d+$/.test(value)) {
    return null
  }

  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    return null
  }

  return parsed
}

function parseEncounterId(value: string): EncounterId | null {
  const parsed = parseNonNegativeInt(value)
  if (parsed === 0 || parsed === 1 || parsed === 2) {
    return parsed
  }
  return null
}

export function parseTargetUid(uid: string): TargetUidParts | null {
  const parts = uid.split(':')
  if (parts.length !== 4) {
    return null
  }

  const [seasonId, loopIndexRaw, stageCode, encounterIdRaw] = parts

  if (!seasonId || !stageCode || !loopIndexRaw || !encounterIdRaw) {
    return null
  }

  const loopIndex = parseNonNegativeInt(loopIndexRaw)
  if (loopIndex === null) {
    return null
  }

  const encounterId = parseEncounterId(encounterIdRaw)
  if (encounterId === null) {
    return null
  }

  return {
    seasonId,
    loopIndex,
    stageCode,
    encounterId
  }
}
