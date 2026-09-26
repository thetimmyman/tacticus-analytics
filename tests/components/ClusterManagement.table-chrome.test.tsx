import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DiscordBotSection } from '@/app/(dashboard)/leaderboards/components/cluster-management/components/DiscordBotSection'

describe('cluster-management DataTable chrome', () => {
  it('preserves the Discord links tbody secondary tint', () => {
    render(
      <DiscordBotSection
        clusterCode="EOT"
        discordLinks={[
          {
            guildCode: 'EOT_GR',
            displayName: 'Example Alliance',
            discordLink: null,
            invites: []
          }
        ]}
        discordLinksLoading={false}
        discordLinksError={null}
        clusterInvites={[]}
        copiedInvite={null}
        generatingInviteFor={null}
        inviteSuccessMessage={null}
        deletingInviteId={null}
        onRefresh={vi.fn()}
        onGenerateInvite={vi.fn()}
        onCopyInvite={vi.fn()}
        onDeleteInvite={vi.fn()}
      />
    )

    expect(screen.getByRole('table').className).toContain(
      '[&_tbody]:bg-[color-mix(in_srgb,var(--bg-secondary)_20%,transparent)]'
    )
  })
})
