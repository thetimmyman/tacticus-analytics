import type { Json } from '@tacticus/app-core/database.generated'
import { getRuntimeProfile } from '@tacticus/app-core/runtime-profile'
import type { GdprSupabaseClient } from '@tacticus/app-core/database-extensions'
import { serviceDb } from '@/app/lib/db'
import { createDirectClient } from '@/app/lib/network/direct-supabase'
import { projectExportBundle } from '@/app/lib/compliance/export-projection'
import { registerJobHandler } from './dispatcher'
import type { JobHandler } from './types'

const exportLocalProfileData: JobHandler = async (_payload, context) => {
  if (getRuntimeProfile() !== 'desktop')
    throw new Error('Local export requires a desktop workspace')
  context.signal?.throwIfAborted()
  const { data: workspaces, error } = await createDirectClient().query<
    { subject_user_id: string }[]
  >('desktop_preview_setup?select=subject_user_id&singleton=eq.true', {
    signal: context.signal
  })
  const subject =
    Array.isArray(workspaces) && workspaces.length === 1
      ? workspaces[0]?.subject_user_id
      : null
  if (error || !subject) throw new Error('Local export workspace unavailable')
  const db = serviceDb(context.signal) as unknown as GdprSupabaseClient
  // Processing rows survive interruption and are safe to regenerate. Payloads
  // cannot select the account, destination, or data in the export.
  const { data: requests, error: requestError } = await db
    .from('gdpr_data_exports')
    .select('request_id')
    .eq('user_id', subject)
    .in('status', ['pending', 'processing'])
    .order('requested_at')
    .limit(5)
  if (requestError || !requests)
    throw new Error('Local export requests unavailable')
  let completed = 0
  for (const request of requests) {
    context.signal?.throwIfAborted()
    const { error: startError } = await db
      .from('gdpr_data_exports')
      .update({
        status: 'processing',
        processing_started_at: new Date().toISOString()
      })
      .eq('user_id', subject)
      .eq('request_id', request.request_id)
    if (startError) throw new Error('Local export could not start')
    const { data, error: collectError } = await db.rpc(
      'get_user_data_for_export',
      { p_user_id: subject }
    )
    const bundle = projectExportBundle(data)
    if (collectError) throw new Error('Local export data unavailable')
    if (
      !bundle ||
      typeof bundle !== 'object' ||
      Array.isArray(bundle) ||
      !('user_id' in bundle) ||
      bundle.user_id !== subject ||
      !('data' in bundle) ||
      !bundle.data ||
      typeof bundle.data !== 'object' ||
      Array.isArray(bundle.data) ||
      Buffer.byteLength(JSON.stringify(bundle), 'utf8') > 8 * 1024 * 1024
    ) {
      // Permanent shape/size refusal must not leave the dialog processing forever
      // or prevent later requests from being processed. Database faults retry.
      const { error: failureError } = await db
        .from('gdpr_data_exports')
        .update({ status: 'failed', data_package: null, download_url: null })
        .eq('user_id', subject)
        .eq('request_id', request.request_id)
      if (failureError)
        throw new Error('Local export refusal could not persist')
      continue
    }
    context.signal?.throwIfAborted()
    const now = Date.now()
    const { data: saved, error: saveError } = await db
      .from('gdpr_data_exports')
      .update({
        status: 'completed',
        data_package: bundle as Json,
        completed_at: new Date(now).toISOString(),
        expires_at: new Date(now + 7 * 86400000).toISOString(),
        download_url: `/api/gdpr/my-data/${request.request_id}/download`
      })
      .eq('user_id', subject)
      .eq('request_id', request.request_id)
      .select('request_id')
    if (saveError || saved?.length !== 1)
      throw new Error('Local export could not complete')
    completed++
  }
  return { status: 'ok', completed }
}

export function registerLocalProfileExportHandler(): void {
  registerJobHandler('export-local-profile-data', exportLocalProfileData)
}
