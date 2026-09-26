export const FEATURE_FLAGS = {
  BOSS_ASSIGNMENTS: process.env.NEXT_PUBLIC_ENABLE_BOSS_ASSIGNMENTS === 'true',
  VOTLW_STRICT_TOKENS: process.env.NEXT_PUBLIC_VOTLW_STRICT_TOKENS === 'true'
} as const

export type FeatureFlagName = keyof typeof FEATURE_FLAGS

export function isFeatureEnabled(flag: FeatureFlagName): boolean {
  return FEATURE_FLAGS[flag] ?? false
}
