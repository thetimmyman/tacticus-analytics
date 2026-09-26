'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  Settings,
  Users,
  ImageIcon,
  ArrowLeft,
  Activity,
  Gauge
} from 'lucide-react'
import { UserManager } from './UserManager'
import { CarouselManager } from './CarouselManager'
import { ActivityAnalytics } from './ActivityAnalytics'
import { GlobalThresholdsManager } from './GlobalThresholdsManager'

type TabKey = 'users' | 'carousel' | 'analytics' | 'thresholds'

interface Tab {
  key: TabKey
  label: string
  icon: React.ReactNode
  description: string
}

const TABS: Tab[] = [
  {
    key: 'users',
    label: 'Manage Users',
    icon: <Users className="h-4 w-4" />,
    description: 'Accounts, access roles, bans, and invite codes'
  },
  {
    key: 'carousel',
    label: 'Carousel Manager',
    icon: <ImageIcon className="h-4 w-4" />,
    description: 'Homepage news, promos, and announcements'
  },
  {
    key: 'analytics',
    label: 'Activity Analytics',
    icon: <Activity className="h-4 w-4" />,
    description: 'User activity tracking and engagement metrics'
  },
  {
    key: 'thresholds',
    label: 'Strength Thresholds',
    icon: <Gauge className="h-4 w-4" />,
    description: 'Global hero strength requirements for boss assignments'
  }
]

export function AdminDashboard() {
  const [activeTab, setActiveTab] = useState<TabKey>('users')

  return (
    <div className="max-w-full mx-auto p-6 space-y-6">
      <div>
        <Link
          href="/home"
          className="inline-flex items-center gap-1.5 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] mb-4"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Home
        </Link>
        <div className="flex items-center gap-3">
          <Settings className="h-8 w-8 text-[var(--accent)]" />
          <div>
            <h1 className="text-2xl font-bold text-[var(--text-primary)]">
              Admin Dashboard
            </h1>
            <p className="text-[var(--text-secondary)]">
              Manage users, features, and content
            </p>
          </div>
        </div>
      </div>

      <div className="border-b border-[var(--card-border)]">
        <nav className="flex gap-1 -mb-px overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`
                flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap
                ${
                  activeTab === tab.key
                    ? 'border-[var(--accent)] text-[var(--accent)]'
                    : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--card-border)]'
                }
              `}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      <div className="min-h-[500px]">
        {activeTab === 'users' && <UserManager />}
        {activeTab === 'carousel' && <CarouselManager />}
        {activeTab === 'analytics' && <ActivityAnalytics />}
        {activeTab === 'thresholds' && <GlobalThresholdsManager />}
      </div>
    </div>
  )
}
