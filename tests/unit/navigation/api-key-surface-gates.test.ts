import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  getVisibleWorkspaceSections,
  workspaces
} from '@/app/components/navigation/workspaces'

/**
 * /api-keys is gated at MEMBER at every layer (roster sync can lag an officer).
 * Credential writes are own-guild only; removal stays officer+ because it disables auto_sync.
 */

const repoRoot = join(__dirname, '..', '..', '..')

/** The files under test quote old gate values in comments. */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const readSource = (relativePath: string) =>
  stripComments(readFileSync(join(repoRoot, relativePath), 'utf8'))

const GUILD_CONSOLE_HREF = '/api-keys'
const PERSONAL_KEY_HREF = '/profile#api-key'

describe('API-key surfaces are gated consistently at member', () => {
  const settings = workspaces.find((workspace) => workspace.id === 'settings')

  it('advertises the guild console to every rank (but not onboarding)', () => {
    expect(settings).toBeDefined()

    const guildConsole = settings!.sections.find(
      (section) => section.href === GUILD_CONSOLE_HREF
    )
    expect(guildConsole).toBeDefined()
    // The full rank enum: an ungated section also renders for `onboarding` users.
    expect(guildConsole!.roles).toEqual(['member', 'officer', 'leader'])
  })

  it('shows both the guild console and the personal key to every rank', () => {
    for (const effectiveRole of ['member', 'officer', 'leader'] as const) {
      const sections = getVisibleWorkspaceSections(settings!, {
        effectiveRole,
        isAlphaDeployment: false
      }).map((section) => section.href)

      expect(sections).toContain(GUILD_CONSOLE_HREF)
      expect(sections).toContain(PERSONAL_KEY_HREF)
    }
  })

  it('gates the guild console page at member, matching the update routes', () => {
    const page = readSource('app/(dashboard)/api-keys/page.tsx')

    expect(page).toContain("requireRole('member')")
    expect(page).not.toContain("requireRole('officer')")
    expect(page).not.toContain("requireRole('leader')")
  })

  it('does not rank-gate the guild console in the proxy', () => {
    const proxy = readSource('proxy.ts')

    const officerPaths = proxy.match(/const officerPaths = \[([^\]]*)\]/)
    expect(officerPaths).not.toBeNull()
    expect(officerPaths![1]).not.toContain(`'${GUILD_CONSOLE_HREF}'`)

    // If the leader-only branch returns, re-derive the boundary from the backend.
    expect(proxy).not.toMatch(/const leaderPaths\s*=/)
    expect(proxy).not.toContain('required=leader')
  })

  it('keeps /api-keys behind the proxy auth boundary at all', () => {
    const proxy = readSource('proxy.ts')
    const protectedPaths = proxy.match(/const PROTECTED_PATHS = \[([^\]]*)\]/)

    expect(protectedPaths).not.toBeNull()
    expect(protectedPaths![1]).toContain(`'${GUILD_CONSOLE_HREF}'`)
  })

  it('keeps the personal-key anchor the nav link points at', () => {
    const profilePage = readSource('app/(dashboard)/profile/page.tsx')

    expect(profilePage).toContain('id="api-key"')
    expect(profilePage).toContain('<ReweaveLink')
  })

  it('authorizes the update paths at own-guild membership, not requireGuildMember', () => {
    for (const route of [
      'app/api/guild/update-api-key/route.ts',
      'app/api/guild/replace-api-key/route.ts'
    ]) {
      const source = readSource(route)
      expect(source).toContain('requireGuildCredentialMember')
      // requireGuildMember admits peer-guild cluster leaders to credential writes.
      expect(source).not.toMatch(/requireGuildMember\b/)
    }
  })

  it('keeps removal on the officer-or-leader authority', () => {
    const updateRoute = readSource('app/api/guild/update-api-key/route.ts')
    expect(updateRoute).toContain('requireGuildCredentialAuthority')

    const permissions = readSource('app/lib/auth/guild-permissions.ts')
    const authority = permissions.slice(
      permissions.indexOf('export const requireGuildCredentialAuthority')
    )
    expect(authority).toContain("profile.role === 'leader'")
    expect(authority).toContain("profile.role === 'officer'")
  })

  // Remove would 403 for members after the confirm, so it is not rendered.
  it('hides the Remove control from members (canRemove gate)', () => {
    const page = readSource('app/(dashboard)/api-keys/page.tsx')
    expect(page).toContain(
      "const canRemove = profile.role === 'officer' || profile.role === 'leader'"
    )
    expect(page).toContain('canRemove={canRemove}')

    const client = readSource(
      'app/(dashboard)/api-keys/ApiKeyManagementClient.tsx'
    )
    expect(client).toMatch(/\{canRemove && \(\s*<button/)
    expect(client).toMatch(/\{canRemove && \(\s*<ConfirmDialog/)
  })

  it('keeps the member helper free of any role predicate or cluster fallback', () => {
    const permissions = readSource('app/lib/auth/guild-permissions.ts')
    const start = permissions.indexOf(
      'export const requireGuildCredentialMember'
    )
    expect(start).toBeGreaterThan(-1)
    const end = permissions.indexOf('export const', start + 1)
    const member = permissions.slice(start, end === -1 ? undefined : end)

    expect(member).toContain('fetchCurrentProfile')
    expect(member).not.toContain('profile.role')
    expect(member).not.toContain('cluster')
  })
})
