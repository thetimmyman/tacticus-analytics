import { beforeAll, beforeEach, vi } from 'vitest'
import { config as loadEnv } from 'dotenv'
import '@testing-library/jest-dom/vitest'

loadEnv({ path: '.env.local', override: false })
loadEnv({ path: '.env', override: false })
process.env.NODE_ENV = 'test'
const DEFAULT_TEST_ANON_KEY = ''
const DEFAULT_TEST_SERVICE_ROLE_KEY = ''
const DEFAULT_TEST_ENCRYPTION_KEY = 'test-encryption-key'

const isPlaceholderValue = (value?: string | null) =>
  !value ||
  value.includes('placeholder') ||
  value.startsWith('unit-test-') ||
  value.startsWith('test-') ||
  value.startsWith('your_') ||
  value.startsWith('your-')

const backupEnv: Record<string, string> | null = null

const applyBackupValue = (key: string) => {
  if (!backupEnv?.[key]) return
  const currentValue = process.env[key]
  if (!currentValue || isPlaceholderValue(currentValue)) {
    process.env[key] = backupEnv[key]
  }
}

applyBackupValue('NEXT_PUBLIC_SUPABASE_URL')
applyBackupValue('SUPABASE_URL')
applyBackupValue('NEXT_PUBLIC_SUPABASE_ANON_KEY')
applyBackupValue('SUPABASE_ANON_KEY')
applyBackupValue('SUPABASE_SERVICE_ROLE_KEY')

const unsetEnvVar = (key: string) => {
  if (process.env[key]) {
    delete process.env[key]
  }
}

unsetEnvVar('KV_REST_API_URL')
unsetEnvVar('KV_REST_API_TOKEN')
unsetEnvVar('UPSTASH_REDIS_REST_URL')
unsetEnvVar('UPSTASH_REDIS_REST_TOKEN')
unsetEnvVar('REDIS_URL')

process.env.CACHE_BACKEND = 'memory'
process.env.APP_CACHE_UNIFIED_CACHE = 'false'

// Neutral by default; auth suites unmock it to prove deny and fail-closed paths.
vi.mock('@/app/lib/auth/user-bans', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/app/lib/auth/user-bans')>()
  return {
    ...actual,
    findActiveBanForAuthUser: vi.fn().mockResolvedValue(null)
  }
})

// Route tests call a handler many times from one client; limiter suites `vi.unmock()` this.
vi.mock(
  '@/app/lib/middleware/api-security-middleware',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('@/app/lib/middleware/api-security-middleware')
      >()
    return {
      ...actual,
      apiSecurityMiddleware: vi.fn().mockResolvedValue(null)
    }
  }
)

/** Map-backed so write assertions can fail; keys mirror as own properties for `Object.keys()`. */
const createTestLocalStorage = (): Storage => {
  const entries = new Map<string, string>()
  const storage = {} as Storage
  const asRecord = storage as unknown as Record<string, unknown>
  const defineMethod = (name: string, value: unknown) => {
    Object.defineProperty(storage, name, {
      value,
      writable: true,
      configurable: true,
      enumerable: false
    })
  }
  const mirrorKeys = () => {
    for (const key of Object.keys(storage)) delete asRecord[key]
    for (const [key, value] of entries) {
      Object.defineProperty(storage, key, {
        value,
        writable: true,
        configurable: true,
        enumerable: true
      })
    }
  }

  // Storage coerces both key and value to strings.
  defineMethod(
    'getItem',
    vi.fn((key: unknown) => entries.get(String(key)) ?? null)
  )
  defineMethod(
    'setItem',
    vi.fn((key: unknown, value: unknown) => {
      entries.set(String(key), String(value))
      mirrorKeys()
    })
  )
  defineMethod(
    'removeItem',
    vi.fn((key: unknown) => {
      entries.delete(String(key))
      mirrorKeys()
    })
  )
  defineMethod(
    'clear',
    vi.fn(() => {
      entries.clear()
      mirrorKeys()
    })
  )
  defineMethod(
    'key',
    vi.fn((index: number) => Array.from(entries.keys())[index] ?? null)
  )
  Object.defineProperty(storage, 'length', {
    get: () => entries.size,
    configurable: true
  })
  return storage
}

const installTestLocalStorage = () => {
  Object.defineProperty(window, 'localStorage', {
    value: createTestLocalStorage(),
    writable: true,
    configurable: true
  })
}

beforeAll(() => {
  process.env.NODE_ENV = 'test'

  process.env.NEXT_PUBLIC_SUPABASE_URL ||=
    process.env.SUPABASE_URL || 'http://localhost:54321'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||=
    process.env.SUPABASE_ANON_KEY || DEFAULT_TEST_ANON_KEY
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= DEFAULT_TEST_SERVICE_ROLE_KEY
  process.env.ENCRYPTION_KEY ||= DEFAULT_TEST_ENCRYPTION_KEY
  if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(), // deprecated
        removeListener: vi.fn(), // deprecated
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn()
      }))
    })

    installTestLocalStorage()
  }

  if (typeof globalThis.IntersectionObserver === 'undefined') {
    globalThis.IntersectionObserver = vi.fn().mockImplementation(() => ({
      observe: vi.fn(),
      disconnect: vi.fn(),
      unobserve: vi.fn()
    }))
  }
})

// Also re-arms default implementations a suite replaced.
beforeEach(() => {
  if (typeof window === 'undefined') return
  installTestLocalStorage()
})

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn()
  }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/test'
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    getAll: vi.fn(() => []),
    set: vi.fn()
  })),
  headers: vi.fn(async () => new Headers())
}))

vi.mock('@/app/lib/auth/browser', () => ({
  createBrowserClient: () => ({
    auth: {
      getUser: vi.fn(),
      signOut: vi.fn()
    },
    from: vi.fn(() => {
      const mockChain = {
        select: vi.fn(() => mockChain),
        eq: vi.fn(() => mockChain),
        in: vi.fn(() => mockChain),
        not: vi.fn(() => mockChain),
        order: vi.fn(() => mockChain),
        limit: vi.fn(() => Promise.resolve({ data: [], error: null })),
        single: vi.fn(() => Promise.resolve({ data: null, error: null }))
      }
      return mockChain
    })
  })
}))

declare global {
  var __TEST_ENV__: boolean
}

globalThis.__TEST_ENV__ = true
