import { vi, type Mock } from 'vitest'

export interface ChainedMockOptions {
  /** 'coerce' (default) forces array data, 'raw' passes { data, error } as given, 'none' is not thenable. */
  thenMode?: 'coerce' | 'raw' | 'none'
}

// `any`-shaped because tests mutate arbitrary links after creation.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ChainedMock = any

export function createChainedMock(
  data: ChainedMock = null,
  error: ChainedMock = null,
  extraMethods: string[] = [],
  options: ChainedMockOptions = {}
): ChainedMock {
  const { thenMode = 'coerce' } = options
  const mockChain: ChainedMock = {}
  for (const method of [
    'select',
    'eq',
    'in',
    'order',
    'limit',
    ...extraMethods
  ]) {
    mockChain[method] = vi.fn().mockReturnValue(mockChain)
  }
  mockChain.maybeSingle = vi.fn().mockResolvedValue({ data, error })
  mockChain.single = vi.fn().mockResolvedValue({ data, error })
  if (thenMode !== 'none') {
    mockChain.then = (
      resolve: (result: { data: ChainedMock; error: ChainedMock }) => void
    ) =>
      resolve(
        thenMode === 'raw'
          ? { data, error }
          : { data: Array.isArray(data) ? data : [], error }
      )
  }
  return mockChain
}

export function createSupabaseMock(
  tables: Record<string, ChainedMock> | ((table: string) => ChainedMock)
): { from: Mock; rpc: Mock } {
  return {
    from: vi.fn((table: string) =>
      typeof tables === 'function' ? tables(table) : tables[table]
    ),
    rpc: vi.fn()
  }
}
