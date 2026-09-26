export function DeploymentEnvironmentBanner() {
  const deploymentEnv = process.env.DEPLOYMENT_ENV?.trim().toLowerCase()
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL || ''
  let isAlphaUrl = false
  try {
    isAlphaUrl =
      new URL(siteUrl).hostname.toLowerCase() === 'alpha.tacticusanalytics.com'
  } catch {
    // An invalid optional URL is not an alpha deployment signal.
  }
  const isAlpha = deploymentEnv === 'alpha' || isAlphaUrl

  if (!isAlpha) {
    return null
  }

  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 border-b border-amber-400/30 bg-amber-500/10 px-4 py-2 text-center text-xs font-semibold uppercase text-amber-100"
    >
      <span>
        Alpha demo environment - shared production data, review UI changes
        carefully
      </span>
    </div>
  )
}
