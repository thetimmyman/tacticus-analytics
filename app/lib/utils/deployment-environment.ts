interface DeploymentEnv {
  [key: string]: string | undefined
  DEPLOYMENT_ENV?: string
  NEXT_PUBLIC_DEPLOYMENT_ENV?: string
  NEXT_PUBLIC_SITE_URL?: string
  SITE_URL?: string
}

export function isAlphaDeploymentEnvironment(
  env: DeploymentEnv = process.env
): boolean {
  const deploymentEnv = (
    env.NEXT_PUBLIC_DEPLOYMENT_ENV ||
    env.DEPLOYMENT_ENV ||
    ''
  )
    .trim()
    .toLowerCase()

  if (deploymentEnv) {
    return deploymentEnv === 'alpha'
  }

  const siteUrl = env.NEXT_PUBLIC_SITE_URL || env.SITE_URL || ''
  try {
    return (
      new URL(siteUrl).hostname.toLowerCase() === 'alpha.tacticusanalytics.com'
    )
  } catch {
    return false
  }
}
