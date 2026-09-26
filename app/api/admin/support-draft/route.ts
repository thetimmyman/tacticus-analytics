import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { withAdminGuards } from '@/app/api/admin/_lib/with-admin-guards'
import { createComponentLogger } from '@/app/lib/logging'
import { draftSupportAnswer } from '@/app/lib/guild-ops/support-draft-retrieval'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { rethrowIfAuthError } from '@/app/lib/middleware/errorHandler'

const logger = createComponentLogger('api.admin.support-draft')

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  question: z.string().trim().min(1).max(2000)
})

// A guild role, not app-admin: draftSupportAnswer() reads only the static corpus and the question.
export const POST = withAdminGuards(
  {
    guard: 'guild-role',
    minRole: 'officer',
    reason:
      'Support drafting reads a static corpus and no cross-guild data; guild officers answer for their own members.'
  },
  async (request: NextRequest, _context, { user }) => {
    try {
      const json = await request.json().catch(() => null)
      const parsed = bodySchema.safeParse(json)
      if (!parsed.success) {
        throw Errors.validation('Invalid request body', {
          issues: parsed.error.issues
        })
      }

      const result = draftSupportAnswer(parsed.data.question)

      logger.info(
        {
          user_id: user.id,
          matched_source_refs: result.sources.map((source) => source.sourceRef),
          confidence: result.confidence,
          needs_handoff: result.needsHandoff
        },
        'Support draft generated'
      )

      return NextResponse.json(result)
    } catch (error) {
      rethrowIfAppError(error)
      rethrowIfAuthError(error)
      const message = error instanceof Error ? error.message : 'Unknown error'
      logger.error({ error: message }, 'Support draft generation failed')
      throw Errors.internal('Failed to generate support draft')
    }
  }
)
