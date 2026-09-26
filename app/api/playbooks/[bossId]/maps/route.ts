import { NextResponse } from 'next/server'
import { requireAuthForApi } from '@/app/lib/auth'
import { serviceDb } from '@/app/lib/db'
import { toInternalStorageUrl } from '@/app/lib/images/internal-storage-url'
import { checkFeatureAccess } from '@/app/lib/services/feature-release-service'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.playbooks.bossId.maps')
import playbooks from '@/data/boss-playbooks/playbooks.json'
import boardSectionsData from '@/data/boss-playbooks/board-sections.json'
import {
  rethrowIfAuthError,
  withErrorHandler
} from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'

type Boss = {
  id: string
  name?: string
  boards?: string[]
}

type BoardSectionConfig = {
  bossType?: string
  main?: string[]
  support?: string[]
}

type BoardEntry = {
  board: string
  path: string
  image_url: string
}

type BoardSection = {
  key: 'main' | 'support'
  title: string
  subtitle: string | null
  boards: BoardEntry[]
}

// Display-only grouping, kept out of playbooks.json so other `boards` consumers are unaffected.
const boardSections = boardSectionsData as unknown as Record<
  string,
  BoardSectionConfig
>

const boardImageFallbackUrl = (boardId: string, bossId: string) =>
  `/api/battle/board-image?board=${encodeURIComponent(boardId)}&boss=${encodeURIComponent(bossId)}`

export const GET = withErrorHandler(
  async (
    _request: Request,
    { params }: { params: Promise<{ bossId: string }> }
  ) => {
    try {
      const { user } = await requireAuthForApi()
      const { bossId } = await params
      const access = await checkFeatureAccess(user.id, 'boss_playbooks')

      if (!access.has_access) {
        throw Errors.fromResponse(403, {
          error: 'Boss Playbooks requires alpha access',
          stage: access.stage,
          reason: access.reason
        })
      }

      const boss = (playbooks.bosses as Boss[]).find(
        (entry) => entry.id === bossId
      )
      const sectionConfig = boardSections[bossId]

      // Fall back to playbook boards (main only).
      const mainIds = sectionConfig?.main ?? boss?.boards ?? []
      const supportIds = sectionConfig?.support ?? []
      const allIds = [...mainIds, ...supportIds]

      if (allIds.length === 0) {
        return NextResponse.json({
          boss: { name: boss?.name ?? null, primes: [] as string[] },
          sections: [] as BoardSection[]
        })
      }

      const serviceClient = serviceDb()

      const { data: mapsData, error: mapsError } = await serviceClient
        .from('maps')
        .select('id, image_url')
        .in('id', allIds)

      if (mapsError) {
        logger.error(
          { error: mapsError, boardIds: allIds },
          'Failed to fetch maps'
        )
        throw Errors.fromResponse(500, { error: 'Failed to fetch map data' })
      }

      const mapsById = new Map((mapsData ?? []).map((m) => [m.id, m.image_url]))

      // encounter_index 0 = main, 1-2 = primes.
      let mainName = boss?.name ?? null
      let primeNames: string[] = []
      const bossType = sectionConfig?.bossType
      if (bossType) {
        const { data: nameRows, error: nameError } = await serviceClient
          .from('boss_mapping')
          .select('encounter_index, boss_name')
          .eq('boss_type', bossType)
        if (nameError) {
          logger.warn(
            { error: nameError, bossType },
            'Failed to fetch boss names'
          )
        } else if (nameRows) {
          if (nameRows.length === 0) {
            // Surfaces a mistyped bossType, which would otherwise fall back silently.
            logger.info(
              { bossType },
              'No boss_mapping rows for configured bossType'
            )
          }
          const byEnc = new Map(
            nameRows.map((r) => [
              r.encounter_index as number,
              r.boss_name as string
            ])
          )
          mainName = byEnc.get(0) ?? mainName
          primeNames = [byEnc.get(1), byEnc.get(2)].filter(
            (name): name is string => Boolean(name)
          )
        }
      }

      const toEntry = (boardId: string): BoardEntry => ({
        board: boardId,
        path: boardId,
        image_url: toInternalStorageUrl(
          mapsById.get(boardId) ?? boardImageFallbackUrl(boardId, bossId)
        )
      })

      const sections: BoardSection[] = []
      if (mainIds.length > 0) {
        sections.push({
          key: 'main',
          title: 'Main Boards',
          subtitle: mainName,
          boards: mainIds.map(toEntry)
        })
      }
      if (supportIds.length > 0) {
        sections.push({
          key: 'support',
          title: 'Support Boards',
          subtitle: primeNames.length > 0 ? primeNames.join(' · ') : null,
          boards: supportIds.map(toEntry)
        })
      }

      return NextResponse.json({
        boss: { name: mainName, primes: primeNames },
        sections
      })
    } catch (error) {
      rethrowIfAppError(error)
      rethrowIfAuthError(error)
      logger.error({ error }, 'Playbook maps API error')
      throw Errors.fromResponse(500, { error: 'Failed to fetch playbook maps' })
    }
  }
)
