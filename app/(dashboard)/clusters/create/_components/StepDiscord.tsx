'use client'

import { Input, Label } from '@tacticus/ui-kit'

import type { DiscordStepProps } from '../_lib/cluster-types'

export function StepDiscord({
  data,
  setData,
  errors = {},
  skipDiscord,
  setSkipDiscord
}: DiscordStepProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-[var(--text-primary)]">
          Discord Integration
        </h2>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={skipDiscord}
            onChange={(e) => setSkipDiscord(e.target.checked)}
            className="rounded"
          />
          <span className="text-sm text-[var(--text-secondary)]">
            Skip this step
          </span>
        </label>
      </div>

      {!skipDiscord && (
        <>
          <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
            <p className="text-sm text-[var(--accent)]">
              <strong>Optional:</strong> Connect your Discord server for
              notifications and community features.
            </p>
          </div>

          <div>
            <Label>Discord Server ID</Label>
            <Input
              value={data.discordServerId}
              onChange={(e) =>
                setData({ ...data, discordServerId: e.target.value })
              }
              placeholder="e.g., 1234567890123456789"
            />
            <p className="text-xs text-[var(--text-secondary)] mt-1">
              Your Discord server&apos;s ID
            </p>
          </div>

          <div>
            <Label>Discord Invite URL</Label>
            <Input
              value={data.discordInviteUrl}
              onChange={(e) =>
                setData({ ...data, discordInviteUrl: e.target.value })
              }
              placeholder="https://discord.gg/yourinvite"
            />
            {errors.discordInviteUrl && (
              <p className="text-red-400 text-sm mt-1">
                {errors.discordInviteUrl}
              </p>
            )}
            <p className="text-xs text-[var(--text-secondary)] mt-1">
              Public invite link for new members
            </p>
          </div>

          <div>
            <Label>Discord Webhook URL</Label>
            <Input
              value={data.discordWebhookUrl}
              onChange={(e) =>
                setData({ ...data, discordWebhookUrl: e.target.value })
              }
              placeholder="https://discord.com/api/webhooks/..."
              type="text"
              className="font-mono"
              autoComplete="off"
              data-form-type="other"
              data-lpignore="true"
              data-1p-ignore="true"
            />
            {errors.discordWebhookUrl && (
              <p className="text-red-400 text-sm mt-1">
                {errors.discordWebhookUrl}
              </p>
            )}
            <p className="text-xs text-[var(--text-secondary)] mt-1">
              For sending notifications to your Discord channel
            </p>
          </div>

          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
            <h3 className="font-semibold text-yellow-400 mb-2">
              How to get a Discord Webhook:
            </h3>
            <ol className="list-decimal list-inside space-y-1 text-sm text-amber-200">
              <li>Go to your Discord server settings</li>
              <li>Navigate to Integrations → Webhooks</li>
              <li>Click &quot;New Webhook&quot;</li>
              <li>Choose the channel for notifications</li>
              <li>Copy the webhook URL</li>
            </ol>
          </div>
        </>
      )}
    </div>
  )
}
