import type { Supabase, CommandInteraction, CommandResponse } from '../../types'
import {
  createCommandResponse,
  buildErrorResponse,
  INFO_THEME,
  COLOR_PALETTE
} from '../../utils/response-builder'
import { getOptionValue } from '../../utils/option-parser'
import { draftSupportAnswer } from '@/app/lib/guild-ops/support-draft-retrieval'

/** In-memory retrieval, so not deferred. Always ephemeral: the reply is a draft for the asker. */
export async function handleAskCommand(
  supabase: Supabase,
  interaction: CommandInteraction
): Promise<CommandResponse> {
  void supabase

  const question = getOptionValue<string>(
    interaction.data.options,
    'question'
  )?.trim()

  if (!question) {
    return buildErrorResponse(
      'Please provide a question, e.g. `/ask question: How do I add my API key?`'
    )
  }

  const result = draftSupportAnswer(question)

  if (result.needsHandoff || !result.answer) {
    return createCommandResponse(INFO_THEME, {
      title: 'No confident answer found',
      description:
        "I couldn't match that question to the support knowledge base with enough confidence to draft an answer. " +
        'Please ask a guild officer or leader — a wrong guess is worse than a handoff.',
      color: COLOR_PALETTE.info,
      footer: 'Tacticus Analytics support drafts · knowledge-base MVP',
      useThemeAccent: false
    })
  }

  const sourceList = result.sources
    .map((source) => `• ${source.question} — \`${source.sourceRef}\``)
    .join('\n')

  return createCommandResponse(INFO_THEME, {
    title: 'Support draft',
    description: result.answer,
    color: COLOR_PALETTE.info,
    fields: [
      {
        name: 'Sources',
        value: sourceList || '—'
      }
    ],
    footer: `Draft answer · confidence ${(result.confidence * 100).toFixed(0)}% · verify before relaying as official`,
    useThemeAccent: false
  })
}
