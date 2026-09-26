'use client'

import { useMemo } from 'react'
import { dbClient } from '@/app/lib/db/client'
import type { ExtendedMember, MemberActionType, Boss, MetaTeam } from './types'
import type {
  MetaTeamOption,
  PlayerMetaRoleRow
} from './LeaderRoleOverrideCell'
import {
  ApiKeyModal,
  BossAssignmentModal,
  NotesModal,
  BossPreferencesModal,
  MetaTeamsModal,
  HeraldRolesModal,
  DiscordHandleModal,
  RosterViewerModal,
  InviteCodeModal,
  AdminUnlinkModal
} from './modals'

interface MemberActionModalsProps {
  actionMember: ExtendedMember | null
  activeAction: MemberActionType | null
  onClose: () => void
  onMemberUpdate: (
    updatedMember: Partial<ExtendedMember> & { player_id: string }
  ) => void
  availableBosses: Boss[]
  metaTeams: MetaTeam[]
  metaTeamsLoading: boolean
  bossDisplayNames: Record<string, string>
  metaTeamOptions?: MetaTeamOption[]
  metaRolesByUser?: Record<string, PlayerMetaRoleRow[]>
  canEditMetaRoles?: boolean
  onMetaRolesChange?: (userId: string, newRows: PlayerMetaRoleRow[]) => void
}

export function MemberActionModals({
  actionMember,
  activeAction,
  onClose,
  onMemberUpdate,
  availableBosses,
  metaTeams,
  metaTeamsLoading,
  bossDisplayNames,
  metaTeamOptions = [],
  metaRolesByUser = {},
  canEditMetaRoles = false,
  onMetaRolesChange
}: MemberActionModalsProps) {
  const supabase = useMemo(() => dbClient(), [])

  if (!activeAction || !actionMember) return null

  switch (activeAction) {
    case 'apiKey':
      return <ApiKeyModal member={actionMember} onClose={onClose} />

    case 'assignBosses':
      return (
        <BossAssignmentModal
          member={actionMember}
          onClose={onClose}
          onMemberUpdate={onMemberUpdate}
          supabase={supabase}
          availableBosses={availableBosses}
        />
      )

    case 'notes':
      return (
        <NotesModal
          member={actionMember}
          onClose={onClose}
          onMemberUpdate={onMemberUpdate}
          supabase={supabase}
        />
      )

    case 'bossPreferences':
      return (
        <BossPreferencesModal
          member={actionMember}
          onClose={onClose}
          onMemberUpdate={onMemberUpdate}
          supabase={supabase}
          bossDisplayNames={bossDisplayNames}
        />
      )

    case 'metaTeams':
      return (
        <MetaTeamsModal
          member={actionMember}
          onClose={onClose}
          onMemberUpdate={onMemberUpdate}
          supabase={supabase}
          metaTeams={metaTeams}
          metaTeamsLoading={metaTeamsLoading}
        />
      )

    case 'heraldRoles':
      return (
        <HeraldRolesModal
          member={actionMember}
          onClose={onClose}
          metaTeamOptions={metaTeamOptions}
          rows={
            actionMember.user_id
              ? (metaRolesByUser[actionMember.user_id] ?? [])
              : []
          }
          canEdit={canEditMetaRoles && Boolean(actionMember.user_id)}
          onChange={(newRows) => {
            if (!actionMember.user_id || !onMetaRolesChange) return
            onMetaRolesChange(actionMember.user_id, newRows)
          }}
        />
      )

    case 'discordHandle':
      return (
        <DiscordHandleModal
          member={actionMember}
          onClose={onClose}
          onMemberUpdate={onMemberUpdate}
          supabase={supabase}
        />
      )

    case 'viewRoster':
      return <RosterViewerModal member={actionMember} onClose={onClose} />

    case 'generateInviteCode':
      return <InviteCodeModal member={actionMember} onClose={onClose} />

    case 'adminUnlink':
      return (
        <AdminUnlinkModal
          member={actionMember}
          onClose={onClose}
          onMemberUpdate={onMemberUpdate}
        />
      )

    default:
      return null
  }
}

export { type MemberActionModalsProps }
