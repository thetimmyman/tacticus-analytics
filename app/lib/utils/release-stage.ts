export type ReleaseStage = 'alpha' | 'beta' | 'coming_soon' | 'public'

export function getStageDisplayInfo(stage: ReleaseStage): {
  label: string
  description: string
  color: string
  bgColor: string
  borderColor: string
} {
  const info: Record<ReleaseStage, ReturnType<typeof getStageDisplayInfo>> = {
    alpha: {
      label: 'Alpha',
      description: 'Limited to alpha testers and admins',
      color: 'text-red-500',
      bgColor: 'bg-red-500/15',
      borderColor: 'border-red-500/30'
    },
    beta: {
      label: 'Beta',
      description: 'Available to beta testers and alpha/admin users',
      color: 'text-blue-500',
      bgColor: 'bg-blue-500/15',
      borderColor: 'border-blue-500/30'
    },
    coming_soon: {
      label: 'Planned',
      description: 'This feature is planned but not yet available',
      color: 'text-gray-500',
      bgColor: 'bg-gray-500/15',
      borderColor: 'border-gray-500/30'
    },
    public: {
      label: 'Public',
      description: 'Available to everyone',
      color: 'text-green-500',
      bgColor: 'bg-green-500/15',
      borderColor: 'border-green-500/30'
    }
  }

  return info[stage]
}

export function canAccessReleaseStage(
  stage: ReleaseStage | undefined,
  accessLevels:
    | {
        max_access_level: 'alpha' | 'beta' | 'public'
        is_app_admin?: boolean
        is_admin?: boolean
      }
    | null
    | undefined
): boolean {
  if (!stage || stage === 'public') return true
  if (!accessLevels) return false

  const { max_access_level, is_app_admin, is_admin } = accessLevels

  if (is_app_admin || is_admin) return true

  const stageHierarchy: Record<ReleaseStage, number> = {
    public: 0,
    beta: 1,
    alpha: 2,
    coming_soon: 999
  }

  const accessHierarchy: Record<string, number> = {
    public: 0,
    beta: 1,
    alpha: 2
  }

  if (stage === 'coming_soon') return false

  const accessLevel = accessHierarchy[max_access_level]
  const requiredLevel = stageHierarchy[stage]
  if (accessLevel === undefined || requiredLevel === undefined) return false
  return accessLevel >= requiredLevel
}
