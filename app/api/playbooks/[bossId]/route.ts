import { NextResponse } from 'next/server'
import { requireAuthForApi } from '@/app/lib/auth'
import { requireFeatureAccess } from '@/app/lib/services/feature-access-gate'
import playbooks from '@/data/boss-playbooks/playbooks.json'
import { getPlaybookContent } from '@/data/boss-playbooks/playbook-content.generated'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.playbooks.bossId')
import {
  withErrorHandler,
  rethrowIfAuthError
} from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'

interface Boss {
  id: string
  name: string
  playbook: string
  primesPlaybook?: string
  [key: string]: unknown
}

export const GET = withErrorHandler(
  async (
    _request: Request,
    { params }: { params: Promise<{ bossId: string }> }
  ) => {
    try {
      const { user } = await requireAuthForApi()
      const { bossId } = await params

      await requireFeatureAccess(
        user.id,
        'boss_playbooks',
        'Boss Playbooks requires alpha access'
      )

      const boss = (playbooks.bosses as Boss[]).find((b) => b.id === bossId)

      if (!boss) {
        throw Errors.fromResponse(404, { error: `Boss '${bossId}' not found` })
      }

      const markdownContent =
        getPlaybookContent(boss.playbook) ||
        `# ${boss.name} Playbook\n\nPlaybook content coming soon.`
      const primesMarkdownContent = boss.primesPlaybook
        ? getPlaybookContent(boss.primesPlaybook)
        : undefined

      return NextResponse.json({
        success: true,
        data: {
          boss,
          markdownContent,
          primesMarkdownContent,
          lastUpdated: playbooks.generatedAt
        }
      })
    } catch (error) {
      rethrowIfAppError(error)
      rethrowIfAuthError(error)
      logger.error({ error }, 'Playbook API error')
      throw Errors.fromResponse(500, { error: 'Failed to fetch playbook' })
    }
  }
)
