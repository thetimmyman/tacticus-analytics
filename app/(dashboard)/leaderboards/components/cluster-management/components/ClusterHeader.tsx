'use client'

import { Button } from '@tacticus/ui-kit'
import { Shield, Plus, Users, Key } from 'lucide-react'
import type { Guild } from '../types'

interface ClusterHeaderProps {
  guilds: Guild[]
  addingGuild: boolean
  onAddGuildClick: () => void
}

export function ClusterHeader({
  guilds,
  addingGuild,
  onAddGuildClick
}: ClusterHeaderProps) {
  return (
    <>
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 sm:gap-4">
        <div>
          <h2 className="text-lg sm:text-2xl font-bold text-primary-wh40k flex items-center gap-2">
            <Shield className="w-5 h-5 sm:w-6 sm:h-6" />
            Cluster Management
          </h2>
          <p className="text-xs sm:text-sm text-secondary-wh40k mt-1">
            Manage guilds, API keys, and configurations
          </p>
        </div>
        <Button
          onClick={onAddGuildClick}
          className="flex items-center gap-2 w-full sm:w-auto text-sm"
          disabled={addingGuild}
        >
          <Plus className="w-4 h-4" />
          Add Guild
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        <div className="card-wh40k p-2 sm:p-4">
          <div className="flex flex-col sm:flex-row items-center gap-1 sm:gap-3 text-center sm:text-left">
            <Users className="w-5 h-5 sm:w-8 sm:h-8 text-[var(--accent)]" />
            <div>
              <p className="text-lg sm:text-2xl font-bold text-primary-wh40k">
                {guilds.length}
              </p>
              <p className="text-[10px] sm:text-sm text-secondary-wh40k">
                Guilds
              </p>
            </div>
          </div>
        </div>

        <div className="card-wh40k p-2 sm:p-4">
          <div className="flex flex-col sm:flex-row items-center gap-1 sm:gap-3 text-center sm:text-left">
            <Shield className="w-5 h-5 sm:w-8 sm:h-8 text-green-400" />
            <div>
              <p className="text-lg sm:text-2xl font-bold text-primary-wh40k">
                {guilds.filter((g) => g.enabled).length}
              </p>
              <p className="text-[10px] sm:text-sm text-secondary-wh40k">
                Active
              </p>
            </div>
          </div>
        </div>

        <div className="card-wh40k p-2 sm:p-4">
          <div className="flex flex-col sm:flex-row items-center gap-1 sm:gap-3 text-center sm:text-left">
            <Key className="w-5 h-5 sm:w-8 sm:h-8 text-[var(--primary)]" />
            <div>
              <p className="text-lg sm:text-2xl font-bold text-primary-wh40k">
                {guilds.filter((g) => g.has_api_key).length}
              </p>
              <p className="text-[10px] sm:text-sm text-secondary-wh40k">
                API Keys
              </p>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
