import { db, serviceDb } from '@/app/lib/db'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('lib.compliance.gdpr-manager')
import {
  eraseAllUserData,
  isAuthUserAlreadyAbsent
} from '@/app/lib/compliance/erase-user-data'
import {
  describeWriteFailure,
  WriteFailureError
} from '@/app/lib/compliance/write-failure'
import type {
  GdprProcessingLogRow,
  GdprDataExportRow,
  GdprDeletionRequestRow,
  GdprSupabaseClient
} from '@tacticus/app-core/database-extensions'
import type { TablesInsert } from '@tacticus/app-core/database.generated'

// The GDPR tables are not in the generated Database type.

export const GDPR_CONFIG = {
  retention: {
    userSessions: 30,
    auditLogs: 2555, // 7 years
    errorLogs: 365,
    userContent: null,
    accountData: null
  },

  categories: {
    // Art 6(1)(b) contract, not consent.
    essential: {
      description: 'Data required for basic service functionality',
      legalBasis: 'contract',
      examples: ['user_id', 'guild_membership', 'authentication']
    },
    performance: {
      description: 'Data used for performance monitoring and optimization',
      legalBasis: 'legitimate_interest',
      examples: ['page_load_times', 'error_rates', 'system_metrics']
    },
    // No consent UI: legitimate interest covers first-party telemetry.
    analytics: {
      description: 'Data used for service improvement and analytics',
      legalBasis: 'legitimate_interest',
      examples: ['usage_patterns', 'feature_adoption', 'user_preferences']
    },
    // Real consent: `admit_coaching_task_delivery_v1` checks `gdpr_user_consent` before delivery.
    communication: {
      description: 'Data used for notifications and communication',
      legalBasis: 'consent',
      examples: [
        'email_address',
        'notification_preferences',
        'discord_webhooks'
      ]
    }
  },

  userRights: [
    'access',
    'rectification',
    'erasure',
    'portability',
    'restriction',
    'objection',
    'withdraw_consent'
  ]
} as const

/**
 * Unmapped types get a NULL `retention_until`, which the sweep never deletes. All are
 * Article 30 evidence, so all map to `auditLogs`.
 */
export const GDPR_RETENTION_KEY_BY_DATA_TYPE: Record<
  string,
  keyof typeof GDPR_CONFIG.retention
> = {
  account_deletion_immediate: 'auditLogs',
  complete_export: 'auditLogs',
  deletion_completed: 'auditLogs',
  deletion_request: 'auditLogs',
  export_redrive: 'auditLogs',
  loki_credential_erasure: 'auditLogs'
}

import { projectExportBundle } from './export-projection'
export { projectExportBundle } from './export-projection'

type GdprCleanupCounts = {
  processingLogRowsDeleted: number | null
  expiredExportRowsDeleted: number | null
}

/** The admin id is appended so the row names who re-drove. */
export const GDPR_EXPORT_REDRIVE_PURPOSE_PREFIX =
  'gdpr_export_redrive:invoked_by='

type GdprExportRedriveResult =
  | { outcome: 'not_found' }
  | { outcome: 'not_redrivable'; status: string }
  | { outcome: 'redriven'; status: string | null }

type ProcessingRecordInput = {
  userId: string
  dataType: string
  processingPurpose: string
  legalBasis: GdprProcessingLogRow['legal_basis']
  consentGiven?: boolean
}

export class GDPRManager {
  private async getSupabase(): Promise<GdprSupabaseClient> {
    return (await db()) as unknown as GdprSupabaseClient
  }

  private getServiceClient(): GdprSupabaseClient {
    return serviceDb() as unknown as GdprSupabaseClient
  }

  private getTypedServiceClient() {
    return serviceDb()
  }

  /** Swallows failures so they cannot block account deletion; logs `gdpr.audit.failure`. */
  async recordDataProcessing(record: ProcessingRecordInput): Promise<void> {
    try {
      const row: GdprProcessingLogRow & Record<string, unknown> = {
        id: crypto.randomUUID(),
        user_id: record.userId,
        data_type: record.dataType,
        processing_purpose: record.processingPurpose,
        legal_basis: record.legalBasis,
        timestamp: new Date().toISOString(),
        retention_until: this.calculateRetentionDate(record.dataType),
        consent_given: record.consentGiven ?? null,
        created_at: new Date().toISOString()
      }

      const supabase = this.getServiceClient()
      const { error } = await supabase
        .from('gdpr_processing_log')
        .insert(row as TablesInsert<'gdpr_processing_log'>)
      if (error) throw error
    } catch (error) {
      logger.error(
        {
          event: 'gdpr.audit.failure',
          userId: record.userId,
          dataType: record.dataType,
          processingPurpose: record.processingPurpose,
          legalBasis: record.legalBasis,
          error: error instanceof Error ? error.message : String(error)
        },
        'gdpr.audit.failure: Failed to record data processing'
      )
    }
  }

  async handleDataAccessRequest(userId: string): Promise<GdprDataExportRow> {
    const requestId = crypto.randomUUID()
    const now = new Date().toISOString()

    try {
      const supabase = this.getServiceClient()
      const { data, error } = await supabase
        .from('gdpr_data_exports')
        .insert({
          request_id: requestId,
          user_id: userId,
          requested_at: now,
          status: 'pending'
        })
        .select()
        .single<GdprDataExportRow>()

      if (error || !data) {
        throw error || new Error('Failed to create export request')
      }

      void this.processDataExport(requestId, userId)

      return data
    } catch (error) {
      logger.error({ err: error }, 'Failed to create data access request')
      throw new Error('Failed to process data access request')
    }
  }

  private static readonly EXPORT_RETRY_DELAY_MS = 250

  /** Never throws. */
  private async attemptDataExport(
    requestId: string,
    userId: string,
    attempt: number
  ): Promise<
    { ok: true; downloadUrl: string } | { ok: false; cause: unknown }
  > {
    try {
      const userData = projectExportBundle(await this.collectUserData(userId))
      const downloadUrl = await this.createSecureDownload(
        userData,
        userId,
        requestId,
        attempt
      )
      return { ok: true, downloadUrl }
    } catch (cause) {
      return { ok: false, cause }
    }
  }

  /** The cron reports success regardless, so `gdpr.export.failed` is the only operator signal. */
  private async failDataExport(
    requestId: string,
    userId: string,
    cause: unknown
  ): Promise<void> {
    logger.error(
      {
        event: 'gdpr.export.failed',
        requestId,
        userId,
        failure: describeWriteFailure(cause),
        error: cause instanceof Error ? cause.message : String(cause)
      },
      'gdpr.export.failed: Article 15 export failed twice; the request is closed as failed and needs an operator'
    )
    try {
      const supabase = this.getServiceClient()
      await supabase
        .from('gdpr_data_exports')
        .update({
          status: 'failed',
          completed_at: new Date().toISOString()
        })
        .eq('request_id', requestId)
    } catch (error) {
      logger.error(
        {
          event: 'gdpr.export.failure_write_failed',
          requestId,
          failure: describeWriteFailure(error)
        },
        'gdpr.export.failure_write_failed: could not mark the export failed'
      )
    }
  }

  /**
   * Retries once, then alerts. Uploads are `upsert: false` on a fixed name, so retries
   * delete any half-written object first.
   */
  private async processDataExport(
    requestId: string,
    userId: string,
    options: { firstAttempt?: number } = {}
  ): Promise<void> {
    // Re-drives start at attempt 1: a failed row may own a half-written object.
    const firstAttempt = options.firstAttempt ?? 0

    try {
      const supabase = this.getServiceClient()
      // Stamp every start: the stuck check must age this attempt, not the request's queue time.
      await supabase
        .from('gdpr_data_exports')
        .update({
          status: 'processing',
          processing_started_at: new Date().toISOString()
        })
        .eq('request_id', requestId)

      let outcome = await this.attemptDataExport(
        requestId,
        userId,
        firstAttempt
      )

      if (!outcome.ok) {
        logger.warn(
          {
            event: 'gdpr.export.retry',
            requestId,
            userId,
            failure: describeWriteFailure(outcome.cause)
          },
          'gdpr.export.retry: first Article 15 export attempt failed; retrying once'
        )
        await new Promise((resolve) =>
          setTimeout(resolve, GDPRManager.EXPORT_RETRY_DELAY_MS)
        )
        outcome = await this.attemptDataExport(
          requestId,
          userId,
          firstAttempt + 1
        )
      }

      if (!outcome.ok) {
        await this.failDataExport(requestId, userId, outcome.cause)
        return
      }

      const expiresAt = new Date(
        Date.now() + 7 * 24 * 60 * 60 * 1000
      ).toISOString()

      await supabase
        .from('gdpr_data_exports')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          download_url: outcome.downloadUrl,
          expires_at: expiresAt
        })
        .eq('request_id', requestId)

      await this.recordDataProcessing({
        userId,
        dataType: 'complete_export',
        processingPurpose: 'gdpr_data_access',
        legalBasis: 'legal_obligation'
      })
    } catch (error) {
      await this.failDataExport(requestId, userId, error)
    }
  }

  /**
   * `failed` always qualifies; a `pending`/`processing` row once it is stuck by the
   * monitor's line. claim_gdpr_export_redrive decides and claims in one UPDATE that
   * stamps processing_started_at, so a second re-drive of a live attempt is refused.
   * `completed` never qualifies: re-driving it would revoke the subject's live URL.
   */
  async redriveDataExport(
    requestId: string,
    invokedByUserId: string
  ): Promise<GdprExportRedriveResult> {
    const supabase = this.getServiceClient()

    const { data: row, error } = await supabase
      .from('gdpr_data_exports')
      .select('*')
      .eq('request_id', requestId)
      .maybeSingle<GdprDataExportRow>()

    if (error) {
      logger.error(
        {
          event: 'gdpr.export.redrive_lookup_failed',
          requestId,
          failure: describeWriteFailure(error)
        },
        'gdpr.export.redrive_lookup_failed: could not read the export row'
      )
      throw error
    }

    if (!row) return { outcome: 'not_found' }

    const { data: claimed, error: claimError } = await supabase.rpc(
      'claim_gdpr_export_redrive',
      { p_request_id: requestId }
    )

    if (claimError) {
      logger.error(
        {
          event: 'gdpr.export.redrive_claim_failed',
          requestId,
          failure: describeWriteFailure(claimError)
        },
        'gdpr.export.redrive_claim_failed: could not claim the export row'
      )
      throw claimError
    }

    if (claimed !== true) {
      logger.warn(
        {
          event: 'gdpr.export.redrive_refused',
          requestId,
          status: row.status,
          invokedByUserId
        },
        'gdpr.export.redrive_refused: only a failed or stuck pending/processing export row is re-drivable'
      )
      return { outcome: 'not_redrivable', status: row.status }
    }

    // `user_id` is the subject (their RLS policy keys on it); the operator is in `processing_purpose`.
    await this.recordDataProcessing({
      userId: row.user_id,
      dataType: 'export_redrive',
      processingPurpose: `${GDPR_EXPORT_REDRIVE_PURPOSE_PREFIX}${invokedByUserId}`,
      legalBasis: 'legal_obligation'
    })

    logger.info(
      {
        event: 'gdpr.export.redrive_started',
        requestId,
        userId: row.user_id,
        invokedByUserId
      },
      'gdpr.export.redrive_started: operator re-driving a failed Article 15 export'
    )

    await this.processDataExport(requestId, row.user_id, { firstAttempt: 1 })

    const { data: after } = await supabase
      .from('gdpr_data_exports')
      .select('*')
      .eq('request_id', requestId)
      .maybeSingle<GdprDataExportRow>()

    return { outcome: 'redriven', status: after?.status ?? null }
  }

  private async collectUserData(userId: string): Promise<unknown> {
    const supabase = this.getServiceClient()
    const { data, error } = await supabase.rpc('get_user_data_for_export', {
      p_user_id: userId
    })

    if (error) {
      logger.error({ err: error }, 'Error collecting user data via RPC')
      throw error
    }
    return data
  }

  /**
   * The daily cron erases rows still `scheduled`. Inline erasers must file the row
   * FIRST so the cron finishes a half-done erasure.
   */
  async handleDataDeletionRequest(
    userId: string,
    requestType: 'partial' | 'complete',
    dataCategories: string[] = [],
    options: { scheduledFor?: string } = {}
  ): Promise<GdprDeletionRequestRow> {
    const requestId = crypto.randomUUID()
    const requestedAt = new Date().toISOString()
    const scheduledFor =
      options.scheduledFor ??
      new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

    try {
      if (requestType === 'partial') {
        this.assertPartialDeletionSupported(dataCategories)
      }

      const supabase = this.getServiceClient()
      const { data, error } = await supabase
        .from('gdpr_deletion_requests')
        .insert({
          request_id: requestId,
          user_id: userId,
          request_type: requestType,
          requested_at: requestedAt,
          scheduled_for: scheduledFor,
          status: 'scheduled',
          data_categories: requestType === 'complete' ? ['all'] : dataCategories
        })
        .select()
        .single<GdprDeletionRequestRow>()

      if (error || !data) {
        throw error || new Error('Failed to create deletion request')
      }

      await this.recordDataProcessing({
        userId,
        dataType: 'deletion_request',
        processingPurpose: 'gdpr_data_erasure',
        legalBasis: 'legal_obligation'
      })

      return data
    } catch (error) {
      logger.error({ err: error }, 'Failed to create deletion request')
      throw new Error('Failed to process data deletion request')
    }
  }

  /** The only payload that closes an Article 17 record. */
  private static completionPayload(): {
    status: 'completed'
    completed_at: string
  } {
    return { status: 'completed', completed_at: new Date().toISOString() }
  }

  private static readonly COMPLETION_RETRY_DELAY_MS = 250

  private async attemptCompletionWrite(
    requestId: string
  ): Promise<{ ok: true } | { ok: false; cause: unknown }> {
    try {
      const supabase = this.getServiceClient()
      const { error } = await supabase
        .from('gdpr_deletion_requests')
        .update(GDPRManager.completionPayload())
        .eq('request_id', requestId)
      if (error) return { ok: false, cause: error }
      return { ok: true }
    } catch (thrown) {
      // A rejection from the injected fetch can still throw.
      return { ok: false, cause: thrown }
    }
  }

  /** Retries once on a new client: this write can fail transiently right after `deleteUser`. */
  async completeDeletionRequest(requestId: string): Promise<void> {
    const first = await this.attemptCompletionWrite(requestId)
    if (first.ok) return

    const firstFailure = describeWriteFailure(first.cause)
    logger.warn(
      {
        event: 'gdpr.deletion.completion_write_retry',
        requestId,
        failure: firstFailure
      },
      'gdpr.deletion.completion_write_retry: first Article 17 ledger close failed; retrying once'
    )

    await new Promise((resolve) =>
      setTimeout(resolve, GDPRManager.COMPLETION_RETRY_DELAY_MS)
    )

    const second = await this.attemptCompletionWrite(requestId)
    if (second.ok) return

    throw new WriteFailureError(
      'Failed to mark deletion completed',
      second.cause
    )
  }

  /** An absent subject means erasure is satisfied; re-running it would fail forever. */
  private async isSubjectAuthUserAbsent(userId: string): Promise<boolean> {
    const supabase = this.getTypedServiceClient()
    const { data, error } = await supabase.auth.admin.getUserById(userId)
    if (error) {
      if (isAuthUserAlreadyAbsent(error)) return true
      throw new Error(`Failed to look up Auth user: ${error.message}`)
    }
    return !data?.user
  }

  async executeScheduledDeletions(): Promise<void> {
    const supabase = this.getServiceClient()
    try {
      const { data: pendingDeletions, error } = await supabase
        .from('gdpr_deletion_requests')
        .select('*')
        .eq('status', 'scheduled')
        .lte('scheduled_for', new Date().toISOString())
        .returns<GdprDeletionRequestRow[]>()

      if (error) throw error
      if (!pendingDeletions || pendingDeletions.length === 0) return

      for (const deletion of pendingDeletions) {
        await this.executeDeletion(deletion)
      }
    } catch (error) {
      logger.error({ err: error }, 'Error executing scheduled deletions')
    }
  }

  private async executeDeletion(
    deletion: GdprDeletionRequestRow
  ): Promise<void> {
    try {
      // An absent auth row completes only a `complete` request.
      if (
        deletion.request_type === 'complete' &&
        (await this.isSubjectAuthUserAbsent(deletion.user_id))
      ) {
        logger.info(
          {
            event: 'gdpr.deletion.subject_already_absent',
            requestId: deletion.request_id,
            userId: deletion.user_id,
            requestType: deletion.request_type
          },
          'gdpr.deletion.subject_already_absent: subject already absent; closing the Article 17 record'
        )
        await this.completeDeletionRequest(deletion.request_id)
        await this.recordDataProcessing({
          userId: deletion.user_id,
          dataType: 'deletion_completed',
          processingPurpose: 'gdpr_data_erasure',
          legalBasis: 'legal_obligation'
        })
        return
      }

      if (deletion.request_type === 'complete') {
        await this.deleteAllUserData(deletion.user_id)
      } else {
        await this.deletePartialUserData(
          deletion.user_id,
          deletion.data_categories
        )
      }

      await this.completeDeletionRequest(deletion.request_id)

      await this.recordDataProcessing({
        userId: deletion.user_id,
        dataType: 'deletion_completed',
        processingPurpose: 'gdpr_data_erasure',
        legalBasis: 'legal_obligation'
      })
    } catch (error) {
      // Leave the request `scheduled` for the next run; never cancel it.
      logger.error(
        {
          event: 'gdpr.deletion.execution_failed',
          requestId: deletion.request_id,
          userId: deletion.user_id,
          requestType: deletion.request_type,
          dataCategories: deletion.data_categories,
          error: error instanceof Error ? error.message : String(error),
          // Never values.
          failure: describeWriteFailure(error)
        },
        'gdpr.deletion.execution_failed'
      )
    }
  }

  private async deleteAllUserData(userId: string): Promise<void> {
    await eraseAllUserData(
      this.getTypedServiceClient(),
      userId,
      'gdpr_erasure',
      { recordProcessing: (record) => this.recordDataProcessing(record) }
    )
  }

  /** Completing a request for a category we do not delete violates Art. 17. */
  private static readonly SUPPORTED_PARTIAL_CATEGORIES = new Set<string>([])

  private assertPartialDeletionSupported(categories: string[]): never {
    const requested = categories.length > 0 ? categories : ['<empty>']
    logger.error(
      {
        event: 'gdpr.partial_deletion.unsupported_category',
        unsupported: requested
      },
      'Partial GDPR deletion is not implemented'
    )
    throw new Error(
      `Partial deletion not implemented for categories: ${requested.join(', ')}`
    )
  }

  /** Throws on unknown categories so the request stays scheduled. */
  private async deletePartialUserData(
    _userId: string,
    categories: string[]
  ): Promise<void> {
    if (GDPRManager.SUPPORTED_PARTIAL_CATEGORIES.size === 0) {
      this.assertPartialDeletionSupported(categories)
    }

    const unsupported = categories.filter(
      (c) => !GDPRManager.SUPPORTED_PARTIAL_CATEGORIES.has(c)
    )

    if (unsupported.length > 0) {
      logger.error(
        {
          event: 'gdpr.partial_deletion.unsupported_category',
          unsupported
        },
        'Partial GDPR deletion requested with unsupported categories'
      )
      throw new Error(
        `Partial deletion not implemented for categories: ${unsupported.join(', ')}`
      )
    }

    for (const category of categories) {
      switch (category) {
        // Every `case` here must really delete or anonymize.
        default:
          throw new Error(
            `deletePartialUserData: category "${category}" is in SUPPORTED set but has no handler`
          )
      }
    }
  }

  /** The `${userId}/...` path is what the owner-only storage RLS policy keys on. */
  private async createSecureDownload(
    userData: unknown,
    userId: string,
    requestId: string,
    attempt = 0
  ): Promise<string> {
    const supabase = this.getServiceClient()
    try {
      const dataJson = JSON.stringify(userData, null, 2)
      const dataBuffer = Buffer.from(dataJson)

      const fileName = `${userId}/gdpr-export-${requestId}.json`

      // `upsert: false`: remove a failed earlier attempt's object, or every retry is a duplicate.
      if (attempt > 0) {
        const { error: removeError } = await supabase.storage
          .from('gdpr-exports')
          .remove([fileName])
        if (removeError) {
          logger.warn(
            {
              event: 'gdpr.export.stale_object_remove_failed',
              requestId,
              failure: describeWriteFailure(removeError)
            },
            'gdpr.export.stale_object_remove_failed: could not clear a half-written export object before the retry'
          )
        }
      }

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('gdpr-exports')
        .upload(fileName, dataBuffer, {
          contentType: 'application/json',
          upsert: false
        })

      if (uploadError || !uploadData) {
        throw uploadError || new Error('Failed to upload data export')
      }

      const { data: signedUrl, error: signError } = await supabase.storage
        .from('gdpr-exports')
        .createSignedUrl(fileName, 7 * 24 * 60 * 60) // 7 days

      if (signError || !signedUrl?.signedUrl) {
        throw signError || new Error('Failed to create signed URL')
      }

      return signedUrl.signedUrl
    } catch (error) {
      logger.error({ err: error }, 'Failed to create secure download')
      throw error
    }
  }

  /** Logs unmapped types loudly: a NULL stamp means the sweep never reaches the row. */
  private calculateRetentionDate(dataType: string): string | null {
    const retentionKey = GDPR_RETENTION_KEY_BY_DATA_TYPE[dataType]

    if (retentionKey === undefined) {
      logger.error(
        { event: 'gdpr.retention.unmapped_data_type', dataType },
        'gdpr.retention.unmapped_data_type: no retention key for this data type; the row will never expire'
      )
      return null
    }

    const retentionDays = GDPR_CONFIG.retention[retentionKey]

    if (retentionDays === null || retentionDays === undefined) {
      return null
    }

    const retentionDate = new Date()
    retentionDate.setDate(retentionDate.getDate() + retentionDays)
    return retentionDate.toISOString()
  }

  /** `null` means no count was reported, not zero. */
  async cleanupExpiredData(): Promise<GdprCleanupCounts> {
    const supabase = this.getServiceClient()
    const counts: GdprCleanupCounts = {
      processingLogRowsDeleted: null,
      expiredExportRowsDeleted: null
    }
    try {
      const now = new Date().toISOString()

      const { count: processingLogRowsDeleted, error: processingLogError } =
        await supabase
          .from('gdpr_processing_log')
          .delete({ count: 'exact' })
          .lt('retention_until', now)
          .not('retention_until', 'is', null)
      if (processingLogError) throw processingLogError
      counts.processingLogRowsDeleted = processingLogRowsDeleted ?? null

      const { count: expiredExportRowsDeleted, error: expiredExportError } =
        await supabase
          .from('gdpr_data_exports')
          .delete({ count: 'exact' })
          .lt('expires_at', now)
          .not('expires_at', 'is', null)
      if (expiredExportError) throw expiredExportError
      counts.expiredExportRowsDeleted = expiredExportRowsDeleted ?? null

      logger.info(
        { event: 'gdpr.cleanup.completed', ...counts },
        'gdpr.cleanup.completed: GDPR data cleanup completed'
      )
    } catch (error) {
      logger.error(
        { event: 'gdpr.cleanup.failed', ...counts, err: error },
        'gdpr.cleanup.failed: GDPR cleanup failed'
      )
    }
    return counts
  }

  /** Uses the user's own client so RLS enforces ownership. */
  async getComplianceStatus(userId: string): Promise<{
    userId: string
    recentProcessing: GdprProcessingLogRow[]
    pendingRequests: {
      exports: GdprDataExportRow[]
      deletions: GdprDeletionRequestRow[]
    }
    dataCategories: string[]
    userRights: readonly string[]
    lastUpdated: string
  }> {
    const supabase = await this.getSupabase()
    try {
      const { data: recentProcessing } = await supabase
        .from('gdpr_processing_log')
        .select('*')
        .eq('user_id', userId)
        .order('timestamp', { ascending: false })
        .limit(10)
        .returns<GdprProcessingLogRow[]>()

      const { data: pendingExports } = await supabase
        .from('gdpr_data_exports')
        .select('*')
        .eq('user_id', userId)
        .in('status', ['pending', 'processing'])
        .returns<GdprDataExportRow[]>()

      const { data: pendingDeletions } = await supabase
        .from('gdpr_deletion_requests')
        .select('*')
        .eq('user_id', userId)
        .in('status', ['pending', 'scheduled'])
        .returns<GdprDeletionRequestRow[]>()

      return {
        userId,
        recentProcessing: recentProcessing || [],
        pendingRequests: {
          exports: pendingExports || [],
          deletions: pendingDeletions || []
        },
        dataCategories: Object.keys(GDPR_CONFIG.categories),
        userRights: GDPR_CONFIG.userRights,
        lastUpdated: new Date().toISOString()
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to get compliance status')
      throw error
    }
  }
}

export const gdprManager = new GDPRManager()
