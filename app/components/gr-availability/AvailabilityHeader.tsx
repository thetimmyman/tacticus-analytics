'use client'

import { type Dispatch, type RefObject, type SetStateAction } from 'react'
import {
  Button,
  CardDescription,
  CardHeader,
  CardTitle,
  StatusLabel
} from '@tacticus/ui-kit'
import { ChevronDown, Clock, Copy, RefreshCw, Send } from 'lucide-react'
import type { PlayerAvailability } from '@/app/components/gr-availability/types'

interface AvailabilityHeaderProps {
  season: string
  useMentions: boolean
  setUseMentions: Dispatch<SetStateAction<boolean>>
  copyDropdownRef: RefObject<HTMLDivElement>
  postDropdownRef: RefObject<HTMLDivElement>
  loading: boolean
  exporting: boolean
  players: PlayerAvailability[]
  showCopyDropdown: boolean
  setShowCopyDropdown: Dispatch<SetStateAction<boolean>>
  showPostDropdown: boolean
  setShowPostDropdown: Dispatch<SetStateAction<boolean>>
  exportToDiscord: (
    postToWebhook?: boolean,
    filterType?: 'full' | 'capped' | 'bombs'
  ) => Promise<void>
  hasApiKey: boolean
  setError: Dispatch<SetStateAction<string | null>>
  setShowDetails: Dispatch<SetStateAction<boolean>>
  autoRefresh: boolean
  setAutoRefresh: Dispatch<SetStateAction<boolean>>
  syncGuildData: () => Promise<void>
  syncing: boolean
}

export const AvailabilityHeader = ({
  season,
  useMentions,
  setUseMentions,
  copyDropdownRef,
  postDropdownRef,
  loading,
  exporting,
  players,
  showCopyDropdown,
  setShowCopyDropdown,
  showPostDropdown,
  setShowPostDropdown,
  exportToDiscord,
  hasApiKey,
  setError,
  setShowDetails,
  autoRefresh,
  setAutoRefresh,
  syncGuildData,
  syncing
}: AvailabilityHeaderProps) => {
  return (
    <CardHeader className="pb-3 pt-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-4">
          <div>
            <CardTitle className="text-base">Guild Raid Availability</CardTitle>
            <CardDescription className="text-xs">
              Season {season}
            </CardDescription>
          </div>
        </div>
        <div className="flex items-center gap-0.5 sm:gap-1 flex-wrap">
          {/* Use @mentions toggle */}
          <Button
            size="sm"
            variant={useMentions ? 'default' : 'ghost'}
            onClick={() => setUseMentions(!useMentions)}
            className="h-7 px-2 sm:px-3"
            title="When enabled, players with linked Discord accounts will be @mentioned (pinged) in capped/bombs lists"
          >
            <span className="text-xs">@</span>
            <StatusLabel
              type={useMentions ? 'success' : 'inactive'}
              size="sm"
              className="ml-1"
            >
              {useMentions ? 'ON' : 'OFF'}
            </StatusLabel>
          </Button>
          {/* Copy dropdown */}
          <div ref={copyDropdownRef} className="relative">
            <Button
              size="sm"
              variant="ghost"
              disabled={loading || exporting || players.length === 0}
              className="h-7 px-2 sm:px-3"
              title="Copy to clipboard"
              onClick={() => {
                setShowCopyDropdown(!showCopyDropdown)
                setShowPostDropdown(false)
              }}
            >
              <Copy className="h-3 w-3" />
              <span className="hidden sm:inline ml-1 text-xs">Copy</span>
              <ChevronDown className="h-3 w-3 ml-0.5 sm:ml-1" />
            </Button>
            {showCopyDropdown && (
              <div className="absolute right-0 mt-1 z-50 min-w-40 rounded-md dropdown-menu p-1">
                <button
                  className="w-full text-left px-3 py-2 text-sm rounded-sm hover:bg-[color-mix(in_srgb,var(--accent)_20%,transparent)] hover:text-(--accent) transition-colors"
                  onClick={() => {
                    exportToDiscord(false, 'full')
                    setShowCopyDropdown(false)
                  }}
                >
                  Full Details
                </button>
                <button
                  className="w-full text-left px-3 py-2 text-sm rounded-sm hover:bg-[color-mix(in_srgb,var(--accent)_20%,transparent)] hover:text-(--accent) transition-colors"
                  onClick={() => {
                    exportToDiscord(false, 'capped')
                    setShowCopyDropdown(false)
                  }}
                >
                  Capped Players (3/3)
                </button>
                <button
                  className="w-full text-left px-3 py-2 text-sm rounded-sm hover:bg-[color-mix(in_srgb,var(--accent)_20%,transparent)] hover:text-(--accent) transition-colors"
                  onClick={() => {
                    exportToDiscord(false, 'bombs')
                    setShowCopyDropdown(false)
                  }}
                >
                  Bombs Available
                </button>
              </div>
            )}
          </div>

          {/* Post dropdown */}
          <div ref={postDropdownRef} className="relative">
            <Button
              size="sm"
              variant="ghost"
              disabled={loading || exporting || players.length === 0}
              className="h-7 px-2 sm:px-3"
              title="Post to Discord"
              onClick={() => {
                setShowPostDropdown(!showPostDropdown)
                setShowCopyDropdown(false)
              }}
            >
              <Send className="h-3 w-3" />
              <span className="hidden sm:inline ml-1 text-xs">Post</span>
              <ChevronDown className="h-3 w-3 ml-0.5 sm:ml-1" />
            </Button>
            {showPostDropdown && (
              <div className="absolute right-0 mt-1 z-50 min-w-40 rounded-md dropdown-menu p-1">
                <button
                  className="w-full text-left px-3 py-2 text-sm rounded-sm hover:bg-[color-mix(in_srgb,var(--accent)_20%,transparent)] hover:text-(--accent) transition-colors"
                  onClick={() => {
                    exportToDiscord(true, 'full')
                    setShowPostDropdown(false)
                  }}
                >
                  Full Details
                </button>
                <button
                  className="w-full text-left px-3 py-2 text-sm rounded-sm hover:bg-[color-mix(in_srgb,var(--accent)_20%,transparent)] hover:text-(--accent) transition-colors"
                  onClick={() => {
                    exportToDiscord(true, 'capped')
                    setShowPostDropdown(false)
                  }}
                >
                  Capped Players (3/3)
                </button>
                <button
                  className="w-full text-left px-3 py-2 text-sm rounded-sm hover:bg-[color-mix(in_srgb,var(--accent)_20%,transparent)] hover:text-(--accent) transition-colors"
                  onClick={() => {
                    exportToDiscord(true, 'bombs')
                    setShowPostDropdown(false)
                  }}
                >
                  Bombs Available
                </button>
              </div>
            )}
          </div>
          {/* Future: custom role permissions. */}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              if (!hasApiKey) {
                setError(
                  'Auto-refresh requires an API key. Please add your Player API key below.'
                )
                setShowDetails(true)
                setTimeout(() => {
                  const apiInput = document.getElementById('api-key-input')
                  if (apiInput) {
                    apiInput.scrollIntoView({
                      behavior: 'smooth',
                      block: 'center'
                    })
                    apiInput.classList.add(
                      'ring-2',
                      'ring-yellow-400',
                      'ring-opacity-75',
                      'animate-pulse'
                    )
                    setTimeout(() => {
                      apiInput.classList.remove('animate-pulse')
                      setTimeout(() => {
                        apiInput.classList.remove(
                          'ring-2',
                          'ring-yellow-400',
                          'ring-opacity-75'
                        )
                      }, 2000)
                    }, 2000)
                    apiInput.focus()
                  }
                }, 100)
                return
              }
              setAutoRefresh(!autoRefresh)
            }}
            className="h-7 px-2 sm:px-3"
            title="Auto-refresh"
            disabled={!hasApiKey && autoRefresh}
          >
            <Clock className="h-3 w-3" />
            <span className="hidden sm:inline ml-1 text-xs">Auto</span>
            <StatusLabel
              type={autoRefresh && hasApiKey ? 'success' : 'inactive'}
              size="sm"
              className="ml-0.5 sm:ml-1"
            >
              {autoRefresh && hasApiKey ? 'ON' : 'OFF'}
            </StatusLabel>
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={syncGuildData}
            disabled={loading || syncing}
            className="h-7 px-2 sm:px-3"
            title="Sync guild data"
          >
            <RefreshCw
              className={`h-3 w-3 ${loading || syncing ? 'animate-spin' : ''}`}
            />
            <span className="hidden sm:inline ml-1 text-xs">Sync</span>
          </Button>
        </div>
      </div>
    </CardHeader>
  )
}
