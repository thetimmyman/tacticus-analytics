import { describe, expect, it } from 'vitest'

import {
  getFirstBooleanValue,
  getFirstStringArray,
  getFirstStringValue,
  getNestedValue,
  getNumberFromRecord,
  getRecordsArrayFromPaths,
  getStringFromRecord,
  toRecord
} from '@/app/lib/utils/coerce'

describe('coerce utilities', () => {
  const response = {
    body: {
      guild: {
        name: 'Example Guild',
        enabled: false,
        members: [{ id: 'one' }, null, 'invalid', { id: 'two' }]
      },
      bossTypes: ['Avatar', 42, 'Mortarion']
    }
  }

  it('walks object and array paths without throwing on invalid shapes', () => {
    expect(getNestedValue(response, ['body', 'guild', 'members', 1])).toBeNull()
    expect(getNestedValue(response, ['body', 'missing', 0])).toBeUndefined()
    expect(
      getNestedValue({ value: 'not-an-array' }, ['value', 0])
    ).toBeUndefined()
  })

  it('selects the first value of the requested type', () => {
    expect(
      getFirstStringValue(response, [['missing'], ['body', 'guild', 'name']])
    ).toBe('Example Guild')
    expect(
      getFirstBooleanValue(response, [
        ['missing'],
        ['body', 'guild', 'enabled']
      ])
    ).toBe(false)
    expect(getFirstStringArray(response, [['body', 'bossTypes']])).toEqual([
      'Avatar',
      'Mortarion'
    ])
  })

  it('filters record arrays and reads typed record fields', () => {
    const records = getRecordsArrayFromPaths(response, [
      ['body', 'guild', 'members']
    ])
    expect(records).toEqual([{ id: 'one' }, { id: 'two' }])
    expect(getStringFromRecord(records[0], 'id')).toBe('one')
    expect(getNumberFromRecord({ count: 2 }, 'count')).toBe(2)
    expect(toRecord(null)).toBeNull()
  })
})
