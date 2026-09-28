'use client'

import { AlertCircle, Hash, Users } from 'lucide-react'

import { formatGuildDisplayLabel } from '@/app/lib/format/guild'

import { LANGUAGES, type ClusterData } from '../_lib/cluster-types'

export function StepReview({ data }: { data: ClusterData }) {
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold text-primary-wh40k mb-4">
        Review & Create
      </h2>

      <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
        <p className="text-sm text-green-400">
          <strong>Ready to create!</strong> Review your cluster configuration
          below.
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <h3 className="font-semibold text-primary-wh40k mb-2">
            Basic Information
          </h3>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="text-secondary-wh40k">Code:</div>
            <div>{data.clusterCode}</div>
            <div className="text-secondary-wh40k">Display Name:</div>
            <div>{data.displayName}</div>
            <div className="text-secondary-wh40k">Timezone:</div>
            <div>{data.timezone}</div>
            <div className="text-secondary-wh40k">Language:</div>
            <div>
              {LANGUAGES.find((l) => l.code === data.primaryLanguage)?.name}
            </div>
          </div>
        </div>

        {(data.primaryColor !== '#dc2626' || data.logoUrl) && (
          <div>
            <h3 className="font-semibold text-primary-wh40k mb-2">Branding</h3>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="text-secondary-wh40k">Colors:</div>
              <div className="flex gap-2">
                <div
                  className="w-6 h-6 rounded-sm"
                  style={{ backgroundColor: data.primaryColor }}
                />
                <div
                  className="w-6 h-6 rounded-sm"
                  style={{ backgroundColor: data.secondaryColor }}
                />
                <div
                  className="w-6 h-6 rounded-sm"
                  style={{ backgroundColor: data.accentColor }}
                />
              </div>
              {data.logoUrl && (
                <>
                  <div className="text-secondary-wh40k">Logo:</div>
                  <div>Configured</div>
                </>
              )}
            </div>
          </div>
        )}

        {data.discordWebhookUrl && (
          <div>
            <h3 className="font-semibold text-primary-wh40k mb-2">Discord</h3>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="text-secondary-wh40k">Webhook:</div>
              <div>Configured</div>
              {data.discordInviteUrl && (
                <>
                  <div className="text-secondary-wh40k">Invite:</div>
                  <div>Set</div>
                </>
              )}
            </div>
          </div>
        )}

        <div>
          <h3 className="font-semibold text-primary-wh40k mb-2">Settings</h3>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="text-secondary-wh40k">Max Guilds:</div>
            <div>{data.maxGuilds}</div>
            <div className="text-secondary-wh40k">Token Thresholds:</div>
            <div>
              {data.tokenOffenderThreshold} / {data.tokenAbuserThreshold}
            </div>
          </div>
        </div>

        <div>
          <h3 className="font-semibold text-primary-wh40k mb-2">
            Guild Setup Method
          </h3>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="text-secondary-wh40k">Setup Method:</div>
            <div className="flex items-center gap-2">
              {data.setupMethod === 'direct' ? (
                <>
                  <Users className="w-4 h-4 text-green-400" />
                  <span>Direct Setup</span>
                </>
              ) : (
                <>
                  <Hash className="w-4 h-4 text-blue-400" />
                  <span>Invite Code</span>
                </>
              )}
            </div>
            {data.setupMethod === 'invite_code' && (
              <>
                <div className="text-secondary-wh40k">Code Generated:</div>
                <div className="text-green-400">Yes</div>
              </>
            )}
          </div>
        </div>

        {data.setupMethod === 'direct' && data.foundingGuilds.length > 0 && (
          <div>
            <h3 className="font-semibold text-primary-wh40k mb-2">
              Founding Guilds
            </h3>
            <div className="space-y-1">
              {data.foundingGuilds.map((guild) => (
                <div
                  key={`review-guild-${guild.guildCode}`}
                  className="text-sm"
                >
                  •{' '}
                  {formatGuildDisplayLabel({
                    guild_code: guild.guildCode,
                    display_name: guild.displayName
                  })}
                  <span className="text-xs text-secondary-wh40k ml-2">
                    {guild.apiKey ? '(Ready)' : '(Invitation)'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {data.setupMethod === 'invite_code' && (
          <div>
            <h3 className="font-semibold text-primary-wh40k mb-2">
              Invite Code Setup
            </h3>
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3">
              <p className="text-sm text-blue-400 mb-2">
                <Hash className="inline w-4 h-4 mr-1" />
                An invite code will be generated for guild leaders to join
              </p>
              <div className="text-xs text-secondary-wh40k">
                • Multi-use invite code with no expiration
                <br />
                • Guild leaders can join with their own API keys and information
                <br />• You can manage or regenerate the code anytime from
                cluster settings
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
        <p className="text-sm text-amber-200">
          <AlertCircle className="inline w-4 h-4 mr-1" />
          Once created, you&apos;ll be able to manage all aspects of your
          cluster from the Cluster Management page.
        </p>
      </div>
    </div>
  )
}
