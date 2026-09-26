import { describe, it, expect } from 'vitest'
import { rowsToCsv } from '@/app/lib/utils/csv'

describe('rowsToCsv', () => {
  it('quotes every field and joins rows with CRLF', () => {
    const csv = rowsToCsv(['Player', 'Damage'], [['Alice', 1234]])
    expect(csv).toBe('"Player","Damage"\r\n"Alice","1234"')
  })

  it('escapes embedded quotes by doubling them', () => {
    const csv = rowsToCsv(['Name'], [['the "Boss"']])
    expect(csv).toBe('"Name"\r\n"the ""Boss"""')
  })

  it('keeps commas and newlines inside a single field intact', () => {
    const csv = rowsToCsv(['Note'], [['a,b\nc']])
    expect(csv).toBe('"Note"\r\n"a,b\nc"')
    expect(csv.split('\r\n')).toHaveLength(2)
  })

  it('renders null and undefined as empty quoted cells', () => {
    const csv = rowsToCsv(['A', 'B'], [[null, undefined]])
    expect(csv).toBe('"A","B"\r\n"",""')
  })

  it('emits only the header row when there are no data rows', () => {
    expect(rowsToCsv(['A', 'B'], [])).toBe('"A","B"')
  })
})
