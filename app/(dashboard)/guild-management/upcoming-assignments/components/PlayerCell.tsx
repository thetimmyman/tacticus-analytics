import { getUserAvatar, resolvePlayerAvatar } from '@/app/lib/utils/avatar'
import { MemberName } from '@/app/components/ui/MemberName'

export function PlayerCell({
  playerId,
  displayName,
  avatarMap,
  guildCode
}: {
  playerId: string
  displayName: string
  avatarMap: Map<string, string | null>
  guildCode?: string
}) {
  const avatarUnitId = avatarMap.get(playerId) ?? null
  // No avatar frame data here, so the resolver runs without a frame map.
  const avatarUrl = resolvePlayerAvatar({
    avatarUnitId,
    playerName: displayName,
    guildCode: guildCode || 'GLOBAL',
    size: 32
  })

  return (
    <div className="flex items-center gap-2">
      <img
        src={avatarUrl}
        alt=""
        className="h-8 w-8 flex-shrink-0 rounded-full object-cover"
        onError={(e) => {
          e.currentTarget.src = getUserAvatar(
            displayName,
            guildCode || 'GLOBAL',
            32
          )
        }}
      />
      <span>
        <MemberName value={displayName} />
      </span>
    </div>
  )
}
