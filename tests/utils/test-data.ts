import { randomUUID } from 'crypto'

type PartialRecord<T> = {
  [K in keyof T]?: T[K]
}

export interface TestUser {
  id: string
  email: string
  displayName: string
  createdAt: string
  guildId?: string
}

export const createTestUser = (
  overrides: PartialRecord<TestUser> = {}
): TestUser => ({
  id: overrides.id ?? randomUUID(),
  email: overrides.email ?? 'test-user@example.com',
  displayName: overrides.displayName ?? 'Test User',
  createdAt: overrides.createdAt ?? new Date().toISOString(),
  guildId: overrides.guildId
})

export const createIsoDate = (date = new Date()) => date.toISOString()
