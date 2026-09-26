// @deno-types="npm:@supabase/supabase-js@2.39.0"
import {
  createClient,
  SupabaseClient
} from 'https://esm.sh/@supabase/supabase-js@2'

export type { SupabaseClient }

export function createServiceClient(): SupabaseClient {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error(
      'Missing Supabase credentials: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY'
    )
  }

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    },
    global: {
      headers: {
        Authorization: 'Bearer ' + supabaseServiceKey,
        apikey: supabaseServiceKey
      }
    }
  })
}
