import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '../../..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')

const activeMemberRoutes = [
  'app/api/wars/analytics/team/route.ts',
  'app/api/wars/analytics/lineups/route.ts',
  'app/api/wars/analytics/cores/route.ts',
  'app/api/wars/analytics/performance/route.ts',
  'app/api/wars/analytics/maps/route.ts',
  'app/api/sync/freshness/route.ts',
  'app/api/briefing/seen/route.ts'
] as const

describe('fresh membership route contract', () => {
  it.each(activeMemberRoutes)(
    '%s requires a current active membership',
    (path) => {
      const source = read(path)
      expect(source).toContain('requireActiveMembershipForApi()')
      expect(source).not.toContain('getAuthUser')
    }
  )
})
