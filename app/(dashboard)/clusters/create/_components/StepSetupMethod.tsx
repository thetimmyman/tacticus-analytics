'use client'

import { Button, Input, Label } from '@tacticus/ui-kit'
import { AlertCircle, Hash, Plus, Users, X } from 'lucide-react'

import { formatGuildDisplayLabel } from '@/app/lib/format/guild'

import { useFoundingGuildDraft } from '../_lib/use-founding-guild-draft'
import type { StepProps } from '../_lib/cluster-types'

// Takes the shared StepProps (unused `errors`) so all steps share a signature.
export function StepSetupMethod({ data, setData }: StepProps) {
  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-primary-wh40k mb-4">
        Guild Setup Method
      </h2>

      <div className="space-y-4">
        {/* Setup Method Choice */}
        <div className="space-y-3">
          <Label className="text-base font-medium">
            How would you like to set up guilds?
          </Label>

          <div className="space-y-3">
            {/* Direct Setup Option */}
            <div
              className={`border rounded-lg p-4 cursor-pointer transition-colors ${
                data.setupMethod === 'direct'
                  ? 'border-primary-wh40k bg-[color-mix(in_srgb,var(--primary)_10%,transparent)]'
                  : 'border-(--card-border) hover:border-[color-mix(in_srgb,var(--primary)_50%,transparent)]'
              }`}
              onClick={() =>
                setData({
                  ...data,
                  setupMethod: 'direct',
                  generateInviteCode: false
                })
              }
            >
              <div className="flex items-start gap-3">
                <div
                  className={`w-5 h-5 rounded-full border-2 flex items-center justify-center mt-0.5 ${
                    data.setupMethod === 'direct'
                      ? 'border-primary-wh40k bg-primary-wh40k'
                      : 'border-(--text-tertiary)'
                  }`}
                >
                  {data.setupMethod === 'direct' && (
                    <div className="w-2 h-2 bg-white rounded-full" />
                  )}
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-primary-wh40k mb-1 flex items-center gap-2">
                    <Users className="w-4 h-4" />
                    Set Up Guilds Directly
                  </h3>
                  <p className="text-sm text-secondary-wh40k mb-3">
                    Add guild information (API keys, names, leader emails) on
                    behalf of other guild leaders
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <span className="px-2 py-1 bg-green-500/20 text-green-400 text-xs rounded-sm">
                      Immediate Setup
                    </span>
                    <span className="px-2 py-1 bg-blue-500/20 text-blue-400 text-xs rounded-sm">
                      No Manual Steps
                    </span>
                    <span className="px-2 py-1 bg-purple-500/20 text-purple-400 text-xs rounded-sm">
                      Full Control
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Invite Code Option */}
            <div
              className={`border rounded-lg p-4 cursor-pointer transition-colors ${
                data.setupMethod === 'invite_code'
                  ? 'border-primary-wh40k bg-[color-mix(in_srgb,var(--primary)_10%,transparent)]'
                  : 'border-(--card-border) hover:border-[color-mix(in_srgb,var(--primary)_50%,transparent)]'
              }`}
              onClick={() =>
                setData({
                  ...data,
                  setupMethod: 'invite_code',
                  generateInviteCode: true
                })
              }
            >
              <div className="flex items-start gap-3">
                <div
                  className={`w-5 h-5 rounded-full border-2 flex items-center justify-center mt-0.5 ${
                    data.setupMethod === 'invite_code'
                      ? 'border-primary-wh40k bg-primary-wh40k'
                      : 'border-(--text-tertiary)'
                  }`}
                >
                  {data.setupMethod === 'invite_code' && (
                    <div className="w-2 h-2 bg-white rounded-full" />
                  )}
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-primary-wh40k mb-1 flex items-center gap-2">
                    <Hash className="w-4 h-4" />
                    Generate Invite Code
                  </h3>
                  <p className="text-sm text-secondary-wh40k mb-3">
                    Create an invite code that guild leaders can use to join
                    your cluster at their own pace
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <span className="px-2 py-1 bg-blue-500/20 text-blue-400 text-xs rounded-sm">
                      Multi-Use
                    </span>
                    <span className="px-2 py-1 bg-green-500/20 text-green-400 text-xs rounded-sm">
                      No Expiration
                    </span>
                    <span className="px-2 py-1 bg-orange-500/20 text-orange-400 text-xs rounded-sm">
                      Self-Service
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Security Warning for Invite Codes */}
        {data.setupMethod === 'invite_code' && (
          <div className="bg-orange-500/10 border border-orange-500/30 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-orange-400 mt-0.5 shrink-0" />
              <div>
                <h4 className="font-medium text-orange-400 mb-1">
                  Security Notice
                </h4>
                <p className="text-sm text-secondary-wh40k">
                  <strong>Multi-use invite codes</strong> can be used by anyone
                  who has them. Share them only with trusted guild leaders. You
                  can regenerate or disable the invite code anytime from your
                  cluster management settings.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Direct Setup - Founding Guilds Section */}
        {data.setupMethod === 'direct' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-primary-wh40k">
                Founding Guilds
              </h3>
              <p className="text-sm text-secondary-wh40k">
                Your guild will be added automatically
              </p>
            </div>

            {/* Guild Addition Form */}
            <div className="border border-(--card-border) rounded-lg p-4 bg-(--card-bg)">
              <h4 className="font-medium text-primary-wh40k mb-3">Add Guild</h4>
              <GuildAddForm data={data} setData={setData} />
            </div>

            {/* Display Added Guilds */}
            {data.foundingGuilds.length > 0 && (
              <div className="space-y-2">
                {data.foundingGuilds.map((guild, index) => (
                  <div
                    key={guild.guildCode}
                    className="flex items-center justify-between p-3 bg-(--bg-secondary) rounded-lg"
                  >
                    <div>
                      <span className="font-medium">
                        {formatGuildDisplayLabel({
                          guild_code: guild.guildCode,
                          display_name: guild.displayName
                        })}
                      </span>
                      {guild.apiKey && (
                        <span className="text-xs text-green-400 ml-2">
                          (API Key Provided)
                        </span>
                      )}
                    </div>
                    <Button
                      type="button"
                      onClick={() =>
                        setData({
                          ...data,
                          foundingGuilds: data.foundingGuilds.filter(
                            (_, i) => i !== index
                          )
                        })
                      }
                      variant="outline"
                      size="sm"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function GuildAddForm({ data, setData }: StepProps) {
  const {
    newGuild,
    setNewGuild,
    add: addGuild
  } = useFoundingGuildDraft(data, setData)

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <Label className="text-sm">Guild Code *</Label>
          <Input
            value={newGuild.guildCode}
            onChange={(e) =>
              setNewGuild({
                ...newGuild,
                guildCode: e.target.value.toUpperCase()
              })
            }
            placeholder="GUILD"
            maxLength={20}
          />
        </div>
        <div>
          <Label className="text-sm">Display Name *</Label>
          <Input
            value={newGuild.displayName}
            onChange={(e) =>
              setNewGuild({ ...newGuild, displayName: e.target.value })
            }
            placeholder="Guild Display Name"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <Label className="text-sm">Leader Email</Label>
          <Input
            type="email"
            value={newGuild.leaderEmail}
            onChange={(e) =>
              setNewGuild({ ...newGuild, leaderEmail: e.target.value })
            }
            placeholder="leader@example.com"
          />
        </div>
        <div>
          <Label className="text-sm">API Key (Optional)</Label>
          <Input
            value={newGuild.apiKey}
            onChange={(e) =>
              setNewGuild({ ...newGuild, apiKey: e.target.value })
            }
            placeholder="API key for immediate setup"
          />
        </div>
      </div>

      <Button
        type="button"
        onClick={addGuild}
        disabled={!newGuild.guildCode || !newGuild.displayName}
        className="w-full"
      >
        <Plus className="w-4 h-4 mr-2" />
        Add Guild
      </Button>
    </div>
  )
}
