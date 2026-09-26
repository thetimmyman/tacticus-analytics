import versionData from '@/version.json'

export default function VersionFooter() {
  return (
    <div className="text-xs text-[var(--text-secondary)] opacity-50">
      <span>v{versionData.version}</span>
      <span className="mx-2">•</span>
      <span>{versionData.lastUpdated}</span>
    </div>
  )
}
