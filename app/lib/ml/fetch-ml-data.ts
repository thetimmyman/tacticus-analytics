import { fetchJson } from '@/app/lib/api/fetch-json'
import type {
  MlInferenceApiResponse,
  MlTrainingFeaturesApiResponse
} from '@/app/lib/ml/api-types'

function isMlSuccessResponse<T extends { success: true; rows: unknown[] }>(
  payload: unknown
): payload is T {
  if (!payload || typeof payload !== 'object' || !('success' in payload)) {
    return false
  }
  const candidate = payload as { success?: unknown; rows?: unknown }
  return candidate.success === true && Array.isArray(candidate.rows)
}

export async function fetchMlTrainingFeatures(
  guildCode: string,
  seasons: string[],
  minMetaAttacks: number,
  minLoopSamples: number,
  limit: number
): Promise<MlTrainingFeaturesApiResponse> {
  const params = new URLSearchParams()
  params.set('guild', guildCode)
  if (seasons.length > 0) {
    params.set('seasons', seasons.join(','))
  }
  params.set('minMetaAttacks', String(minMetaAttacks))
  params.set('minLoopSamples', String(minLoopSamples))
  params.set('limit', String(limit))

  return fetchJson<MlTrainingFeaturesApiResponse>('/api/ml/training-features', {
    params,
    errorFallback: 'Failed to load ML training features',
    invalidMessage: 'Invalid ML training features response',
    validate: isMlSuccessResponse
  })
}

export async function fetchMlInferenceInputs(
  guildCode: string,
  season: string,
  minMetaAttacks: number,
  minLoopSamples: number
): Promise<MlInferenceApiResponse> {
  const params = new URLSearchParams()
  params.set('guild', guildCode)
  params.set('season', season)
  params.set('minMetaAttacks', String(minMetaAttacks))
  params.set('minLoopSamples', String(minLoopSamples))

  return fetchJson<MlInferenceApiResponse>('/api/ml/inference-inputs', {
    params,
    errorFallback: 'Failed to load ML inference inputs',
    invalidMessage: 'Invalid ML inference response',
    validate: isMlSuccessResponse
  })
}
