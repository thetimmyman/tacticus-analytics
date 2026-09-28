'use client'

import {
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react'

interface Tab {
  id: string
  label: string
  content: React.ReactNode
}

interface TabsProps {
  tabs: Tab[]
  defaultTab?: string
  /** Controlled active tab (e.g. mirrored in the URL); omit for uncontrolled. */
  value?: string
  onChange?: (tabId: string) => void
  className?: string
}

export function Tabs({
  tabs,
  defaultTab,
  value,
  onChange,
  className = ''
}: TabsProps) {
  const [internalTab, setInternalTab] = useState(
    defaultTab || tabs[0]?.id || ''
  )
  const tabSetId = useId()
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const isControlled = value !== undefined
  const activeTab = isControlled ? value : internalTab

  const selectTab = (tabId: string) => {
    if (!isControlled) setInternalTab(tabId)
    onChange?.(tabId)
  }

  const handleKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    currentIndex: number
  ) => {
    let nextIndex: number | null = null
    if (event.key === 'ArrowRight') {
      nextIndex = (currentIndex + 1) % tabs.length
    } else if (event.key === 'ArrowLeft') {
      nextIndex = (currentIndex - 1 + tabs.length) % tabs.length
    } else if (event.key === 'Home') {
      nextIndex = 0
    } else if (event.key === 'End') {
      nextIndex = tabs.length - 1
    }

    if (nextIndex === null) return
    event.preventDefault()
    const nextTab = tabs[nextIndex]
    if (!nextTab) return
    tabRefs.current[nextIndex]?.focus()
    selectTab(nextTab.id)
  }

  if (tabs.length === 0) return null

  return (
    <div className={className}>
      {/* Tab Navigation */}
      <div className="border-b border-(--card-border) overflow-x-auto scrollbar-hide -mx-4 px-4 md:mx-0 md:px-0">
        <nav
          className="-mb-px flex space-x-1 min-w-max"
          aria-label="Tabs"
          role="tablist"
        >
          {tabs.map((tab, index) => (
            <button
              key={tab.id}
              ref={(node) => {
                tabRefs.current[index] = node
              }}
              type="button"
              role="tab"
              id={`${tabSetId}-tab-${tab.id}`}
              aria-controls={`${tabSetId}-panel-${tab.id}`}
              aria-selected={activeTab === tab.id}
              tabIndex={activeTab === tab.id ? 0 : -1}
              onClick={() => selectTab(tab.id)}
              onKeyDown={(event) => handleKeyDown(event, index)}
              className={`
                min-h-11 px-2.5 md:px-4 py-2 text-xs md:text-sm font-medium transition-colors duration-200
                border-b-2 whitespace-nowrap shrink-0
                ${
                  activeTab === tab.id
                    ? 'border-accent-wh40k text-(--accent)'
                    : 'border-transparent text-secondary-wh40k hover:text-primary-wh40k hover:border-(--text-secondary)'
                }
              `}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Every tab's aria-controls needs a DOM target; only the active panel mounts content. */}
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab
        return (
          <div
            key={tab.id}
            className={isActive ? 'mt-4 md:mt-6' : undefined}
            role="tabpanel"
            id={`${tabSetId}-panel-${tab.id}`}
            aria-labelledby={`${tabSetId}-tab-${tab.id}`}
            tabIndex={isActive ? 0 : undefined}
            hidden={!isActive}
          >
            {isActive ? tab.content : null}
          </div>
        )
      })}
    </div>
  )
}
