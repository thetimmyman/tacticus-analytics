import {
  DOWNLOADS_CACHE_HEADERS,
  getDownloadsState
} from '@/app/lib/downloads/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const runtime = 'nodejs'

export async function GET(request: Request) {
  const state = await getDownloadsState(
    request.headers.get('x-downloads-preview-token')
  )
  if (state.status !== 'ready')
    return Response.json(
      { status: state.status, releases: [] },
      {
        status: state.status === 'disabled' ? 404 : 503,
        headers: DOWNLOADS_CACHE_HEADERS
      }
    )
  return Response.json(
    { schemaVersion: 1, ...state },
    { headers: DOWNLOADS_CACHE_HEADERS }
  )
}
