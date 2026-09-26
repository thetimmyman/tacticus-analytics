import { describe, expect, it } from 'vitest'
import { isAlphaDeploymentEnvironment } from '@/app/lib/utils/deployment-environment'

describe('isAlphaDeploymentEnvironment', () => {
  it('prefers explicit deployment env over URL inference', () => {
    expect(
      isAlphaDeploymentEnvironment({
        DEPLOYMENT_ENV: 'production',
        NEXT_PUBLIC_SITE_URL: 'https://alpha.tacticusanalytics.com'
      })
    ).toBe(false)
  })

  it('accepts public deployment env for client-side gates', () => {
    expect(
      isAlphaDeploymentEnvironment({
        NEXT_PUBLIC_DEPLOYMENT_ENV: 'alpha'
      })
    ).toBe(true)
  })

  it('falls back to the alpha hostname when no deployment env is set', () => {
    expect(
      isAlphaDeploymentEnvironment({
        NEXT_PUBLIC_SITE_URL: 'https://alpha.tacticusanalytics.com'
      })
    ).toBe(true)
  })

  it('rejects attacker-controlled hosts containing the alpha hostname', () => {
    expect(
      isAlphaDeploymentEnvironment({
        NEXT_PUBLIC_SITE_URL: 'https://alpha.tacticusanalytics.com.evil.test'
      })
    ).toBe(false)
  })
})
