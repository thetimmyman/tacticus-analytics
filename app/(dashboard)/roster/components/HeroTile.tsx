import { TileStars } from './TileStars'
import {
  getRankColor,
  getRankIconUrl,
  getRankName,
  type UnitRarity
} from '../utils/roster-helpers'
import {
  getFrameUrl,
  getPortraitUrl,
  TILE_ASPECT_RATIO
} from '../utils/tile-art'

/** Shares of the 190x247 frame, whose 7px/8px bevel insets the portrait. */
const PORTRAIT_INSET_X = '3.7%'
const PORTRAIT_INSET_Y = '3.2%'
/** Headroom so star pips can overhang the frame top. */
const STAR_HEADROOM = '7%'

interface HeroTileProps {
  name: string
  unitId: string
  /** Round catalog icon; fallback when no portrait exists. */
  iconUrl: string | null
  rarity: UnitRarity
  rank: number
  xpLevel: number
  progressionIndex: number
  shards: number
  mythicShards?: number
  abilities: Array<{ id: string; level: number }>
  onSelect?: () => void
}

export function HeroTile({
  name,
  unitId,
  iconUrl,
  rarity,
  rank,
  xpLevel,
  progressionIndex,
  shards,
  mythicShards,
  abilities,
  onSelect
}: HeroTileProps) {
  const rankName = getRankName(rank)
  const rankIconUrl = getRankIconUrl(rank)
  const frameUrl = getFrameUrl(rarity)
  // LIVE-build art, else the round icon for units added since extraction.
  const portraitUrl = getPortraitUrl(unitId)
  const artUrl = portraitUrl ?? iconUrl

  const abilityLevels = abilities.map((a) => a.level).join('/')
  const tooltip = [
    `${name} — ${rankName} · Lv ${xpLevel} · ${rarity}`,
    `Shards: ${shards}${mythicShards ? ` (+${mythicShards} mythic)` : ''}`,
    abilityLevels ? `Abilities: ${abilityLevels}` : null
  ]
    .filter(Boolean)
    .join('\n')

  return (
    <button
      type="button"
      onClick={onSelect}
      className="group block w-full min-w-0 rounded-lg text-left focus:outline-hidden focus-visible:ring-2 focus-visible:ring-(--accent)"
      title={tooltip}
      aria-label={`${name} details`}
    >
      {/* Padding reserves the star overhang so it is never clipped. */}
      <div style={{ paddingTop: STAR_HEADROOM }}>
        <div
          className="relative w-full transition-transform duration-150 group-hover:scale-[1.04]"
          style={{ aspectRatio: TILE_ASPECT_RATIO }}
        >
          {/* Portrait sits inside the frame bevel. */}
          <div
            className="absolute overflow-hidden bg-(--bg-secondary)"
            style={{ inset: `${PORTRAIT_INSET_Y} ${PORTRAIT_INSET_X}` }}
          >
            {artUrl ? (
              <img
                src={artUrl}
                alt={name}
                className={`h-full w-full ${
                  portraitUrl ? 'object-cover' : 'object-contain p-[12%]'
                }`}
                loading="lazy"
                decoding="async"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-base font-semibold text-secondary-wh40k">
                {name.slice(0, 2)}
              </div>
            )}
          </div>

          {/* Rarity frame overlays the portrait edge. */}
          <img
            src={frameUrl}
            alt=""
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 h-full w-full select-none"
            loading="lazy"
            decoding="async"
          />

          {/* Rank badge, bottom-left, as in-game. */}
          {rankIconUrl ? (
            <img
              src={rankIconUrl}
              alt={rankName}
              title={rankName}
              className="pointer-events-none absolute bottom-[1%] left-[1%] w-[30%] select-none object-contain drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]"
              loading="lazy"
              decoding="async"
            />
          ) : (
            <span
              className={`absolute bottom-[3%] left-[4%] text-[10px] font-bold drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)] ${getRankColor(rank)}`}
            >
              {rankName}
            </span>
          )}

          {/* Level chip, bottom-right — the game's own placement. */}
          <span className="absolute bottom-[3%] right-[4%] rounded-sm bg-black/75 px-1 text-[10px] font-semibold leading-4 text-white">
            {xpLevel}
          </span>

          {/* Stars straddle the frame's top edge. */}
          <TileStars
            progressionIndex={progressionIndex}
            className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2"
          />
        </div>
      </div>

      {/* Active / passive ability levels ([active, passive], as in roster responses). */}
      {abilities.length > 0 && (
        <div className="mt-0.5 flex w-full items-stretch justify-between gap-1 px-[6%]">
          {abilities.slice(0, 2).map((ability, index) => (
            <span
              key={ability.id}
              className="min-w-0 flex-1 rounded-xs bg-black/60 text-center text-[10px] font-bold leading-4 text-white ring-1 ring-white/20"
              title={`${index === 0 ? 'Active' : 'Passive'} ability level`}
            >
              {ability.level}
            </span>
          ))}
        </div>
      )}

      <div className="mt-0.5 truncate text-center text-[11px] leading-tight text-primary-wh40k">
        {name}
      </div>
    </button>
  )
}
