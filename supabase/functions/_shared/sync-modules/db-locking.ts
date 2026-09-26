import { getErrorMessage } from './helpers.ts'

export interface LockLogger {
  info: (ctx: string, msg: string) => void
  warn: (ctx: string, msg: string) => void
  error: (ctx: string, msg: string, err?: unknown) => void
}

export interface LockConfig {
  table: string
  lockTimeoutMs: number
}

export interface LockDeps {
  supabase: any
  logger: LockLogger
}

export async function acquireLock(
  deps: LockDeps,
  config: LockConfig,
  guildCode: string,
  clusterCode: string | null
): Promise<string | null> {
  const lockKey = `gr_sync_${clusterCode || 'none'}_${guildCode}`
  const lockId = crypto.randomUUID()

  try {
    const { error: cleanupError } = await deps.supabase
      .from(config.table)
      .delete()
      .lt('expires_at', new Date().toISOString())
    if (cleanupError) throw new Error('Execution lock cleanup failed')

    const { data, error } = await deps.supabase
      .from(config.table)
      .insert({
        lock_key: lockKey,
        lock_id: lockId,
        guild_code: guildCode,
        worker_id: 'sync-modular-workflow',
        acquired_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + config.lockTimeoutMs).toISOString(),
        heartbeat_at: new Date().toISOString()
      })
      .select()

    if (!error && data) {
      deps.logger.info(guildCode, `Acquired execution lock`)
      return lockId
    }

    if (error?.code === '23505') {
      deps.logger.info(guildCode, 'Another sync holds the guild lock')
      return null
    }
    throw new Error('Execution lock acquisition failed')
  } catch (error) {
    deps.logger.error(
      guildCode,
      `Lock acquisition exception: ${getErrorMessage(error)}`,
      error
    )
    throw error
  }
}

export async function releaseLock(
  deps: LockDeps,
  config: LockConfig,
  guildCode: string,
  clusterCode: string | null,
  lockId: string
) {
  try {
    const { error } = await deps.supabase
      .from(config.table)
      .delete()
      .eq('lock_key', `gr_sync_${clusterCode || 'none'}_${guildCode}`)
      .eq('lock_id', lockId)

    if (!error) {
      deps.logger.info(guildCode, `Released execution lock`)
    }
  } catch (error) {
    deps.logger.error(
      guildCode,
      `Failed to release lock: ${getErrorMessage(error)}`,
      error
    )
  }
}
