import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// A route that builds the session client can refresh the session mid-request, which
// attaches a rotated auth cookie; a public Cache-Control would let a CDN keep it.
const SESSION_CLIENT = /\bawait db\(\)|from '@\/app\/lib\/auth\/server'/
const PUBLIC_CACHE = /['"]Cache-Control['"]\s*:\s*[`'"][^`'"]*\bpublic\b/

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return routeFiles(path)
    return name === 'route.ts' ? [path] : []
  })
}

describe('API routes that use the session client are never publicly cached', () => {
  it('finds no route combining the session client with a public Cache-Control', () => {
    const offenders = routeFiles('app/api').filter((file) => {
      const src = readFileSync(file, 'utf8')
      return SESSION_CLIENT.test(src) && PUBLIC_CACHE.test(src)
    })
    expect(offenders).toEqual([])
  })

  it('detects the pattern it guards against (negative control)', () => {
    const src = `const supabase = await db()\nreturn NextResponse.json(x, { headers: { 'Cache-Control': 'public, max-age=60' } })`
    expect(SESSION_CLIENT.test(src) && PUBLIC_CACHE.test(src)).toBe(true)
  })
})
