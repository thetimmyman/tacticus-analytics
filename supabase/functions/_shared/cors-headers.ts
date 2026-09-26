export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type'
}

function createCorsResponse(body: string | object, status = 200): Response {
  const content = typeof body === 'string' ? body : JSON.stringify(body)
  return new Response(content, {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json'
    }
  })
}

export function createCorsOptionsResponse(): Response {
  return new Response('ok', { headers: corsHeaders })
}
