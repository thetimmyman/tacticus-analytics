// Ambient declarations for Deno edge modules imported by Node-side Vitest tests.
declare namespace Deno {
  const env: {
    get(key: string): string | undefined
    set?(key: string, value: string): void
    delete?(key: string): void
  }
  function readFile(path: string | URL): Promise<Uint8Array<ArrayBuffer>>
}

declare module 'https://esm.sh/@supabase/supabase-js@2' {
  export * from '@supabase/supabase-js'
}
