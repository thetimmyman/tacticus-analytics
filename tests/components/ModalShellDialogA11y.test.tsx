import { act, render, screen, fireEvent } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@tacticus/app-core/types'
import type { ExtendedMember } from '@/app/(dashboard)/guild-management/members/components/types'
import { AdminUnlinkModal } from '@/app/(dashboard)/guild-management/members/components/modals/AdminUnlinkModal'
import { ApiKeyModal } from '@/app/(dashboard)/guild-management/members/components/modals/ApiKeyModal'
import { BossAssignmentModal } from '@/app/(dashboard)/guild-management/members/components/modals/BossAssignmentModal'
import { BossPreferencesModal } from '@/app/(dashboard)/guild-management/members/components/modals/BossPreferencesModal'
import { DiscordHandleModal } from '@/app/(dashboard)/guild-management/members/components/modals/DiscordHandleModal'
import { HeraldRolesModal } from '@/app/(dashboard)/guild-management/members/components/modals/HeraldRolesModal'
import { InviteCodeModal } from '@/app/(dashboard)/guild-management/members/components/modals/InviteCodeModal'
import { MetaTeamsModal } from '@/app/(dashboard)/guild-management/members/components/modals/MetaTeamsModal'
import { NotesModal } from '@/app/(dashboard)/guild-management/members/components/modals/NotesModal'
import { RosterViewerModal } from '@/app/(dashboard)/guild-management/members/components/modals/RosterViewerModal'

// An unlabelled ModalShell falls back to the generic 'Dialog' name; each
// dialog below must announce its own heading and route Escape to onClose.
const member = {
  player_id: 'player-1',
  display_name: 'Test Member',
  guild_code: 'TEST',
  user_id: null
} as unknown as ExtendedMember

const supabase = {
  rpc: vi.fn(async () => ({ data: { success: true }, error: null }))
} as unknown as SupabaseClient<Database>

const onMemberUpdate = vi.fn()

type DialogCase = {
  title: RegExp
  open: (onClose: () => void) => ReactElement
}

const DIALOG_CASES: DialogCase[] = [
  {
    title: /Meta Team Preferences/u,
    open: (onClose) => (
      <MetaTeamsModal
        member={member}
        onClose={onClose}
        onMemberUpdate={onMemberUpdate}
        supabase={supabase}
        metaTeams={[]}
        metaTeamsLoading={false}
      />
    )
  },
  {
    title: /Add Player API Key/u,
    open: (onClose) => <ApiKeyModal member={member} onClose={onClose} />
  },
  {
    title: /Invite Code/u,
    open: (onClose) => <InviteCodeModal member={member} onClose={onClose} />
  },
  {
    title: /Unlink Player/u,
    open: (onClose) => (
      <AdminUnlinkModal
        member={member}
        onClose={onClose}
        onMemberUpdate={onMemberUpdate}
      />
    )
  },
  {
    title: /Herald Roles/u,
    open: (onClose) => (
      <HeraldRolesModal
        member={member}
        onClose={onClose}
        metaTeamOptions={[]}
        rows={[]}
        canEdit={false}
        onChange={vi.fn()}
      />
    )
  },
  {
    title: /Set Discord Handle/u,
    open: (onClose) => (
      <DiscordHandleModal
        member={member}
        onClose={onClose}
        onMemberUpdate={onMemberUpdate}
        supabase={supabase}
      />
    )
  },
  {
    title: /Boss Preferences/u,
    open: (onClose) => (
      <BossPreferencesModal
        member={member}
        onClose={onClose}
        onMemberUpdate={onMemberUpdate}
        supabase={supabase}
        bossDisplayNames={{ siege: 'Siege' }}
      />
    )
  },
  {
    title: /Boss Assignments/u,
    open: (onClose) => (
      <BossAssignmentModal
        member={member}
        onClose={onClose}
        onMemberUpdate={onMemberUpdate}
        supabase={supabase}
        availableBosses={[]}
      />
    )
  },
  {
    title: /Edit Notes/u,
    open: (onClose) => (
      <NotesModal
        member={member}
        onClose={onClose}
        onMemberUpdate={onMemberUpdate}
        supabase={supabase}
      />
    )
  },
  {
    title: /^Roster/u,
    open: (onClose) => <RosterViewerModal member={member} onClose={onClose} />
  }
]

beforeAll(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ units: [], powerLevel: 1 })
    }))
  )
})

describe.each(DIALOG_CASES)('ModalShell dialog $title', ({ title, open }) => {
  it('announces its own heading instead of the generic Dialog label', async () => {
    render(open(vi.fn()))
    await act(async () => {}) // flush mount-time fetches (roster viewer)
    const dialog = screen.getByRole('dialog', { name: title })
    expect(dialog.getAttribute('aria-label')).not.toBe('Dialog')
  })

  it('routes Escape to the consumer onClose', async () => {
    const onClose = vi.fn()
    render(open(onClose))
    await act(async () => {})
    expect(screen.getByRole('dialog', { name: title })).toBeInTheDocument()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
