import { NextRequest, NextResponse } from 'next/server'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.admin.guild-cleanup')
import { serviceDb } from '@/app/lib/db'
import { createError } from '@tacticus/app-core/error-handler'
import { z } from 'zod'
import { rethrowIfAuthError } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { withAdminGuards } from '@/app/api/admin/_lib/with-admin-guards'
import {
  deletePlayerGuild,
  parsePlayerGuildDeletion,
  parsePlayerGuildDeletionFailure
} from '@/app/lib/auth/player-authority-lifecycle'

export const dynamic = 'force-dynamic'

const deleteGuildSchema = z.object({
  action: z.literal('delete_guild'),
  guild_ids: z.array(z.number().int().positive().max(2147483647)).min(1).max(10)
})

const fixOrphanedPlayersSchema = z.object({
  action: z.literal('fix_orphaned_players'),
  player_ids: z.array(z.string().min(1)).min(1).max(50)
})

const mergeGuildsSchema = z.object({
  action: z.literal('merge_guilds'),
  source_guild_id: z.number().positive(),
  target_guild_id: z.number().positive(),
  options: z.record(z.string(), z.unknown()).optional()
})

const cleanCorruptedSchema = z.object({
  action: z.literal('clean_corrupted_data'),
  guild_ids: z.array(z.number().positive()).min(1).max(10)
})

const cleanupRequestSchema = z.discriminatedUnion('action', [
  deleteGuildSchema,
  fixOrphanedPlayersSchema,
  mergeGuildsSchema,
  cleanCorruptedSchema
])

type CleanupRequest = z.infer<typeof cleanupRequestSchema>

type CleanupOperationResult = {
  success: boolean
  [key: string]: unknown
}

export const POST = withAdminGuards(
  { guard: 'app-admin-user-id' },
  async (request: NextRequest, _context, { user_id: userId }) => {
    try {
      const requestBody = await request.json()
      const cleanupRequest: CleanupRequest =
        cleanupRequestSchema.parse(requestBody)

      // requireAppAdmin() is the gate. Full guild deletion is one locked owner RPC.
      const supabase = serviceDb()
      const results: CleanupOperationResult[] = []

      logger.info(
        {
          userId,
          action: cleanupRequest.action,
          targetCount:
            'guild_ids' in cleanupRequest
              ? cleanupRequest.guild_ids.length
              : cleanupRequest.action === 'fix_orphaned_players'
                ? cleanupRequest.player_ids.length
                : cleanupRequest.action === 'merge_guilds'
                  ? 2
                  : 0
        },
        'Guild cleanup operation requested'
      )

      switch (cleanupRequest.action) {
        case 'delete_guild':
          if (
            !cleanupRequest.guild_ids ||
            cleanupRequest.guild_ids.length === 0
          ) {
            throw createError(
              'VALIDATION_ERROR',
              'Guild IDs are required for deletion'
            )
          }

          for (const guildId of cleanupRequest.guild_ids) {
            try {
              const { data, error } = await deletePlayerGuild(
                supabase,
                guildId,
                'app.admin.guild-cleanup'
              )
              if (error) {
                logger.error(
                  { guild_id: guildId, error },
                  'Failed to delete guild'
                )
                results.push({
                  guild_id: guildId,
                  success: false,
                  error: error.message
                })
                continue
              }

              const deletion = parsePlayerGuildDeletion(data, guildId)
              if (deletion) {
                logger.info(
                  {
                    guild_id: guildId,
                    guild_code: deletion.guildCode,
                    deleted_mapping_count: deletion.deletedMappingCount,
                    revoked_attestations: deletion.revokedAttestations
                  },
                  'Guild deleted successfully'
                )
                results.push({
                  guild_id: guildId,
                  guild_code: deletion.guildCode,
                  success: true,
                  message: 'Guild deleted successfully',
                  deleted_mapping_count: deletion.deletedMappingCount,
                  deleted_invite_count: deletion.deletedInviteCount,
                  revoked_attestations: deletion.revokedAttestations
                })
                continue
              }

              const refusal = parsePlayerGuildDeletionFailure(data)
              results.push({
                guild_id: guildId,
                success: false,
                error:
                  refusal?.error ?? 'Guild deletion returned an invalid proof',
                ...(refusal && { error_code: refusal.errorCode })
              })
            } catch (err) {
              const errorMessage =
                err instanceof Error ? err.message : 'Unknown error'
              logger.error(
                { guild_id: guildId, error: errorMessage },
                'Error deleting guild'
              )
              results.push({
                guild_id: guildId,
                success: false,
                error: errorMessage
              })
            }
          }
          break

        case 'fix_orphaned_players':
          if (
            !cleanupRequest.player_ids ||
            cleanupRequest.player_ids.length === 0
          ) {
            throw createError(
              'VALIDATION_ERROR',
              'Player IDs are required for orphaned player fix'
            )
          }

          for (const playerId of cleanupRequest.player_ids) {
            try {
              const { data: playerRecord } = await supabase
                .from('player_mapping')
                .select('player_id, user_id, display_name')
                .eq('player_id', playerId)
                .eq('is_current', true)
                .single()

              if (playerRecord?.user_id) {
                logger.warn(
                  {
                    player_id: playerId,
                    user_id: playerRecord.user_id,
                    display_name: playerRecord.display_name
                  },
                  'Skipping deletion of claimed player mapping'
                )
                results.push({
                  player_id: playerId,
                  success: false,
                  error: `Player "${playerRecord.display_name}" has a claimed account (user_id: ${playerRecord.user_id}). Use account deletion instead.`
                })
                continue
              }

              const { error: deleteError } = await supabase
                .from('player_mapping')
                .delete()
                .eq('player_id', playerId)
                .eq('is_current', true)
                .is('user_id', null)

              if (deleteError) {
                logger.error(
                  { player_id: playerId, error: deleteError },
                  'Failed to fix orphaned player'
                )
                results.push({
                  player_id: playerId,
                  success: false,
                  error: deleteError.message
                })
              } else {
                logger.info(
                  { player_id: playerId },
                  'Orphaned player mapping cleaned up'
                )
                results.push({
                  player_id: playerId,
                  success: true,
                  message: 'Orphaned player mapping removed'
                })
              }
            } catch (err) {
              const errorMessage =
                err instanceof Error ? err.message : 'Unknown error'
              logger.error(
                { player_id: playerId, error: errorMessage },
                'Error fixing orphaned player'
              )
              results.push({
                player_id: playerId,
                success: false,
                error: errorMessage
              })
            }
          }
          break

        case 'merge_guilds':
          if (
            !cleanupRequest.target_guild_id ||
            !cleanupRequest.source_guild_id
          ) {
            throw createError(
              'VALIDATION_ERROR',
              'Target and source guild IDs are required for merge'
            )
          }

          results.push({
            action: 'merge_guilds',
            success: false,
            error:
              'Guild merge functionality not yet implemented - requires careful data migration'
          })
          break

        case 'clean_corrupted_data':
          if (
            !cleanupRequest.guild_ids ||
            cleanupRequest.guild_ids.length === 0
          ) {
            throw createError(
              'VALIDATION_ERROR',
              'Guild IDs are required for corruption cleanup'
            )
          }

          for (const guildId of cleanupRequest.guild_ids) {
            try {
              const { data: guildInfo } = await supabase
                .from('guild_config')
                .select(
                  'guild_code, display_name, enabled, cluster_code, cluster_id'
                )
                .eq('id', guildId)
                .single()

              if (!guildInfo) {
                results.push({
                  guild_id: guildId,
                  success: false,
                  error: 'Guild not found'
                })
                continue
              }

              const updates: { display_name?: string; cluster_code?: string } =
                {}
              let needsUpdate = false

              if (
                !guildInfo.display_name ||
                guildInfo.display_name.trim() === ''
              ) {
                updates.display_name = guildInfo.guild_code || 'Unknown Guild'
                needsUpdate = true
              }

              if (
                guildInfo.enabled &&
                !guildInfo.cluster_code &&
                !guildInfo.cluster_id
              ) {
                updates.cluster_code = 'INDEPENDENT'
                needsUpdate = true
              }

              if (needsUpdate) {
                const { error: updateError } = await supabase
                  .from('guild_config')
                  .update(updates)
                  .eq('id', guildId)

                if (updateError) {
                  logger.error(
                    { guild_id: guildId, error: updateError },
                    'Failed to clean corrupted guild data'
                  )
                  results.push({
                    guild_id: guildId,
                    guild_code: guildInfo.guild_code,
                    success: false,
                    error: updateError.message
                  })
                } else {
                  logger.info(
                    {
                      guild_id: guildId,
                      guild_code: guildInfo.guild_code,
                      updates
                    },
                    'Corrupted guild data cleaned'
                  )
                  results.push({
                    guild_id: guildId,
                    guild_code: guildInfo.guild_code,
                    success: true,
                    message: 'Guild data corruption fixed',
                    applied_fixes: updates
                  })
                }
              } else {
                results.push({
                  guild_id: guildId,
                  guild_code: guildInfo.guild_code,
                  success: true,
                  message: 'No corruption found - guild data is clean'
                })
              }
            } catch (err) {
              const errorMessage =
                err instanceof Error ? err.message : 'Unknown error'
              logger.error(
                { guild_id: guildId, error: errorMessage },
                'Error cleaning corrupted guild data'
              )
              results.push({
                guild_id: guildId,
                success: false,
                error: errorMessage
              })
            }
          }
          break

        default: {
          const exhaustiveCheck: never = cleanupRequest
          throw createError(
            'VALIDATION_ERROR',
            `Unknown cleanup action: ${(exhaustiveCheck as { action: string }).action}`
          )
        }
      }

      logger.info(
        {
          user_id: userId,
          action: cleanupRequest.action,
          total_items: results.length,
          successful: results.filter((r) => r.success).length,
          failed: results.filter((r) => !r.success).length
        },
        'Guild cleanup operation completed'
      )

      const responseData = {
        success: true,
        action: cleanupRequest.action,
        results,
        summary: {
          total: results.length,
          successful: results.filter((r) => r.success).length,
          failed: results.filter((r) => !r.success).length
        }
      }

      return NextResponse.json(responseData)
    } catch (error) {
      rethrowIfAppError(error)
      rethrowIfAuthError(error)
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error'
      logger.error(
        {
          error: errorMessage,
          stack: error instanceof Error ? error.stack : undefined
        },
        'Guild cleanup operation failed'
      )

      throw Errors.fromResponse(500, {
        success: false,
        error: 'Failed to perform cleanup operation',
        details: errorMessage
      })
    }
  }
)
