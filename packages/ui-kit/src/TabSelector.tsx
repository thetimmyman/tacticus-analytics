'use client'

interface TabOption {
  id: string
  label: string
}

interface TabSelectorProps {
  tabs: TabOption[]
  activeTab: string
  onTabChange: (tabId: string) => void
  className?: string
}

export function TabSelector({
  tabs,
  activeTab,
  onTabChange,
  className = ''
}: TabSelectorProps) {
  return (
    <div className={`relative ${className}`}>
      {/* Background glow effect */}
      <div className="absolute inset-0 bg-linear-to-r from-transparent via-[color-mix(in_srgb,var(--accent)_5%,transparent)] to-transparent opacity-50" />

      {/* Tab container with proper border */}
      <div className="relative border-b border-(--card-border) bg-[color-mix(in_srgb,var(--bg-primary)_20%,transparent)]">
        <nav
          className="-mb-px flex overflow-x-auto scrollbar-hide"
          aria-label="Tabs"
        >
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`
                relative shrink-0 px-3 sm:px-4 lg:px-6 py-2.5 lg:py-3 
                text-xs sm:text-sm font-medium transition-all duration-200
                border-b-2 whitespace-nowrap
                ${
                  activeTab === tab.id
                    ? 'border-accent-wh40k text-(--accent) bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]'
                    : 'border-transparent text-secondary-wh40k hover:text-primary-wh40k hover:border-[color-mix(in_srgb,var(--text-secondary)_50%,transparent)] hover:bg-[color-mix(in_srgb,var(--bg-primary)_30%,transparent)]'
                }
              `}
              aria-current={activeTab === tab.id ? 'page' : undefined}
            >
              {tab.label}
              {/* Active tab glow */}
              {activeTab === tab.id && (
                <div className="absolute inset-x-0 bottom-0 h-px bg-linear-to-r from-transparent via-(--accent) to-transparent" />
              )}
            </button>
          ))}
        </nav>
      </div>
    </div>
  )
}
