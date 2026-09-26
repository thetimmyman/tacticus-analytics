import { describe, it, expect } from 'vitest'
import { getPlaybookId } from '@/app/lib/boss-playbooks/playbook-id'

describe('getPlaybookId', () => {
  it('resolves current-season main boss names to their catalog slug', () => {
    expect(getPlaybookId('Ghazghkull')).toBe('ghazghkull')
    expect(getPlaybookId('Screamer Killer')).toBe('screamer-killer')
    expect(getPlaybookId('Rogal Dorn')).toBe('rogal-dorn')
    expect(getPlaybookId('Belisarius Cawl')).toBe('belisarius')
    expect(getPlaybookId('Riptide')).toBe('riptide')
    expect(getPlaybookId('Lion')).toBe('lion')
    expect(getPlaybookId("Lion El'Jonson")).toBe('lion')
  })

  it('resolves via case-insensitive match (prettyBossName casing) and lore names', () => {
    expect(getPlaybookId('Avatar Of Khaine')).toBe('avatar-of-khaine')
    expect(getPlaybookId('Szarekh')).toBe('silent-king')
    expect(getPlaybookId('Silent King')).toBe('silent-king')
  })

  it('returns null for an unmapped name (prime lore names) so callers fall back', () => {
    expect(getPlaybookId('Tanksmasha')).toBeNull()
    expect(getPlaybookId('Gibbascrapz')).toBeNull()
    expect(getPlaybookId('')).toBeNull()
  })
})
