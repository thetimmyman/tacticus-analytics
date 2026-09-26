import { useQuery } from '@tanstack/react-query'
import type { ReleaseStage } from '@/app/lib/utils/release-stage'

type FeatureStages = Record<string, ReleaseStage>

async function fetchFeatureStages(): Promise<FeatureStages> {
  const res = await fetch('/api/features/stages')
  if (!res.ok) throw new Error('Failed to fetch feature stages')
  return res.json()
}

export function useFeatureStages() {
  return useQuery({
    queryKey: ['feature-stages'],
    queryFn: fetchFeatureStages,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000
  })
}

export function useFeatureStage(featureKey: string): ReleaseStage | undefined {
  const { data } = useFeatureStages()
  return data?.[featureKey] as ReleaseStage | undefined
}
