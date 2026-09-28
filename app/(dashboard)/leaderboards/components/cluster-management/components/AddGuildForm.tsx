'use client'

import React from 'react'
import { Button } from '@tacticus/ui-kit'
import { Input } from '@tacticus/ui-kit'
import { Label } from '@tacticus/ui-kit'
import { Switch } from '@tacticus/ui-kit'
import { Save, X, Search, Info, AlertTriangle, Loader2 } from 'lucide-react'
import type { Guild } from '../types'
import type { ClaimGuildInfo } from '../hooks/useGuildActions'
import { formatGuildDisplayLabel } from '@/app/lib/format/guild'

interface AddGuildFormProps {
  newGuild: Partial<Guild>
  addingGuildPending: boolean
  claimMode: boolean
  claimGuildInfo: ClaimGuildInfo | null
  checkingGuild: boolean
  onNewGuildChange: (guild: Partial<Guild>) => void
  onCheckGuild: (guildCode: string) => void
  onCancel: () => void
  onSubmit: () => void
}

export function AddGuildForm({
  newGuild,
  addingGuildPending,
  claimMode,
  claimGuildInfo,
  checkingGuild,
  onNewGuildChange,
  onCheckGuild,
  onCancel,
  onSubmit
}: AddGuildFormProps) {
  const guildCode = newGuild.guild_code || ''

  return (
    <div className="card-wh40k p-6 space-y-4">
      <h3 className="text-lg font-bold text-primary-wh40k">
        {claimMode ? 'Claim Existing Guild' : 'Add New Guild'}
      </h3>

      {/* Guild Code + Check button */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label htmlFor="new-guild-code">Guild Code*</Label>
          <div className="flex gap-2">
            <Input
              id="new-guild-code"
              value={guildCode}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                onNewGuildChange({
                  ...newGuild,
                  guild_code: e.target.value.toUpperCase()
                })
              }
              placeholder="e.g., IW, DA, TS"
              maxLength={10}
              className="flex-1"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => onCheckGuild(guildCode)}
              disabled={checkingGuild || guildCode.length < 2}
              className="shrink-0"
            >
              {checkingGuild ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Search className="w-4 h-4" />
              )}
              <span className="ml-1">Check</span>
            </Button>
          </div>
          <p className="text-xs text-secondary-wh40k mt-1">
            Enter a guild code and click Check to see if it already exists
          </p>
        </div>

        {/* Claim mode: show existing guild info instead of display name input */}
        {claimMode && claimGuildInfo ? (
          <div className="flex items-end">
            <div className="text-sm">
              <Label>Existing Guild</Label>
              <p className="text-primary-wh40k font-semibold mt-1">
                {formatGuildDisplayLabel(
                  {
                    display_name: claimGuildInfo.display_name,
                    guild_code: guildCode
                  },
                  guildCode
                )}
              </p>
            </div>
          </div>
        ) : (
          <div>
            <Label htmlFor="new-display-name">Display Name*</Label>
            <Input
              id="new-display-name"
              value={newGuild.display_name || ''}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                onNewGuildChange({ ...newGuild, display_name: e.target.value })
              }
              placeholder="e.g., Iron Warriors"
            />
          </div>
        )}
      </div>

      {/* Claim mode info banner */}
      {claimMode && claimGuildInfo && (
        <div
          className={`rounded-lg p-3 border ${
            claimGuildInfo.cluster_code
              ? 'bg-amber-500/10 border-amber-500/30'
              : 'bg-blue-500/10 border-blue-500/30'
          }`}
        >
          <div className="flex items-start gap-2">
            {claimGuildInfo.cluster_code ? (
              <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
            ) : (
              <Info className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
            )}
            <div className="text-sm">
              {claimGuildInfo.cluster_code ? (
                <p className="text-amber-200">
                  This guild is currently in cluster{' '}
                  <strong>{claimGuildInfo.cluster_code}</strong>. Claiming it
                  will move it to your cluster.
                </p>
              ) : (
                <p className="text-blue-200">
                  This guild exists but is not assigned to any cluster. Provide
                  a valid API key from a member of this guild to claim it.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* API Key + Owner (always shown) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label htmlFor="new-api-key">API Key*</Label>
          <Input
            id="new-api-key"
            type="text"
            value={newGuild.api_key || ''}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              onNewGuildChange({ ...newGuild, api_key: e.target.value })
            }
            placeholder={
              claimMode
                ? 'API key from a member of this guild'
                : "Guild leader's API key"
            }
            className="font-mono"
            autoComplete="off"
            data-form-type="other"
            data-lpignore="true"
            data-1p-ignore="true"
            required
          />
          {claimMode && (
            <p className="text-xs text-secondary-wh40k mt-1">
              The API key must belong to a member of this guild. This validates
              your authorization to claim it.
            </p>
          )}
        </div>

        <div>
          <Label htmlFor="new-api-key-owner">API Key Owner</Label>
          <Input
            id="new-api-key-owner"
            value={newGuild.API_Owner || ''}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              onNewGuildChange({ ...newGuild, API_Owner: e.target.value })
            }
            placeholder="Owner's name"
          />
        </div>
      </div>

      {/* Rankings + Enabled toggle (only in normal creation mode) */}
      {!claimMode && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="new-gr-ranking">GR Ranking</Label>
              <Input
                id="new-gr-ranking"
                type="number"
                value={newGuild.GR_Ranking || ''}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  onNewGuildChange({
                    ...newGuild,
                    GR_Ranking: parseInt(e.target.value) || null
                  })
                }
                placeholder="1-100"
              />
            </div>

            <div>
              <Label htmlFor="new-gw-ranking">GW Ranking</Label>
              <Input
                id="new-gw-ranking"
                type="number"
                value={newGuild.GW_Ranking || ''}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  onNewGuildChange({
                    ...newGuild,
                    GW_Ranking: parseInt(e.target.value) || null
                  })
                }
                placeholder="1-100"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Switch
              checked={newGuild.enabled ?? true}
              onCheckedChange={(checked: boolean) =>
                onNewGuildChange({ ...newGuild, enabled: checked })
              }
            />
            <Label>Guild Enabled</Label>
          </div>
        </>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>
          <X className="w-4 h-4 mr-1" />
          Cancel
        </Button>
        <Button onClick={onSubmit} disabled={addingGuildPending}>
          <Save className="w-4 h-4 mr-1" />
          {addingGuildPending
            ? claimMode
              ? 'Claiming...'
              : 'Adding...'
            : claimMode
              ? 'Claim Guild'
              : 'Add Guild'}
        </Button>
      </div>
    </div>
  )
}
