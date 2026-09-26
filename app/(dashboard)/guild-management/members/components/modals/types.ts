import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@tacticus/app-core/types'
import type { ExtendedMember, Boss, MetaTeam } from '../types'

export interface BaseModalProps {
  member: ExtendedMember
  onClose: () => void
  onMemberUpdate: (
    updatedMember: Partial<ExtendedMember> & { player_id: string }
  ) => void
}

export interface ModalWithSupabaseProps extends BaseModalProps {
  supabase: SupabaseClient<Database>
}

export interface BossAssignmentModalProps extends ModalWithSupabaseProps {
  availableBosses: Boss[]
}

export interface BossPreferencesModalProps extends ModalWithSupabaseProps {
  bossDisplayNames: Record<string, string>
}

export interface MetaTeamsModalProps extends ModalWithSupabaseProps {
  metaTeams: MetaTeam[]
  metaTeamsLoading: boolean
}
