import {
  DOWNLOADS_CACHE_HEADERS,
  getDownloadsState
} from '@/app/lib/downloads/server'
import { releaseDestination } from '@/app/lib/downloads/manifest'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const runtime = 'nodejs'

export async function GET(
  request: Request,
  context: { params: Promise<{ releaseId: string }> }
) {
  const state = await getDownloadsState(
    request.headers.get('x-downloads-preview-token')
  )
  const { releaseId } = await context.params
  const release = state.releases.find((entry) => entry.id === releaseId)
  if (!release)
    return Response.json(
      { status: 'unavailable' },
      { status: 404, headers: DOWNLOADS_CACHE_HEADERS }
    )
  return new Response(null, {
    status: 307,
    headers: {
      ...DOWNLOADS_CACHE_HEADERS,
      Location: releaseDestination(release)
    }
  })
}
