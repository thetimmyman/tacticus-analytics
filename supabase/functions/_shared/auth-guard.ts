import { corsHeaders } from './cors-headers.ts'

/**
 * Defense in depth behind Kong: 401 unless an Authorization or apikey header is present
 * (e.g. direct container access); null when authorized.
 */
export function requireAuth(req: Request): Response | null {
  const authHeader = req.headers.get('authorization')
  const apiKey = req.headers.get('apikey')

  if (authHeader || apiKey) {
    return null // Authorized — caller provided credentials
  }

  return new Response(
    JSON.stringify({
      error: 'Unauthorized',
      message: 'Missing authorization or apikey header'
    }),
    {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    }
  )
}

/**
 * For machine-to-machine endpoints (VERIFY_JWT=false behind Kong): requires the service-role key as
 * Bearer or apikey, so anon-key holders are rejected. Fails closed if SUPABASE_SERVICE_ROLE_KEY is unset.
 */
export function requireServiceRole(req: Request): Response | null {
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  const unauthorized = () =>
    new Response(
      JSON.stringify({
        error: 'Unauthorized',
        message: 'Service role credentials required'
      }),
      {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )

  if (!serviceRoleKey) {
    return unauthorized()
  }

  const authHeader = req.headers.get('authorization') || ''
  const bearerToken = authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7).trim()
    : ''
  const apiKey = req.headers.get('apikey') || ''

  if (bearerToken === serviceRoleKey || apiKey === serviceRoleKey) {
    return null // Authorized — caller presented the service-role key
  }

  return unauthorized()
}
