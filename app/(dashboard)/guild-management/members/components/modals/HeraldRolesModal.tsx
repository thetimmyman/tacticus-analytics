'use client'

import { Button } from '@tacticus/ui-kit'
import { ModalShell } from '@/app/components/ui/ModalShell'
import { MemberName } from '@/app/components/ui/MemberName'
import { useMemberLabels } from '@/app/hooks/useMemberLabels'
import {
  LeaderRoleOverrideCell,
  type MetaTeamOption,
  type PlayerMetaRoleRow
} from '../LeaderRoleOverrideCell'
import type { ExtendedMember } from '../types'

interface HeraldRolesModalProps {
  member: ExtendedMember
  onClose: () => void
  metaTeamOptions: MetaTeamOption[]
  rows: PlayerMetaRoleRow[]
  canEdit: boolean
  onChange: (newRows: PlayerMetaRoleRow[]) => void
}

export function HeraldRolesModal({
  member,
  onClose,
  metaTeamOptions,
  rows,
  canEdit,
  onChange
}: HeraldRolesModalProps) {
  const { labelFor } = useMemberLabels()

  return (
    <ModalShell>
      <h3 className="text-lg font-semibold text-primary-wh40k mb-2">
        Herald Roles - <MemberName value={member.display_name} />
      </h3>
      <p className="text-xs text-secondary-wh40k mb-4">
        Assign meta team roles for Herald ping routing. Officer assignments
        appear with the &apos;leader&apos; source badge and take precedence over
        player-set roles.
      </p>

      {!member.user_id ? (
        <p className="text-sm text-secondary-wh40k">
          This member has no claimed profile yet. Herald roles can only be
          assigned after they claim their profile via invite code.
        </p>
      ) : (
        <LeaderRoleOverrideCell
          targetUserId={member.user_id}
          targetDisplayName={
            member.display_name ? labelFor(member.display_name) : null
          }
          metaTeamOptions={metaTeamOptions}
          rows={rows}
          canEdit={canEdit}
          onChange={onChange}
        />
      )}

      <div className="flex justify-end gap-3 mt-4">
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
    </ModalShell>
  )
}
