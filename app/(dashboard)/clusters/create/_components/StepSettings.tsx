'use client'

import { Button, Input, Label } from '@tacticus/ui-kit'
import { AlertCircle, Plus, X } from 'lucide-react'

import { formatGuildDisplayLabel } from '@/app/lib/format/guild'

import type { StepProps } from '../_lib/cluster-types'
import { useFoundingGuildDraft } from '../_lib/use-founding-guild-draft'

export function StepSettings({ data, setData, errors = {} }: StepProps) {
  const {
    newGuild,
    setNewGuild,
    add: addFoundingGuild,
    removeAt: removeGuild
  } = useFoundingGuildDraft(data, setData)

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold text-primary-wh40k mb-4">
        Cluster Settings
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label>Maximum Guilds</Label>
          <Input
            type="number"
            value={data.maxGuilds}
            onChange={(event) => {
              const parsed = Number.parseInt(event.target.value, 10)
              setData({
                ...data,
                maxGuilds: Number.isNaN(parsed) ? 10 : parsed
              })
            }}
            min={1}
            max={100}
          />
          {errors.maxGuilds && (
            <p className="text-red-400 text-sm mt-1">{errors.maxGuilds}</p>
          )}
        </div>

        <div>
          <Label>Token Offender Threshold</Label>
          <Input
            type="number"
            value={data.tokenOffenderThreshold}
            onChange={(event) => {
              const parsed = Number.parseInt(event.target.value, 10)
              setData({
                ...data,
                tokenOffenderThreshold: Number.isNaN(parsed) ? 10 : parsed
              })
            }}
            min={1}
            max={30}
          />
          <p className="text-xs text-secondary-wh40k mt-1">
            Tokens before marked as offender
          </p>
        </div>

        <div>
          <Label>Token Abuser Threshold</Label>
          <Input
            type="number"
            value={data.tokenAbuserThreshold}
            onChange={(event) => {
              const parsed = Number.parseInt(event.target.value, 10)
              setData({
                ...data,
                tokenAbuserThreshold: Number.isNaN(parsed) ? 15 : parsed
              })
            }}
            min={1}
            max={30}
          />
          <p className="text-xs text-secondary-wh40k mt-1">
            Tokens before marked as abuser
          </p>
        </div>
      </div>

      {/* Founding Guilds */}
      <div className="border-t border-(--card-border) pt-4">
        <h3 className="font-semibold text-primary-wh40k mb-3">
          Founding Guilds (Optional)
        </h3>

        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 mb-4">
          <p className="text-sm text-amber-200">
            <AlertCircle className="inline w-4 h-4 mr-1" />
            <strong>Important:</strong> Only add NEW guilds that don&apos;t
            exist yet. Existing guilds cannot be claimed. If you have the
            guild&apos;s API key, they can be fully set up immediately.
            Otherwise, an invitation will be sent.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 mb-3">
          <Input
            value={newGuild.guildCode}
            onChange={(e) =>
              setNewGuild({
                ...newGuild,
                guildCode: e.target.value.toUpperCase()
              })
            }
            placeholder="Guild Code (e.g., ABC)"
            maxLength={10}
          />
          <Input
            value={newGuild.displayName}
            onChange={(e) =>
              setNewGuild({ ...newGuild, displayName: e.target.value })
            }
            placeholder="Guild Display Name"
          />
          <Input
            value={newGuild.leaderEmail}
            onChange={(e) =>
              setNewGuild({ ...newGuild, leaderEmail: e.target.value })
            }
            placeholder="Leader Email"
            type="email"
          />
          <Input
            value={newGuild.apiKey}
            onChange={(e) =>
              setNewGuild({ ...newGuild, apiKey: e.target.value })
            }
            placeholder="API Key (optional)"
            type="text"
            className="font-mono"
            autoComplete="off"
            data-form-type="other"
            data-lpignore="true"
            data-1p-ignore="true"
          />
        </div>
        <Button onClick={addFoundingGuild} size="sm" className="w-full">
          <Plus className="w-4 h-4 mr-2" />
          Add Founding Guild
        </Button>

        {data.foundingGuilds.length > 0 && (
          <div className="space-y-2 mt-4">
            {data.foundingGuilds.map((guild, index) => (
              <div
                key={guild.guildCode}
                className="flex items-center justify-between p-3 bg-(--bg-secondary) hover:bg-card/80 transition-colors duration-200 rounded-lg"
              >
                <div>
                  <span className="text-sm font-medium">
                    {formatGuildDisplayLabel({
                      guild_code: guild.guildCode,
                      display_name: guild.displayName
                    })}
                  </span>
                  <div className="text-xs text-secondary-wh40k mt-1">
                    {guild.apiKey
                      ? 'API key provided'
                      : `Invite: ${guild.leaderEmail}`}
                  </div>
                </div>
                <Button
                  onClick={() => removeGuild(index)}
                  size="sm"
                  variant="ghost"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
