'use client'

// No in-page tabs: AlphaChromeBar's SectionSubnav already shows this section's nav.

export default function GuildManagementLayoutClient({
  children
}: {
  children: React.ReactNode
}) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-primary-wh40k mb-2">
          Guild Management
        </h1>
        <p className="text-secondary-wh40k">
          Manage your guild members and settings
        </p>
      </div>

      <div>{children}</div>
    </div>
  )
}
